package console

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testHandler() *Handler {
	h := NewHandler()
	return h
}

// killAll membersihkan sesi agar proses shell tidak bocor antar test.
func killAll(t *testing.T, h *Handler) {
	t.Helper()
	t.Cleanup(func() {
		for _, s := range h.mgr.List() {
			h.mgr.Kill(s.ID)
		}
	})
}

func doReq(h *Handler, method, target, body string) *httptest.ResponseRecorder {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target+"?api_key=test", strings.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target+"?api_key=test", nil)
	}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	return rec
}

func TestCreateAndList(t *testing.T) {
	h := testHandler()
	killAll(t, h)
	rec := doReq(h, "POST", "/api/console/sessions", `{"cols":80,"rows":24}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Session Snapshot `json:"session"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if created.Session.ID == "" {
		t.Fatal("empty session id")
	}

	rec = doReq(h, "GET", "/api/console/sessions", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var listed struct {
		Sessions []Snapshot `json:"sessions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("invalid list json: %v", err)
	}
	if len(listed.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(listed.Sessions))
	}
}

func TestMaxFiveSessions(t *testing.T) {
	h := testHandler()
	killAll(t, h)
	for i := 0; i < MaxSessions; i++ {
		rec := doReq(h, "POST", "/api/console/sessions", `{}`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create %d: status = %d: %s", i, rec.Code, rec.Body.String())
		}
	}
	rec := doReq(h, "POST", "/api/console/sessions", `{}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("6th create: status = %d, want 409", rec.Code)
	}
}

func TestInputEchoRoundtrip(t *testing.T) {
	h := testHandler()
	killAll(t, h)
	rec := doReq(h, "POST", "/api/console/sessions", `{"cols":120,"rows":30}`)
	var created struct {
		Session Snapshot `json:"session"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	id := created.Session.ID

	// Buka stream SSE dengan satu reader goroutine; body ditutup eksplisit
	// di akhir test (defer LIFO: body dulu, baru srv) agar srv.Close()
	// tidak menggantung menunggu stream terbuka.
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	streamReq, err := http.NewRequest(http.MethodGet,
		srv.URL+"/api/console/sessions/"+id+"/stream?api_key=test", nil)
	if err != nil {
		t.Fatalf("build stream request: %v", err)
	}
	streamRes, err := http.DefaultClient.Do(streamReq)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer streamRes.Body.Close()

	type sseChunk struct {
		raw []byte
		ok  bool
	}
	chunks := make(chan sseChunk, 64)
	go func() {
		defer close(chunks)
		sc := bufio.NewScanner(streamRes.Body)
		sc.Buffer(make([]byte, 0, 1<<20), 1<<20)
		for sc.Scan() {
			line := sc.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var ev map[string]interface{}
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &ev); err != nil {
				continue
			}
			d, _ := ev["data"].(string)
			raw, err := base64.StdEncoding.DecodeString(d)
			if err != nil || len(raw) == 0 {
				continue
			}
			chunks <- sseChunk{raw, true}
		}
	}()

	// nextOutput menunggu chunk output berikutnya sampai timeout.
	nextOutput := func(timeout time.Duration) []byte {
		select {
		case <-time.After(timeout):
			return nil
		case c, ok := <-chunks:
			if !ok {
				return nil
			}
			return c.raw
		}
	}

	// Tunggu prompt awal (scrollback/output pertama).
	if nextOutput(10*time.Second) == nil {
		t.Fatal("timeout menunggu output awal PTY")
	}

	// Kirim perintah echo + newline.
	payload := base64.StdEncoding.EncodeToString([]byte("echo CONSOLE_OK_123\n"))
	rec = doReq(h, "POST", "/api/console/sessions/"+id+"/input", "{\"data\":\""+payload+"\"}")
	if rec.Code != http.StatusOK {
		t.Fatalf("input status = %d: %s", rec.Code, rec.Body.String())
	}

	deadline := time.Now().Add(10 * time.Second)
	for {
		raw := nextOutput(time.Until(deadline))
		if raw == nil {
			t.Fatal("timeout menunggu echo perintah")
		}
		if strings.Contains(string(raw), "CONSOLE_OK_123") {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("timeout menunggu echo perintah")
		}
	}
}

func TestKillAndResize(t *testing.T) {
	h := testHandler()
	killAll(t, h)
	rec := doReq(h, "POST", "/api/console/sessions", `{}`)
	var created struct {
		Session Snapshot `json:"session"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	id := created.Session.ID

	rec = doReq(h, "POST", "/api/console/sessions/"+id+"/resize", `{"cols":100,"rows":40}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("resize status = %d", rec.Code)
	}
	s, ok := h.mgr.Get(id)
	if !ok {
		t.Fatal("session hilang setelah resize")
	}
	snap := s.snapshot()
	if snap.Cols != 100 || snap.Rows != 40 {
		t.Fatalf("size = %dx%d, want 100x40", snap.Cols, snap.Rows)
	}

	rec = doReq(h, "DELETE", "/api/console/sessions/"+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("kill status = %d", rec.Code)
	}
	if h.mgr.Count() != 0 {
		t.Fatalf("count = %d, want 0", h.mgr.Count())
	}

	rec = doReq(h, "POST", "/api/console/sessions/"+id+"/input", `{"data":"eA=="}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("input ke sesi mati: status = %d, want 404", rec.Code)
	}
}

func TestRequireKey(t *testing.T) {
	h := NewHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	req := httptest.NewRequest(http.MethodGet, "/api/console/sessions", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("tanpa key: status = %d, want 401", rec.Code)
	}
}
