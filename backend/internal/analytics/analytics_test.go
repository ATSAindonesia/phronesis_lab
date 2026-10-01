package analytics

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseCPUStatLine(t *testing.T) {
	idle, total, ok := parseCPUStatLine("cpu  100 0 50 800 50 0 0 0 0 0")
	if !ok {
		t.Fatal("expected ok=true")
	}
	if idle != 850 {
		t.Fatalf("idle = %d, want 850", idle)
	}
	if total != 1000 {
		t.Fatalf("total = %d, want 1000", total)
	}
	if _, _, ok := parseCPUStatLine("intr 123"); ok {
		t.Fatal("expected ok=false for non-cpu line")
	}
}

func TestSampleShape(t *testing.T) {
	s := Sample()
	if s.MemTotalMB < 0 || s.DiskTotalGB < 0 || s.UptimeSec < 0 {
		t.Fatalf("negative values in sample: %+v", s)
	}
	if s.Timestamp == "" {
		t.Fatal("timestamp empty")
	}
	if s.Goroutines <= 0 {
		t.Fatal("goroutines should be > 0")
	}
}

func TestSnapshotEndpoint(t *testing.T) {
	h := NewHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/analytics/server/snapshot", nil)
	rec := httptest.NewRecorder()
	h.Snapshot(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var s ServerStats
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if s.Timestamp == "" {
		t.Fatal("timestamp empty")
	}
}

func TestStreamFirstEvents(t *testing.T) {
	h := &Handler{interval: 50 * time.Millisecond}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	srv := httptest.NewServer(mux)
	defer srv.Close()

	// interval_ms di-clamp minimal 1000 oleh handler — request 1000ms
	// lalu baca 2 event pertama dengan deadline.
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/analytics/server/stream?interval_ms=1000", nil)
	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("stream request: %v", err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q", ct)
	}

	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	gotStats := 0
	deadline := time.After(6 * time.Second)
	type lineRes struct {
		line string
		ok   bool
	}
	lines := make(chan lineRes)
	go func() {
		for sc.Scan() {
			lines <- lineRes{sc.Text(), true}
		}
		close(lines)
	}()
	for gotStats < 1 {
		select {
		case <-deadline:
			t.Fatal("timeout waiting for first stats event")
		case lr, ok := <-lines:
			if !ok {
				t.Fatal("stream closed unexpectedly")
			}
			if strings.HasPrefix(lr.line, "data: ") {
				var s ServerStats
				if err := json.Unmarshal([]byte(strings.TrimPrefix(lr.line, "data: ")), &s); err != nil {
					t.Fatalf("invalid stats json: %v", err)
				}
				gotStats++
			}
		}
	}
}
