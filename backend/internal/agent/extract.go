package agent

import (
	stdhtml "html"
	"strings"
	"unicode/utf8"

	nethtml "golang.org/x/net/html"
)

// ─── Article extractor (pengganti regex htmlToText) ──────────────────────────
// Extractor DOM: buang boilerplate (nav/footer/ads/script), pilih konten
// utama (article > main > div terpadat), preservasi struktur heading/list,
// decode full HTML entities, kembalikan metadata (title/description/author/
// published/canonical) untuk sniffing yang lebih kuat.

// ExtractedPage adalah hasil ekstraksi satu halaman HTML.
type ExtractedPage struct {
	Title       string
	Description string
	Author      string
	Published   string
	Canonical   string
	Text        string
	Headings    []string
	WordCount   int
}

// ExtractArticle mengekstrak konten utama dari HTML mentah.
func ExtractArticle(rawHTML string) ExtractedPage {
	doc, err := nethtml.Parse(strings.NewReader(rawHTML))
	if err != nil {
		// Fallback: teks polos minimal (jangan pernah gagal total).
		t := smartTrimRunes(collapseInline(stripTagsFallback(rawHTML)), 20000)
		return ExtractedPage{Text: t, WordCount: countWords(t)}
	}
	meta := collectMeta(doc)
	stripBoilerplate(doc)
	candidate := pickMainContent(doc)
	text, headings := renderText(candidate)
	text = smartTrimRunes(text, 20000)
	return ExtractedPage{
		Title:       meta.title,
		Description: meta.description,
		Author:      meta.author,
		Published:   meta.published,
		Canonical:   meta.canonical,
		Text:        text,
		Headings:    headings,
		WordCount:   countWords(text),
	}
}

// ─── Metadata ────────────────────────────────────────────────────────────────

type pageMeta struct {
	title       string
	description string
	author      string
	published   string
	canonical   string
	h1          string
}

