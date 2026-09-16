package files

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Sentinel errors — dipetakan ke status HTTP di handler.go.
var (
	errBadRequest = errors.New("invalid path or request")
	errForbidden  = errors.New("access outside project root is not allowed")
	errBinary     = errors.New("file type not allowed")
	errNotFound   = errors.New("file or directory not found")
	errTooLarge   = errors.New("file exceeds the size limit")
	errInternal   = errors.New("internal error")
)

// maxFileSize membatasi ukuran file yang bisa dibaca via /api/files/content.
const maxFileSize = 1 << 20 // 1 MB

// ignoredNames tidak pernah muncul di tree (di-skip saat scan directory).
var ignoredNames = map[string]bool{
	".git":         true,
	"node_modules": true,
	".next":        true,
	"dist":         true,
	"build":        true,
	"coverage":     true,
	".cache":       true,
}

// blockedNames: file kredensial/private key yang tidak boleh dibaca isinya.
var blockedNames = map[string]bool{
	".env":             true,
	".npmrc":           true,
	".netrc":           true,
	".git-credentials": true,
	".htpasswd":        true,
}

// blockedExtensions: ekstensi binary/private key yang tidak boleh dibaca.
var blockedExtensions = map[string]bool{
	".pem": true, ".key": true, ".p12": true, ".pfx": true, ".jks": true, ".kdbx": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".ico": true, ".bmp": true,
	".pdf": true, ".zip": true, ".tar": true, ".gz": true, ".tgz": true, ".bz2": true, ".7z": true, ".rar": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".eot": true,
	".mp3": true, ".mp4": true, ".webm": true, ".wav": true, ".ogg": true,
	".exe": true, ".dll": true, ".so": true, ".dylib": true, ".bin": true,
	".db": true, ".sqlite": true, ".sqlite3": true, ".wasm": true,
	".pyc": true, ".class": true, ".o": true, ".a": true,
}

// languageByExt memetakan ekstensi -> label language untuk syntax highlighting
// di frontend.
var languageByExt = map[string]string{
	".go": "go", ".mod": "go", ".sum": "go",
	".ts": "typescript", ".tsx": "tsx",
	".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "jsx",
	".json": "json", ".jsonc": "json",
	".css": "css", ".scss": "scss", ".sass": "scss", ".less": "less",
	".html": "html", ".htm": "html",
	".md": "markdown", ".mdx": "markdown",
	".yml": "yaml", ".yaml": "yaml",
	".sh": "bash", ".bash": "bash", ".zsh": "bash",
	".py": "python", ".sql": "sql", ".toml": "toml",
	".rs": "rust", ".java": "java", ".kt": "kotlin", ".swift": "swift",
	".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
	".rb": "ruby", ".php": "php", ".xml": "xml", ".svg": "xml",
	".vue": "vue", ".svelte": "svelte", ".graphql": "graphql", ".prisma": "prisma",
	".txt": "plaintext", ".log": "plaintext", ".csv": "csv",
}

// languageByBase: nama file (tanpa ekstensi) yang punya language khusus.
var languageByBase = map[string]string{
	"dockerfile":     "dockerfile",
	"makefile":       "makefile",
	".gitignore":     "plaintext",
	".gitattributes": "plaintext",
	".editorconfig":  "plaintext",
	".env.example":   "plaintext",
	"license":        "plaintext",
}

// Entry adalah satu baris di response tree.
type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"` // "directory" | "file"
}

// FileContent adalah response /api/files/content.
type FileContent struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Language string `json:"language"`
	Size     int64  `json:"size"`
	Content  string `json:"content"`
}

type Handler struct {
	root         string
	resolvedRoot string
}

// NewHandler membaca PROJECT_ROOT dari environment (fallback: working directory).
func NewHandler() *Handler {
	root := os.Getenv("PROJECT_ROOT")
	if root == "" {
		root, _ = os.Getwd()
	}
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	resolved := root
	if r, err := filepath.EvalSymlinks(root); err == nil {
		resolved = r
	}
	return &Handler{root: root, resolvedRoot: resolved}
}

// resolve memetakan path relatif dari request ke path absolut di dalam root.
// Path traversal ("..") ditolak; path absolut dipaksa relatif terhadap root.
func (h *Handler) resolve(rel string) (abs string, cleaned string, err error) {
	if strings.Contains(rel, "..") {
		return "", "", errForbidden
	}
	cleaned = filepath.Clean("/" + rel) // paksa relatif terhadap root
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "." {
		cleaned = ""
	}
	abs = filepath.Join(h.root, cleaned)
	if cleaned != "" && !withinRoot(h.root, abs) {
		return "", "", errForbidden
	}
	return abs, cleaned, nil
}

