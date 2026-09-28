// Package analytics menyediakan snapshot kondisi server (CPU, RAM, disk,
// load, uptime) + stream SSE realtime untuk halaman /lab/analytics-server.
//
// Semua sampling stdlib-only (baca /proc, syscall, runtime) agar tidak
// menambah dependency. Di non-Linux nilai yang tidak tersedia diisi 0
// dengan flag Degraded=true, handler tetap tidak crash.
package analytics

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// ServerStats adalah satu titik sampel kondisi server.
type ServerStats struct {
	CPUPercent  float64 `json:"cpu_percent"`
	MemTotalMB  float64 `json:"mem_total_mb"`
	MemUsedMB   float64 `json:"mem_used_mb"`
	MemPercent  float64 `json:"mem_percent"`
	DiskTotalGB float64 `json:"disk_total_gb"`
	DiskUsedGB  float64 `json:"disk_used_gb"`
	DiskPercent float64 `json:"disk_percent"`
	Load1       float64 `json:"load_1"`
	Load5       float64 `json:"load_5"`
	Load15      float64 `json:"load_15"`
	UptimeSec   int64   `json:"uptime_sec"`
	Goroutines  int     `json:"goroutines"`
	Degraded    bool    `json:"degraded"`
	Timestamp   string  `json:"timestamp"`
}

var startTime = time.Now()

// Sample mengambil satu titik sampel kondisi server saat ini.
func Sample() ServerStats {
	s := ServerStats{
		Goroutines: runtime.NumGoroutine(),
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
	}

	degraded := false

	if cpu, ok := readCPUPercent(); ok {
		s.CPUPercent = cpu
	} else {
		degraded = true
	}
	if total, used, ok := readMem(); ok {
		s.MemTotalMB = total
		s.MemUsedMB = used
		if total > 0 {
			s.MemPercent = round1(used / total * 100)
		}
	} else {
		degraded = true
	}
	if total, used, ok := readDisk(); ok {
		s.DiskTotalGB = total
		s.DiskUsedGB = used
		if total > 0 {
			s.DiskPercent = round1(used / total * 100)
		}
	} else {
		degraded = true
	}
	if l1, l5, l15, ok := readLoad(); ok {
		s.Load1, s.Load5, s.Load15 = l1, l5, l15
	} else {
		degraded = true
	}
	if up, ok := readUptime(); ok {
		s.UptimeSec = up
	} else {
		s.UptimeSec = int64(time.Since(startTime).Seconds())
		degraded = true
	}

	s.Degraded = degraded
	return s
}

// ─── CPU (/proc/stat, delta 200ms) ───────────────────────────────────────────

func readCPUPercent() (float64, bool) {
	idle1, total1, ok := readCPUStat()
	if !ok {
		return 0, false
	}
	time.Sleep(200 * time.Millisecond)
	idle2, total2, ok := readCPUStat()
	if !ok {
		return 0, false
	}
	idleDelta := float64(idle2 - idle1)
	totalDelta := float64(total2 - total1)
	if totalDelta <= 0 {
		return 0, false
	}
	usage := (1 - idleDelta/totalDelta) * 100
	if usage < 0 {
		usage = 0
	}
	if usage > 100 {
		usage = 100
	}
	return round1(usage), true
}

func readCPUStat() (idle, total uint64, ok bool) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 4096), 4096)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:]
		if len(fields) < 4 {
			return 0, 0, false
		}
		nums := make([]uint64, 0, len(fields))
		for _, fld := range fields {
			n, err := strconv.ParseUint(fld, 10, 64)
			if err != nil {
				return 0, 0, false
			}
			nums = append(nums, n)
		}
		var t uint64
		for _, n := range nums {
			t += n
		}
		// idle = idle + iowait (kolom ke-4 dan ke-5, 0-indexed 3 dan 4).
		idle := nums[3]
		if len(nums) > 4 {
			idle += nums[4]
		}
		return idle, t, true
	}
	return 0, 0, false
}

// ─── Memory (/proc/meminfo, MB) ──────────────────────────────────────────────

func readMem() (totalMB, usedMB float64, ok bool) {
	vals, ok := parseMeminfo()
	if !ok {
		return 0, 0, false
	}
	totalKB, ok1 := vals["MemTotal"]
	availKB, ok2 := vals["MemAvailable"]
	if !ok1 || !ok2 || totalKB == 0 {
		// Fallback: MemFree + Buffers + Cached.
		free, f1 := vals["MemFree"]
		buf, f2 := vals["Buffers"]
		cached, f3 := vals["Cached"]
		if !ok1 || !f1 || !f2 || !f3 {
			return 0, 0, false
		}
		availKB = free + buf + cached
		totalKB = vals["MemTotal"]
		if totalKB == 0 {
			return 0, 0, false
		}
		_ = ok2
	}
	totalMB = round1(float64(totalKB) / 1024)
	usedMB = round1(float64(totalKB-availKB) / 1024)
	if usedMB < 0 {
		usedMB = 0
	}
	return totalMB, usedMB, true
}

func parseMeminfo() (map[string]uint64, bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return nil, false
	}
	defer f.Close()
	out := map[string]uint64{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 16*1024), 64*1024)
	for sc.Scan() {
		// Format: "MemTotal:       4024548 kB"
		parts := strings.SplitN(sc.Text(), ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		fields := strings.Fields(strings.TrimSpace(parts[1]))
		if len(fields) == 0 {
			continue
		}
		n, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		out[key] = n
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

// ─── Disk (statfs "/") ───────────────────────────────────────────────────────

func readDisk() (totalGB, usedGB float64, ok bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err != nil {
		return 0, 0, false
	}
	if st.Blocks == 0 {
		return 0, 0, false
	}
	bs := float64(st.Bsize)
	total := float64(st.Blocks) * bs / 1e9
	free := float64(st.Bavail) * bs / 1e9
	used := total - free
	if used < 0 {
		used = 0
	}
	return round1(total), round1(used), true
}

// ─── Load average (/proc/loadavg) ────────────────────────────────────────────

func readLoad() (l1, l5, l15 float64, ok bool) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	fields := strings.Fields(string(b))
	if len(fields) < 3 {
		return 0, 0, 0, false
	}
	f1, err1 := strconv.ParseFloat(fields[0], 64)
	f5, err5 := strconv.ParseFloat(fields[1], 64)
	f15, err15 := strconv.ParseFloat(fields[2], 64)
	if err1 != nil || err5 != nil || err15 != nil {
		return 0, 0, 0, false
	}
	return round2(f1), round2(f5), round2(f15), true
}

// ─── Uptime (/proc/uptime) ───────────────────────────────────────────────────

func readUptime() (int64, bool) {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, false
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0, false
	}
	f, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, false
	}
	return int64(f), true
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}

// cpuStatLine dipakai untuk unit test parsing tanpa /proc.
func parseCPUStatLine(line string) (idle, total uint64, ok bool) {
	if !strings.HasPrefix(line, "cpu ") {
		return 0, 0, false
	}
	fields := strings.Fields(line)[1:]
	if len(fields) < 4 {
		return 0, 0, false
	}
	var nums []uint64
	for _, fld := range fields {
		n, err := strconv.ParseUint(fld, 10, 64)
		if err != nil {
			return 0, 0, false
		}
		nums = append(nums, n)
	}
	var t uint64
	for _, n := range nums {
		t += n
	}
	idle = nums[3]
	if len(nums) > 4 {
		idle += nums[4]
	}
	return idle, t, true
}
