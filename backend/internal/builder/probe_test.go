package builder

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// probeStream mirrors tryModel's request but prints every raw data: line so we
// can see exactly how the gateway encodes digit deltas.
func probeStream(t *testing.T, model, prompt string) {
	t.Helper()
	c := llmFromEnv()
	body, _ := json.Marshal(map[string]interface{}{
		"model": model,
		"messages": []oaiMsg{{Role: "user", Content: prompt}},
		"stream":  true, "temperature": 0,
	})
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(c.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	t.Logf("=== %s RAW (%d bytes) ===", model, len(raw))
	sc := bufio.NewScanner(bytes.NewReader(raw))
	sc.Buffer(make([]byte, 0, 1<<20), 1<<24)
	n := 0
	for sc.Scan() {
		line := sc.Text()
		if strings.Contains(line, "\"delta\"") && !strings.Contains(line, "\"delta\":{}") {
			n++
			if n <= 40 {
				t.Logf("chunk%02d: %s", n, line)
			}
		}
	}
}

func TestProbeGatewayDigitEncoding(t *testing.T) {
	probeStream(t, "qwen3-coder", "Reply with exactly A900B. No markdown.")
	probeStream(t, "gemini-38-flash", "Reply with exactly A900B. No markdown.")
}
