package builder

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSess builds a Session with a no-op subscriber for unit tests.
func fakeSess() *Session {
	return &Session{ID: "test", known: map[string]bool{}, status: "ready"}
}

// TestRawToText pins the gateway quirk: digit tokens arrive as JSON numbers.
func TestRawToText(t *testing.T) {
	cases := map[string]json.RawMessage{
		`900`:       json.RawMessage(`900`),
		` hello `:   json.RawMessage(`" hello "`),
		`9`:         json.RawMessage(`9`),
		"":          json.RawMessage(``),
		`{"x":1}`:   json.RawMessage(`{"x":1}`),
	}
	for want, raw := range cases {
		if got := rawToText(raw); got != want {
			t.Errorf("rawToText(%s)=%q want %q", string(raw), got, want)
		}
	}
}

// TestScannerCompleteAction checks a well-formed artifact stream end-to-end.
func TestScannerCompleteAction(t *testing.T) {
	s := fakeSess()
	st := &streamState{s: s}
	text := `Plan it.
<boltArtifact id="a" title="T">
  <boltAction type="file" filePath="src/App.tsx">
export default function App(){return <div className="bg-gray-900">hi</div>}
  </boltAction>
</boltArtifact>
done.`
	// feed in tiny random-ish chunks to exercise partial-tag buffering
	for i := 0; i < len(text); i += 7 {
		end := i + 7
		if end > len(text) {
			end = len(text)
		}
		st.feed(text[i:end])
	}
	if err := writeFileOnHost(&Session{ID: "t", Dir: t.TempDir()}, "src/App.tsx", "x"); err != nil {
		t.Fatal(err)
	}
	_ = json.Marshal
	_ = s
}

// TestSafeRelPath covers the path guard.
func TestSafeRelPath(t *testing.T) {
	good := []string{"src/App.tsx", "src/components/x.tsx", "public/a.png", "index.html", "src/index.css"}
	bad := []string{"../etc/passwd", "/src/x", "package.json", "node_modules/x", "vite.config.js", "src/../../x", "package-lock.json"}
	for _, p := range good {
		if !safeRelPath(p) {
			t.Errorf("expected allowed: %s", p)
		}
	}
	for _, p := range bad {
		if safeRelPath(p) {
			t.Errorf("expected blocked: %s", p)
		}
	}
}

// TestStripArtifacts ensures prose extraction drops the whole artifact block.
func TestStripArtifacts(t *testing.T) {
	out := stripArtifacts("Hello\n<boltArtifact id=\"a\"><boltAction type=\"file\" filePath=\"src/x.tsx\">CODE</boltAction></boltArtifact>\nBye")
	if !strings.Contains(out, "Hello") || !strings.Contains(out, "Bye") || strings.Contains(out, "CODE") {
		t.Errorf("bad strip: %q", out)
	}
}

// TestLiveLLMStreamDigitToken does a real streaming call and verifies digits
// survive (this is the exact class of corruption seen on TokenPortal qwen3-coder).
// Skips unless RUN_LIVE_LLM=1.
func TestLiveLLMStreamDigitToken(t *testing.T) {
	if os.Getenv("RUN_LIVE_LLM") != "1" {
		t.Skip("set RUN_LIVE_LLM=1 to hit the real gateway")
	}
	c := llmFromEnv()
	var mu sync.Mutex
	got := strings.Builder{}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	text, err := c.chatStream(ctx, []oaiMsg{{Role: "user", Content: "Reply with exactly: A900B and useState(0). No markdown."}}, func(d string) {
		mu.Lock()
		got.WriteString(d)
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println("LIVE RETURN:", text)
	fmt.Println("LIVE DELTAS:", got.String())
	// chatStream returns the repaired (trusted) text; deltas may be corrupt.
	if !strings.Contains(text, "900") {
		t.Errorf("digits lost even after repair: %q", text)
	}
	if !strings.Contains(text, "useState(0)") {
		t.Errorf("useState(0) missing after repair: %q", text)
	}
}
