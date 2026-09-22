package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"lab/internal/files"
)

// Handler menyajikan agent playground: loop LLM<->tool via SSE + approval.
type Handler struct {
	filesH   *files.Handler
	approvals *approvals
}

func NewHandler() *Handler {
	return &Handler{
		filesH:   files.NewHandler(),
		approvals: newApprovals(),
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("POST /v1/agent/chat", h.requireKey(http.HandlerFunc(h.handleAgentChat)))
	mux.Handle("POST /v1/agent/approvals/{id}", h.requireKey(http.HandlerFunc(h.handleApproval)))
	mux.Handle("GET /v1/agent/tools", h.requireKey(http.HandlerFunc(h.handleTools)))
}

func (h *Handler) requireKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		if key == "" {
			key = r.URL.Query().Get("api_key")
		}
		if key == "" {
			jsonErr(w, http.StatusUnauthorized, "X-API-Key header is required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// handleTools mengembalikan daftar tool + metadata approval.
func (h *Handler) handleTools(w http.ResponseWriter, r *http.Request) {
	all := append(Registry(h.filesH), ResearchTools(NewResearchContext())...)
	type info struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		NeedsApproval bool   `json:"needs_approval"`
	}
	out := make([]info, 0, len(all))
	for _, t := range all {
		out = append(out, info{t.Name, t.Description, t.NeedsApproval})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"tools": out})
}

type agentChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type agentChatRequest struct {
	Messages      []agentChatMessage `json:"messages"`
	System        string             `json:"system,omitempty"`
	Model         string             `json:"model,omitempty"`
	Temperature   *float64           `json:"temperature,omitempty"`
	Tools         []string           `json:"tools,omitempty"`
	MaxIterations *int               `json:"max_iterations,omitempty"`
	// Research memaksa agent loop riset web (web_search + fetch_url +
	// local tools eksplisit) dengan system prompt riset + sitasi.
	// False = perilaku agent normal seperti sebelumnya.
	Research bool `json:"research,omitempty"`
}

// handleAgentChat: POST /v1/agent/chat -> SSE (trace + token + [DONE]).
func (h *Handler) handleAgentChat(w http.ResponseWriter, r *http.Request) {
	var req agentChatRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	history := make([]Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role != "user" && m.Role != "assistant" && m.Role != "system" {
			jsonErr(w, http.StatusBadRequest, "Invalid message role: "+m.Role)
			return
		}
		if strings.TrimSpace(m.Content) == "" {
			jsonErr(w, http.StatusBadRequest, "Message content is required")
			return
		}
		history = append(history, Message{Role: m.Role, Content: m.Content})
	}
	if len(history) == 0 {
		jsonErr(w, http.StatusBadRequest, "messages is required")
		return
	}

	temp := 0.7
	if req.Temperature != nil && *req.Temperature >= 0 && *req.Temperature <= 2 {
		temp = *req.Temperature
	}
	maxIter := 5
	if req.MaxIterations != nil && *req.MaxIterations >= 1 && *req.MaxIterations <= 10 {
		maxIter = *req.MaxIterations
	}

	all := Registry(h.filesH)
	var enabled []Tool
	var system string
	var rc *ResearchContext
	if req.Research {
		// Mode riset: toolset = web_search + fetch_url + local tools yang
		// disebut eksplisit. Tanpa itu, loop riset murni web.
		rc = NewResearchContext()
		enabled = append(enabled, ResearchTools(rc)...)
		want := map[string]bool{}
		for _, n := range req.Tools {
			want[strings.TrimSpace(n)] = true
		}
		for _, t := range all {
			if want[t.Name] {
				enabled = append(enabled, t)
			}
		}
		system = researchSystemPrompt
		if s := strings.TrimSpace(req.System); s != "" {
			system = s + "\n\n" + researchSystemPrompt
		}
	} else {
		if len(req.Tools) == 0 {
			enabled = all // default: semua tool
		} else {
			want := map[string]bool{}
			for _, n := range req.Tools {
				want[strings.TrimSpace(n)] = true
			}
			for _, t := range all {
				if want[t.Name] {
					enabled = append(enabled, t)
				}
			}
		}
		system = req.System
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, canFlush := w.(http.Flusher)

	// sendMu: ping ticker dan loop agent menulis ke w dari goroutine
	// berbeda — serialize agar chunk SSE tidak interleave.
	var sendMu sync.Mutex
	sendEvent := func(payload string) {
		sendMu.Lock()
		defer sendMu.Unlock()
		fmt.Fprintf(w, "data: %s\n\n", payload)
		if canFlush {
			flusher.Flush()
		}
	}
	sendComment := func(payload string) {
		sendMu.Lock()
		defer sendMu.Unlock()
		fmt.Fprint(w, payload)
		if canFlush {
			flusher.Flush()
		}
	}
	emit := func(ev map[string]interface{}) {
		b, _ := json.Marshal(ev)
		sendEvent(string(b))
	}

	// Approval: emit request, blokir sampai user menjawab / timeout.
	approve := func(ctx context.Context, callID, toolName, command string) bool {
		ch := h.approvals.wait(callID)
		emit(map[string]interface{}{
			"type": "trace", "kind": "approval_request",
			"call_id": callID, "name": toolName, "command": command,
			"timeout_sec": approvalTimeoutSec,
		})
		select {
		case ok := <-ch:
			return ok
		case <-ctx.Done():
			h.approvals.discard(callID)
			return false
		case <-time.After(approvalTimeoutSec * time.Second):
			h.approvals.discard(callID)
			emit(map[string]interface{}{
				"type": "trace", "kind": "note",
				"text": "approval timeout (120s) — otomatis ditolak",
			})
			return false
		}
	}

	sendComment(": ok\n\n")
	if req.Research {
		emit(map[string]interface{}{"type": "trace", "kind": "note", "text": "research mode: riset web dulu sebelum menjawab"})
	}
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-r.Context().Done():
				return
			case <-done:
				return
			case <-ping.C:
				sendComment(": ping\n\n")
			}
		}
	}()

	agent := NewAgent(enabled, approve, maxIter)
	final, iters, toolsUsed, err := agent.Run(r.Context(), emit, strings.TrimSpace(req.Model), system, history, temp)
	close(done)
	if err != nil {
		// Bedakan upstream vs internal agar frontend bisa menjelaskan.
		msg := err.Error()
		if strings.Contains(msg, "HTTP 400") || strings.Contains(msg, "no choices") {
			msg += " (model mungkin tidak mendukung tool-calling — coba model lain atau matikan tools)"
		}
		errPayload, _ := json.Marshal(map[string]string{"type": "error", "error": msg})
		sendEvent(string(errPayload))
		_ = iters
		_ = toolsUsed
		sendEvent("[DONE]")
		return
	}
	if final != "" {
		if req.Research && rc != nil {
			final = appendCitations(final, rc.Sources())
		}
		tokPayload, _ := json.Marshal(map[string]string{"type": "token", "delta": final})
		sendEvent(string(tokPayload))
	}
	sendEvent("[DONE]")
}

