// Package agent mengimplementasikan Chat Agent Playground:
// loop sederhana User -> Agent -> LLM -> Tool -> LLM -> Response dengan
// SSE trace + persetujuan manusia untuk eksekusi shell.
package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"lab/internal/analytics"
	"lab/internal/files"
)

// Batas sesuai keputusan playground.
const (
	maxToolResultRunes = 4000
	maxShellOutput     = 16 << 10
	defaultShellSecs   = 60
)

// Tool adalah definisi + eksekutor satu perkakas agent.
type Tool struct {
	Name        string
	Description string
	Schema      map[string]interface{}
	// NeedsApproval: run_shell — loop berhenti minta persetujuan user.
	NeedsApproval bool
	Exec          func(ctx context.Context, args map[string]interface{}) (string, error)
}

// Registry membangun tool yang diizinkan. filesH dipakai ulang agar
// batasan PROJECT_ROOT + blocklist kredensial tetap berlaku.
func Registry(filesH *files.Handler) []Tool {
	return []Tool{
		{
			Name:        "list_files",
			Description: "List isi satu direktori di dalam project (path relatif terhadap root project, kosongkan untuk root). Read-only.",
			Schema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{"type": "string", "description": "Direktori relatif, misal 'backend/internal'. Kosong = root."},
				},
			},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				rel, _ := args["path"].(string)
				path, entries, err := filesH.ListDir(strings.TrimSpace(rel))
				if err != nil {
					return "", fmt.Errorf("list_files: %v", err)
				}
				var sb strings.Builder
				fmt.Fprintf(&sb, "path: %s\n", path)
				for _, e := range entries {
					fmt.Fprintf(&sb, "- [%s] %s\n", e.Type, e.Path)
				}
				return truncateRunes(sb.String(), maxToolResultRunes), nil
			},
		},
		{
			Name:        "read_file",
			Description: "Baca isi file teks di dalam project (path relatif). File kredensial/binary ditolak. Read-only.",
			Schema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{"type": "string", "description": "Path file relatif, misal 'backend/go.mod'."},
				},
				"required": []string{"path"},
			},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				rel, _ := args["path"].(string)
				if strings.TrimSpace(rel) == "" {
					return "", fmt.Errorf("read_file: path is required")
				}
				fc, err := filesH.ReadFile(rel)
				if err != nil {
					return "", fmt.Errorf("read_file: %v", err)
				}
				out := fmt.Sprintf("file: %s (%s, %d bytes)\n%s", fc.Path, fc.Language, fc.Size, fc.Content)
				return truncateRunes(out, maxToolResultRunes), nil
			},
		},
		{
			Name:        "server_stats",
			Description: "Ambil snapshot kondisi server saat ini (CPU, RAM, disk, load, uptime). Read-only.",
			Schema:      map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				s := analytics.Sample()
				b, _ := json.Marshal(s)
				return truncateRunes(string(b), maxToolResultRunes), nil
			},
		},
		{
			Name:        "clock",
			Description: "Waktu server saat ini (RFC3339). Read-only.",
			Schema:      map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				return time.Now().Format(time.RFC3339), nil
			},
		},
		{
			Name:        "run_shell",
			Description: "Jalankan perintah bash di root project dan kembalikan outputnya. BUTUH PERSETUJUAN USER tiap perintah. Jangan pakai untuk membaca file (pakai read_file) atau cek server (pakai server_stats).",
			Schema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"command": map[string]interface{}{"type": "string", "description": "Perintah bash, misal 'ls -la backend'."},
				},
				"required": []string{"command"},
			},
			NeedsApproval: true,
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				cmdStr, _ := args["command"].(string)
				if strings.TrimSpace(cmdStr) == "" {
					return "", fmt.Errorf("run_shell: command is required")
				}
				return runShell(ctx, cmdStr, defaultShellSecs)
			},
		},
	}
}

// openAITools mengubah registry menjadi parameter `tools` OpenAI-compatible.
func openAITools(tools []Tool) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(tools))
	for _, t := range tools {
		out = append(out, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.Schema,
			},
		})
	}
	return out
}

func findTool(tools []Tool, name string) *Tool {
	for i := range tools {
		if tools[i].Name == name {
			return &tools[i]
		}
	}
	return nil
}

