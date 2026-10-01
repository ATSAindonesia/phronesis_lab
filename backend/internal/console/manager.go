package console

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// errMaxSessions dikembalikan saat slot terminal penuh (HTTP 409).
var errMaxSessions = errors.New("maximum 5 terminals reached")

// Session adalah satu shell interaktif di atas PTY.
type Session struct {
	ID        string
	CreatedAt time.Time
	Cols      int
	Rows      int

	mu       sync.Mutex
	master   *os.File
	cmd      *exec.Cmd
	subs     map[chan []byte]struct{}
	scroll   []byte // ring scrollback terakhir (cap scrollbackCap)
	lastIO   int64
	exited   bool
	exitCode int
	waitDone chan struct{}
}

// Manager menyimpan sesi terminal (maks MaxSessions).
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{sessions: map[string]*Session{}}
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Snapshot adalah representasi JSON sesi (tanpa fd).
type Snapshot struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	LastIOMs  int64  `json:"last_io_ms"`
	Exited    bool   `json:"exited"`
	ExitCode  *int   `json:"exit_code,omitempty"`
}

// Create membuka terminal baru (cols/rows di-clamp).
func (m *Manager) Create(cols, rows int) (*Session, error) {
	cols, rows = clampSize(cols, rows)

	m.mu.Lock()
	if len(m.sessions) >= MaxSessions {
		m.mu.Unlock()
		return nil, errMaxSessions
	}
	m.mu.Unlock()

	master, slavePath, err := openPty()
	if err != nil {
		return nil, err
	}
	cmd, err := startShell(slavePath, cols, rows)
	if err != nil {
		master.Close()
		return nil, err
	}
	masterFile := master

	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sessions) >= MaxSessions {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		masterFile.Close()
		return nil, errMaxSessions
	}
	s := &Session{
		ID:        newID(),
		CreatedAt: time.Now(),
		Cols:      cols,
		Rows:      rows,
		master:    masterFile,
		cmd:       cmd,
		subs:      map[chan []byte]struct{}{},
		lastIO:    nowMS(),
		waitDone:  make(chan struct{}),
	}
	m.sessions[s.ID] = s
	go s.pump()
	go s.reap(m)
	return s, nil
}

// Get mengambil sesi berdasarkan id.
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	return s, ok
}

// List mengembalikan snapshot semua sesi.
func (m *Manager) List() []Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Snapshot, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s.snapshot())
	}
	return out
}

// Kill menghentikan proses + menutup PTY + menghapus sesi.
func (m *Manager) Kill(id string) bool {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return false
	}
	s.shutdown()
	return true
}

// Count jumlah sesi aktif.
func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

func (s *Session) snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := Snapshot{
		ID:        s.ID,
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339),
		Cols:      s.Cols,
		Rows:      s.Rows,
		LastIOMs:  s.lastIO,
		Exited:    s.exited,
	}
	if s.exited {
		c := s.exitCode
		snap.ExitCode = &c
	}
	return snap
}

// Write mengirim byte input ke PTY (dipanggil handler POST /input).
func (s *Session) Write(p []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.exited {
		return errors.New("session exited")
	}
	s.lastIO = nowMS()
	// Tulis sampai habis; master blocking — buffer PTY terkuras cepat
	// karena pump selalu membaca.
	for len(p) > 0 {
		n, err := s.master.Write(p)
		if err != nil {
			return err
		}
		p = p[n:]
	}
	return nil
}

// Resize mengubah ukuran PTY.
func (s *Session) Resize(cols, rows int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cols, rows = clampSize(cols, rows)
	s.Cols, s.Rows = cols, rows
	if !s.exited {
		setWinsize(s.master, cols, rows)
	}
}

// Subscribe mendaftarkan channel output (buffered). Kembalikan fungsi
// unsubscribe + salinan scrollback saat ini.
func (s *Session) Subscribe() (ch chan []byte, scrollback []byte, cancel func()) {
	ch = make(chan []byte, 64)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	scrollback = append([]byte(nil), s.scroll...)
	exited := s.exited
	code := s.exitCode
	s.mu.Unlock()
	cancel = func() {
		s.mu.Lock()
		if _, ok := s.subs[ch]; ok {
			delete(s.subs, ch)
			close(ch)
		}
		s.mu.Unlock()
	}
	if exited {
		// Sesi sudah mati sebelum subscribe — kirim sentinel exit langsung.
		go func() {
			select {
			case ch <- exitSentinel(code):
			default:
			}
		}()
	}
	return ch, scrollback, cancel
}

// pump membaca master PTY dan broadcast ke subscriber + scrollback.
func (s *Session) pump() {
	buf := make([]byte, readChunk)
	for {
		n, err := s.master.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			s.mu.Lock()
			s.lastIO = nowMS()
			s.scroll = append(s.scroll, chunk...)
			if len(s.scroll) > scrollbackCap {
				s.scroll = s.scroll[len(s.scroll)-scrollbackCap:]
			}
			for ch := range s.subs {
				select {
				case ch <- chunk:
				default:
					// Subscriber lambat — drop chunk ini daripada blokir pump.
				}
			}
			s.mu.Unlock()
		}
		if err != nil {
			// EOF/EIO: child mati atau master ditutup.
			return
		}
	}
}

// exitSentinel adalah payload khusus penanda sesi berakhir.
func exitSentinel(code int) []byte {
	return []byte{0xFF, byte(code >> 8), byte(code)}
}

// reap menunggu proses selesai, menandai exited, lalu menutup subscriber.
func (s *Session) reap(m *Manager) {
	err := s.cmd.Wait()
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if ws, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				code = ws.ExitStatus()
			} else {
				code = 1
			}
		}
	}
	s.mu.Lock()
	s.exited = true
	s.exitCode = code
	for ch := range s.subs {
		select {
		case ch <- exitSentinel(code):
		default:
		}
		close(ch)
	}
	s.subs = map[chan []byte]struct{}{}
	s.mu.Unlock()
	close(s.waitDone)
}

// shutdown dipakai Kill: bunuh proses + tutup master.
// Sesi yang sudah exited: cukup tutup master.
func (s *Session) shutdown() {
	s.mu.Lock()
	master := s.master
	exited := s.exited
	s.mu.Unlock()
	if !exited && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		select {
		case <-s.waitDone:
		case <-time.After(3 * time.Second):
		}
	}
	_ = master.Close()
}

// IsExitSentinel memeriksa payload penanda exit.
func IsExitSentinel(p []byte) (bool, int) {
	if len(p) == 3 && p[0] == 0xFF {
		return true, int(p[1])<<8 | int(p[2])
	}
	return false, 0
}
