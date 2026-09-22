package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// ─── Research Mode ──────────────────────────────────────────────────────────
// Research Agent terpisah dari adapter model/provider: loop generik
// (Agent.Run, OpenAI-compatible untuk model apa pun) + toolset riset +
// system prompt riset + pipeline sitasi deterministik.
//
// Batas keamanan: max_searches, max_sources, timeout per tool call.
// Tanpa search provider nyata yang dikonfigurasi, web_search JUJUR
// mengembalikan error "not configured" — tidak ada fake/mock hasil.

const (
	maxSearches      = 5
	maxSources       = 6
	toolTimeoutSecs  = 20
	maxFetchBytes    = 1 << 20
	maxFetchText     = 12000
	defaultMaxResult = 5
)

// SearchResult adalah satu hasil pencarian.
type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// PageContent adalah hasil fetch satu URL.
type PageContent struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// Source adalah sumber yang benar-benar di-fetch (calon sitasi).
type Source struct {
	N     int
	Title string
	URL   string
}

// ─── SearchProvider (dapat diganti via konfigurasi) ─────────────────────────

// SearchProvider mencari web. Implementasi nyata (berbayar/gratis) didaftar
// di factory tanpa mengubah agent.
type SearchProvider interface {
	Name() string
	Search(ctx context.Context, query string, maxResults int) ([]SearchResult, error)
}

// UnconfiguredSearchProvider: jujur — belum ada provider nyata.
type UnconfiguredSearchProvider struct{}

func (UnconfiguredSearchProvider) Name() string { return "unconfigured" }

func (UnconfiguredSearchProvider) Search(ctx context.Context, query string, maxResults int) ([]SearchResult, error) {
	return nil, fmt.Errorf("web search belum dikonfigurasi (set SEARCH_PROVIDER=keenable di environment backend) — tidak ada hasil pencarian yang dibuat-buat")
}

// searchProviderFromEnv memilih provider dari env.
// "keenable" = index web independen (keyless public endpoint, atau
// authenticated kalau KEENABLE_API_KEY di-set). Default: unconfigured.
func searchProviderFromEnv() SearchProvider {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SEARCH_PROVIDER"))) {
	case "keenable":
		return NewKeenableSearchProvider()
	default:
		return UnconfiguredSearchProvider{}
	}
}

// ─── Keenable (index web independen) ────────────────────────────────────────

const (
	keenableSearchURL   = "https://api.keenable.ai/v1/search"
	keenablePublicURL   = "https://api.keenable.ai/v1/search/public"
	keenableTimeoutSecs = 25
)

// KeenableSearchProvider: provider pencarian nyata. Tanpa API key pakai
// endpoint /public (keyless, tanpa SLA); dengan KEENABLE_API_KEY pakai
// endpoint authenticated.
type KeenableSearchProvider struct {
	apiKey   string
	endpoint string
	client   *http.Client
}

func NewKeenableSearchProvider() *KeenableSearchProvider {
	apiKey := strings.TrimSpace(os.Getenv("KEENABLE_API_KEY"))
	endpoint := keenablePublicURL
	if apiKey != "" {
		endpoint = keenableSearchURL
	}
	return &KeenableSearchProvider{
		apiKey:   apiKey,
		endpoint: endpoint,
		client:   &http.Client{Timeout: keenableTimeoutSecs * time.Second},
	}
}

func (p *KeenableSearchProvider) Name() string { return "keenable" }

type keenableSearchResponse struct {
	Results []struct {
		Title       string `json:"title"`
		URL         string `json:"url"`
		Snippet     string `json:"snippet"`
		Description string `json:"description"`
	} `json:"results"`
}

func (p *KeenableSearchProvider) Search(ctx context.Context, query string, maxResults int) ([]SearchResult, error) {
	body, err := json.Marshal(map[string]string{"query": query})
	if err != nil {
		return nil, fmt.Errorf("web search: %v", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("web search: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Keenable-Title", "phronesis-lab")
	if p.apiKey != "" {
		req.Header.Set("X-API-Key", p.apiKey)
	}
	res, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("web search: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("web search: HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxFetchBytes))
	if err != nil {
		return nil, fmt.Errorf("web search: %v", err)
	}
	var parsed keenableSearchResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("web search: respons tidak valid: %v", err)
	}
	out := make([]SearchResult, 0, len(parsed.Results))
	for _, r := range parsed.Results {
		if len(out) >= maxResults {
			break
		}
		if strings.TrimSpace(r.URL) == "" {
			continue
		}
		snippet := r.Snippet
		if strings.TrimSpace(snippet) == "" {
			snippet = r.Description
		}
		title := r.Title
		if strings.TrimSpace(title) == "" {
			title = r.URL
		}
		out = append(out, SearchResult{Title: title, URL: r.URL, Snippet: snippet})
	}
	return out, nil
}

// ─── PageFetcher ────────────────────────────────────────────────────────────

// PageFetcher membaca satu URL menjadi teks.
type PageFetcher interface {
	Fetch(ctx context.Context, rawURL string) (PageContent, error)
}

// HTTPPageFetcher: fetch nyata (stdlib), timeout + cap + guard SSRF.
type HTTPPageFetcher struct {
	client *http.Client
}

func NewHTTPPageFetcher() *HTTPPageFetcher {
	return &HTTPPageFetcher{
		client: &http.Client{Timeout: toolTimeoutSecs * time.Second},
	}
}

