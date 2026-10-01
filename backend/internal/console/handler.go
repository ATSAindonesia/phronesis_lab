package console

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Handler menyajikan API sesi terminal lokal.
type Handler struct {
	mgr *Manager
}

func NewHandler() *Handler {
	return &Handler{mgr: NewManager()}
}

// RegisterRoutes mendaftarkan endpoint console. Semua butuh X-API-Key
// non-empty (header) atau api_key (query) — pola sama dengan builder/chat;
// proxy Next.js meneruskannya server-side setelah verifikasi cookie session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/console/sessions", h.requireKey(http.HandlerFunc(h.Create)))
	mux.Handle("GET /api/console/sessions", h.requireKey(http.HandlerFunc(h.List)))
	mux.Handle("DELETE /api/console/sessions/{id}", h.requireKey(http.HandlerFunc(h.Kill)))
	mux.Handle("POST /api/console/sessions/{id}/input", h.requireKey(http.HandlerFunc(h.Input)))
	mux.Handle("POST /api/console/sessions/{id}/resize", h.requireKey(http.HandlerFunc(h.Resize)))
	mux.Handle("GET /api/console/sessions/{id}/stream", h.requireKey(http.HandlerFunc(h.Stream)))
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

func (h *Handler) session(w http.ResponseWriter, r *http.Request) (*Session, bool) {
	s, ok := h.mgr.Get(r.PathValue("id"))
	if !ok {
		jsonErr(w, http.StatusNotFound, "session not found")
		return nil, false
	}
	return s, true
}

// Create menangani POST /api/console/sessions {cols,rows}.
// 409 jika sudah 5 sesi (maksimal terminal).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body)
	if body.Cols == 0 {
		body.Cols = 80
	}
	if body.Rows == 0 {
		body.Rows = 24
	}
	s, err := h.mgr.Create(body.Cols, body.Rows)
	if err != nil {
		if err == errMaxSessions {
			jsonErr(w, http.StatusConflict, "maximum 5 terminals reached")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "failed to start terminal: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"session": s.snapshot()})
}

// List menangani GET /api/console/sessions — untuk reattach.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"sessions": h.mgr.List()})
}

// Kill menangani DELETE /api/console/sessions/{id}.
func (h *Handler) Kill(w http.ResponseWriter, r *http.Request) {
	if !h.mgr.Kill(r.PathValue("id")) {
		jsonErr(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Input menangani POST /api/console/sessions/{id}/input {data: base64}.
func (h *Handler) Input(w http.ResponseWriter, r *http.Request) {
	s, ok := h.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Data string `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	raw, err := base64.StdEncoding.DecodeString(body.Data)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "data must be base64")
		return
	}
	if err := s.Write(raw); err != nil {
		jsonErr(w, http.StatusGone, "session exited")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Resize menangani POST /api/console/sessions/{id}/resize {cols,rows}.
func (h *Handler) Resize(w http.ResponseWriter, r *http.Request) {
	s, ok := h.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	s.Resize(body.Cols, body.Rows)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Stream menangani GET /api/console/sessions/{id}/stream — SSE output PTY.
// Event: `scrollback` (sekali di awal, base64), `output` (base64 per chunk),
// `exit` ({code}). Query opsional: api_key (EventSource tanpa header).
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	s, ok := h.session(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		jsonErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	send := func(ev string, v interface{}) {
		b, _ := json.Marshal(v)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev, b)
		flusher.Flush()
	}

	ch, scrollback, cancel := s.Subscribe()
	defer cancel()

	if len(scrollback) > 0 {
		send("scrollback", map[string]string{"data": base64.StdEncoding.EncodeToString(scrollback)})
	}
	fmt.Fprint(w, ": ok\n\n")
	flusher.Flush()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	// flush mengirim pending sebagai SATU event output.
	var pending []byte
	flush := func() {
		if len(pending) == 0 {
			return
		}
		send("output", map[string]string{"data": base64.StdEncoding.EncodeToString(pending)})
		pending = nil
	}

	// drain menggabungkan burst output (maks 20ms / 128KB) menjadi satu
	// event. Di link lambat (tunnel), tiap flush SSE bisa antre detik —
	// burst yang dipecah banyak event kecil terasa patah-patah.
	drain := func(first []byte) (exit bool, code int) {
		pending = append(pending, first...)
		timer := time.NewTimer(20 * time.Millisecond)
		defer timer.Stop()
		for len(pending) < 128<<10 {
			select {
			case c, ok := <-ch:
				if !ok {
					return true, -1 // closed tanpa sentinel: akhiri stream
				}
				if isExit, code := IsExitSentinel(c); isExit {
					return true, code
				}
				pending = append(pending, c...)
			case <-timer.C:
				return false, 0
			case <-r.Context().Done():
				return true, -1
			}
		}
		return false, 0
	}

	for {
		select {
		case <-r.Context().Done():
			flush()
			return
		case <-ping.C:
			flush() // jangan biarkan output tertahan oleh jadwal ping
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case chunk, ok := <-ch:
			if !ok {
				flush()
				return
			}
			if isExit, code := IsExitSentinel(chunk); isExit {
				flush()
				send("exit", map[string]int{"code": code})
				return
			}
			if exit, code := drain(chunk); exit {
				flush()
				if code >= 0 {
					send("exit", map[string]int{"code": code})
				}
				return
			}
			flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
