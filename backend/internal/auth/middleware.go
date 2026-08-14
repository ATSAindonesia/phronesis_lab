package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const userUUIDKey contextKey = "user_uuid"

// Middleware memvalidasi JWT dan menyimpan user_uuid ke context.
func (h *Handler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if header == "" {
			writeError(w, http.StatusUnauthorized, "missing authorization header")
			return
		}

		tokenString := strings.TrimPrefix(header, "Bearer ")
		if tokenString == header {
			writeError(w, http.StatusUnauthorized, "invalid authorization header")
			return
		}

		claims, err := ParseToken(h.service.jwtSecret, tokenString)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		ctx := context.WithValue(r.Context(), userUUIDKey, claims.UserUUID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserUUID mengambil user_uuid dari context (dari middleware).
func UserUUID(ctx context.Context) string {
	val, _ := ctx.Value(userUUIDKey).(string)
	return val
}