// statSafe mengambil FileInfo dan memastikan target (termasuk lewat symlink)
// tetap berada di dalam PROJECT_ROOT.
func (h *Handler) statSafe(abs string) (os.FileInfo, error) {
	fi, err := os.Stat(abs)
	if err != nil {
		return nil, errNotFound
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		if !withinRoot(h.resolvedRoot, real) {
			return nil, errForbidden
		}
	}
	return fi, nil
}

// ListDir mengembalikan satu level isi directory (lazy, tidak rekursif),
// terurut directory dulu lalu nama. Directory dalam ignoredNames di-skip.
func (h *Handler) ListDir(rel string) (string, []Entry, error) {
	abs, cleaned, err := h.resolve(rel)
	if err != nil {
		return "", nil, err
	}
	fi, err := h.statSafe(abs)
	if err != nil {
		return "", nil, err
	}
	if !fi.IsDir() {
		return "", nil, errBadRequest
	}
	dirEntries, err := os.ReadDir(abs)
	if err != nil {
		return "", nil, errInternal
	}
	entries := make([]Entry, 0, len(dirEntries))
	for _, de := range dirEntries {
		name := de.Name()
		if ignoredNames[name] {
			continue
		}
		childRel := name
		if cleaned != "" {
			childRel = cleaned + "/" + name
		}
		typ := "file"
		if de.IsDir() {
			typ = "directory"
		}
		entries = append(entries, Entry{Name: name, Path: childRel, Type: typ})
	}
	sort.Slice(entries, func(i, j int) bool {
		if (entries[i].Type == "directory") != (entries[j].Type == "directory") {
			return entries[i].Type == "directory"
		}
		return entries[i].Name < entries[j].Name
	})
	return cleaned, entries, nil
}

// ReadFile membaca isi file (maks 1 MB, teks saja) di dalam root.
// File .env, private key, credentials, dan binary ditolak.
func (h *Handler) ReadFile(rel string) (*FileContent, error) {
	abs, cleaned, err := h.resolve(rel)
	if err != nil {
		return nil, err
	}
	if cleaned == "" {
		return nil, errBadRequest
	}
	fi, err := h.statSafe(abs)
	if err != nil {
		return nil, err
	}
	if fi.IsDir() {
		return nil, errBadRequest
	}
	if isBlockedFile(fi.Name()) {
		return nil, errBinary
	}
	if fi.Size() > maxFileSize {
		return nil, errTooLarge
	}
	f, err := os.Open(abs)
	if err != nil {
		return nil, errNotFound
	}
	defer f.Close()
	// Baca maksimal maxFileSize+1 supaya file yang membesar antara stat
	// dan read tetap ketahuan kelebihan ukuran.
	data, err := io.ReadAll(io.LimitReader(f, maxFileSize+1))
	if err != nil {
		return nil, errInternal
	}
	if len(data) > maxFileSize {
		return nil, errTooLarge
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, errBinary // null byte = binary
	}
	name := fi.Name()
	return &FileContent{
		Path:     cleaned,
		Name:     name,
		Language: detectLanguage(name),
		Size:     fi.Size(),
		Content:  string(data),
	}, nil
}

// isBlockedFile menolak .env, private key, credentials, dan binary berdasar
// nama/ekstensi.
func isBlockedFile(name string) bool {
	lower := strings.ToLower(name)
	switch {
	case blockedNames[lower]:
		return true
	case strings.HasPrefix(lower, ".env."):
		return true
	case strings.HasPrefix(lower, "id_rsa"),
		strings.HasPrefix(lower, "id_ed25519"),
		strings.HasPrefix(lower, "id_ecdsa"),
		strings.HasPrefix(lower, "id_dsa"):
		return true
	case strings.Contains(lower, "credential"), strings.Contains(lower, "private_key"):
		return true
	}
	return blockedExtensions[filepath.Ext(lower)]
}

// detectLanguage menentukan label language dari nama file.
func detectLanguage(name string) string {
	lower := strings.ToLower(name)
	if lang, ok := languageByBase[lower]; ok {
		return lang
	}
	if lang, ok := languageByExt[filepath.Ext(lower)]; ok {
		return lang
	}
	return "plaintext"
}

func withinRoot(root, p string) bool {
	root = filepath.Clean(root)
	p = filepath.Clean(p)
	return p == root || strings.HasPrefix(p, root+string(os.PathSeparator))
}
