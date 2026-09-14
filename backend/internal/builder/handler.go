package builder

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// RegisterRoutes mounts the OpenComputer-compatible surface. The frontend
// proxy (Next.js) forwards these with X-API-Key; we accept any non-empty key
// but require the header so accidental open access is impossible.
func (st *Store) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/sessions", st.hCreate)
	mux.HandleFunc("GET /v1/sessions/{id}", st.hGet)
	mux.HandleFunc("POST /v1/sessions/{id}/messages", st.hMessage)
	mux.HandleFunc("GET /v1/sessions/{id}/events", st.hEvents)
	RegisterPreviewProxy(mux)
}

func (st *Store) authed(r *http.Request) bool {
	key := r.Header.Get("X-API-Key")
	if key == "" {
		key = r.URL.Query().Get("api_key")
	}
	return key != ""
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (st *Store) hCreate(w http.ResponseWriter, r *http.Request) {
	if !st.authed(r) {
		jsonErr(w, http.StatusUnauthorized, "X-API-Key header is required")
		return
	}
	var body struct {
		Prompt string `json:"prompt"`
		UserID string `json:"user_id"`
		Email  string `json:"user_email"`
		Name   string `json:"user_name"`
		// AgentConfig lets a specialized frontend (e.g. UI/UX design lab)
		// override the agent's system prompt for this session.
		AgentConfig struct {
			SystemPrompt string `json:"system_prompt"`
		} `json:"agent_config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(body.Prompt) == "" {
		jsonErr(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if body.UserID == "" {
		body.UserID = "local"
	}
	s, err := st.Create(body.UserID, body.Email, body.Name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sp := strings.TrimSpace(body.AgentConfig.SystemPrompt); sp != "" {
		s.SystemPrompt = sp
	}
	s.emit(AgentEvent{Type: "ready"})
	st.QueueTurn(s, body.Prompt)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"session": s.snapshot(),
	})
}

func (st *Store) find(r *http.Request) (*Session, bool) {
	s := st.Get(r.PathValue("id"))
	return s, s != nil
}

func (st *Store) hGet(w http.ResponseWriter, r *http.Request) {
	if !st.authed(r) {
		jsonErr(w, http.StatusUnauthorized, "api_key required")
		return
	}
	s, ok := st.find(r)
	if !ok {
		jsonErr(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"session": s.snapshot()})
}

func (st *Store) hMessage(w http.ResponseWriter, r *http.Request) {
	if !st.authed(r) {
		jsonErr(w, http.StatusUnauthorized, "api_key required")
		return
	}
	s, ok := st.find(r)
	if !ok {
		jsonErr(w, http.StatusNotFound, "session not found")
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
		jsonErr(w, http.StatusBadRequest, "message is required")
		return
	}
	st.QueueTurn(s, body.Message)
	writeJSON(w, http.StatusOK, map[string]interface{}{"session": s.snapshot()})
}

// hEvents is the SSE stream: replay history, then live events, with pings.
func (st *Store) hEvents(w http.ResponseWriter, r *http.Request) {
	if !st.authed(r) {
		jsonErr(w, http.StatusUnauthorized, "api_key required")
		return
	}
	s, ok := st.find(r)
	if !ok {
		jsonErr(w, http.StatusNotFound, "session not found")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		jsonErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	replay, live, cancel := s.subscribe()
	defer cancel()

	send := func(ev AgentEvent) {
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}
	for _, ev := range replay {
		send(ev)
	}
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	// kick so EventSource opens immediately
	fmt.Fprint(w, ": ok\n\n")
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case ev := <-live:
			send(ev)
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
