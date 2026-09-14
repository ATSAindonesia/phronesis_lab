package chat

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ─── LLM config (TokenPortal, env chain sama kayak builder) ─────────────────

type llmConfig struct {
	BaseURL string
	APIKey  string
	Model   string
}

func llmFromEnv() llmConfig {
	return llmConfig{
		BaseURL: getenvOr("CHAT_LLM_BASE_URL", getenvOr("BUILDER_LLM_BASE_URL", getenvOr("LLM_BASE_URL", getenvOr("OPENAI_BASE_URL", "https://api.tokenportal.id/v1")))),
		APIKey:  getenvOr("BUILDER_LLM_API_KEY", getenvOr("LLM_API_KEY", os.Getenv("HERMES_CUSTOM_API_TOKENPORTAL_ID_API_KEY"))),
		Model:   getenvOr("CHAT_LLM_MODEL", getenvOr("BUILDER_LLM_MODEL", getenvOr("LLM_MODEL", "qwen-3.8-flash"))),
	}
}

func getenvOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// ─── Handler ────────────────────────────────────────────────────────────────

type Handler struct {
	cfg    llmConfig
	client *http.Client
}

func NewHandler() *Handler {
	return &Handler{
		cfg:    llmFromEnv(),
		client: &http.Client{Timeout: 6 * time.Minute},
	}
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Messages    []chatMessage `json:"messages"`
	System      string        `json:"system,omitempty"`
	Model       string        `json:"model,omitempty"`
	Temperature *float64      `json:"temperature,omitempty"`
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("POST /v1/chat", h.requireKey(http.HandlerFunc(h.handleChat)))
	mux.Handle("GET /v1/chat/meta", h.requireKey(http.HandlerFunc(h.handleMeta)))
}

// requireKey: X-API-Key non-empty (header) atau api_key (query) — pola sama
// dengan builder API; proxy Next.js yang meneruskan.
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

func (h *Handler) handleMeta(w http.ResponseWriter, r *http.Request) {
	host := h.cfg.BaseURL
	if u, err := url.Parse(h.cfg.BaseURL); err == nil && u.Host != "" {
		host = u.Host
	}
	writeJSON(w, map[string]string{"model": h.cfg.Model, "provider": host})
}

func (h *Handler) handleChat(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Susun pesan final: system opsional di depan, sisanya apa adanya.
	msgs := make([]chatMessage, 0, len(req.Messages)+1)
	if s := strings.TrimSpace(req.System); s != "" {
		msgs = append(msgs, chatMessage{Role: "system", Content: s})
	}
	for _, m := range req.Messages {
		role := m.Role
		if role != "user" && role != "assistant" && role != "system" {
			jsonErr(w, http.StatusBadRequest, "Invalid message role: "+role)
			return
		}
		if strings.TrimSpace(m.Content) == "" {
			jsonErr(w, http.StatusBadRequest, "Message content is required")
			return
		}
		msgs = append(msgs, chatMessage{Role: role, Content: m.Content})
	}
	if len(msgs) == 0 {
		jsonErr(w, http.StatusBadRequest, "messages is required")
		return
	}

	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = h.cfg.Model
	}

	temp := 0.7
	if req.Temperature != nil && *req.Temperature >= 0 && *req.Temperature <= 2 {
		temp = *req.Temperature
	}

	upstreamBody, _ := json.Marshal(map[string]interface{}{
		"model":       model,
		"messages":    msgs,
		"stream":      true,
		"temperature": temp,
	})

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Minute)
	defer cancel()
	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(h.cfg.BaseURL, "/")+"/chat/completions",
		bytes.NewReader(upstreamBody))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to build upstream request")
		return
	}
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Authorization", "Bearer "+h.cfg.APIKey)
	upReq.Header.Set("Accept", "text/event-stream")

	upRes, err := h.client.Do(upReq)
	if err != nil {
		jsonErr(w, http.StatusBadGateway, "LLM upstream unreachable: "+err.Error())
		return
	}
	defer upRes.Body.Close()

	// SSE headers — setelah titik ini semua error dikirim sebagai event SSE.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, canFlush := w.(http.Flusher)

	sendEvent := func(payload string) {
		fmt.Fprintf(w, "data: %s\n\n", payload)
		if canFlush {
			flusher.Flush()
		}
	}

	if upRes.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(upRes.Body, 8<<10))
		log.Printf("chat: upstream %s -> %d: %s", model, upRes.StatusCode, string(b))
		errPayload, _ := json.Marshal(map[string]string{
			"error": fmt.Sprintf("LLM upstream error (HTTP %d)", upRes.StatusCode),
		})
		sendEvent(string(errPayload))
		sendEvent("[DONE]")
		return
	}

	// Passthrough SSE upstream: baca baris "data: ..." lalu teruskan.
	// Baris non-data (event:, id:, komentar, kosong) dinormalisasi buang.
	scanner := bufio.NewScanner(upRes.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			sendEvent("[DONE]")
			return
		}
		var chunk map[string]interface{}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if _, isErr := chunk["error"]; isErr {
			log.Printf("chat: upstream stream error: %s", payload)
			sendEvent(payload) // teruskan apa adanya, frontend yang tangani
			sendEvent("[DONE]")
			return
		}
		sendEvent(payload)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("chat: upstream stream read error: %v", err)
		errPayload, _ := json.Marshal(map[string]string{"error": "Stream interrupted"})
		sendEvent(string(errPayload))
	}
	sendEvent("[DONE]")
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
