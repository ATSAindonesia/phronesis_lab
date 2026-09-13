package experiments

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// FileItem represents a source file in the project virtual filesystem.
type FileItem struct {
	Name     string `json:"name"`
	Language string `json:"language"`
	Content  string `json:"content"`
}

// GenerateRequest represents the client generation request payload.
type GenerateRequest struct {
	Prompt string              `json:"prompt"`
	Files  map[string]FileItem `json:"files,omitempty"`
	Stream bool                `json:"stream,omitempty"`
}

// GenerateResponse represents a non-streaming response structure.
type GenerateResponse struct {
	Success bool                `json:"success"`
	Prompt  string              `json:"prompt"`
	Thought string              `json:"thought,omitempty"`
	Files   map[string]FileItem `json:"files,omitempty"`
}

// sendSSE flushes an SSE event to the client.
func sendSSE(w http.ResponseWriter, flusher http.Flusher, event string, data interface{}) {
	payload, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, string(payload))
	flusher.Flush()
}

// ─── OPENAI-COMPATIBLE STREAMING (TokenPortal / Qwen / etc.) ────────────────

type OpenAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OpenAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []OpenAIMessage `json:"messages"`
	Stream      bool            `json:"stream"`
	Temperature float64         `json:"temperature"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
}

type OpenAIStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func streamOpenAIResponse(ctx context.Context, baseURL, apiKey, model, systemPrompt, userContent string, w http.ResponseWriter, flusher http.Flusher) error {
	url := strings.TrimRight(baseURL, "/") + "/chat/completions"

	reqBody := OpenAIChatRequest{
		Model: model,
		Messages: []OpenAIMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userContent},
		},
		Stream:      true,
		Temperature: 0.4,
		MaxTokens:   8192,
	}

	payloadBytes, err := json.Marshal(reqBody)
	if err != nil {
		sendSSE(w, flusher, "error", map[string]string{"error": err.Error()})
		return err
	}

	reqCtx, reqCancel := context.WithTimeout(ctx, 15*time.Minute)
	defer reqCancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST", url, bytes.NewBuffer(payloadBytes))
	if err != nil {
		sendSSE(w, flusher, "error", map[string]string{"error": err.Error()})
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ResponseHeaderTimeout: 120 * time.Second,
			IdleConnTimeout:       90 * time.Second,
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		sendSSE(w, flusher, "error", map[string]string{"error": err.Error()})
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("provider returned status %d: %s", resp.StatusCode, string(body))
		log.Printf("[streamOpenAIResponse] %v", err)
		sendSSE(w, flusher, "error", map[string]string{"error": err.Error()})
		return err
	}

	sendSSE(w, flusher, "status", map[string]string{"phase": "generating", "model": model})

	// Background keepalive ping to prevent proxies, Next.js, and client fetch from timing out
	pingDone := make(chan struct{})
	defer close(pingDone)
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		sec := 0
		for {
			select {
			case <-pingDone:
				return
			case <-ticker.C:
				sec += 2
				sendSSE(w, flusher, "ping", map[string]interface{}{"status": "alive", "phase": "thinking", "elapsed": sec})
			}
		}
	}()

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			log.Printf("[streamOpenAIResponse] read error: %v", err)
			break
		}

		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}

		dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if dataStr == "[DONE]" {
			break
		}
		if dataStr == "" {
			continue
		}

		var chunk OpenAIStreamChunk
		if err := json.Unmarshal([]byte(dataStr), &chunk); err != nil {
			continue
		}

		if chunk.Error != nil && chunk.Error.Message != "" {
			sendSSE(w, flusher, "error", map[string]string{"error": chunk.Error.Message})
			return fmt.Errorf("provider error: %s", chunk.Error.Message)
		}

		if len(chunk.Choices) > 0 {
			choice := chunk.Choices[0]
			if choice.FinishReason != nil && (*choice.FinishReason == "stop" || *choice.FinishReason == "end_turn") {
				break
			}

			text := choice.Delta.Content
			if text != "" {
				sendSSE(w, flusher, "token", map[string]string{"text": text})
			} else if choice.Delta.ReasoningContent != "" {
				sendSSE(w, flusher, "status", map[string]string{"phase": "thinking", "thought": choice.Delta.ReasoningContent})
			}
		}
	}

	sendSSE(w, flusher, "done", map[string]string{"status": "completed"})
	return nil
}

// ─── GEMINI STREAMING FALLBACK ──────────────────────────────────────────────

type geminiPart struct {
	Text string `json:"text,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent  `json:"systemInstruction,omitempty"`
	Contents          []geminiContent `json:"contents"`
	GenerationConfig  *struct {
		Temperature     float64 `json:"temperature,omitempty"`
		MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
	} `json:"generationConfig,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
}

func streamGeminiResponse(ctx context.Context, apiKey, model, systemPrompt, userContent string, w http.ResponseWriter, flusher http.Flusher) error {
	reqBody := geminiRequest{
		SystemInstruction: &geminiContent{
			Parts: []geminiPart{
				{Text: systemPrompt},
			},
		},
		Contents: []geminiContent{
			{
				Role: "user",
				Parts: []geminiPart{
					{Text: userContent},
				},
			},
		},
		GenerationConfig: &struct {
			Temperature     float64 `json:"temperature,omitempty"`
			MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
		}{
			Temperature:     0.4,
			MaxOutputTokens: 8192,
		},
	}

	payloadBytes, err := json.Marshal(reqBody)
	if err != nil {
		sendSSE(w, flusher, "error", map[string]string{"error": err.Error()})
		return err
	}

	modelsToTry := []string{model, "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.7-flash"}
	seen := make(map[string]bool)
	var uniqueModels []string
	for _, m := range modelsToTry {
		if m != "" && !seen[m] {
			seen[m] = true
			uniqueModels = append(uniqueModels, m)
		}
	}

	var lastErr error
	for _, m := range uniqueModels {
		url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?alt=sse&key=%s", m, apiKey)

		var resp *http.Response
		client := &http.Client{
			Transport: &http.Transport{
				ResponseHeaderTimeout: 90 * time.Second,
			},
		}

		for attempt := 0; attempt < 2; attempt++ {
			if attempt > 0 {
				time.Sleep(1 * time.Second)
			}
			req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(payloadBytes))
			if err != nil {
				lastErr = err
				continue
			}
			req.Header.Set("Content-Type", "application/json")

			resp, err = client.Do(req)
			if err != nil {
				lastErr = err
				continue
			}

			if resp.StatusCode == http.StatusOK {
				break
			}

			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			lastErr = fmt.Errorf("model %s returned %d: %s", m, resp.StatusCode, string(body))
			log.Printf("[StreamAgentResponse] %v (attempt %d/2)", lastErr, attempt+1)

			if resp.StatusCode != 503 && resp.StatusCode != 429 {
				break
			}
		}

		if resp == nil || resp.StatusCode != http.StatusOK {
			continue
		}

		sendSSE(w, flusher, "status", map[string]string{"phase": "generating", "model": m})

		reader := bufio.NewReader(resp.Body)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				if err == io.EOF {
					break
				}
				log.Printf("[StreamAgentResponse] read error: %v", err)
				break
			}

			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "data:") {
				continue
			}

			dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if dataStr == "" || dataStr == "[DONE]" {
				continue
			}

			var gemResp geminiResponse
			if err := json.Unmarshal([]byte(dataStr), &gemResp); err != nil {
				continue
			}

			if len(gemResp.Candidates) > 0 {
				for _, part := range gemResp.Candidates[0].Content.Parts {
					if part.Text != "" {
						sendSSE(w, flusher, "token", map[string]string{"text": part.Text})
					}
				}
			}
		}
		resp.Body.Close()

		sendSSE(w, flusher, "done", map[string]string{"status": "completed"})
		return nil
	}

	sendSSE(w, flusher, "error", map[string]string{"error": fmt.Sprintf("All AI models failed: %v", lastErr)})
	return lastErr
}

// ─── STREAM AGENT ORCHESTRATOR ──────────────────────────────────────────────

// StreamAgentResponse streams real-time Bolt artifact tokens and actions to the client via SSE
func StreamAgentResponse(ctx context.Context, prompt string, currentFiles map[string]FileItem, w http.ResponseWriter) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return fmt.Errorf("streaming unsupported")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sendSSE(w, flusher, "status", map[string]string{"phase": "connecting", "message": "Connecting to AI coding agent..."})

	var filesSummary strings.Builder
	if len(currentFiles) > 0 {
		filesSummary.WriteString("\nCurrent Project Files in Virtual Filesystem:\n")
		for path, file := range currentFiles {
			if strings.HasSuffix(path, ".tsx") || strings.HasSuffix(path, ".jsx") || strings.HasSuffix(path, ".css") || path == "package.json" {
				filesSummary.WriteString(fmt.Sprintf("\n--- FILE: %s ---\n%s\n", path, file.Content))
			} else {
				filesSummary.WriteString(fmt.Sprintf("\n--- FILE (exists): %s ---\n", path))
			}
		}
	}

	systemPrompt := `You are an elite autonomous AI software engineer and UI/UX designer operating inside an in-browser WebContainer development environment running Vite + React + Tailwind CSS.

