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
	"strconv"
	"strings"
	"time"

	nethtml "golang.org/x/net/html"
)

// ─── Research Mode ──────────────────────────────────────────────────────────
// Research Agent terpisah dari adapter model/provider: loop generik
// (Agent.Run, OpenAI-compatible untuk model apa pun) + toolset riset +
// system prompt riset + pipeline sitasi deterministik.
//
// Batas keamanan: max searches/sources + timeout per tool call, semuanya
// bisa dioverride via env (lihat effectiveMaxSearches dkk).
// Tanpa search provider nyata yang dikonfigurasi, web_search JUJUR
// mengembalikan error "not configured" — tidak ada fake/mock hasil.

// Default limit (override via env: SEARCH_MAX_SEARCHES, SEARCH_MAX_SOURCES,
// SEARCH_TOOL_TIMEOUT_SECS, SEARCH_FETCH_TEXT, SEARCH_FETCH_BYTES,
// SEARCH_ENABLE_FALLBACK).
const (
	defaultMaxSearches = 8
	defaultMaxSources  = 10
	defaultToolTimeout = 20
	defaultFetchBytes  = 3 << 20
	defaultFetchText   = 20000
	defaultMaxResult   = 5
)

// effectiveMaxSearches membaca env live (agar t.Setenv di test bekerja).
func effectiveMaxSearches() int { return clampEnvInt("SEARCH_MAX_SEARCHES", defaultMaxSearches, 1, 15) }
func effectiveMaxSources() int  { return clampEnvInt("SEARCH_MAX_SOURCES", defaultMaxSources, 1, 20) }
func effectiveToolTimeout() int {
	return clampEnvInt("SEARCH_TOOL_TIMEOUT_SECS", defaultToolTimeout, 5, 60)
}
func effectiveFetchText() int { return clampEnvInt("SEARCH_FETCH_TEXT", defaultFetchText, 4000, 60000) }
func effectiveFetchBytes() int64 {
	return int64(clampEnvInt("SEARCH_FETCH_BYTES", defaultFetchBytes, 1<<20, 8<<20))
}

func fallbackEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("SEARCH_ENABLE_FALLBACK")))
	return v != "false" && v != "0" && v != "no"
}

func clampEnvInt(key string, def, min, max int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

// Kompatibilitas: test lama memakai maxSearches/maxSources sebagai nilai.
// Pertahankan sebagai alias default (kode produksi memakai effective*).
const (
	maxSearches     = defaultMaxSearches
	maxSources      = defaultMaxSources
	toolTimeoutSecs = defaultToolTimeout
	maxFetchBytes   = defaultFetchBytes
	maxFetchText    = defaultFetchText
)

// SearchResult adalah satu hasil pencarian.
type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// PageContent adalah hasil fetch satu URL.
type PageContent struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Text        string `json:"text"`
	Description string `json:"description,omitempty"`
	Published   string `json:"published,omitempty"`
	WordCount   int    `json:"word_count,omitempty"`
	FinalURL    string `json:"final_url,omitempty"`
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

// MultiSearchProvider: primary dulu, fallback gratis bila primary gagal /
// kosong. SEARCH_ENABLE_FALLBACK=false mematikan fallback.
type MultiSearchProvider struct {
	primary  SearchProvider
	fallback SearchProvider
}

func (m *MultiSearchProvider) Name() string { return "multi:" + m.primary.Name() }

func (m *MultiSearchProvider) Search(ctx context.Context, query string, maxResults int) ([]SearchResult, error) {
	out, err := m.primary.Search(ctx, query, maxResults)
	if err == nil && len(out) > 0 {
		return out, nil
	}
	if m.fallback == nil || !fallbackEnabled() {
		if err != nil {
			return nil, err
		}
		return out, nil
	}
	fb, fbErr := m.fallback.Search(ctx, query, maxResults)
	if fbErr != nil {
		if err != nil {
			return nil, fmt.Errorf("web search: primary gagal (%v) + fallback gagal (%v)", err, fbErr)
		}
		return nil, fbErr
	}
	return fb, nil
}

// searchProviderFromEnv memilih provider dari env.
// "keenable" = index web independen (keyless public endpoint, atau
// authenticated kalau KEENABLE_API_KEY di-set), dibungkus Multi dengan
// fallback DuckDuckGo Lite gratis. Default: unconfigured.
func searchProviderFromEnv() SearchProvider {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SEARCH_PROVIDER"))) {
	case "keenable":
		return &MultiSearchProvider{
			primary:  NewKeenableSearchProvider(),
			fallback: NewDuckDuckGoSearchProvider(),
		}
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
	if maxResults <= 0 {
		maxResults = defaultMaxResult
	}
	body, err := json.Marshal(map[string]interface{}{"query": query, "max_results": maxResults})
	if err != nil {
		return nil, fmt.Errorf("web search: %v", err)
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(600 * time.Millisecond):
			}
		}
		res, err := p.doOnce(ctx, body)
		if err != nil {
			lastErr = err
			if !isRetryableSearchErr(err) {
				return nil, err
			}
			continue
		}
		return res, nil
	}
	return nil, lastErr
}