func (f *HTTPPageFetcher) Fetch(ctx context.Context, rawURL string) (PageContent, error) {
	rawURL = strings.TrimSpace(rawURL)
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return PageContent{}, fmt.Errorf("fetch_url: URL harus http(s)")
	}
	if err := guardPublicHost(ctx, u.Hostname()); err != nil {
		return PageContent{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return PageContent{}, fmt.Errorf("fetch_url: %v", err)
	}
	req.Header.Set("User-Agent", "PhronesisLab-Research/1.0 (+local)")
	res, err := f.client.Do(req)
	if err != nil {
		return PageContent{}, fmt.Errorf("fetch_url: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return PageContent{}, fmt.Errorf("fetch_url: HTTP %d", res.StatusCode)
	}
	ct := strings.ToLower(res.Header.Get("Content-Type"))
	if strings.Contains(ct, "image/") || strings.Contains(ct, "video/") ||
		strings.Contains(ct, "audio/") || strings.Contains(ct, "octet-stream") ||
		strings.Contains(ct, "pdf") {
		return PageContent{}, fmt.Errorf("fetch_url: tipe konten tidak didukung (%s)", ct)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, maxFetchBytes))
	if err != nil {
		return PageContent{}, fmt.Errorf("fetch_url: %v", err)
	}
	text := htmlToText(string(b))
	return PageContent{URL: u.String(), Title: extractTitle(string(b)), Text: truncateRunes(text, maxFetchText)}, nil
}

// guardPublicHost menolak host non-publik (anti SSRF ke infra lokal).
func guardPublicHost(ctx context.Context, host string) error {
	if strings.EqualFold(host, "localhost") {
		return fmt.Errorf("fetch_url: host lokal tidak diizinkan")
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return fmt.Errorf("fetch_url: host tidak dapat di-resolve")
	}
	for _, ip := range ips {
		if !ip.IP.IsGlobalUnicast() || ip.IP.IsPrivate() || ip.IP.IsLoopback() ||
			ip.IP.IsLinkLocalUnicast() || ip.IP.IsLinkLocalMulticast() {
			return fmt.Errorf("fetch_url: host non-publik tidak diizinkan")
		}
	}
	return nil
}

var (
	tagRe    = regexp.MustCompile(`(?s)<(script|style|noscript|template)[^>]*>.*?</(script|style|noscript|template)>`)
	htmlTagR = regexp.MustCompile(`<[^>]*>`)
	spaceRe  = regexp.MustCompile(`[ \t\x0b\f\r]+`)
	blankRe  = regexp.MustCompile(`\n{3,}`)
	titleRe  = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

// htmlToText mengekstrak teks kasar dari HTML (stdlib-only).
func htmlToText(h string) string {
	s := tagRe.ReplaceAllString(h, " ")
	s = htmlTagR.ReplaceAllString(s, " ")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", `"`)
	s = spaceRe.ReplaceAllString(s, " ")
	s = strings.ReplaceAll(s, "\n ", "\n")
	s = blankRe.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}

func extractTitle(h string) string {
	m := titleRe.FindStringSubmatch(h)
	if len(m) == 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// ─── Konteks riset per-request ────────────────────────────────────────────

// ResearchContext menyimpan state riset satu request: counter pencarian
// (batas max_searches) dan daftar sumber ter-fetch (batas max_sources,
// urutan sitasi). Dibuat baru per request — tidak dishare antar request.
type ResearchContext struct {
	provider SearchProvider
	fetcher  PageFetcher

	searches int
	sources  []Source
}

func NewResearchContext() *ResearchContext {
	return &ResearchContext{
		provider: searchProviderFromEnv(),
		fetcher:  NewHTTPPageFetcher(),
	}
}

// Sources mengembalikan sumber ter-fetch (urutan sitasi).
func (rc *ResearchContext) Sources() []Source {
	return rc.sources
}

// ─── Research system prompt & sitasi ────────────────────────────────────────

const researchSystemPrompt = `Kamu adalah research agent di Phronesis Lab. Jawab BERDASARKAN sumber yang benar-benar kamu baca.

Alur wajib:
1. Pahami pertanyaan, buat 1-3 query pencarian yang spesifik (tools web_search).
2. Evaluasi hasil: pilih sumber yang relevan dan kredibel.
3. Baca sumber dengan fetch_url (maksimal beberapa halaman; kalau kurang, cari lagi dengan query berbeda).
4. Sintesis dari bukti yang kamu baca. Rujuk sumber dengan marker [1], [2], dst sesuai urutan sumber dibaca.
5. Kalau search belum dikonfigurasi atau sumber tidak cukup: katakan JUJUR apa yang kurang — JANGAN mengarang URL, judul, kutipan, atau fakta.

Aturan keras:
- DILARANG mengarang URL, judul artikel, angka, atau kutipan.
- Hanya klaim fakta yang didukung tool_result.
- Kalau pertanyaan bisa dijawab tanpa riset (umum/penalaran), jawab langsung tanpa tool.`

// appendCitations menambahkan daftar Sumber deterministik dari sumber yang
// benar-benar di-fetch (bukan karangan model).
func appendCitations(final string, sources []Source) string {
	if len(sources) == 0 {
		return final
	}
	var sb strings.Builder
	sb.WriteString(strings.TrimRight(final, "\n"))
	sb.WriteString("\n\nSumber:\n")
	for _, s := range sources {
		title := s.Title
		if title == "" {
			title = s.URL
		}
		fmt.Fprintf(&sb, "[%d] %s — %s\n", s.N, truncateRunes(title, 160), s.URL)
	}
	return sb.String()
}
