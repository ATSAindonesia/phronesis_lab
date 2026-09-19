package commands

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/jmoiron/sqlx"

	"lab/internal/auth"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type Handler struct {
	store *Store
}

func NewHandler(db *sqlx.DB) *Handler {
	return &Handler{store: NewStore(db)}
}

// RegisterRoutes mendaftarkan endpoint Command Sets. Semua route dibungkus
// requireKey (X-API-Key dari proxy Next.js) + middleware JWT, pola sama
// dengan riwayat chat.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	wrap := func(next http.Handler) http.Handler {
		return h.requireKey(authMW(next))
	}

	mux.Handle("GET /v1/commands/services", wrap(http.HandlerFunc(h.listServices)))
	mux.Handle("POST /v1/commands/services", wrap(http.HandlerFunc(h.createService)))
	mux.Handle("GET /v1/commands/services/{id}", wrap(http.HandlerFunc(h.getService)))
	mux.Handle("PATCH /v1/commands/services/{id}", wrap(http.HandlerFunc(h.updateService)))
	mux.Handle("DELETE /v1/commands/services/{id}", wrap(http.HandlerFunc(h.deleteService)))
	mux.Handle("POST /v1/commands/services/{id}/titles", wrap(http.HandlerFunc(h.createTitle)))

	mux.Handle("GET /v1/commands/titles/{id}", wrap(http.HandlerFunc(h.getTitle)))
	mux.Handle("PATCH /v1/commands/titles/{id}", wrap(http.HandlerFunc(h.updateTitle)))
	mux.Handle("DELETE /v1/commands/titles/{id}", wrap(http.HandlerFunc(h.deleteTitle)))
	mux.Handle("POST /v1/commands/titles/{id}/commands", wrap(http.HandlerFunc(h.createCommand)))

	mux.Handle("PATCH /v1/commands/entries/{id}", wrap(http.HandlerFunc(h.updateCommand)))
	mux.Handle("DELETE /v1/commands/entries/{id}", wrap(http.HandlerFunc(h.deleteCommand)))
}

func (h *Handler) requireKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		if key == "" {
			key = r.URL.Query().Get("api_key")
		}
		if key == "" {
			jsonErr(w, http.StatusUnauthorized, "X-API-Key header is required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Service ────────────────────────────────────────────────────────────────

func (h *Handler) listServices(w http.ResponseWriter, r *http.Request) {
	services, err := h.store.ListServices(auth.UserUUID(r.Context()))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to list services")
		return
	}
	if services == nil {
		services = []Service{}
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"services": services})
}

func (h *Handler) createService(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	name := truncateRunes(strings.TrimSpace(body.Name), 120)
	if name == "" {
		jsonErr(w, http.StatusBadRequest, "Service name is required")
		return
	}
	svc, err := h.store.CreateService(auth.UserUUID(r.Context()), name, strings.TrimSpace(body.Description))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to create service")
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]interface{}{"service": svc})
}

func (h *Handler) getService(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid service id")
		return
	}
	svc, err := h.store.GetService(auth.UserUUID(r.Context()), id)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "Service not found")
		return
	}
	titles, err := h.store.ListTitles(id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to list command titles")
		return
	}
	if titles == nil {
		titles = []CommandTitle{}
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"service": svc, "titles": titles})
}

func (h *Handler) updateService(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid service id")
		return
	}
	userUUID := auth.UserUUID(r.Context())
	current, err := h.store.GetService(userUUID, id)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "Service not found")
		return
	}
	var body struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	name, description := current.Name, current.Description
	if body.Name != nil {
		name = truncateRunes(strings.TrimSpace(*body.Name), 120)
		if name == "" {
			jsonErr(w, http.StatusBadRequest, "Service name is required")
			return
		}
	}
	if body.Description != nil {
		description = strings.TrimSpace(*body.Description)
	}
	if err := h.store.UpdateService(userUUID, id, name, description); err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to update service")
		return
	}
	updated, err := h.store.GetService(userUUID, id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to reload service")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"service": updated})
}

func (h *Handler) deleteService(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid service id")
		return
	}
	if err := h.store.DeleteService(auth.UserUUID(r.Context()), id); err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Service not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to delete service")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]string{"ok": "true"})
}

// ─── Judul command ──────────────────────────────────────────────────────────