func (p *KeenableSearchProvider) doOnce(ctx context.Context, body []byte) ([]SearchResult, error) {
	maxResults := defaultMaxResult
	// max_results sudah di body; potong lokal sebagai pengaman juga.
	var bodyProbe map[string]interface{}
	if err := json.Unmarshal(body, &bodyProbe); err == nil {
		if f, ok := bodyProbe["max_results"].(float64); ok && f >= 1 {
			maxResults = int(f)
		}
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
		return nil, fmt.Errorf("web search: %v (retryable)", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		peek, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		err := fmt.Errorf("web search: keenable HTTP %d: %.200s", res.StatusCode, strings.TrimSpace(string(peek)))
		if res.StatusCode == 429 || res.StatusCode >= 500 {
			return nil, fmt.Errorf("%w (retryable)", err)
		}
		return nil, err
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

func isRetryableSearchErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "(retryable)")
}

// ─── DuckDuckGo Lite (fallback gratis, tanpa API key) ───────────────────────

const ddgLiteURL = "https://lite.duckduckgo.com/lite/"

// DuckDuckGoSearchProvider: fallback gratis tanpa key. Kualitas di bawah
// Keenable (tanpa snippet kaya), tapi jauh lebih baik daripada gagal total.
type DuckDuckGoSearchProvider struct {
	client   *http.Client
	endpoint string
}

func NewDuckDuckGoSearchProvider() *DuckDuckGoSearchProvider {
	return &DuckDuckGoSearchProvider{
		client:   &http.Client{Timeout: keenableTimeoutSecs * time.Second},
		endpoint: ddgLiteURL,
	}
}

func (p *DuckDuckGoSearchProvider) Name() string { return "ddg-lite" }

func (p *DuckDuckGoSearchProvider) Search(ctx context.Context, query string, maxResults int) ([]SearchResult, error) {
	if maxResults <= 0 {
		maxResults = defaultMaxResult
	}
	u := p.endpoint + "?q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("web search (fallback): %v", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) PhronesisLab-Research/2.0")
	res, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("web search (fallback): %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("web search (fallback): HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("web search (fallback): %v", err)
	}
	return parseDDGLite(string(raw), maxResults), nil
}

// parseDDGLite mengekstrak link hasil dari halaman lite DDG.
func parseDDGLite(htmlBody string, maxResults int) []SearchResult {
	doc, err := nethtml.Parse(strings.NewReader(htmlBody))
	if err != nil {
		return nil
	}
	var out []SearchResult
	seen := map[string]bool{}
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if len(out) >= maxResults {
			return
		}
		if n.Type == nethtml.ElementNode && strings.EqualFold(n.Data, "a") {
			href := strings.TrimSpace(getAttr(n, "href"))
			// DDG membungkus link luar via //duckduckgo.com/l/?uddg=<url-encoded>.
			if strings.Contains(href, "uddg=") {
				if u, err := url.Parse(href); err == nil {
					if real := u.Query().Get("uddg"); real != "" {
						href = real
					}
				}
			}
			if (strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://")) &&
				!strings.Contains(strings.ToLower(href), "duckduckgo.com") {
				norm := normalizeURL(href)
				if !seen[norm] {
					title := strings.TrimSpace(collapseInline(innerTextRaw(n)))
					if len([]rune(title)) >= 8 {
						seen[norm] = true
						out = append(out, SearchResult{Title: title, URL: href, Snippet: ""})
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if len(out) >= maxResults {
				return
			}
			walk(c)
		}
	}
	walk(doc)
	return out
}

// ─── PageFetcher ────────────────────────────────────────────────────────────

// PageFetcher membaca satu URL menjadi teks.
type PageFetcher interface {
	Fetch(ctx context.Context, rawURL string) (PageContent, error)
}

// HTTPPageFetcher: fetch nyata (stdlib), timeout + cap + guard SSRF +
// retry 1x + ekstraksi artikel (bukan regex).
type HTTPPageFetcher struct {
	client *http.Client
}

func NewHTTPPageFetcher() *HTTPPageFetcher {
	return &HTTPPageFetcher{
		client: &http.Client{Timeout: time.Duration(effectiveToolTimeout()) * time.Second},
	}
}

// fetchUserAgent dirotasi ringan agar tidak diblokir satu UA statis.
func fetchUserAgent() string {
	return "Mozilla/5.0 (X11; Linux x86_64) PhronesisLab-Research/2.0 (+local; article-extract)"
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
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return PageContent{}, ctx.Err()
			case <-time.After(500 * time.Millisecond):
			}
		}
		page, retry, err := f.fetchOnce(ctx, u.String())
		if err == nil {
			return page, nil
		}
		lastErr = err
		if !retry {
			return PageContent{}, err
		}
	}
	return PageContent{}, lastErr
}

