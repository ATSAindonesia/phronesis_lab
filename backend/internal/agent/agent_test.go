package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeLLM adalah upstream OpenAI-compatible palsu dengan skrip respons.
type fakeLLM struct {
	t        *testing.T
	script   []string // respons mentah per panggilan
	calls    int
	lastBody map[string]interface{}
}

func (f *fakeLLM) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.lastBody = body
	idx := f.calls
	if idx >= len(f.script) {
		idx = len(f.script) - 1
	}
	f.calls++
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(f.script[idx]))
}

func choiceMsg(content string) string {
	return `{"choices":[{"message":{"role":"assistant","content":` +
		quoteJSON(content) + `},"finish_reason":"stop"}]}`
}

func choiceTools(calls string) string {
	return `{"choices":[{"message":{"role":"assistant","content":"","tool_calls":[` +
		calls + `]},"finish_reason":"tool_calls"}]}`
}

func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestLoopNoTool(t *testing.T) {
	f := &fakeLLM{script: []string{choiceMsg("Halo, jawaban langsung.")}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	// Registry manual tanpa files (hindari nil handler).
	a := NewAgent([]Tool{
		{Name: "clock", Description: "clock", Schema: map[string]interface{}{"type": "object"},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				return "2026-01-01T00:00:00Z", nil
			}},
	}, nil, 5)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"

	var traces []map[string]interface{}
	emit := func(ev map[string]interface{}) { traces = append(traces, ev) }
	final, iters, used, err := a.Run(context.Background(), emit, "", "", []Message{{Role: "user", Content: "hai"}}, 0.7)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if final != "Halo, jawaban langsung." {
		t.Fatalf("final = %q", final)
	}
	if iters != 1 || used != 0 {
		t.Fatalf("iters=%d used=%d, want 1/0", iters, used)
	}
	// tools harus dikirim ke upstream
	tools, _ := f.lastBody["tools"].([]interface{})
	if len(tools) != 1 {
		t.Fatalf("tools terkirim = %d, want 1", len(tools))
	}
}

func TestLoopToolThenAnswer(t *testing.T) {
	tc := `{"id":"call-1","type":"function","function":{"name":"clock","arguments":"{}"}}`
	f := &fakeLLM{script: []string{choiceTools(tc), choiceMsg("Sekarang jamnya sudah diketahui.")}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	a := NewAgent([]Tool{
		{Name: "clock", Description: "clock", Schema: map[string]interface{}{"type": "object"},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				return "2026-05-05T05:05:05Z", nil
			}},
	}, nil, 5)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"

	var kinds []string
	emit := func(ev map[string]interface{}) {
		if ev["type"] == "trace" {
			kinds = append(kinds, ev["kind"].(string))
		}
	}
	final, iters, used, err := a.Run(context.Background(), emit, "", "", []Message{{Role: "user", Content: "jam berapa?"}}, 0.7)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if final != "Sekarang jamnya sudah diketahui." {
		t.Fatalf("final = %q", final)
	}
	if iters != 2 || used != 1 {
		t.Fatalf("iters=%d used=%d, want 2/1", iters, used)
	}
	joined := strings.Join(kinds, ",")
	for _, want := range []string{"iteration", "tool_call", "tool_result", "done"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("trace %q hilang: %s", want, joined)
		}
	}
}

func TestApprovalDenied(t *testing.T) {
	tc := `{"id":"call-9","type":"function","function":{"name":"run_shell","arguments":"{\"command\":\"rm -rf /tmp/x\"}"}}`
	f := &fakeLLM{script: []string{choiceTools(tc), choiceMsg("Baik, tidak jadi dihapus.")}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	executed := false
	a := NewAgent([]Tool{
		{Name: "run_shell", Description: "shell", Schema: map[string]interface{}{"type": "object"},
			NeedsApproval: true,
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				executed = true
				return "x", nil
			}},
	}, func(ctx context.Context, callID, toolName, command string) bool {
		if command != "rm -rf /tmp/x" {
			t.Fatalf("command = %q", command)
		}
		return false // user menolak
	}, 5)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"

	final, _, _, err := a.Run(context.Background(), func(ev map[string]interface{}) {}, "", "", []Message{{Role: "user", Content: "hapus x"}}, 0.7)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if executed {
		t.Fatal("tool tereksekusi padahal ditolak")
	}
	if final != "Baik, tidak jadi dihapus." {
		t.Fatalf("final = %q", final)
	}
}

func TestMaxIterStops(t *testing.T) {
	tc := `{"id":"c","type":"function","function":{"name":"clock","arguments":"{}"}}`
	f := &fakeLLM{script: []string{choiceTools(tc)}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	a := NewAgent([]Tool{
		{Name: "clock", Description: "clock", Schema: map[string]interface{}{"type": "object"},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				return "t", nil
			}},
	}, nil, 3)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"

	_, iters, used, err := a.Run(context.Background(), func(ev map[string]interface{}) {}, "", "", []Message{{Role: "user", Content: "loop"}}, 0.7)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if iters != 3 || used != 3 {
		t.Fatalf("iters=%d used=%d, want 3/3", iters, used)
	}
	if f.calls != 3 {
		t.Fatalf("upstream calls = %d, want 3", f.calls)
	}
}

func TestApprovalsRendezvous(t *testing.T) {
	ap := newApprovals()
	ch := ap.wait("c1")
	go func() {
		time.Sleep(20 * time.Millisecond)
		if !ap.answer("c1", true) {
			t.Error("answer gagal")
		}
	}()
	select {
	case ok := <-ch:
		if !ok {
			t.Fatal("expected approved")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout menunggu answer")
	}
	if ap.answer("c1", true) {
		t.Fatal("answer kedua harus 404/false")
	}
	if ap.answer("unknown", true) {
		t.Fatal("unknown harus false")
	}
}

func TestToolsEndpoint(t *testing.T) {
	h := NewHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	req := httptest.NewRequest(http.MethodGet, "/v1/agent/tools?api_key=test", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		Tools []struct {
			Name          string `json:"name"`
			NeedsApproval bool   `json:"needs_approval"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(out.Tools) != 7 {
		t.Fatalf("tools = %d, want 7", len(out.Tools))
	}
	found := false
	for _, tool := range out.Tools {
		if tool.Name == "run_shell" && tool.NeedsApproval {
			found = true
		}
	}
	if !found {
		t.Fatal("run_shell needs_approval tidak ketemu")
	}
}