func collectMeta(doc *nethtml.Node) pageMeta {
	var m pageMeta
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if n.Type == nethtml.ElementNode {
			switch strings.ToLower(n.Data) {
			case "title":
				if m.title == "" {
					m.title = strings.TrimSpace(innerTextRaw(n))
				}
			case "h1":
				if m.h1 == "" {
					m.h1 = strings.TrimSpace(innerTextRaw(n))
				}
			case "meta":
				name := strings.ToLower(strings.TrimSpace(getAttr(n, "name")))
				prop := strings.ToLower(strings.TrimSpace(getAttr(n, "property")))
				content := strings.TrimSpace(getAttr(n, "content"))
				if content == "" {
					break
				}
				switch name {
				case "description":
					if m.description == "" {
						m.description = content
					}
				case "author":
					if m.author == "" {
						m.author = content
					}
				}
				switch prop {
				case "og:title":
					if m.title == "" {
						m.title = content
					}
				case "og:description":
					if m.description == "" {
						m.description = content
					}
				case "article:published_time", "article:published", "og:published_time":
					if m.published == "" {
						m.published = content
					}
				}
				if name == "article:published_time" && m.published == "" {
					m.published = content
				}
				if name == "publish_date" && m.published == "" {
					m.published = content
				}
			case "link":
				if strings.EqualFold(strings.TrimSpace(getAttr(n, "rel")), "canonical") {
					if m.canonical == "" {
						m.canonical = strings.TrimSpace(getAttr(n, "href"))
					}
				}
			case "time":
				if m.published == "" {
					if dt := strings.TrimSpace(getAttr(n, "datetime")); dt != "" {
						m.published = dt
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	if m.title == "" {
		m.title = m.h1
	}
	m.title = stdhtml.UnescapeString(strings.TrimSpace(m.title))
	m.description = stdhtml.UnescapeString(strings.TrimSpace(m.description))
	return m
}

// ─── Boilerplate stripping ───────────────────────────────────────────────────

var dropTags = map[string]bool{
	"script": true, "style": true, "noscript": true, "template": true,
	"svg": true, "canvas": true, "form": true, "button": true,
	"header": true, "nav": true, "footer": true, "aside": true,
	"dialog": true, "select": true, "input": true, "textarea": true,
}

// Pola class/id boilerplate (hanya untuk container, bukan teks utama).
func isBoilerplateClass(s string) bool {
	s = strings.ToLower(s)
	for _, k := range []string{
		"sidebar", "advert", "ads", "adsbox", "promo", "cookie", "newsletter",
		"popup", "subscribe", "breadcrumb", "social-share", "share-buttons",
		"related-posts", "read-also", "comment", "widget", "sponsor",
	} {
		if strings.Contains(s, k) {
			return true
		}
	}
	return false
}

func stripBoilerplate(doc *nethtml.Node) {
	// Two-pass: kumpulkan dulu, hapus kemudian — menghapus saat traversal
	// merusak urutan kunjungan (sibling berikutnya terlewat).
	var victims []*nethtml.Node
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == nethtml.ElementNode {
				tag := strings.ToLower(c.Data)
				if dropTags[tag] {
					victims = append(victims, c)
					continue // jangan masuk ke subtree yang akan dibuang
				}
				if tag == "div" || tag == "section" || tag == "aside" || tag == "ul" {
					cls := getAttr(c, "class") + " " + getAttr(c, "id") + " " + getAttr(c, "role")
					if isBoilerplateClass(cls) {
						victims = append(victims, c)
						continue
					}
				}
			}
			walk(c)
		}
	}
	walk(doc)
	for _, v := range victims {
		removeNode(v)
	}
}

func removeNode(n *nethtml.Node) {
	if n.Parent != nil {
		n.Parent.RemoveChild(n)
	}
}

// ─── Main-content picking ────

// pickMainContent: article pertama yang berisi teks -> main/[role=main] ->
// div/section terpadat (skor = kata - penalti link-density) -> body.
func pickMainContent(doc *nethtml.Node) *nethtml.Node {
	body := findNode(doc, "body")
	if body == nil {
		body = doc
	}
	// 1. <article> pertama yang cukup berisi.
	var firstArticle *nethtml.Node
	var findArticle func(n *nethtml.Node)
	findArticle = func(n *nethtml.Node) {
		if firstArticle != nil {
			return
		}
		if n.Type == nethtml.ElementNode && strings.ToLower(n.Data) == "article" {
			if countWords(innerTextRaw(n)) >= 25 {
				firstArticle = n
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			findArticle(c)
		}
	}
	findArticle(body)
	if firstArticle != nil {
		return firstArticle
	}
	// 2. <main> / [role=main].
	var main *nethtml.Node
	var findMain func(n *nethtml.Node)
	findMain = func(n *nethtml.Node) {
		if main != nil {
			return
		}
		if n.Type == nethtml.ElementNode {
			tag := strings.ToLower(n.Data)
			if tag == "main" || strings.EqualFold(getAttr(n, "role"), "main") {
				main = n
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			findMain(c)
		}
	}
	findMain(body)
	if main != nil && countWords(innerTextRaw(main)) >= 25 {
		return main
	}
	// 3. div/section terpadat.
	var best *nethtml.Node
	bestScore := 0
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if n.Type == nethtml.ElementNode {
			tag := strings.ToLower(n.Data)
			if tag == "div" || tag == "section" {
				total := countWords(innerTextRaw(n))
				if total >= 60 {
					linkW := countWords(linkTextRaw(n))
					// Penalti link-density: navigasi punya rasio link tinggi.
					score := total - 2*linkW
					if score > bestScore {
						bestScore = score
						best = n
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	base := main
	if base == nil {
		base = body
	}
	walk(base)
	if best != nil {
		return best
	}
	return body
}

func findNode(root *nethtml.Node, tag string) *nethtml.Node {
	var found *nethtml.Node
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if found != nil {
			return
		}
		if n.Type == nethtml.ElementNode && strings.ToLower(n.Data) == tag {
			found = n
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return found
}

// ─── Rendering ───────────────────────────────────────────────────────────────

func renderText(root *nethtml.Node) (string, []string) {
	var sb strings.Builder
	var headings []string
	var render func(n *nethtml.Node)
	render = func(n *nethtml.Node) {
		switch n.Type {
		case nethtml.TextNode:
			sb.WriteString(collapseInline(stdhtml.UnescapeString(n.Data)))
			sb.WriteString(" ")
			return
		case nethtml.ElementNode:
			tag := strings.ToLower(n.Data)
			switch tag {
			case "h1", "h2", "h3":
				t := strings.TrimSpace(collapseInline(stdhtml.UnescapeString(innerTextRaw(n))))
				if t != "" {
					sb.WriteString("\n\n## " + t + "\n")
					if len(headings) < 20 {
						headings = append(headings, t)
					}
				}
				return // jangan render ulang anaknya
			case "li":
				t := strings.TrimSpace(collapseInline(stdhtml.UnescapeString(innerTextRaw(n))))
				if t != "" {
					sb.WriteString("\n- " + t)
				}
				return
			case "br":
				sb.WriteString("\n")
				return
			case "p", "div", "section", "article", "main", "blockquote", "pre":
				sb.WriteString("\n\n")
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			render(c)
		}
		if n.Type == nethtml.ElementNode {
			tag := strings.ToLower(n.Data)
			switch tag {
			case "p", "div", "section", "article", "main", "blockquote", "pre", "ul", "ol", "table":
				sb.WriteString("\n")
			}
		}
	}
	render(root)
	s := sb.String()
	// Normalisasi blank lines: maksimal 2 newline berurutan.
	s = normalizeBlankLines(s)
	return strings.TrimSpace(s), headings
}

func normalizeBlankLines(s string) string {
	s = strings.ReplaceAll(s, "\r", "\n")
	lines := strings.Split(s, "\n")
	var out []string
	blanks := 0
	for _, l := range lines {
		t := strings.TrimRight(l, " \t")
		if strings.TrimSpace(t) == "" {
			blanks++
			if blanks <= 2 {
				out = append(out, "")
			}
			continue
		}
		blanks = 0
		out = append(out, t)
	}
	return strings.Join(out, "\n")
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func getAttr(n *nethtml.Node, key string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return a.Val
		}
	}
	return ""
}

func innerTextRaw(n *nethtml.Node) string {
	var sb strings.Builder
	var walk func(x *nethtml.Node)
	walk = func(x *nethtml.Node) {
		if x.Type == nethtml.TextNode {
			sb.WriteString(x.Data + " ")
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return sb.String()
}

func linkTextRaw(n *nethtml.Node) string {
	var sb strings.Builder
	var walk func(x *nethtml.Node)
	walk = func(x *nethtml.Node) {
		if x.Type == nethtml.ElementNode && strings.ToLower(x.Data) == "a" {
			sb.WriteString(innerTextRaw(x) + " ")
			return
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return sb.String()
}

func collapseInline(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\t", " ")
	// collapse spasi ganda
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return s
}

func countWords(s string) int {
	return len(strings.Fields(s))
}

// smartTrimRunes memotong per-paragraf (tidak tengah kalimat) + penanda.
func smartTrimRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	paras := strings.Split(s, "\n\n")
	var sb strings.Builder
	used := 0
	for i, p := range paras {
		pr := []rune(p)
		need := len(pr) + 2
		if used+need > max {
			if i == 0 {
				// Paragraf pertama saja sudah kepanjangan: potong keras.
				return string(r[:max]) + "\n\n[DIPOTONG — konten bersambung, sisa tidak ditampilkan]"
			}
			break
		}
		if i > 0 {
			sb.WriteString("\n\n")
			used += 2
		}
		sb.WriteString(p)
		used += len(pr)
	}
	sb.WriteString("\n\n[DIPOTONG — konten bersambung, sisa tidak ditampilkan]")
	return sb.String()
}

// decodeBody mengkonversi body bytes ke string dengan penanganan charset
// minimal: hormati charset latin-1 bila body bukan UTF-8 valid.
func decodeBody(b []byte, contentType string) string {
	if utf8.Valid(b) {
		return string(b)
	}
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "iso-8859-1") || strings.Contains(ct, "latin-1") || strings.Contains(ct, "windows-1252") {
		runes := make([]rune, 0, len(b))
		for _, c := range b {
			runes = append(runes, rune(c))
		}
		return string(runes)
	}
	return string(b)
}

// stripTagsFallback untuk kasus parse gagal total (stdlib-only).
func stripTagsFallback(h string) string {
	var sb strings.Builder
	inTag := false
	for _, r := range h {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
			sb.WriteString(" ")
		default:
			if !inTag {
				sb.WriteRune(r)
			}
		}
	}
	return stdhtml.UnescapeString(sb.String())
}
