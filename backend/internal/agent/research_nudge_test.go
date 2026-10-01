package agent

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── Research nudge guard ───────────────────────────────────────────────────
// RequireResearch=true: jawaban langsung tanpa tool riset DITOLAK, loop
// menyuntik nudge dan memaksa model memakai web_search/fetch_url.

func searchCall(id, query string) string {
	return `{"id":"` + id + `","type":"function","function":{"name":"web_search","arguments":"{\"query\":\"` + query + `\"}"}}`
}

func fetchCall(id, url string) string {
	return `{"id":"` + id + `","type":"function","function":{"name":"fetch_url","arguments":"{\"url\":\"` + url + `\"}"}}`
}

func TestResearchNudgeForcesSearch(t *testing.T) {
	f := &fakeLLM{script: []string{
		choiceMsg("Jawaban langsung malas tanpa riset."),
		choiceTools(searchCall("s1", "go generics") + "," + searchCall("s2", "golang history")),
		choiceTools(fetchCall("f1", "https://example.com/go") + "," + fetchCall("f2", "https://example.com/2")),
		choiceMsg("Go punya generics sejak 1.18 [1] [2].\n\n### Pertanyaan lanjutan\n1. Apa itu type constraint?\n2. Kapan Go 1.18 rilis?\n3. Siapa desainer Go?"),
	}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	rc := &ResearchContext{
		provider: &fakeSearch{results: []SearchResult{
			{Title: "Go Generics", URL: "https://example.com/go", Snippet: "generics..."},
			{Title: "Go Dua", URL: "https://example.com/2", Snippet: "dua..."},
		}},
		fetcher: &fakeFetcher{pages: map[string]PageContent{
			"https://example.com/go": {URL: "https://example.com/go", Title: "Go Generics", Text: "Generics sejak Go 1.18."},
			"https://example.com/2":  {URL: "https://example.com/2", Title: "Go Dua", Text: "Halaman kedua."},
		}},
	}
	a := NewAgent(ResearchTools(rc), nil, 8)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"
	a.RequireResearch = true

	var nudged bool
	emit := func(ev map[string]interface{}) {
		if ev["type"] == "trace" && ev["kind"] == "nudge" {
			nudged = true
		}
	}
	final, iters, used, err := a.Run(context.Background(), emit, "", researchSystemPrompt, []Message{{Role: "user", Content: "kapan go punya generics?"}}, 0.3)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !nudged {
		t.Fatal("nudge tidak di-emit padahal agent jawab langsung dulu")
	}
	if used != 4 {
		t.Fatalf("used=%d, want 4 (2 search + 2 fetch paralel)", used)
	}
	if iters != 4 {
		t.Fatalf("iters=%d, want 4 (1 direct + 1 search + 1 fetch + 1 jawab)", iters)
	}
	if !strings.Contains(final, "1.18") {
		t.Fatalf("final = %q", final)
	}
	if len(rc.Sources()) != 2 {
		t.Fatalf("sources=%d, want 2", len(rc.Sources()))
	}
}

func TestNoNudgeWhenNotRequired(t *testing.T) {
	f := &fakeLLM{script: []string{choiceMsg("Jawaban langsung biasa.")}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	a := NewAgent(nil, nil, 5)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"
	// RequireResearch default false — perilaku existing tidak berubah.
	final, iters, used, err := a.Run(context.Background(), func(ev map[string]interface{}) {}, "", "", []Message{{Role: "user", Content: "hai"}}, 0.7)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if final != "Jawaban langsung biasa." || iters != 1 || used != 0 {
		t.Fatalf("final=%q iters=%d used=%d", final, iters, used)
	}
}

func TestNudgeGivesUpAfterMax(t *testing.T) {
	// Model bandel: selalu jawab langsung. Guard boleh nudge maksimal
	// maxResearchNudges kali, lalu terima jawaban (anti infinite loop).
	f := &fakeLLM{script: []string{choiceMsg("tetap malas.")}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	a := NewAgent(ResearchTools(&ResearchContext{
		provider: UnconfiguredSearchProvider{},
		fetcher:  NewHTTPPageFetcher(),
	}), nil, 6)
	a.cfg.BaseURL = srv.URL
	a.cfg.APIKey = "test"
	a.RequireResearch = true

	nudges := 0
	emit := func(ev map[string]interface{}) {
		if ev["type"] == "trace" && ev["kind"] == "nudge" {
			nudges++
		}
	}
	final, iters, used, err := a.Run(context.Background(), emit, "", researchSystemPrompt, []Message{{Role: "user", Content: "hai"}}, 0.3)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if nudges != maxResearchNudges {
		t.Fatalf("nudges=%d, want %d", nudges, maxResearchNudges)
	}
	if iters != maxResearchNudges+1 {
		t.Fatalf("iters=%d, want %d (berhenti setelah nudge habis)", iters, maxResearchNudges+1)
	}
	if used != 0 || final != "tetap malas." {
		t.Fatalf("used=%d final=%q", used, final)
	}
}

func TestResearchPromptRequiresActivity(t *testing.T) {
	// Guard isi prompt: klausul "jawab langsung" yang lama tidak boleh balik,
	// aturan wajib-riset + fan-out + follow-up harus ada.
	for _, want := range []string{
		"DILARANG menjawab langsung",
		"SEKALIGUS",
		"KUOTA MINIMUM",
		"### Pertanyaan lanjutan",
		researchFollowupHeader,
		researchNudgeMessage[:40],
	} {
		if !strings.Contains(researchSystemPrompt+researchNudgeMessage, want) {
			t.Fatalf("prompt kehilangan frasa wajib: %q", want)
		}
	}
	if strings.Contains(researchSystemPrompt, "bisa dijawab tanpa riset") {
		t.Fatal("klausul pasif lama bocor kembali ke prompt")
	}
}
