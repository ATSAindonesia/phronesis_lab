package auth

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// RegisterRoutes memasang endpoint auth pada mux.
// Login/register publik tanpa proteksi; route /v1/users (CRUD settings)
// dibungkus requireKey + JWT middleware, pola sama dengan commands.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/auth/register", h.Register)

	wrap := func(next http.Handler) http.Handler {
		return h.requireKey(authMW(next))
	}

	mux.Handle("GET /v1/users", wrap(http.HandlerFunc(h.ListUsers)))
	mux.Handle("POST /v1/users", wrap(http.HandlerFunc(h.CreateUser)))
	mux.Handle("GET /v1/users/me", wrap(http.HandlerFunc(h.Me)))
	mux.Handle("GET /v1/users/{id}", wrap(http.HandlerFunc(h.GetUser)))
	mux.Handle("PATCH /v1/users/{id}", wrap(http.HandlerFunc(h.UpdateUser)))
	mux.Handle("POST /v1/users/{id}/password", wrap(http.HandlerFunc(h.SetPassword)))
	mux.Handle("DELETE /v1/users/{id}", wrap(http.HandlerFunc(h.DeleteUser)))
}

func (h *Handler) requireKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		if key == "" {
			key = r.URL.Query().Get("api_key")
		}
		if key == "" {
			writeError(w, http.StatusUnauthorized, "X-API-Key header is required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	// Single-user mode: pendaftaran publik terkunci. User baru hanya bisa
	// dibuat via CLI adduser. Darurat: set ALLOW_PUBLIC_REGISTER=true + restart.
	if os.Getenv("ALLOW_PUBLIC_REGISTER") != "true" {
		writeError(w, http.StatusForbidden, "registration is disabled (single-user mode)")
		return
	}

	var req CreateUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Name = strings.TrimSpace(req.Name)

	if req.Email == "" || req.Name == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "name, email, and password are required")
		return
	}

	user, err := h.service.CreateUser(req)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			writeError(w, http.StatusConflict, "email is already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create user: "+err.Error())
		return
	}

	token, err := GenerateToken(h.service.jwtSecret, h.service.jwtExpiryMins, user.UUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate session token")
		return
	}

	writeJSON(w, http.StatusCreated, LoginResponse{
		Token: token,
		User:  *user,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := h.service.Login(req)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, res)
}

func decodeJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
