package experiments

import (
	"encoding/json"
	"testing"
)

func TestGetInitialDefaultProject(t *testing.T) {
	files := getInitialDefaultProject()
	if len(files) == 0 {
		t.Fatalf("Expected default project files, got empty map")
	}

	app, ok := files["src/App.tsx"]
	if !ok || app.Content == "" {
		t.Errorf("Expected src/App.tsx in initial project files")
	}

	pkg, ok := files["package.json"]
	if !ok || pkg.Content == "" {
		t.Errorf("Expected package.json in initial project files")
	}

	css, ok := files["src/styles.css"]
	if !ok || css.Content == "" {
		t.Errorf("Expected src/styles.css in initial project files")
	}
}

func TestLoadFilesFromWorkspace(t *testing.T) {
	files := LoadFilesFromWorkspace()
	if len(files) == 0 {
		t.Fatalf("Expected files from LoadFilesFromWorkspace, got 0")
	}
}

func TestGenerateRequestEncoding(t *testing.T) {
	req := GenerateRequest{
		Prompt: "Create a modern dashboard",
		Files: map[string]FileItem{
			"src/App.tsx": {
				Name:     "src/App.tsx",
				Language: "typescript",
				Content:  "export default function App() { return <div>Dashboard</div>; }",
			},
		},
		Stream: true,
	}

	bytes, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("Failed to marshal GenerateRequest: %v", err)
	}

	var decoded GenerateRequest
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal GenerateRequest: %v", err)
	}

	if decoded.Prompt != req.Prompt {
		t.Errorf("Prompt mismatch: expected %q, got %q", req.Prompt, decoded.Prompt)
	}
	if !decoded.Stream {
		t.Errorf("Expected Stream to be true")
	}
	if len(decoded.Files) != 1 {
		t.Errorf("Expected 1 file, got %d", len(decoded.Files))
	}
}