CRITICAL PROTOCOL (ABSOLUTE RULES):
1. You MUST start your response IMMEDIATELY with the opening <boltArtifact id="..." title="..."> tag.
2. NEVER include ANY greetings, chit-chat, preamble, commentary, or markdown code fences outside or before the artifact.
3. NEVER wrap the artifact or action contents in markdown blocks (e.g. do NOT use markdown code fences inside <boltAction>). The contents inside <boltAction> must be the RAW source code.
4. Every file must be complete, runnable, and high quality. Never use placeholders like "// implement here".

Format:
<boltArtifact id="project-update" title="Short description of changes">
  <boltAction type="file" filePath="src/App.tsx">
import React from 'react';
// Complete raw source code without markdown fences
  </boltAction>
</boltArtifact>

ACTIONS SPECIFICATION:
1. <boltAction type="file" filePath="relative/path/to/file.ext">
   - Always supply the full, complete source code. Never use placeholders, truncated comments ("// same as before"), or TODOs.
   - "src/App.tsx" is the primary entrypoint mounted by the Vite dev server.
   - Ensure all imported components exist or are provided in the same artifact.

2. <boltAction type="shell">
   - Only use shell actions if installing NEW third-party npm packages not already present in package.json.
   - Example: npm install framer-motion
   - PRE-INSTALLED packages: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge". Do NOT re-install these.
   - CRITICAL: NEVER run dev server commands like "npm run dev" or "vite". The Vite development server is ALREADY running in the background and automatically picks up file changes via HMR!

