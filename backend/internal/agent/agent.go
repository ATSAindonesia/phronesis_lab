package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Konfigurasi LLM (rantai env sama seperti chat/builder) ─────────────────

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

// ─── Pesan & tool call (OpenAI-compatible) ───────────────────────────────────

type ToolCall struct {
	ID       string
	Name     string
	ArgsJSON string
}

type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"-"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

// MarshalJSON menyusun format OpenAI (tool_calls hanya untuk assistant).
func (m Message) MarshalJSON() ([]byte, error) {
	type wire struct {
		Role       string                   `json:"role"`
		Content    string                   `json:"content,omitempty"`
		ToolCalls  []map[string]interface{} `json:"tool_calls,omitempty"`
		ToolCallID string                   `json:"tool_call_id,omitempty"`
		Name       string                   `json:"name,omitempty"`
	}
	w := wire{Role: m.Role, Content: m.Content, ToolCallID: m.ToolCallID, Name: m.Name}
	for _, tc := range m.ToolCalls {
		w.ToolCalls = append(w.ToolCalls, map[string]interface{}{
			"id":   tc.ID,
			"type": "function",
			"function": map[string]string{
				"name":      tc.Name,
				"arguments": tc.ArgsJSON,
			},
		})
	}
	type alias wire
	return json.Marshal(alias(w))
}

// ─── Agent ───────────────────────────────────────────────────────────────────

const systemPrompt = `Kamu adalah agent asisten di Phronesis Lab. Jawab dengan ringkas dan tepat.

Aturan tool:
- Pakai tool HANYA bila jawaban butuh fakta dari luar: isi file project (read_file/list_files), kondisi server (server_stats), waktu (clock), atau perintah shell (run_shell).
- Kalau pertanyaan umum/penalaran yang bisa dijawab langsung, JAWAB LANGSUNG tanpa tool.
- run_shell selalu butuh persetujuan manusia — minta hanya bila benar-benar perlu, dan jelaskan dulu mau apa.
- Jangan panggil tool yang sama berulang tanpa progres.`

// ApprovalFunc dipanggil loop saat tool butuh persetujuan.
// Mengembalikan true bila user menyetujui eksekusi.
type ApprovalFunc func(ctx context.Context, callID, toolName, command string) bool

// Emit mengirim satu event trace ke client (SSE).
type Emit func(ev map[string]interface{})

// Agent mengeksekusi loop LLM <-> tool.
type Agent struct {
	cfg     llmConfig
	client  *http.Client
	tools   []Tool
	maxIter int
	approve ApprovalFunc
}

func NewAgent(tools []Tool, approve ApprovalFunc, maxIter int) *Agent {
	if maxIter <= 0 || maxIter > 10 {
		maxIter = 5
	}
	return &Agent{
		cfg:     llmFromEnv(),
		client:  &http.Client{Timeout: 6 * time.Minute},
		tools:   tools,
		maxIter: maxIter,
		approve: approve,
	}
}

// llmResponse adalah hasil satu panggilan non-streaming.
type llmResponse struct {
	Content   string
	Reasoning string
	ToolCalls []ToolCall
}

// Run mengeksekusi loop agent. Mengembalikan jawaban final + statistik.
func (a *Agent) Run(ctx context.Context, emit Emit, model, system string, history []Message, temperature float64) (final string, iters int, toolsUsed int, err error) {
	if strings.TrimSpace(model) == "" {
		model = a.cfg.Model
	}
	msgs := make([]Message, 0, len(history)+2)
	if s := strings.TrimSpace(system); s != "" {
		msgs = append(msgs, Message{Role: "system", Content: s})
	} else {
		msgs = append(msgs, Message{Role: "system", Content: systemPrompt})
	}
	msgs = append(msgs, history...)

	for i := 1; i <= a.maxIter; i++ {
		iters = i
		emit(map[string]interface{}{"type": "trace", "kind": "iteration", "n": i, "of": a.maxIter})

		resp, err := a.complete(ctx, model, msgs, temperature, true)
		if err != nil {
			return "", iters, toolsUsed, err
		}
		msgs = append(msgs, Message{Role: "assistant", Content: resp.Content, ToolCalls: resp.ToolCalls})
		if strings.TrimSpace(resp.Reasoning) != "" {
			emit(map[string]interface{}{"type": "trace", "kind": "note", "text": "reasoning: " + truncateRunes(resp.Reasoning, 500)})
		}

		if len(resp.ToolCalls) == 0 {
			final = resp.Content
			emit(map[string]interface{}{"type": "trace", "kind": "done", "iterations": i, "tools_used": toolsUsed})
			return final, iters, toolsUsed, nil
		}

		for _, tc := range resp.ToolCalls {
			toolsUsed++
			emit(map[string]interface{}{
				"type": "trace", "kind": "tool_call",
				"call_id": tc.ID, "name": tc.Name, "arguments": tc.ArgsJSON,
			})
			t0 := time.Now()
			result := a.execTool(ctx, emit, tc)
			emit(map[string]interface{}{
				"type": "trace", "kind": "tool_result",
				"call_id": tc.ID, "name": tc.Name,
				"result": truncateRunes(result, 2000),
				"ms":     time.Since(t0).Milliseconds(),
			})
			msgs = append(msgs, Message{Role: "tool", Content: result, ToolCallID: tc.ID})
		}
	}

	// Iterasi habis tanpa jawaban final eksplisit — ambil konten terakhir.
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "assistant" && strings.TrimSpace(msgs[i].Content) != "" {
			final = msgs[i].Content
			break
		}
	}
	if final == "" {
		final = "Batas iterasi tercapai tanpa jawaban final. Coba sederhanakan permintaan atau aktifkan tool yang relevan."
	}
	emit(map[string]interface{}{"type": "trace", "kind": "done", "iterations": a.maxIter, "tools_used": toolsUsed, "truncated": true})
	return final, iters, toolsUsed, nil
}

