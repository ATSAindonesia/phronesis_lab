package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCanDelete(t *testing.T) {
	if err := canDelete("a", "a", 3); err != errSelfDelete {
		t.Fatalf("hapus diri: got %v, want errSelfDelete", err)
	}
	if err := canDelete("a", "b", 1); err != errLastUser {
		t.Fatalf("user terakhir: got %v, want errLastUser", err)
	}
	if err := canDelete("a", "b", 2); err != nil {
		t.Fatalf("hapus normal: got %v, want nil", err)
	}
}

func TestUserRoutesRequireKey(t *testing.T) {
	h := &Handler{service: &Service{}}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux, func(next http.Handler) http.Handler { return next })

	for _, target := range []string{
		"/v1/users",
		"/v1/users/me",
		"/v1/users/00000000-0000-0000-0000-000000000000",
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s tanpa key: status = %d, want 401", target, rec.Code)
		}
	}
}

func TestInvalidUUIDRejected(t *testing.T) {
	h := &Handler{service: &Service{}}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux, func(next http.Handler) http.Handler { return next })

	req := httptest.NewRequest(http.MethodGet, "/v1/users/bukan-uuid?api_key=test", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("uuid invalid: status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid user id") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}
