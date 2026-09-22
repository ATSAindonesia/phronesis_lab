package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── Research Mode ──────────────────────────────────────────────────────────
// NOTE: tidak ada fake/mock hasil pencarian di kode produksi. Fake di bawah
// HANYA untuk test, di-inject via interface SearchProvider/PageFetcher.

// fakeSearch adalah SearchProvider scripted untuk test.
type fakeSearch struct {
	results []SearchResult
	calls   int
}

func (f *fakeSearch) Name() string { return "fake-test" }

func (f *fakeSearch) Search(ctx context.Context, query string, max int) ([]SearchResult, error) {
	f.calls++
	if len(f.results) > max {
		return f.results[:max], nil
	}
	return f.results, nil
}

// fakeFetcher mengembalikan halaman canned untuk test.
type fakeFetcher struct {
	pages map[string]PageContent
}

func (f *fakeFetcher) Fetch(ctx context.Context, rawURL string) (PageContent, error) {
	if p, ok := f.pages[rawURL]; ok {
		return p, nil
	}
	return PageContent{}, errTestNoPage
}

var errTestNoPage = errTestSentinel()

type sentinel struct{ msg string }

func (s sentinel) Error() string { return s.msg }

func errTestSentinel() error { return sentinel{"test: page not found"} }

func TestResearchLoopSearchFetchAnswer(t *testing.T) {
	searchTC := `{"id":"s1","type":"function","function":{"name":"web_search","arguments":"{\"query\":\"go generics\"}"}}`
	fetchTC := `{"id":"f1","type":"function","function":{"name":"fetch_url","arguments":"{\"url\":\"https://example.com/go\"}"}}`
	f := &fakeLLM{script: []string{
		choiceTools(searchTC),
		choiceTools(fetchTC),
		choiceMsg("Go mendukung generics sejak 1.18 [1]."),
	}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	rc := &ResearchContext{
		provider: &fakeSearch{results: []SearchResult{
			{Title: "Go Generics", URL: "https://example.com/go", Snippet: "generics..."},
		}},
		fetcher: &fakeFetcher{pages: map[string]PageContent{
			"https://example.com/go": {URL: "https://example.com/go", Title: "Go Generics", Text: "Generics sejak Go 1.18."},
		}},
	}
	a := NewAgent(ResearchTools(rc), nil, 5)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"

	final, iters, used, err := a.Run(context.Background(), func(ev map[string]interface{}) {}, "", researchSystemPrompt, []Message{{Role: "user", Content: "kapan go punya generics?"}}, 0.7)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if iters != 3 || used != 2 {
		t.Fatalf("iters=%d used=%d, want 3/2", iters, used)
	}
	if !strings.Contains(final, "1.18") {
		t.Fatalf("final = %q", final)
	}
	final = appendCitations(final, rc.Sources())
	if !strings.Contains(final, "https://example.com/go") {
		t.Fatalf("sitasi hilang: %q", final)
	}
	if !strings.Contains(final, "[1]") {
		t.Fatalf("marker sitasi hilang: %q", final)
	}
}

func TestUnconfiguredSearchHonest(t *testing.T) {
	rc := NewResearchContext() // tanpa env = unconfigured
	if _, ok := rc.provider.(UnconfiguredSearchProvider); !ok {
		t.Skip("env SEARCH_PROVIDER terisi di mesin test — skip")
	}
	tools := ResearchTools(rc)
	var ws *Tool
	for i := range tools {
		if tools[i].Name == "web_search" {
			ws = &tools[i]
		}
	}
	if ws == nil {
		t.Fatal("web_search tidak ketemu")
	}
	out, err := ws.Exec(context.Background(), map[string]interface{}{"query": "x"})
	if err == nil {
		t.Fatal("harus error, bukan hasil palsu")
	}
	if out != "" || !strings.Contains(err.Error(), "belum dikonfigurasi") {
		t.Fatalf("pesan tidak jujur: out=%q err=%v", out, err)
	}
}

func TestMaxSearchesEnforced(t *testing.T) {
	rc := &ResearchContext{
		provider: &fakeSearch{results: []SearchResult{{Title: "t", URL: "https://example.com/", Snippet: "s"}}},
		fetcher:  NewHTTPPageFetcher(),
	}
	tools := ResearchTools(rc)
	var ws *Tool
	for i := range tools {
		if tools[i].Name == "web_search" {
			ws = &tools[i]
		}
	}
	for i := 0; i < maxSearches; i++ {
		if _, err := ws.Exec(context.Background(), map[string]interface{}{"query": "q"}); err != nil {
			t.Fatalf("search %d: %v", i, err)
		}
	}
	if _, err := ws.Exec(context.Background(), map[string]interface{}{"query": "q"}); err == nil ||
		!strings.Contains(err.Error(), "batas pencarian") {
		t.Fatalf("batas tidak ditegakkan: %v", err)
	}
}

func TestMaxSourcesEnforced(t *testing.T) {
	rc := &ResearchContext{
		provider: UnconfiguredSearchProvider{},
		fetcher: &fakeFetcher{pages: map[string]PageContent{
			"https://example.com/1": {URL: "https://example.com/1", Title: "P1", Text: "isi"},
		}},
	}
	// Isi sumber sampai penuh langsung.
	for len(rc.sources) < maxSources {
		rc.sources = append(rc.sources, Source{N: len(rc.sources) + 1, URL: "https://example.com/x"})
	}
	tools := ResearchTools(rc)
	var fu *Tool
	for i := range tools {
		if tools[i].Name == "fetch_url" {
			fu = &tools[i]
		}
	}
	if _, err := fu.Exec(context.Background(), map[string]interface{}{"url": "https://example.com/1"}); err == nil ||
		!strings.Contains(err.Error(), "batas sumber") {
		t.Fatalf("batas sumber tidak ditegakkan: %v", err)
	}
}

func TestSSRFGuard(t *testing.T) {
	f := NewHTTPPageFetcher()
	ctx := context.Background()
	for _, u := range []string{
		"http://localhost:8081/api",
		"http://127.0.0.1/",
		"http://192.168.1.1/",
		"http://10.0.0.1/",
		"ftp://example.com/x",
		"bukan-url",
	} {
		if _, err := f.Fetch(ctx, u); err == nil {
			t.Fatalf("%s harus ditolak", u)
		}
	}
}

func TestKeenableProviderParsesResults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("content-type = %q", got)
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["query"] != "go generics" {
			t.Errorf("query diteruskan salah: %q", body["query"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[
			{"title":"Go Generics","url":"https://example.com/go","snippet":"generics sejak 1.18"},
			{"title":"","url":"https://example.com/desc","description":"fallback deskripsi"},
			{"title":"tanpa url","url":"","snippet":"harus dibuang"},
			{"title":"keempat","url":"https://example.com/4","snippet":"di luar max"}
		]}`))
	}))
	defer srv.Close()

	p := &KeenableSearchProvider{endpoint: srv.URL, client: srv.Client()}
	got, err := p.Search(context.Background(), "go generics", 3)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3 (max_results dihormati, entri tanpa URL dibuang)", len(got))
	}
	if got[0].Title != "Go Generics" || got[0].URL != "https://example.com/go" {
		t.Fatalf("hasil[0] = %+v", got[0])
	}
	if got[1].Snippet != "fallback deskripsi" {
		t.Fatalf("snippet fallback dari description gagal: %+v", got[1])
	}
	if got[1].Title != "https://example.com/desc" {
		t.Fatalf("title fallback ke URL gagal: %+v", got[1])
	}
	if p.Name() != "keenable" {
		t.Fatalf("name = %q", p.Name())
	}
}

func TestKeenableProviderHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	p := &KeenableSearchProvider{endpoint: srv.URL, client: srv.Client()}
	if _, err := p.Search(context.Background(), "q", 5); err == nil || !strings.Contains(err.Error(), "HTTP 429") {
		t.Fatalf("error tidak jelas: %v", err)
	}
}

func TestSearchProviderFromEnv(t *testing.T) {
	t.Setenv("SEARCH_PROVIDER", "keenable")
	if _, ok := searchProviderFromEnv().(*KeenableSearchProvider); !ok {
		t.Fatal("SEARCH_PROVIDER=keenable harus bikin KeenableSearchProvider")
	}
	t.Setenv("SEARCH_PROVIDER", "")
	if _, ok := searchProviderFromEnv().(UnconfiguredSearchProvider); !ok {
		t.Fatal("kosong harus tetap unconfigured (jujur, bukan fake)")
	}
}

func TestAppendCitationsEmpty(t *testing.T) {
	if got := appendCitations("halo", nil); got != "halo" {
		t.Fatalf("tanpa sumber harus utuh: %q", got)
	}
}
