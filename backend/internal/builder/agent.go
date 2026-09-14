package builder

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// ─── LLM client (OpenAI-compatible streaming, TokenPortal) ──────────────────

type llmConfig struct {
	BaseURL string
	APIKey  string
	Model   string
	Falls   []string // fallback models on error/empty
}

func llmFromEnv() llmConfig {
	c := llmConfig{
		BaseURL: getenvOr("BUILDER_LLM_BASE_URL", getenvOr("LLM_BASE_URL", getenvOr("OPENAI_BASE_URL", "https://api.tokenportal.id/v1"))),
		APIKey:  getenvOr("BUILDER_LLM_API_KEY", getenvOr("LLM_API_KEY", os.Getenv("HERMES_CUSTOM_API_TOKENPORTAL_ID_API_KEY"))),
		Model:   getenvOr("BUILDER_LLM_MODEL", getenvOr("LLM_MODEL", "qwen-3.8-flash")),
	}
	c.Falls = []string{c.Model}
	return c
}

func getenvOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type oaiMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chatStream calls the LLM streaming, invoking onDelta per chunk.
// Returns full text; tries fallback models on failure.
func (c llmConfig) chatStream(ctx context.Context, msgs []oaiMsg, onDelta func(string)) (string, error) {
	var lastErr error
	seen := map[string]bool{}
	// Hanya model yang dikonfigurasi — tanpa fallback ke model lain.
	for _, model := range c.Falls {
		if model == "" || seen[model] {
			continue
		}
		seen[model] = true
		text, err := c.tryModel(ctx, model, msgs, onDelta)
		if err == nil {
			return text, nil
		}
		lastErr = fmt.Errorf("%s: %w", model, err)
		log.Printf("builder: model %s failed, failing over: %v", model, err)
	}
	return "", fmt.Errorf("all models failed, last: %w", lastErr)
}

func (c llmConfig) tryModel(ctx context.Context, model string, msgs []oaiMsg, onDelta func(string)) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model": model, "messages": msgs, "stream": true, "temperature": 0.4,
	})
	ctx2, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx2, http.MethodPost,
		strings.TrimRight(c.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(b), 200))
	}
	var sb strings.Builder
	var numberChunks int
	gotAny := false
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					// json.RawMessage so number-typed content (a known quirk of
					// some gateways re-typing digit tokens) survives decode.
					Content json.RawMessage `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(payload), &chunk) != nil {
			continue
		}
		for _, ch := range chunk.Choices {
			txt := rawToText(ch.Delta.Content)
			if len(ch.Delta.Content) > 0 && ch.Delta.Content[0] != '"' && txt != "" {
				numberChunks++ // e.g. "900" arrived as bare number 900
			}
			if txt != "" {
				sb.WriteString(txt)
				if onDelta != nil {
					onDelta(txt)
				}
				gotAny = true
			}
		}
	}
	// ── gateway integrity repair ────────────────────────────────────────────
	// TokenPortal SSE (verified 2026-09-14): digit-only content tokens arrive
	// as JSON *numbers* and runs like "900"/"0" get silently truncated,
	// corrupting generated code (bg-gray-900 -> bg-gray-, useState(0) ->
	// useState()). Non-streaming responses are intact. If suspicious, redo
	// the call unstreamed (up to 2 attempts); if still bad, error out so
	// chatStream retries the same configured model on transient stream errors.
	if numberChunks > 0 || looksChopped(sb.String()) {
		streamed := sb.String()
		log.Printf("builder: corruption suspect model=%s numChunks=%d streamedLen=%d chopped=%v", model, numberChunks, len(streamed), looksChopped(streamed))
		for attempt := 0; attempt < 2; attempt++ {
			fixed, ferr := c.complete(ctx, model, msgs)
			if ferr != nil {
				log.Printf("builder: repair attempt %d error: %v", attempt, ferr)
				break
			}
			log.Printf("builder: repair attempt %d len=%d hasArtifact=%v chopped=%v", attempt, len(fixed), strings.Contains(fixed, "<boltArtifact"), looksChopped(fixed))
			if strings.Contains(fixed, "<boltArtifact") && !looksChopped(fixed) {
				sb.Reset()
				sb.WriteString(fixed)
				if onDelta != nil {
					onDelta(REPAIR_MARK)
				}
				return fixed, nil
			}
			if !strings.Contains(fixed, "<boltArtifact") {
				continue
			}
			break
		}
		if strings.Contains(streamed, "<boltArtifact") {
			return "", fmt.Errorf("gateway stream corrupted (%d numeric deltas) and repair failed", numberChunks)
		}
	}
	if !gotAny || strings.TrimSpace(sb.String()) == "" {
		return "", fmt.Errorf("empty response")
	}
	return sb.String(), nil
}

// REPAIR_MARK signals the agent loop to discard incremental applies and
// re-run the final (repaired) text through the artifact scanner.
const REPAIR_MARK = "\n\x00REPAIR\x00\n"

var reChopState = regexp.MustCompile(`useState\(\)`)

// looksChopped detects digit-loss signatures in generated code.
func looksChopped(s string) bool {
	if !strings.Contains(s, "<boltArtifact") {
		return false // prose: corruption mostly harmless
	}
	if reChopState.MatchString(s) {
		return true
	}
	// Tailwind color scales are 50..950; a single digit then non-digit =
	// trailing zeros eaten, e.g. "bg-gray-9 " (was bg-gray-900).
	return reColorChop.MatchString(s)
}

var reColorChop = regexp.MustCompile(`-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d(?:[^0-9]|$)`)

// complete is a non-streaming chat call returning the full assistant text.
func (c llmConfig) complete(ctx context.Context, model string, msgs []oaiMsg) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model": model, "messages": msgs, "stream": false, "temperature": 0.4,
	})
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx2, http.MethodPost,
		strings.TrimRight(c.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(b), 200))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(b, &out) != nil || len(out.Choices) == 0 {
		return "", fmt.Errorf("bad response")
	}
	return out.Choices[0].Message.Content, nil
}

// ─── Agent prompt ────────────────────────────────────────────────────────────

const systemPrompt = `You are a web app builder agent (like bolt.new). Respond with a short plan sentence, then exactly ONE <boltArtifact> XML block containing <boltAction> children.

