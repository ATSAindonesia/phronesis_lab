// Package files menyediakan API read-only untuk menelusuri file di dalam
// PROJECT_ROOT (fitur Code Explorer, page /lab/files).
package files

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
)

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/files/tree", h.Tree)
	mux.HandleFunc("GET /api/files/content", h.Content)
}

// Tree menangani GET /api/files/tree?path=...
// Mengembalikan satu level isi directory (lazy scan, tidak rekursif).
func (h *Handler) Tree(w http.ResponseWriter, r *http.Request) {
	path, entries, err := h.ListDir(r.URL.Query().Get("path"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"path":    path,
		"entries": entries,
	})
}

// Content menangani GET /api/files/content?path=...
// Mengembalikan isi file (maks 1 MB) + label language untuk highlighting.
func (h *Handler) Content(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	if strings.TrimSpace(rel) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Query parameter 'path' is required")
		return
	}
	fc, err := h.ReadFile(rel)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fc)
}

// writeError memetakan sentinel error internal ke response JSON + status HTTP.
func (h *Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errBadRequest):
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid path or request")
	case errors.Is(err, errForbidden):
		writeError(w, http.StatusForbidden, "PATH_FORBIDDEN", "Access outside project root is not allowed")
	case errors.Is(err, errBinary):
		writeError(w, http.StatusForbidden, "FILE_FORBIDDEN", "Binary or credential files are not readable")
	case errors.Is(err, errNotFound):
		writeError(w, http.StatusNotFound, "FILE_NOT_FOUND", "File or directory not found")
	case errors.Is(err, errTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "File exceeds the 1 MB limit")
	default:
		log.Printf("files: internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Internal server error")
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]interface{}{
		"error": map[string]string{"code": code, "message": message},
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