DESIGN & QUALITY STANDARDS:
- Craft authentic, production-grade applications.
- Use Tailwind CSS classes for styling. Ensure responsive layouts, harmonious color palettes, modern glassmorphism or sleek dark mode, and interactive states with React hooks.
- Create beautiful, modern UI components (cards, gradients, transitions, icons).`

	userContent := fmt.Sprintf("USER REQUEST:\n%s\n%s", prompt, filesSummary.String())

	// 1. Primary: OpenAI-compatible provider (TokenPortal / Qwen / etc.)
	openAIBaseURL := os.Getenv("LLM_BASE_URL")
	if openAIBaseURL == "" {
		openAIBaseURL = os.Getenv("OPENAI_BASE_URL")
	}
	openAIKey := os.Getenv("LLM_API_KEY")
	if openAIKey == "" {
		openAIKey = os.Getenv("OPENAI_API_KEY")
	}
	openAIModel := os.Getenv("LLM_MODEL")
	if openAIModel == "" {
		openAIModel = os.Getenv("OPENAI_MODEL")
	}
	if openAIModel == "" {
		openAIModel = "qwen-3.8-flash"
	}

	if openAIBaseURL != "" && openAIKey != "" {
		return streamOpenAIResponse(ctx, openAIBaseURL, openAIKey, openAIModel, systemPrompt, userContent, w, flusher)
	}

	// 2. Fallback: Gemini API
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		sendSSE(w, flusher, "error", map[string]string{"error": "No LLM API credentials configured (set LLM_API_KEY or GEMINI_API_KEY)"})
		return nil
	}

	model := os.Getenv("GEMINI_MODEL")
	if model == "" {
		model = "gemini-3.6-flash"
	}

	return streamGeminiResponse(ctx, apiKey, model, systemPrompt, userContent, w, flusher)
}

// ─── INITIAL STARTER UTILITIES ──────────────────────────────────────────────

func getInitialDefaultProject() map[string]FileItem {
	return map[string]FileItem{
		"src/App.tsx": {
			Name:     "src/App.tsx",
			Language: "typescript",
			Content: `import React from "react";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
          UI/UX Playground
        </h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          The sandbox executes the agent project filesystem live. Enter a prompt below to build and modify components.
        </p>
      </div>
    </div>
  );
}`,
		},
		"src/styles.css": {
			Name:     "src/styles.css",
			Language: "css",
			Content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`,
		},
		"package.json": {
			Name:     "package.json",
			Language: "json",
			Content: `{
  "name": "playground-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.468.0"
  }
}`,
		},
	}
}

// LoadFilesFromWorkspace returns starter files for the virtual filesystem.
func LoadFilesFromWorkspace() map[string]FileItem {
	return getInitialDefaultProject()
}
