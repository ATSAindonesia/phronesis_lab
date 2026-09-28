package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Tanpa env (default): register publik harus ditolak 403 sebelum validasi body.
func TestRegisterDisabledByDefault(t *testing.T) {
	t.Setenv("ALLOW_PUBLIC_REGISTER", "")

	h := &Handler{service: &Service{}}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{"name":"X","email":"x@example.com","password":"secret123"}`))
	rec := httptest.NewRecorder()
	h.Register(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if !strings.Contains(rec.Body.String(), "single-user") {
		t.Fatalf("body tidak menjelaskan single-user mode: %s", rec.Body.String())
	}
}

// Dengan ALLOW_PUBLIC_REGISTER=true: gate lolos, lanjut ke validasi normal
// (body kosong -> 400, bukan 403).
func TestRegisterEnabledViaEnv(t *testing.T) {
	t.Setenv("ALLOW_PUBLIC_REGISTER", "true")

	h := &Handler{service: &Service{}}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	h.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (lolos gate, gagal validasi)", rec.Code, http.StatusBadRequest)
	}
}
