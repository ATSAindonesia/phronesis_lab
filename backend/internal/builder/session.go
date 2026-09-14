// Package builder implements a self-hosted OpenComputer-compatible API:
// sessions, SSE events, and an agent loop that builds web apps inside a
// docker sandbox. Shapes mirror the frontend contract in builder-shell.tsx.
package builder

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"
)

// ContentBlock mirrors Claude-style message content blocks the UI reduces.
type ContentBlock struct {
	Type  string      `json:"type"`
	Text  string      `json:"text,omitempty"`
	Name  string      `json:"name,omitempty"`
	Input interface{} `json:"input,omitempty"`
}

// EventMessage is the "message" field of an assistant event.
type EventMessage struct {
	Content []ContentBlock `json:"content"`
}

// AgentEvent is the SSE payload consumed by builder-shell extractEventContent.
type AgentEvent struct {
	Type    string        `json:"type"`
	Message *EventMessage `json:"message,omitempty"`
	Tool    string        `json:"tool,omitempty"`
	Result  string        `json:"result,omitempty"`
	Error   string        `json:"error,omitempty"`
}

// ChatMsg is a persisted conversation line shown in the UI chat column.
type ChatMsg struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

// Artifact is a file the agent created/edited (project panel).
type Artifact struct {
	Path    string `json:"path"`
	Summary string `json:"summary"`
}

// EventStub is the persisted-event shape the UI expects on the session.
type EventStub struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

// SessionJSON is the wire shape returned by /v1/sessions endpoints.
type SessionJSON struct {
	ID         string      `json:"id"`
	Status     string      `json:"status"` // "ready" | "running" | "error"
	PreviewURL string      `json:"previewUrl"`
	Messages   []ChatMsg   `json:"messages"`
	Events     []EventStub `json:"events"`
	Project    ProjectInfo `json:"project"`
}

// ProjectInfo describes the built app for the UI.
type ProjectInfo struct {
	Title     string     `json:"title"`
	Framework string     `json:"framework"`
	Artifacts []Artifact `json:"artifacts"`
}

// historyMsg is the internal LLM conversation format.
type historyMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Session is one builder sandbox + its agent state.
type Session struct {
	ID        string
	UserID    string
	Email     string
	Name      string
	Dir       string // host workspace dir, bind-mounted at /data
	CtrName   string
	HostPort  int
	Preview   string
	CreatedAt time.Time
	LastAct   time.Time

	mu        sync.Mutex
	status    string
	history   []historyMsg
	messages  []ChatMsg
	artifacts []Artifact
	known     map[string]bool

	events []AgentEvent
	subs   map[chan AgentEvent]struct{}
}

func (s *Session) setStatus(st string) {
	s.mu.Lock()
	s.status = st
	s.mu.Unlock()
}

func (s *Session) getStatus() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Session) snapshot() SessionJSON {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := SessionJSON{
		ID: s.ID, Status: s.status, PreviewURL: s.Preview,
		Messages: append([]ChatMsg{}, s.messages...),
		Events:   []EventStub{},
	}
	out.Project = ProjectInfo{
		Title: "builder-app", Framework: "vite-react",
		Artifacts: append([]Artifact{}, s.artifacts...),
	}
	return out
}

// emit appends an event to the ring and broadcasts to live SSE subscribers.
func (s *Session) emit(ev AgentEvent) {
	s.mu.Lock()
	s.events = append(s.events, ev)
	if len(s.events) > 2000 {
		s.events = s.events[len(s.events)-2000:]
	}
	for ch := range s.subs {
		select {
		case ch <- ev:
		default: // slow consumer: drop; replay covers reconnects
		}
	}
	s.mu.Unlock()
}

func (s *Session) emitText(text string) {
	if text == "" {
		return
	}
	s.emit(AgentEvent{Type: "assistant", Message: &EventMessage{
		Content: []ContentBlock{{Type: "text", Text: text}},
	}})
}

func (s *Session) emitToolUse(name string, input interface{}) {
	s.emit(AgentEvent{Type: "assistant", Message: &EventMessage{
		Content: []ContentBlock{{Type: "tool_use", Name: name, Input: input}},
	}})
}

func (s *Session) emitSummary(tool string) {
	s.emit(AgentEvent{Type: "tool_use_summary", Tool: tool})
}

func (s *Session) emitError(msg string) {
	s.emit(AgentEvent{Type: "error", Error: msg})
}

func (s *Session) addMessage(role, content string) {
	s.mu.Lock()
	s.messages = append(s.messages, ChatMsg{
		ID: newID(), Role: role, Content: content,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	s.mu.Unlock()
}

// recordArtifact dedupes file paths the agent wrote.
func (s *Session) recordArtifact(path, summary string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.known == nil {
		s.known = map[string]bool{}
	}
	if s.known[path] {
		return
	}
	s.known[path] = true
	s.artifacts = append(s.artifacts, Artifact{Path: path, Summary: summary})
}

// subscribe returns replay history plus a live channel; cancel removes it.
func (s *Session) subscribe() (replay []AgentEvent, live <-chan AgentEvent, cancel func()) {
	ch := make(chan AgentEvent, 256)
	s.mu.Lock()
	replay = append([]AgentEvent{}, s.events...)
	if s.subs == nil {
		s.subs = map[chan AgentEvent]struct{}{}
	}
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return replay, ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
		close(ch)
	}
}

func (s *Session) appendHistory(role, content string) {
	s.mu.Lock()
	s.history = append(s.history, historyMsg{Role: role, Content: content})
	if len(s.history) > 24 { // cap context for small free models
		s.history = s.history[len(s.history)-24:]
	}
	s.mu.Unlock()
}

func (s *Session) getHistory() []historyMsg {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]historyMsg{}, s.history...)
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Session) touch() {
	s.mu.Lock()
	s.LastAct = time.Now()
	s.mu.Unlock()
}

var _ = json.Marshal