func (f *HTTPPageFetcher) fetchOnce(ctx context.Context, target string) (PageContent, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return PageContent{}, false, fmt.Errorf("fetch_url: %v", err)
	}
	req.Header.Set("User-Agent", fetchUserAgent())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5")
	req.Header.Set("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
	res, err := f.client.Do(req)
	if err != nil {
		return PageContent{}, true, fmt.Errorf("fetch_url: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode == 429 || res.StatusCode >= 500 {
		return PageContent{}, true, fmt.Errorf("fetch_url: HTTP %d (coba lagi nanti)", res.StatusCode)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return PageContent{}, false, fmt.Errorf("fetch_url: HTTP %d", res.StatusCode)
	}
	ct := res.Header.Get("Content-Type")
	ctLower := strings.ToLower(ct)
	b, err := io.ReadAll(io.LimitReader(res.Body, effectiveFetchBytes()))
	if err != nil {
		return PageContent{}, true, fmt.Errorf("fetch_url: %v", err)
	}
	finalURL := target
	if res.Request != nil && res.Request.URL != nil && res.Request.URL.String() != "" {
		finalURL = res.Request.URL.String()
	}

	// Tolak biner — tapi PDF diberi pesan yang berguna (ukuran + saran).
	switch {
	case strings.Contains(ctLower, "image/") || strings.Contains(ctLower, "video/") ||
		strings.Contains(ctLower, "audio/") || strings.Contains(ctLower, "octet-stream"):
		return PageContent{}, false, fmt.Errorf("fetch_url: tipe konten tidak didukung (%s)", ct)
	case strings.Contains(ctLower, "pdf"):
		return PageContent{}, false, fmt.Errorf(
			"fetch_url: PDF (%s, %d bytes) tidak bisa dibaca sebagai artikel — cari versi HTML dari dokumen yang sama, atau URL publisher-nya",
			ct, len(b))
	}

	bodyStr := decodeBody(b, ct)
	isHTML := strings.Contains(ctLower, "html") || strings.Contains(ctLower, "xml") ||
		strings.Contains(strings.ToLower(bodyStr[:minLen(len(bodyStr), 500)]), "<html") ||
		strings.Contains(bodyStr, "<article") || ct == ""
	if isHTML {
		art := ExtractArticle(bodyStr)
		title := art.Title
		if title == "" {
			title = finalURL
		}
		return PageContent{
			URL:         finalURL,
			Title:       truncateRunes(title, 200),
			Text:        smartTrimRunes(art.Text, effectiveFetchText()),
			Description: truncateRunes(art.Description, 500),
			Published:   art.Published,
			WordCount:   art.WordCount,
			FinalURL:    finalURL,
		}, false, nil
	}
	// Plain text / JSON / RSS: pakai langsung.
	text := smartTrimRunes(strings.TrimSpace(bodyStr), effectiveFetchText())
	return PageContent{
		URL: finalURL, Title: finalURL, Text: text,
		WordCount: countWords(text), FinalURL: finalURL,
	}, false, nil
}

func minLen(a, b int) int {
	if a < b {
		return a
	}
	return b
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

// normalizeURL untuk dedup: lowercase host, buang trailing slash,
// buang query tracking utm_*, buang fragment.
func normalizeURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
	}
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	q := u.Query()
	for k := range q {
		lk := strings.ToLower(k)
		if strings.HasPrefix(lk, "utm_") || lk == "fbclid" || lk == "gclid" {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	s := u.String()
	s = strings.TrimRight(s, "/")
	return s
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

	seenURLs map[string]bool
	history  []string
}

func NewResearchContext() *ResearchContext {
	return &ResearchContext{
		provider: searchProviderFromEnv(),
		fetcher:  NewHTTPPageFetcher(),
		seenURLs: map[string]bool{},
	}
}

// Sources mengembalikan sumber ter-fetch (urutan sitasi).
func (rc *ResearchContext) Sources() []Source {
	return rc.sources
}

// seenFetch memeriksa apakah URL sudah pernah di-fetch (dedup lintas call).
// Mengembalikan sumber lama bila sudah ada.
func (rc *ResearchContext) seenFetch(rawURL string) *Source {
	if rc.seenURLs == nil {
		rc.seenURLs = map[string]bool{}
	}
	norm := normalizeURL(rawURL)
	for i := range rc.sources {
		if normalizeURL(rc.sources[i].URL) == norm {
			s := rc.sources[i]
			return &s
		}
	}
	return nil
}

func (rc *ResearchContext) markSeen(rawURL string) {
	if rc.seenURLs == nil {
		rc.seenURLs = map[string]bool{}
	}
	rc.seenURLs[normalizeURL(rawURL)] = true
}

// ─── Research system prompt & sitasi ────────────────────────────────────────

const researchSystemPrompt = `Kamu adalah research agent yang AKTIF dan AGRESIF di Phronesis Lab. User menyalakan Research Mode artinya mereka mau jawaban dari RISET WEB NYATA — bukan dari ingatanmu. Jawab BERDASARKAN sumber yang benar-benar kamu baca.

ATURAN PALING PENTING: untuk setiap pertanyaan informasi, kamu DILARANG menjawab langsung tanpa tool. Pengecualian HANYA sapaan/basa-basi murni ("hai", "makasih", "oke") — selain itu WAJIB riset dulu.

Alur wajib (kerja paralel, jangan satu-satu):
1. LANGSUNG bergerak: di giliran tool PERTAMA, panggil 2-4 web_search SEKALIGUS dalam satu blok dengan query yang DIVERSIFIKASI (sudut berbeda, bukan variasi kata yang sama; campur bahasa Indonesia + Inggris bila topiknya global).
2. Evaluasi semua hasil: pilih 3-4 sumber paling relevan dan kredibel (utamakan domain resmi/dokumentasi/jurnal/media besar; perhatikan tanggal terbit bila fakta sensitif waktu). Lalu panggil 3-4 fetch_url SEKALIGUS dalam satu blok.
3. KUOTA MINIMUM sebelum menjawab: minimal 2 query pencarian berbeda DAN minimal 3 sumber berhasil dibaca. Kalau bukti masih kurang: cari lagi dengan query sudut berbeda, JANGAN berhenti prematur dan JANGAN mengarang.
4. Sintesis dari bukti yang kamu baca. Rujuk sumber dengan marker [1], [2], dst sesuai urutan sumber dibaca. Jawab ringkas, langsung ke intinya, dalam bahasa user.
5. Kalau search belum dikonfigurasi atau sumber tidak cukup: katakan JUJUR apa yang kurang — JANGAN mengarang URL, judul, kutipan, atau fakta.

Penutup wajib — blok pertanyaan lanjutan (dipakai UI sebagai tombol, jadi formatnya HARUS persis):
Akhiri SETIAP jawaban riset (kecuali sapaan) dengan blok berikut, tepat 3 pertanyaan yang spesifik dan bisa diriset lanjut:

### Pertanyaan lanjutan
1. <pertanyaan 1>
2. <pertanyaan 2>
3. <pertanyaan 3>

Aturan keras:
- DILARANG mengarang URL, judul artikel, angka, atau kutipan.
- Hanya klaim fakta yang didukung tool_result.
- Jangan fetch URL yang sama berulang — pakai sumber yang sudah dibaca.
- Jangan berhenti setelah 1 pencarian + 1 sumber. Riset yang dangkal = gagal.`

// maxResearchNudges membatasi berapa kali loop boleh menolak jawaban
// langsung tanpa riset (agar model yang bandel tidak infinite loop).
const maxResearchNudges = 2

// researchNudgeMessage disuntik sebagai pesan user saat agent research mode
// berani menjawab tanpa memakai satu pun tool riset.
const researchNudgeMessage = `Kamu menjawab langsung TANPA memakai tool riset sama sekali, padahal Research Mode AKTIF. Jawaban itu DITOLAK. SEKARANG panggil web_search (2-4 query berbeda SEKALIGUS dalam satu blok) — DILARANG menjawab dengan teks biasa sebelum membaca sumber via fetch_url.`

// researchFollowupHeader adalah penanda blok pertanyaan lanjutan yang
// diwajibkan prompt di atas. Frontend memakainya untuk merender tombol.
const researchFollowupHeader = "### Pertanyaan lanjutan"

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