// runShell mengeksekusi bash -c dengan guardrail: cwd = project root,
// timeout, env minimal tanpa secret, output dibatasi.
func runShell(ctx context.Context, command string, timeoutSecs int) (string, error) {
	if timeoutSecs <= 0 || timeoutSecs > 300 {
		timeoutSecs = defaultShellSecs
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSecs)*time.Second)
	defer cancel()

	root := os.Getenv("PROJECT_ROOT")
	if root == "" {
		if wd, err := os.Getwd(); err == nil {
			root = wd
		} else {
			root = "/"
		}
	}
	log.Printf("agent: run_shell cwd=%s cmd=%.200s", root, command)

	cmd := exec.CommandContext(ctx, "/bin/bash", "-c", command)
	cmd.Dir = root
	// Env eksplisit minimal — secret (LLM_API_KEY dkk) TIDAK diteruskan.
	cmd.Env = []string{
		"PATH=/home/william/.local/bin:/usr/local/bin:/usr/bin:/bin",
		"HOME=" + os.Getenv("HOME"),
		"TERM=dumb",
		"LANG=C.UTF-8",
		"AGENT_SHELL=1",
	}
	var buf bytes.Buffer
	cmd.Stdout = &limitedWriter{W: &buf, N: maxShellOutput}
	cmd.Stderr = &limitedWriter{W: &buf, N: maxShellOutput}
	err := cmd.Run()
	out := truncateRunes(buf.String(), maxToolResultRunes)
	if ctx.Err() == context.DeadlineExceeded {
		return out + "\n[TIMEOUT setelah " + fmt.Sprint(timeoutSecs) + "s]", nil
	}
	if err != nil {
		return out + fmt.Sprintf("\n[exit error: %v]", err), nil
	}
	return out, nil
}

// limitedWriter membatasi total byte yang ditulis (anti-ban dump raksasa).
type limitedWriter struct {
	W *bytes.Buffer
	N int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	remain := l.N - l.W.Len()
	if remain <= 0 {
		return len(p), nil // buang kelebihan, laporkan penuh
	}
	if len(p) > remain {
		p = p[:remain]
	}
	return l.W.Write(p)
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "\n[TRUNCATED]"
}

// ─── Web research tools ───────────────────────────────────────────────────

// ResearchTools membangun web_search + fetch_url yang terikat pada satu
// ResearchContext (counter + daftar sumber per request).
func ResearchTools(rc *ResearchContext) []Tool {
	return []Tool{
		{
			Name:        "web_search",
			Description: "Cari web dengan query. Kembalikan judul + URL + snippet. Hasil ini BELUM dibaca — pakai fetch_url untuk membaca sumber. JANGAN mengutip URL dari sini sebagai sitasi final.",
			Schema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query":       map[string]interface{}{"type": "string", "description": "Query pencarian spesifik."},
					"max_results": map[string]interface{}{"type": "number", "description": "Jumlah hasil (1-10, default 5)."},
				},
				"required": []string{"query"},
			},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				query, _ := args["query"].(string)
				if strings.TrimSpace(query) == "" {
					return "", fmt.Errorf("web_search: query is required")
				}
				if rc.searches >= maxSearches {
					return "", fmt.Errorf("web_search: batas pencarian tercapai (%d) — lanjutkan dengan sumber yang ada", maxSearches)
				}
				n := defaultMaxResult
				if f, ok := args["max_results"].(float64); ok && f >= 1 && f <= 10 {
					n = int(f)
				}
				tctx, cancel := context.WithTimeout(ctx, toolTimeoutSecs*time.Second)
				defer cancel()
				results, err := rc.provider.Search(tctx, strings.TrimSpace(query), n)
				if err != nil {
					return "", fmt.Errorf("web_search: %v", err)
				}
				rc.searches++
				if len(results) == 0 {
					return "Tidak ada hasil untuk query ini. Coba query berbeda.", nil
				}
				var sb strings.Builder
				for i, r := range results {
					fmt.Fprintf(&sb, "%d. %s\n   %s\n   %s\n", i+1,
						truncateRunes(r.Title, 160), r.URL, truncateRunes(r.Snippet, 300))
				}
				return truncateRunes(sb.String(), maxToolResultRunes), nil
			},
		},
		{
			Name:        "fetch_url",
			Description: "Baca satu halaman web menjadi teks. Sumber yang berhasil dibaca otomatis menjadi sitasi [N] sesuai urutan dibaca — pakai marker itu di jawaban final.",
			Schema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"url": map[string]interface{}{"type": "string", "description": "URL http(s) publik yang mau dibaca."},
				},
				"required": []string{"url"},
			},
			Exec: func(ctx context.Context, args map[string]interface{}) (string, error) {
				rawURL, _ := args["url"].(string)
				if strings.TrimSpace(rawURL) == "" {
					return "", fmt.Errorf("fetch_url: url is required")
				}
				if len(rc.sources) >= maxSources {
					return "", fmt.Errorf("fetch_url: batas sumber tercapai (%d) — sintesis dari yang sudah dibaca", maxSources)
				}
				tctx, cancel := context.WithTimeout(ctx, toolTimeoutSecs*time.Second)
				defer cancel()
				page, err := rc.fetcher.Fetch(tctx, strings.TrimSpace(rawURL))
				if err != nil {
					return "", err
				}
				n := len(rc.sources) + 1
				rc.sources = append(rc.sources, Source{N: n, Title: page.Title, URL: page.URL})
				return fmt.Sprintf("Sumber [%d]: %s\n%s", n, page.URL, page.Text), nil
			},
		},
	}
}
