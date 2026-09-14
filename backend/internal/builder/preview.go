package builder

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
)

// previewPathRe matches /b/{port}[/...] preview paths (slash opsional —
// vite dengan base /b/{port}/ redirect sendiri ke bentuk berslash).
var previewPathRe = regexp.MustCompile(`^/b/(\d{4,5})(/.*)?$`)

// RegisterPreviewProxy mounts GET/HEAD /b/{port}/ -> 127.0.0.1:{port}.
// The UI embeds the preview via this host-relative path so it works from
// any host (localhost, LAN IP, Tailscale) without CORS or hardcoded hosts.
func RegisterPreviewProxy(mux *http.ServeMux) {
	mux.HandleFunc("/b/", previewProxy)
}

func previewProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	m := previewPathRe.FindStringSubmatch(r.URL.Path)
	if m == nil {
		jsonErr(w, http.StatusNotFound, "invalid preview path")
		return
	}
	port, err := strconv.Atoi(m[1])
	if err != nil || port < 4500 || port > 4600 {
		jsonErr(w, http.StatusNotFound, "preview port out of range")
		return
	}
	target, err := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "bad target")
		return
	}
	// Vite di sandbox dijalankan dengan --base /b/{port}/ (BASE_PATH env),
	// jadi path HARUS diteruskan apa adanya — jangan di-strip. Kalau di-strip,
	// vite menerima "/" dan me-redirect balik ke base -> loop 302.
	r2 := r.Clone(r.Context())
	r2.Host = target.Host
	// Vite dev server checks Host/Origin for HMR websocket + asset URLs;
	// present the preview origin so it serves absolute /@vite paths fine.
	r2.Header.Del("X-Forwarded-Host")
	proxy := httputil.NewSingleHostReverseProxy(target)
	// Strip the CSP-unsafe hop headers; keep websocket upgrade intact.
	proxy.FlushInterval = -1 // streaming HMR
	log.Printf("[builder-preview] %s -> %s%s", r.URL.Path, target, r.URL.Path)
	proxy.ServeHTTP(w, r2)
}