FORMAT (strict):
<boltArtifact id="app" title="My App">
  <boltAction type="file" filePath="src/App.tsx">
...complete file content...
  </boltAction>
  <boltAction type="shell">
npm install date-fns
  </boltAction>
</boltArtifact>

RULES:
- filePath is relative to project root. Allowed: src/..., public/..., index.html. NEVER emit files named package.json, vite.config.js, node_modules, package-lock.json.
- File actions REPLACE the file entirely. When editing existing code, re-output the WHOLE file (read it from context first).
- The Vite dev server is ALREADY RUNNING with hot reload. NEVER emit npm run dev, npm create, npm install react/react-dom/vite — they are preinstalled.
- Emit type="shell" only for NEW npm packages you really need.
- Stack: React 18 + Tailwind CSS v4 (already wired via src/index.css @import "tailwindcss";). Style with Tailwind utility classes. Icons: import { X } from "lucide-react" (preinstalled).
- Entry point src/App.tsx MUST export default a component; src/main.tsx already renders <App/>.
- Keep apps to a few files: src/App.tsx plus src/components/*.tsx as needed.
- Output code that COMPILES: valid TSX, no placeholders like "// rest of code", no TODO stubs.
- NEVER reference binary assets (images, fonts) that you have not created. Do NOT use import statements for .png/.jpg/.svg files — use inline SVG, CSS gradients, or https://images.unsplash.com/... URLs instead.
- Make the UI beautiful by default: gradients, spacing, responsive layout, dark theme friendly.
- Do not wrap file content in markdown fences. No text after </boltArtifact>.`

// ─── Incremental boltArtifact scanner (literal markers, idempotent cursor) ──

var (
	reAttr   = regexp.MustCompile(`(\w+)="([^"]*)"`)
	reArtTag = regexp.MustCompile(`(?s)<boltArtifact.*?>`)
)

const (
	markActOpen  = "<boltAction"
	markActClose = "</boltAction>"
	markArtClose = "</boltArtifact>"
)

type streamState struct {
	s       *Session
	raw     strings.Builder // full model text
	cursor  int             // consumed bytes of raw
	inArt   bool
	thinkAt time.Time
}

func (st *streamState) feed(delta string) {
	if delta == "" {
		return
	}
	st.raw.WriteString(delta)
	st.scan()
}

// scan processes complete markers; leaves partials unconsumed for next delta.
func (st *streamState) scan() {
	for {
		full := st.raw.String()
		rest := full[st.cursor:]
		if !st.inArt {
			if i := strings.Index(rest, "<boltArtifact"); i >= 0 {
				st.emitThinking(rest[:i])
				tag := reArtTag.FindString(rest[i:])
				if tag == "" {
					return // open tag itself still incomplete
				}
				st.cursor += i + len(tag)
				st.inArt = true
				continue
			}
			keep := partialTagTail(rest, "<boltArtifact")
			if keep < len(rest) {
				st.emitThinking(rest[:len(rest)-keep])
				st.cursor += len(rest) - keep
			}
			return
		}
		// Inside artifact: whichever marker comes first wins. Checking close
		// first would swallow whole-buffer rescans (post-repair) as prose.
		actI := strings.Index(rest, markActOpen)
		ci := strings.Index(rest, markArtClose)
		if ci >= 0 && (actI < 0 || ci < actI) {
			st.emitThinking(rest[:ci])
			st.cursor += ci + len(markArtClose)
			st.inArt = false
			continue
		}
		if actI >= 0 {
			st.emitThinking(rest[:actI])
			st.cursor += actI
			if st.tryAction() {
				continue
			}
			return
		}
		keep := partialTagTail(rest, markActOpen)
		if keep2 := partialTagTail(rest, markArtClose); keep2 > keep {
			keep = keep2
		}
		if keep < len(rest) {
			st.emitThinking(rest[:len(rest)-keep])
			st.cursor += len(rest) - keep
		}
		return
	}
}

// tryAction parses one complete <boltAction ...>...</boltAction> at cursor.
func (st *streamState) tryAction() bool {
	full := st.raw.String()
	rest := full[st.cursor:]
	openEnd := strings.Index(rest, ">")
	if openEnd < 0 {
		return false
	}
	attrs := rest[len(markActOpen):openEnd]
	closeIdx := strings.Index(rest[openEnd+1:], markActClose)
	if closeIdx < 0 {
		return false
	}
	body := rest[openEnd+1 : openEnd+1+closeIdx]
	st.cursor += openEnd + 1 + len(markActClose)
	st.apply(boltAction{
		Type: attrValue(attrs, "type"),
		Path: attrValue(attrs, "filePath"),
		Body: strings.TrimSpace(body),
	})
	return true
}

// partialTagTail returns how many trailing bytes of rest could be the start
// of tag (so they must not be emitted or consumed yet).
func partialTagTail(rest, tag string) int {
	max := len(tag) - 1
	if max > len(rest) {
		max = len(rest)
	}
	for n := max; n > 0; n-- {
		if strings.HasPrefix(tag, rest[len(rest)-n:]) {
			return n
		}
	}
	return 0
}

// emitThinking forwards prose (outside actions) as a periodic assistant text.
func (st *streamState) emitThinking(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if time.Since(st.thinkAt) < 1500*time.Millisecond {
		return
	}
	st.thinkAt = time.Now()
	if len(text) > 240 {
		text = truncate(text, 240) + "…"
	}
	st.s.emitText(text)
}

type boltAction struct {
	Type string
	Path string
	Body string
}

func attrValue(attrs, key string) string {
	for _, m := range reAttr.FindAllStringSubmatch(attrs, -1) {
		if m[1] == key {
			return m[2]
		}
	}
	return ""
}

// ─── Turn orchestration ──────────────────────────────────────────────────────

// runTurn executes one agent turn. Assumes the caller guarantees single
// turn-at-a-time per session. Never holds Session.mu across network/exec.
func runTurn(ctx context.Context, s *Session, llm llmConfig, userPrompt string) {
	s.setStatus("running")
	s.touch()
	defer func() {
		s.setStatus("ready")
		s.touch()
	}()

	s.addMessage("user", userPrompt)

	// Make sure the sandbox is alive (may have been idle-reaped).
	if !containerRunning(ctx, s) {
		s.emitSummary("starting sandbox…")
		if err := startSandbox(ctx, s); err != nil {
			s.emitError("sandbox start failed: " + err.Error())
			return
		}
		s.emitSummary("sandbox ready · preview live")
	}

	msgs := []oaiMsg{{Role: "system", Content: s.SystemPrompt}}
	for _, h := range s.getHistory() {
		msgs = append(msgs, oaiMsg{Role: h.Role, Content: h.Content})
	}
	msgs = append(msgs, oaiMsg{Role: "user", Content: "USER REQUEST:\n" + userPrompt})

	st := &streamState{s: s}
	repaired := false
	text, err := llm.chatStream(ctx, msgs, func(d string) {
		if strings.Contains(d, REPAIR_MARK) {
			repaired = true
			return
		}
		st.feed(d)
	})
	if err != nil {
		s.emitError("LLM error: " + err.Error())
		return
	}
	if repaired {
		// Streamed deltas were gateway-corrupted: discard partial parse state
		// and re-scan the repaired non-streaming text from scratch. Incremental
		// (corrupt) file writes are overwritten by correct ones; final state is
		// the repaired artifact.
		s.emitSummary("gateway stream corrupt — repaired via non-streaming rerun")
		log.Printf("builder: REPAIR-RESCAN sess=%s textLen=%d hasArtifact=%v", s.ID, len(text), strings.Contains(text, "<boltArtifact"))
		if !strings.Contains(text, "<boltArtifact") {
			log.Printf("builder: repaired text HEAD120=%q", truncate(text, 120))
		}
		st.raw.Reset()
		st.cursor = 0
		st.inArt = false
		st.raw.WriteString(text)
	}
	st.scan() // best-effort final drain; unclosed actions are intentionally dropped

	clean := stripArtifacts(text)
	if clean == "" {
		clean = "Updated the project."
	}
	s.addMessage("assistant", clean)
	s.appendHistory("user", "USER REQUEST:\n"+userPrompt)
	s.appendHistory("assistant", text)
	s.emit(AgentEvent{Type: "turn_complete"})
}

func stripArtifacts(text string) string {
	re := regexp.MustCompile(`(?s)<boltArtifact.*?</boltArtifact>`)
	out := re.ReplaceAllString(text, "")
	out = strings.TrimSpace(out)
	if len(out) > 1200 {
		out = truncate(out, 1200) + "…"
	}
	return out
}

// apply executes one bolt action against the sandbox, emitting trace events.
func (st *streamState) apply(a boltAction) {
	s := st.s
	switch a.Type {
	case "file":
		if a.Path == "" {
			s.emitError("file action missing filePath")
			return
		}
		if !safeRelPath(a.Path) {
			s.emitError("blocked path: " + a.Path)
			return
		}
		s.emitToolUse("write_file", map[string]interface{}{"path": a.Path, "bytes": len(a.Body), "content": a.Body})
		s.emitSummary("write " + a.Path)
		if err := writeFileOnHost(s, a.Path, a.Body); err != nil {
			s.emitError("write " + a.Path + ": " + err.Error())
			return
		}
		s.recordArtifact(a.Path, fmt.Sprintf("%d bytes", len(a.Body)))
	case "shell":
		cmd := strings.TrimSpace(a.Body)
		if cmd == "" || dangerousCmd(cmd) {
			if cmd != "" {
				s.emitError("blocked shell command: " + truncate(cmd, 120))
			}
			return
		}
		s.emitToolUse("bash", map[string]interface{}{"command": truncate(cmd, 200)})
		s.emitSummary("$ " + truncate(cmd, 120))
		out, errOut, err := execIn(context.Background(), s, cmd, 4*time.Minute)
		combined := strings.TrimSpace(out + "\n" + errOut)
		if len(combined) > 4000 {
			combined = truncate(combined, 4000) + "\n…(truncated)"
		}
		if combined != "" {
			s.emitText(combined)
		}
		if err != nil {
			s.emitError("shell failed: " + err.Error())
		}
	default:
		if a.Type != "" {
			s.emitSummary("skipped unknown action: " + a.Type)
		}
	}
}

// safeRelPath allows src/, public/, index.html, assets, components — blocks
// traversal and root config overrides.
func safeRelPath(p string) bool {
	p = strings.ReplaceAll(strings.TrimSpace(p), "\\", "/")
	if strings.HasPrefix(p, "/") || strings.Contains(p, "..") {
		return false
	}
	low := strings.ToLower(p)
	for _, bad := range []string{"package.json", "package-lock", "vite.config", "node_modules", "tsconfig", ".env"} {
		if low == bad || strings.HasPrefix(low, bad+"/") || strings.Contains(strings.Split(low, "/")[len(strings.Split(low, "/"))-1], bad) && !strings.HasPrefix(low, "src/") && !strings.HasPrefix(low, "public/") {
			return false
		}
	}
	return strings.HasPrefix(low, "src/") || strings.HasPrefix(low, "public/") || low == "index.html" || strings.HasPrefix(low, "assets/")
}

func dangerousCmd(cmd string) bool {
	low := strings.ToLower(cmd)
	blocked := []string{"rm -rf /", "mkfs", "dd if=", ":(){", "shutdown", "reboot", "npm run dev", "yarn dev", "pnpm dev", "vite", "npm create", "npx create", "curl ", "wget "}
	for _, b := range blocked {
		if strings.Contains(low, b) {
			return true
		}
	}
	return false
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// rawToText normalizes a delta content value: a JSON string is unwrapped;
// bare numeric literals (digits emitted as number tokens) are kept as text.
func rawToText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	// number / bool / null literal — treat as its token text
	return string(raw)
}

var _ = io.Discard
var _ = os.Getenv