// handleApproval: POST /v1/agent/approvals/{id} {approve: bool}.
func (h *Handler) handleApproval(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approve *bool `json:"approve"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil || body.Approve == nil {
		jsonErr(w, http.StatusBadRequest, "approve is required")
		return
	}
	if !h.approvals.answer(r.PathValue("id"), *body.Approve) {
		jsonErr(w, http.StatusNotFound, "approval request not found or expired")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─── Approval rendezvous ─────────────────────────────────────────────────────

const approvalTimeoutSec = 120

type approvals struct {
	mu sync.Mutex
	m  map[string]chan bool
}

func newApprovals() *approvals {
	return &approvals{m: map[string]chan bool{}}
}

// wait mendaftarkan channel tunggu untuk callID.
func (a *approvals) wait(callID string) chan bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	ch := make(chan bool, 1)
	a.m[callID] = ch
	return ch
}

// discard menghapus pendaftaran tunggu (dipakai saat timeout/batal agar
// tidak bocor; jawaban yang datang terlambat akan 404).
func (a *approvals) discard(callID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.m, callID)
}

// answer menyampaikan keputusan user; false bila callID tidak dikenal
// (sudah timeout / loop selesai). Tidak pernah blokir (buffered).
func (a *approvals) answer(callID string, approved bool) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	ch, ok := a.m[callID]
	if !ok {
		return false
	}
	delete(a.m, callID)
	select {
	case ch <- approved:
	default:
	}
	return true
}
