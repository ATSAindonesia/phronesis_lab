package experiments

import (
	"strings"
	"testing"
)

func TestVerifyWorkspaceBuild_Success(t *testing.T) {
	fs := NewProjectFS(nil)
	passed, msg := verifyWorkspaceBuild(fs)
	if !passed {
		t.Fatalf("Expected build to pass on valid workspace, but got error: %s", msg)
	}
	if !strings.Contains(msg, "passed verification cleanly") {
		t.Errorf("Expected success message, got: %s", msg)
	}
}

func TestVerifyWorkspaceBuild_MissingApp(t *testing.T) {
	fs := NewProjectFS(nil)
	delete(fs.files, "src/App.tsx")
	passed, msg := verifyWorkspaceBuild(fs)
	if passed {
		t.Fatalf("Expected build to fail when src/App.tsx is missing")
	}
	if !strings.Contains(msg, "missing or empty") {
		t.Errorf("Expected missing or empty message, got: %s", msg)
	}
}

func TestVerifyWorkspaceBuild_SyntaxError(t *testing.T) {
	fs := NewProjectFS(nil)
	origApp := fs.files["src/App.tsx"]
	defer func() {
		_ = fs.WriteFile("src/App.tsx", origApp.Content)
	}()

	// Break syntax in App.tsx
	_ = fs.WriteFile("src/App.tsx", "import React from 'react';\nexport default function App() { return <div><unclosed tag }")

	passed, msg := verifyWorkspaceBuild(fs)
	if passed {
		t.Fatalf("Expected build to fail on syntax error")
	}
	if !strings.Contains(msg, "Unexpected token") && !strings.Contains(msg, "Build failed") && !strings.Contains(msg, "error") {
		t.Errorf("Expected build error snippet, got: %s", msg)
	}
}

func TestCleanBuildError(t *testing.T) {
	rawOutput := `npm notice run workspace@1.0.0 build
npm notice run vite build
vite v8.3.0 building client environment for production...
transforming...
✗ Build failed in 99ms
error during build:
Build failed with 1 error:

[builtin:vite-transform] Unexpected token
   ╭─[ src/App.tsx:2:59 ]
   │
 2 │ export default function App() { return <div><broken syntax
   │                                                           │ 
   │                                                           ╰─ 
───╯

    at aggregateBindingErrorsIntoJsError (file:///path/to/error.mjs:48:18)
    at unwrapBindingResult (file:///path/to/error.mjs:18:128)
`
	cleaned := cleanBuildError(rawOutput)
	if strings.Contains(cleaned, "aggregateBindingErrorsIntoJsError") {
		t.Errorf("Expected node_modules stack trace to be stripped, but was present in: %s", cleaned)
	}
	if !strings.Contains(cleaned, "Unexpected token") {
		t.Errorf("Expected 'Unexpected token' in cleaned error, got: %s", cleaned)
	}
	if !strings.Contains(cleaned, "src/App.tsx:2:59") {
		t.Errorf("Expected file/line location in cleaned error, got: %s", cleaned)
	}
}
