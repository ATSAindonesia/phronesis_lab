// Package console menyediakan terminal lokal (PTY) untuk halaman
// /lab/console: maksimal 5 sesi shell interaktif via SSE + POST.
//
// PTY dibuat stdlib-only (/dev/ptmx + Setctty, Linux) agar tidak menambah
// dependency. Sesi hidup sampai di-kill manual / backend restart.
package console

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"
)

// Maksimal sesi terminal bersamaan.
const MaxSessions = 5

// Chunk baca PTY per putaran pump (batasi agar burst besar tidak lag).
const readChunk = 32 << 10

// Scrollback yang dikirim ulang saat (re)connect stream.
const scrollbackCap = 64 << 10

// ioctl Linux untuk unlockpt / ptsname / winsize.
const (
	tioCSPTLCK = 0x40045431
	tioCGPTN   = 0x80045430
	tioCSWINSZ = 0x5414
)

type winsize struct {
	Row, Col, X, Y uint16
}

func ioctl(fd uintptr, req uint, arg uintptr) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, uintptr(req), arg)
	if errno != 0 {
		return errno
	}
	return nil
}

// projectRoot: PROJECT_ROOT (konvensi sama seperti Code Explorer),
// fallback working directory.
func projectRoot() string {
	if r := os.Getenv("PROJECT_ROOT"); r != "" {
		return r
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "/"
}

func defaultShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	return "/bin/bash"
}

func clampSize(cols, rows int) (int, int) {
	if cols < 20 {
		cols = 20
	}
	if cols > 500 {
		cols = 500
	}
	if rows < 5 {
		rows = 5
	}
	if rows > 200 {
		rows = 200
	}
	return cols, rows
}

// openPty membuka master PTY baru + mengembalikan path slave-nya.
// O_NOCTTY: backend berjalan sebagai session leader tanpa ctty (systemd);
// tanpa flag ini, membuka slave otomatis menjadikannya ctty milik backend,
// lalu TIOCSCTTY di child "mencuri"-nya kembali + SIGHUP ke backend.
func openPty() (master *os.File, slavePath string, err error) {
	master, err = os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, "", fmt.Errorf("open /dev/ptmx: %w", err)
	}
	var zero int32
	if err := ioctl(master.Fd(), tioCSPTLCK, uintptr(unsafe.Pointer(&zero))); err != nil {
		master.Close()
		return nil, "", fmt.Errorf("unlockpt: %w", err)
	}
	var num uint32
	if err := ioctl(master.Fd(), tioCGPTN, uintptr(unsafe.Pointer(&num))); err != nil {
		master.Close()
		return nil, "", fmt.Errorf("ptsname: %w", err)
	}
	return master, fmt.Sprintf("/dev/pts/%d", num), nil
}

func setWinsize(f *os.File, cols, rows int) {
	cols, rows = clampSize(cols, rows)
	ws := winsize{Row: uint16(rows), Col: uint16(cols)}
	_ = ioctl(f.Fd(), tioCSWINSZ, uintptr(unsafe.Pointer(&ws)))
}

// startShell menjalankan shell interaktif di atas slave PTS.
// Master PTY dipegang pemanggil (dari openPty). Mengembalikan cmd yang
// berjalan — pemanggil wajib Wait untuk panen exit code.
func startShell(slavePath string, cols, rows int) (*exec.Cmd, error) {
	// O_NOCTTY wajib di sini (lihat komentar openPty): parent tidak boleh
	// mengakuisisi slave sebagai ctty-nya. Child (session leader baru
	// via Setsid) mendapat ctty lewat TIOCSCTTY tanpa steal/SIGHUP.
	slave, err := os.OpenFile(slavePath, os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, fmt.Errorf("open slave: %w", err)
	}
	defer slave.Close()
	setWinsize(slave, cols, rows)

	shell := defaultShell()
	cmd := exec.Command(shell, "-i")
	cmd.Dir = projectRoot()
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	cmd.Stdin = slave
	cmd.Stdout = slave
	cmd.Stderr = slave
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid: true,
		// Ctty adalah index ke ProcAttr.Files di child: slave terpasang
		// sebagai stdin/stdout/stderr -> fd 0/1/2, pakai 0.
		Setctty: true,
		Ctty:    0,
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start shell: %w", err)
	}
	return cmd, nil
}

// nowMS jam milidetik untuk LastIO.
func nowMS() int64 {
	return time.Now().UnixMilli()
}