func (h *Handler) createTitle(w http.ResponseWriter, r *http.Request) {
	serviceID := r.PathValue("id")
	if !uuidRe.MatchString(serviceID) {
		jsonErr(w, http.StatusBadRequest, "Invalid service id")
		return
	}
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	title := truncateRunes(strings.TrimSpace(body.Title), 255)
	if title == "" {
		jsonErr(w, http.StatusBadRequest, "Command title is required")
		return
	}
	t, err := h.store.CreateTitle(auth.UserUUID(r.Context()), serviceID, title, strings.TrimSpace(body.Description))
	if err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Service not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to create command title")
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]interface{}{"title": t})
}

func (h *Handler) getTitle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid title id")
		return
	}
	title, err := h.store.GetTitle(auth.UserUUID(r.Context()), id)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "Command title not found")
		return
	}
	entries, err := h.store.ListCommands(id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to list commands")
		return
	}
	if entries == nil {
		entries = []Command{}
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"title": title, "commands": entries})
}

func (h *Handler) updateTitle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid title id")
		return
	}
	userUUID := auth.UserUUID(r.Context())
	current, err := h.store.GetTitle(userUUID, id)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "Command title not found")
		return
	}
	var body struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	title, description := current.Title, current.Description
	if body.Title != nil {
		title = truncateRunes(strings.TrimSpace(*body.Title), 255)
		if title == "" {
			jsonErr(w, http.StatusBadRequest, "Command title is required")
			return
		}
	}
	if body.Description != nil {
		description = strings.TrimSpace(*body.Description)
	}
	if err := h.store.UpdateTitle(userUUID, id, title, description); err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to update command title")
		return
	}
	updated, err := h.store.GetTitle(userUUID, id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to reload command title")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"title": updated})
}

func (h *Handler) deleteTitle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid title id")
		return
	}
	if err := h.store.DeleteTitle(auth.UserUUID(r.Context()), id); err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Command title not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to delete command title")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]string{"ok": "true"})
}

// ─── Command bash ───────────────────────────────────────────────────────────

func (h *Handler) createCommand(w http.ResponseWriter, r *http.Request) {
	titleID := r.PathValue("id")
	if !uuidRe.MatchString(titleID) {
		jsonErr(w, http.StatusBadRequest, "Invalid title id")
		return
	}
	var body struct {
		Label       string `json:"label"`
		Body        string `json:"body"`
		Description string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	commandBody := strings.TrimRight(body.Body, "\n")
	if strings.TrimSpace(commandBody) == "" {
		jsonErr(w, http.StatusBadRequest, "Command body is required")
		return
	}
	c, err := h.store.CreateCommand(
		auth.UserUUID(r.Context()), titleID,
		truncateRunes(strings.TrimSpace(body.Label), 255),
		commandBody,
		strings.TrimSpace(body.Description),
	)
	if err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Command title not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to create command")
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]interface{}{"command": c})
}

func (h *Handler) updateCommand(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid command id")
		return
	}
	userUUID := auth.UserUUID(r.Context())
	current, err := h.store.GetCommand(userUUID, id)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "Command not found")
		return
	}
	var body struct {
		Label       *string `json:"label"`
		Body        *string `json:"body"`
		Description *string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	label, commandBody, description := current.Label, current.Body, current.Description
	if body.Label != nil {
		label = truncateRunes(strings.TrimSpace(*body.Label), 255)
	}
	if body.Body != nil {
		commandBody = strings.TrimRight(*body.Body, "\n")
		if strings.TrimSpace(commandBody) == "" {
			jsonErr(w, http.StatusBadRequest, "Command body is required")
			return
		}
	}
	if body.Description != nil {
		description = strings.TrimSpace(*body.Description)
	}
	if err := h.store.UpdateCommand(userUUID, id, label, commandBody, description); err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to update command")
		return
	}
	updated, err := h.store.GetCommand(userUUID, id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to reload command")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"command": updated})
}

func (h *Handler) deleteCommand(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		jsonErr(w, http.StatusBadRequest, "Invalid command id")
		return
	}
	if err := h.store.DeleteCommand(auth.UserUUID(r.Context()), id); err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Command not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to delete command")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]string{"ok": "true"})
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func decodeBody(r *http.Request, v interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

func jsonErr(w http.ResponseWriter, status int, message string) {
	writeJSONStatus(w, status, map[string]string{"error": message})
}

func writeJSONStatus(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}
