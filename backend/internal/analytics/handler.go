package analytics

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// Handler menyajikan snapshot + stream SSE kondisi server.
type Handler struct {
	// Interval default antar tick SSE.
	interval time.Duration
}

// NewHandler membuat handler analytics-server.
func NewHandler() *Handler {
	return &Handler{interval: 2 * time.Second}
}

// RegisterRoutes mendaftarkan endpoint analytics-server.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/analytics/server/snapshot", h.Snapshot)
	mux.HandleFunc("GET /api/analytics/server/stream", h.Stream)
}

// Snapshot menangani GET /api/analytics/server/snapshot — satu sampel JSON.
func (h *Handler) Snapshot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Sample())
}

// Stream menangani GET /api/analytics/server/stream — push SSE realtime.
//
// Query opsional: ?interval_ms=2000 (dibatasi 1000–10000).
// Setiap tick dikirim sebagai `event: stats` + `data: {...}`,
// diselingi komentar `: ping` tiap 15 detik agar proxy tidak menutup koneksi.
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	interval := h.interval
	if q := r.URL.Query().Get("interval_ms"); q != "" {
		if ms, err := strconv.Atoi(q); err == nil {
			if ms < 1000 {
				ms = 1000
			}
			if ms > 10000 {
				ms = 10000
			}
			interval = time.Duration(ms) * time.Millisecond
		}
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
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

	// Sampel pertama langsung — first paint frontend tidak nunggu 1 interval.
	send("stats", Sample())

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	// Kick agar EventSource langsung OPEN.
	fmt.Fprint(w, ": ok\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case <-ticker.C:
			send("stats", Sample())
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
