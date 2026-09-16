package files

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src", "components"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("SECRET=1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "logo.png"), []byte{0x89, 0x50, 0x4E, 0x47, 0x00, 0x01}, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "data.dat"), []byte{0x00, 0x01, 0x02, 0x03}, 0o644); err != nil {
		t.Fatal(err)
	}
	return &Handler{root: root, resolvedRoot: root}
}

func TestResolveTraversal(t *testing.T) {
	h := newTestHandler(t)
	cases := []struct {
		rel     string
		wantErr error
	}{
		{"..", errForbidden},
		{"src/../../etc", errForbidden},
		{"src", nil},
		{"", nil},
		{"/src", nil},
		{"src/components", nil},
	}
	for _, c := range cases {
		_, _, err := h.resolve(c.rel)
		if c.wantErr == nil && err != nil {
			t.Errorf("resolve(%q): unexpected error %v", c.rel, err)
		}
		if c.wantErr != nil && !errors.Is(err, c.wantErr) {
			t.Errorf("resolve(%q): want %v, got %v", c.rel, c.wantErr, err)
		}
	}
}

func TestSymlinkEscape(t *testing.T) {
	h := newTestHandler(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(h.root, "leak")); err != nil {
		t.Fatal(err)
	}
	if _, err := h.statSafe(filepath.Join(h.root, "leak")); !errors.Is(err, errForbidden) {
		t.Errorf("statSafe symlink escape: want errForbidden, got %v", err)
	}
}

func TestListDirIgnoresAndSorts(t *testing.T) {
	h := newTestHandler(t)
	if err := os.MkdirAll(filepath.Join(h.root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	_, entries, err := h.ListDir("")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if ignoredNames[e.Name] {
			t.Errorf("entry %q should be ignored", e.Name)
		}
	}
	// Directory harus di urutan awal.
	if entries[0].Type != "directory" {
		t.Errorf("want directory first, got %s (%s)", entries[0].Name, entries[0].Type)
	}
	// Path anak harus relatif berprefix.
	for _, e := range entries {
		if e.Path != e.Name {
			t.Errorf("root entry path want %q, got %q", e.Name, e.Path)
		}
	}
}

func TestReadFileGuards(t *testing.T) {
	h := newTestHandler(t)

	if err := os.WriteFile(filepath.Join(h.root, "big.txt"), bytes.Repeat([]byte("a"), maxFileSize+1), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := h.ReadFile(".env"); !errors.Is(err, errBinary) {
		t.Errorf(".env: want errBinary (blocked name), got %v", err)
	}
	if _, err := h.ReadFile("logo.png"); !errors.Is(err, errBinary) {
		t.Errorf("logo.png: want errBinary (blocked extension), got %v", err)
	}
	if _, err := h.ReadFile("data.dat"); !errors.Is(err, errBinary) {
		t.Errorf("data.dat: want errBinary (null byte), got %v", err)
	}
	if _, err := h.ReadFile("big.txt"); !errors.Is(err, errTooLarge) {
		t.Errorf("big.txt: want errTooLarge, got %v", err)
	}
	if _, err := h.ReadFile(""); !errors.Is(err, errBadRequest) {
		t.Errorf("empty path: want errBadRequest, got %v", err)
	}
	if _, err := h.ReadFile("src"); !errors.Is(err, errBadRequest) {
		t.Errorf("directory path: want errBadRequest, got %v", err)
	}
	if _, err := h.ReadFile("nope.txt"); !errors.Is(err, errNotFound) {
		t.Errorf("missing file: want errNotFound, got %v", err)
	}

	fc, err := h.ReadFile("src/main.go")
	if err != nil {
		t.Fatal(err)
	}
	if fc.Language != "go" || fc.Content != "package main" || fc.Name != "main.go" {
		t.Errorf("unexpected content result: %+v", fc)
	}
}

func TestDetectLanguage(t *testing.T) {
	cases := map[string]string{
		"main.go":        "go",
		"page.tsx":       "tsx",
		"route.ts":       "typescript",
		"styles.css":     "css",
		"Dockerfile":     "dockerfile",
		".gitignore":     "plaintext",
		"unknown.xyz":    "plaintext",
		"docker-compose.yml": "yaml",
	}
	for name, want := range cases {
		if got := detectLanguage(name); got != want {
			t.Errorf("detectLanguage(%q): want %q, got %q", name, want, got)
		}
	}
}
