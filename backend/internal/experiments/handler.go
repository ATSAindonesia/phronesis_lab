package experiments

import (
	"encoding/json"
	"net/http"
)

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/experiments/generate", h.Generate)
	mux.HandleFunc("POST /api/experiments/generate/stream", h.GenerateStream)
	mux.HandleFunc("GET /api/experiments/files", h.GetFiles)
}

func (h *Handler) GetFiles(w http.ResponseWriter, r *http.Request) {
	files := LoadFilesFromWorkspace()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"files":   files,
	})
}

func (h *Handler) GenerateStream(w http.ResponseWriter, r *http.Request) {
	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	_ = StreamAgentResponse(r.Context(), req.Prompt, req.Files, w)
}

func (h *Handler) Generate(w http.ResponseWriter, r *http.Request) {
	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	_ = StreamAgentResponse(r.Context(), req.Prompt, req.Files, w)
}

