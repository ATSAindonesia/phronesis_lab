package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Me menangani GET /v1/users/me — profil sendiri dari JWT.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u, err := h.service.GetUser(UserUUID(r.Context()))
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}

// ListUsers menangani GET /v1/users — daftar user tanpa password.
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.service.ListUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"users": users})
}

// CreateUser menangani POST /v1/users — tambah user (sesi login, bukan
// signup publik yang terkunci).
func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	req.Name = strings.TrimSpace(req.Name)
	if req.Email == "" || req.Name == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "name, email, and password are required")
		return
	}
	if len(req.Password) < 6 {
		writeError(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}
	user, err := h.service.CreateUser(req)
	if err != nil {
		if isDup(err) {
			writeError(w, http.StatusConflict, "email is already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create user")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"user": user})
}

// GetUser menangani GET /v1/users/{id}.
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	u, err := h.service.GetUser(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}

// UpdateUser menangani PATCH /v1/users/{id} — edit nama/email.
func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body struct {
		Name  *string `json:"name"`
		Email *string `json:"email"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	updated, err := h.service.UpdateUser(id, body.Name, body.Email)
	if err != nil {
		switch {
		case err == errNotFound:
			writeError(w, http.StatusNotFound, "user not found")
		case err == errDupEmail:
			writeError(w, http.StatusConflict, "email is already registered")
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": updated})
}

// SetPassword menangani POST /v1/users/{id}/password — reset password.
func (h *Handler) SetPassword(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.service.SetPassword(id, body.Password); err != nil {
		if err == errNotFound {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// DeleteUser menangani DELETE /v1/users/{id} — tolak hapus diri sendiri
// dan hapus user terakhir.
func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	requester := UserUUID(r.Context())
	n, err := h.service.CountUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to count users")
		return
	}
	if err := canDelete(requester, id, n); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	if err := h.service.DeleteUser(id); err != nil {
		if err == errNotFound {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		if err == errLastUser {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func decodeBody(r *http.Request, v interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

// isDup mendeteksi pelanggaran unique constraint Postgres.
func isDup(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}