// execTool mengeksekusi satu tool call (dengan approval untuk run_shell).
func (a *Agent) execTool(ctx context.Context, emit Emit, tc ToolCall) string {
	tool := findTool(a.tools, tc.Name)
	if tool == nil {
		return "error: unknown tool '" + tc.Name + "'"
	}
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(tc.ArgsJSON), &args); err != nil {
		return "error: invalid arguments JSON: " + err.Error()
	}
	if args == nil {
		args = map[string]interface{}{}
	}
	if tool.NeedsApproval {
		cmd, _ := args["command"].(string)
		callID := tc.ID
		if callID == "" {
			callID = fmt.Sprintf("call-%d", time.Now().UnixNano())
		}
		approved := false
		if a.approve != nil {
			approved = a.approve(ctx, callID, tool.Name, cmd)
		}
		emit(map[string]interface{}{
			"type": "trace", "kind": "approval_decision",
			"call_id": callID, "approved": approved,
		})
		if !approved {
			return "USER MENOLAK eksekusi perintah ini. Jelaskan alternatif atau jawab tanpa tool tersebut."
		}
	}
	out, err := tool.Exec(ctx, args)
	if err != nil {
		return "error: " + err.Error()
	}
	return out
}

// complete memanggil /chat/completions sekali (non-streaming).
func (a *Agent) complete(ctx context.Context, model string, msgs []Message, temperature float64, withTools bool) (*llmResponse, error) {
	body := map[string]interface{}{
		"model":       model,
		"messages":    msgs,
		"stream":      false,
		"temperature": temperature,
	}
	if withTools && len(a.tools) > 0 {
		body["tools"] = openAITools(a.tools)
		body["tool_choice"] = "auto"
	}
	raw, _ := json.Marshal(body)

	ctx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(a.cfg.BaseURL, "/")+"/chat/completions",
		bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("build upstream request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.APIKey)

	res, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("LLM upstream unreachable: %w", err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM upstream error (HTTP %d): %s", res.StatusCode, truncateRunes(string(b), 500))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content          *string `json:"content"`
				ReasoningContent *string `json:"reasoning_content"`
				Reasoning        *string `json:"reasoning"`
				ToolCalls        []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Error interface{} `json:"error"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return nil, fmt.Errorf("invalid upstream response: %w", err)
	}
	if parsed.Error != nil {
		eb, _ := json.Marshal(parsed.Error)
		return nil, fmt.Errorf("LLM upstream error: %s", string(eb))
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("LLM upstream returned no choices")
	}
	m := parsed.Choices[0].Message
	out := &llmResponse{}
	if m.Content != nil {
		out.Content = *m.Content
	}
	if m.ReasoningContent != nil {
		out.Reasoning = *m.ReasoningContent
	} else if m.Reasoning != nil {
		out.Reasoning = *m.Reasoning
	}
	for i, tc := range m.ToolCalls {
		id := tc.ID
		if id == "" {
			id = fmt.Sprintf("call-%d-%d", time.Now().UnixNano(), i)
		}
		out.ToolCalls = append(out.ToolCalls, ToolCall{ID: id, Name: tc.Function.Name, ArgsJSON: tc.Function.Arguments})
	}
	return out, nil
}
