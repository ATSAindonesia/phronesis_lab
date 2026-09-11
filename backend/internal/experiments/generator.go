package experiments

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type FileItem struct {
	Name     string `json:"name"`
	Language string `json:"language"`
	Content  string `json:"content"`
}

type AgentAction struct {
	Type        string `json:"type"`                  // "list_files", "read_file", "write_file", "create_file", "delete_file", "run_terminal_command"
	Path        string `json:"path,omitempty"`        // Target file path
	Content     string `json:"content,omitempty"`     // Content for write_file or create_file
	Command     string `json:"command,omitempty"`     // Command for run_terminal_command
	Output      string `json:"output,omitempty"`      // Output of terminal command
	Explanation string `json:"explanation,omitempty"` // Explanation for action
}

type AgentResult struct {
	Thought string              `json:"thought"`
	Actions []AgentAction       `json:"actions"`
	Files   map[string]FileItem `json:"files"`
}

type GenerateRequest struct {
	Prompt string              `json:"prompt"`
	Files  map[string]FileItem `json:"files,omitempty"`
}

type GenerateResponse struct {
	Success bool                `json:"success"`
	Prompt  string              `json:"prompt"`
	Thought string              `json:"thought,omitempty"`
	Actions []AgentAction       `json:"actions,omitempty"`
	Files   map[string]FileItem `json:"files"`
}

// ─── PROJECT FILESYSTEM ENVIRONMENT ─────────────────────────────────────────

type ProjectFS struct {
	files map[string]FileItem
}

func NewProjectFS(initialFiles map[string]FileItem) *ProjectFS {
	cp := make(map[string]FileItem)
	if len(initialFiles) > 0 {
		for k, v := range initialFiles {
			cp[k] = v
		}
	} else {
		cp = LoadFilesFromWorkspace()
	}

	// Always ensure package.json exists in ProjectFS so agent can inspect dependencies
	if _, ok := cp["package.json"]; !ok {
		pkgPath := filepath.Join(getWorkspaceDir(), "package.json")
		if data, err := os.ReadFile(pkgPath); err == nil {
			cp["package.json"] = FileItem{
				Name:     "package.json",
				Language: "json",
				Content:  string(data),
			}
		} else {
			cp["package.json"] = FileItem{
				Name:     "package.json",
				Language: "json",
				Content: `{
  "name": "workspace",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "lucide-react": "^1.45.0"
  }
}`,
			}
		}
	}

	return &ProjectFS{files: cp}
}

func (fs *ProjectFS) ListFiles() []string {
	var paths []string
	for p := range fs.files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	return paths
}

func (fs *ProjectFS) ReadFile(path string) (string, error) {
	if f, ok := fs.files[path]; ok {
		return f.Content, nil
	}
	return "", fmt.Errorf("file %q not found in project", path)
}

func (fs *ProjectFS) WriteFile(path string, content string) error {
	lang := "typescript"
	if strings.HasSuffix(path, ".css") {
		lang = "css"
	} else if strings.HasSuffix(path, ".js") {
		lang = "javascript"
	} else if strings.HasSuffix(path, ".json") {
		lang = "json"
	} else if strings.HasSuffix(path, ".html") {
		lang = "html"
	}
	fs.files[path] = FileItem{
		Name:     path,
		Language: lang,
		Content:  content,
	}

	// Persist changes directly to the project workspace on disk
	diskPath := filepath.Join(getWorkspaceDir(), path)
	if err := os.MkdirAll(filepath.Dir(diskPath), 0755); err == nil {
		_ = os.WriteFile(diskPath, []byte(content), 0644)
	}

	return nil
}

func (fs *ProjectFS) CreateFile(path string, content string) error {
	return fs.WriteFile(path, content)
}

func (fs *ProjectFS) DeleteFile(path string) error {
	if _, ok := fs.files[path]; ok {
		delete(fs.files, path)
		diskPath := filepath.Join(getWorkspaceDir(), path)
		_ = os.Remove(diskPath)
		return nil
	}
	return fmt.Errorf("file %q does not exist", path)
}

// SyncToDisk ensures all files in ProjectFS are persisted to the workspace directory on disk.
func (fs *ProjectFS) SyncToDisk() error {
	workspaceDir := getWorkspaceDir()
	for path, file := range fs.files {
		fullPath := filepath.Join(workspaceDir, path)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(fullPath, []byte(file.Content), 0644); err != nil {
			return err
		}
	}
	return nil
}

func getWorkspaceDir() string {
	if dir := os.Getenv("AGENT_WORKSPACE_DIR"); dir != "" {
		return dir
	}
	pwd, err := os.Getwd()
	if err == nil {
		if strings.HasSuffix(pwd, "backend") {
			return filepath.Join(pwd, "workspace")
		}
		candidate := filepath.Join(pwd, "backend", "workspace")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "/home/william/Documents/selfProject_Website/lab_phronesis/backend/workspace"
}

// ExecuteControlledTerminalCommand executes a bounded, sandboxed command in the project workspace.
func ExecuteControlledTerminalCommand(cmdStr, explanation string, fs *ProjectFS) (map[string]interface{}, error) {
	cmdStr = strings.TrimSpace(cmdStr)
	if cmdStr == "" {
		return map[string]interface{}{
			"command":   "",
			"stdout":    "",
			"stderr":    "Empty command provided.",
			"exit_code": 1,
			"success":   false,
		}, nil
	}

	workspaceDir := getWorkspaceDir()
	if err := os.MkdirAll(workspaceDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to access workspace dir: %w", err)
	}

	// 1. Security & Whitelisting:
	// Allowed commands must start with npm, npx, or node
	allowedPrefixes := []string{"npm ", "npm\t", "npx ", "npx\t", "node ", "node\t"}
	isAllowed := false
	for _, p := range allowedPrefixes {
		if strings.HasPrefix(cmdStr, p) || cmdStr == "npm" || cmdStr == "npx" {
			isAllowed = true
			break
		}
	}
	if !isAllowed {
		return map[string]interface{}{
			"command":   cmdStr,
			"stdout":    "",
			"stderr":    "Security violation: Only controlled 'npm', 'npx', and 'node' commands are permitted in the workspace.",
			"exit_code": 1,
			"success":   false,
		}, nil
	}

	// Disallow dangerous shell escape and destructive patterns
	forbiddenPatterns := []string{
		"sudo", "rm -rf /", "rm -rf /*", "mkfs", "dd if=", ":(){ :|:& };:",
		"curl ", "wget ", "> /dev/", "| bash", "| sh", "; rm", "&& rm -rf",
	}
	for _, pattern := range forbiddenPatterns {
		if strings.Contains(cmdStr, pattern) {
			return map[string]interface{}{
				"command":   cmdStr,
				"stdout":    "",
				"stderr":    fmt.Sprintf("Security violation: pattern %q is strictly forbidden.", pattern),
				"exit_code": 1,
				"success":   false,
			}, nil
		}
	}

	// 2. Sync all files in ProjectFS to disk workspace before command execution
	_ = fs.SyncToDisk()

	// 3. Special handling for dev server (e.g. npm run dev or npm start)
	if strings.Contains(cmdStr, "run dev") || strings.Contains(cmdStr, "npm start") {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, "bash", "-c", cmdStr)
		cmd.Dir = workspaceDir

		var combinedBuf bytes.Buffer
		cmd.Stdout = &combinedBuf
		cmd.Stderr = &combinedBuf

		_ = cmd.Run() // Expect timeout since dev servers run indefinitely

		out := combinedBuf.String()
		log.Printf("[AI Agent Terminal Dev Check] output:\n%s", out)

		if strings.Contains(out, "error") || strings.Contains(out, "Error") || strings.Contains(out, "Failed") {
			return map[string]interface{}{
				"command":   cmdStr,
				"stdout":    out,
				"stderr":    "Dev server reported errors during startup",
				"exit_code": 1,
				"success":   false,
			}, nil
		}

		return map[string]interface{}{
			"command":   cmdStr,
			"stdout":    out + "\n✓ Development server successfully started and verified.",
			"stderr":    "",
			"exit_code": 0,
			"success":   true,
		}, nil
	}

	// 4. Regular commands: npm install, npm run build, npm test, etc.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-c", cmdStr)
	cmd.Dir = workspaceDir

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	stdoutStr := stdoutBuf.String()
	stderrStr := stderrBuf.String()

	// 5. Sync package.json and any other disk modifications back into ProjectFS
	pkgPath := filepath.Join(workspaceDir, "package.json")
	if data, err := os.ReadFile(pkgPath); err == nil {
		fs.files["package.json"] = FileItem{
			Name:     "package.json",
			Language: "json",
			Content:  string(data),
		}
	}

	return map[string]interface{}{
		"command":   cmdStr,
		"stdout":    stdoutStr,
		"stderr":    stderrStr,
		"exit_code": exitCode,
		"success":   exitCode == 0,
	}, nil
}

// ─── VERIFICATION & BUILD INSPECTION ENGINE ─────────────────────────────────

// verifyWorkspaceBuild runs the application build to verify that changes compile cleanly.
// It returns whether verification passed and the captured, relevant error message if failed.
func verifyWorkspaceBuild(fs *ProjectFS) (bool, string) {
	workspaceDir := getWorkspaceDir()
	// Ensure all current file modifications are committed to disk
	_ = fs.SyncToDisk()

	// 1. Sanity check: Ensure src/App.tsx exists and is non-empty
	appFile, ok := fs.files["src/App.tsx"]
	if !ok || strings.TrimSpace(appFile.Content) == "" {
		return false, "Build verification failed: 'src/App.tsx' is missing or empty. The UI/UX project requires 'src/App.tsx' as its main React entry point."
	}

	// 2. Run 'npm run build' in the workspace directory
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "npm", "run", "build")
	cmd.Dir = workspaceDir

	var combinedBuf bytes.Buffer
	cmd.Stdout = &combinedBuf
	cmd.Stderr = &combinedBuf

	err := cmd.Run()
	output := combinedBuf.String()

	if err == nil && !strings.Contains(output, "✗ Build failed") && !strings.Contains(output, "error during build") {
		return true, "✓ Application build passed verification cleanly (exit code 0)."
	}

	// 3. Extract and clean up relevant error output
	cleaned := cleanBuildError(output)
	if cleaned == "" {
		cleaned = fmt.Sprintf("Build failed with error: %v\nOutput:\n%s", err, output)
	}

	return false, cleaned
}

// cleanBuildError extracts relevant error snippets, filenames, line numbers, and error descriptions from build logs.
func cleanBuildError(output string) string {
	lines := strings.Split(output, "\n")
	var relevantLines []string
	capture := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		// Skip generic npm and bundler notice headers
		if strings.HasPrefix(trimmed, "npm notice") || strings.HasPrefix(trimmed, "vite v") || strings.HasPrefix(trimmed, "transforming") {
			continue
		}
		// Cut off internal node_modules stack traces from bundler binaries
		if strings.Contains(line, "at aggregateBindingErrorsIntoJsError") ||
			strings.Contains(line, "at unwrapBindingResult") ||
			strings.Contains(line, "at #build") ||
			strings.Contains(line, "at async buildEnvironment") {
			break
		}
		if strings.Contains(line, "error") || strings.Contains(line, "Error") ||
			strings.Contains(line, "Build failed") || strings.Contains(line, "Failed") ||
			strings.Contains(line, "Unexpected") || strings.Contains(line, "╭─") ||
			strings.Contains(line, "╰─") || strings.Contains(line, "│") ||
			strings.Contains(line, "Cannot find") || strings.Contains(line, "is not defined") ||
			strings.Contains(line, "not exported") {
			capture = true
		}
		if capture || trimmed != "" {
			relevantLines = append(relevantLines, line)
		}
	}

	res := strings.TrimSpace(strings.Join(relevantLines, "\n"))
	if len(res) > 1500 {
		res = res[:1500] + "\n... (error output truncated)"
	}
	if res == "" {
		res = strings.TrimSpace(output)
		if len(res) > 1500 {
			res = res[:1500] + "\n... (error output truncated)"
		}
	}
	return res
}

// ─── GEMINI TOOL DEFINITIONS & TYPES ────────────────────────────────────────

type geminiFunctionCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args"`
	ID   string                 `json:"id,omitempty"`
}

type geminiFunctionResponse struct {
	Name     string                 `json:"name"`
	Response map[string]interface{} `json:"response"`
	ID       string                 `json:"id,omitempty"`
}

type geminiPart struct {
	Text             string                  `json:"text,omitempty"`
	FunctionCall     *geminiFunctionCall     `json:"functionCall,omitempty"`
	FunctionResponse *geminiFunctionResponse `json:"functionResponse,omitempty"`
	ThoughtSignature string                  `json:"thoughtSignature,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiToolDeclaration struct {
	FunctionDeclarations []geminiFunctionDecl `json:"functionDeclarations"`
}

type geminiFunctionDecl struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Parameters  interface{} `json:"parameters"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	Contents          []geminiContent         `json:"contents"`
	Tools             []geminiToolDeclaration `json:"tools,omitempty"`
	GenerationConfig  *struct {
		Temperature     float64 `json:"temperature,omitempty"`
		MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
	} `json:"generationConfig,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
}

func getAgentTools() []geminiToolDeclaration {
	return []geminiToolDeclaration{
		{
			FunctionDeclarations: []geminiFunctionDecl{
				{
					Name:        "list_files",
					Description: "List all files currently in the UI/UX project filesystem.",
					Parameters: map[string]interface{}{
						"type":       "OBJECT",
						"properties": map[string]interface{}{},
					},
				},
				{
					Name:        "read_file",
					Description: "Read the full text content of a file in the project filesystem.",
					Parameters: map[string]interface{}{
						"type": "OBJECT",
						"properties": map[string]interface{}{
							"path": map[string]interface{}{
								"type":        "STRING",
								"description": "The path of the file to inspect (e.g. 'src/App.tsx').",
							},
						},
						"required": []string{"path"},
					},
				},
				{
					Name:        "write_file",
					Description: "Overwrite/update an existing file in the project filesystem with complete modified content.",
					Parameters: map[string]interface{}{
						"type": "OBJECT",
						"properties": map[string]interface{}{
							"path": map[string]interface{}{
								"type":        "STRING",
								"description": "The file path to update (e.g. 'src/App.tsx').",
							},
							"content": map[string]interface{}{
								"type":        "STRING",
								"description": "The complete updated source code.",
							},
							"explanation": map[string]interface{}{
								"type":        "STRING",
								"description": "Short explanation of the modifications.",
							},
						},
						"required": []string{"path", "content"},
					},
				},
				{
					Name:        "create_file",
					Description: "Create a new file in the project filesystem.",
					Parameters: map[string]interface{}{
						"type": "OBJECT",
						"properties": map[string]interface{}{
							"path": map[string]interface{}{
								"type":        "STRING",
								"description": "The path of the new file (e.g. 'src/components/MyCard.tsx').",
							},
							"content": map[string]interface{}{
								"type":        "STRING",
								"description": "The complete source code for the new file.",
							},
							"explanation": map[string]interface{}{
								"type":        "STRING",
								"description": "Why this file is being created.",
							},
						},
						"required": []string{"path", "content"},
					},
				},
				{
					Name:        "delete_file",
					Description: "Delete an obsolete or unneeded file from the project filesystem.",
					Parameters: map[string]interface{}{
						"type": "OBJECT",
						"properties": map[string]interface{}{
							"path": map[string]interface{}{
								"type":        "STRING",
								"description": "The path of the file to delete.",
							},
							"explanation": map[string]interface{}{
								"type":        "STRING",
								"description": "Reason for deleting this file.",
							},
						},
						"required": []string{"path"},
					},
				},
				{
					Name:        "run_terminal_command",
					Description: "Execute a controlled terminal command in the project workspace (e.g. 'npm install <package>', 'npm run build', 'npm run dev', 'npm list'). Inspects command output, exit code, and errors.",
					Parameters: map[string]interface{}{
						"type": "OBJECT",
						"properties": map[string]interface{}{
							"command": map[string]interface{}{
								"type":        "STRING",
								"description": "The command to run (e.g. 'npm install recharts', 'npm run build', 'npm run dev').",
							},
							"explanation": map[string]interface{}{
								"type":        "STRING",
								"description": "Reason why this terminal command is necessary.",
							},
						},
						"required": []string{"command"},
					},
				},
			},
		},
	}
}

// ─── AUTONOMOUS AGENT LOOP ──────────────────────────────────────────────────

// RunAgentLoop runs the multi-turn agent loop:
// user prompt -> agent -> list/read relevant files -> decide changes -> write/create/delete files -> return result
func RunAgentLoop(prompt string, currentFiles map[string]FileItem) AgentResult {
	cleanPrompt := strings.TrimSpace(prompt)
	if cleanPrompt == "" {
		cleanPrompt = "Inspect and refine the project."
	}

	apiKey := os.Getenv("GEMINI_API_KEY")
	model := os.Getenv("GEMINI_MODEL")
	if model == "" {
		model = "gemini-3.5-flash-lite"
	}

	fs := NewProjectFS(currentFiles)

	if apiKey == "" {
		log.Printf("[AI Agent] Warning: GEMINI_API_KEY not configured")
		return AgentResult{
			Thought: "API key missing. Unable to run agent loop.",
			Actions: []AgentAction{},
			Files:   fs.files,
		}
	}

	modelsToTry := []string{model, "gemini-3.1-flash-lite", "gemini-3.7-flash"}
	seen := make(map[string]bool)
	var uniqueModels []string
	for _, m := range modelsToTry {
		if m != "" && !seen[m] {
			seen[m] = true
			uniqueModels = append(uniqueModels, m)
		}
	}

	var lastErr error
	for _, m := range uniqueModels {
		res, err := executeAgentToolLoop(cleanPrompt, fs, apiKey, m)
		if err == nil {
			log.Printf("[AI Agent] Loop completed successfully using model %s with %d actions", m, len(res.Actions))
			return *res
		}
		lastErr = err
		log.Printf("[AI Agent] Model %s failed in tool loop: %v. Trying next model...", m, err)
	}

	log.Printf("[AI Agent] All models failed in agent loop: %v", lastErr)
	return AgentResult{
		Thought: fmt.Sprintf("Agent error: %v", lastErr),
		Actions: []AgentAction{},
		Files:   fs.files,
	}
}

func executeAgentToolLoop(prompt string, fs *ProjectFS, apiKey, model string) (*AgentResult, error) {
	systemPrompt := `You are an elite, autonomous AI software engineer and UI/UX designer with direct tool access to a React project filesystem. You specialize in building authentic, beautiful, and fully functional React applications across diverse industries and domains.

Available tools:
1. list_files: inspect what files exist in the project (including src/ and package.json).
2. read_file: read the source code of any file.
3. write_file: update/overwrite an existing file with complete modified code.
4. create_file: create a new file with source code.
5. delete_file: delete an unnecessary file.
6. run_terminal_command: run a controlled shell command in the workspace (npm install <package>, npm run build, npm run dev, npm list).

CORE DESIGN & ARCHITECTURE PRINCIPLES:
1. Authentic Domain-Specific Design (NEVER force requests into a generic SaaS landing page):
   - When the user asks for a specific application domain or concept, design a genuinely authentic experience tailored to that domain:
     * Restaurant / Food: Warm culinary or elegant dark aesthetic, restaurant branding, interactive menu with category tabs (Appetizers, Mains, Desserts, Cocktails) with realistic dish names, ingredients, and prices, chef specials, table reservation booking form/widget, customer reviews, opening hours and location. (NO SaaS pricing cards!).
     * Developer Portfolio: Minimalist or dark cyber aesthetic, developer title and bio, interactive skills/tech stack badges, featured projects grid with live tags/metrics, work experience timeline, and interactive contact form. (NO SaaS pricing cards!).
     * Finance Dashboard: Sleek fintech aesthetic, net worth and balance cards with trend indicators, visual asset allocation breakdown, quick money transfer widget, recent transactions feed with categories (Shopping, Salary, Investments) and status badges, virtual card preview.
     * E-Commerce: Product catalog with category filter, search bar, product cards with ratings/prices, shopping cart drawer/preview, promo banner.
     * Healthcare, Fitness, Music, Gaming, Social, etc.: Build an authentic, rich layout with realistic domain mock data, domain-appropriate icons, and interactive elements.

2. New Project vs Iterative Edit:
   - NEW UI REQUEST (e.g. "Create a restaurant landing page", "Create a developer portfolio", "Create a finance dashboard"):
     * Build the new application from scratch for the requested domain.
     * Overwrite 'src/App.tsx' with the complete new application structure and state.
     * Create clean, domain-specific components in 'src/components/' (or compose clean modular components directly in 'src/App.tsx').
     * If the workspace contains obsolete components from a previous unrelated project (like old pricing cards or SaaS heroes), use delete_file to remove them so the project remains clean.
   - ITERATIVE EDIT (e.g. "Change the hero background to blue", "Add a dessert section to the menu", "Make the font bigger", "Add a chart"):
     * Inspect existing files with read_file, preserve the existing project structure, and apply the requested modifications.

3. Complete, Production-Quality Code:
   - React and Tailwind CSS are already configured. "lucide-react" is available for icons.
   - Use Tailwind CSS classes for modern styling (gradients, subtle borders, rounded corners, responsive layouts).
   - Provide realistic, rich mock data (never write "Lorem Ipsum" or "Card 1, Card 2").
   - Ensure interactive states (e.g. active tabs, filter buttons, counter/form inputs) are implemented with React hooks.
   - You MUST call write_file (or create_file) to write complete code to disk.
   - 'src/App.tsx' is the root entry component that must be rendered.

4. AUTOMATED BUILD VERIFICATION & ERROR REPAIR:
   - After modifying project files, the system automatically runs the project build and captures any errors.
   - If you receive a BUILD VERIFICATION FAILED notification:
     a) Inspect the affected file(s) using read_file to examine the line and code where the error occurred.
     b) Fix the syntax error, missing import, or broken export using write_file (or install missing dependencies with run_terminal_command).
     c) The system will automatically re-run the build verification until it succeeds or reaches maximum repair attempts.
5. Provide a concise final summary of what tools you used, dependencies installed, files modified, and build verification status.`

	history := []geminiContent{
		{
			Role: "user",
			Parts: []geminiPart{
				{Text: fmt.Sprintf(
					"USER REQUEST:\n%s\n\n"+
						"INSTRUCTIONS:\n"+
						"1. Analyze whether the request is asking to CREATE A NEW TYPE OF PROJECT/PAGE (e.g. restaurant, portfolio, finance dashboard, e-commerce, etc.) or to ITERATIVELY EDIT the existing project.\n"+
						"2. If creating a new project domain: build an authentic, rich, domain-specific UI tailored exclusively to the requested topic. Overwrite src/App.tsx with the new layout, create domain-appropriate components, and delete any obsolete files from previous projects with delete_file.\n"+
						"3. If iteratively modifying the existing project: inspect current files and apply the modifications while preserving the current project.\n"+
						"4. Use your tools (write_file, create_file, delete_file, read_file, list_files) to execute the changes, and ensure the project compiles cleanly.",
					prompt,
				)},
			},
		},
	}

	var executedActions []AgentAction
	var finalThought string
	maxTurns := 18
	maxRepairAttempts := 3
	repairAttempts := 0

	for turn := 0; turn < maxTurns; turn++ {
		reqBody := geminiRequest{
			SystemInstruction: &geminiContent{
				Parts: []geminiPart{
					{Text: systemPrompt},
				},
			},
			Contents: history,
			Tools:    getAgentTools(),
			GenerationConfig: &struct {
				Temperature     float64 `json:"temperature,omitempty"`
				MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
			}{
				Temperature:     0.4,
				MaxOutputTokens: 8192,
			},
		}

		payloadBytes, err := json.Marshal(reqBody)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}

		url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", model, apiKey)

		var bodyBytes []byte
		var statusCode int
		client := &http.Client{Timeout: 90 * time.Second}
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				time.Sleep(2 * time.Second)
			}
			resp, err := client.Post(url, "application/json", bytes.NewBuffer(payloadBytes))
			if err != nil {
				if attempt == 2 {
					return nil, fmt.Errorf("http error: %w", err)
				}
				continue
			}
			bodyBytes, err = io.ReadAll(resp.Body)
			resp.Body.Close()
			statusCode = resp.StatusCode
			if err != nil {
				if attempt == 2 {
					return nil, fmt.Errorf("read body: %w", err)
				}
				continue
			}
			if statusCode == http.StatusOK {
				break
			}
			if statusCode != 503 && statusCode != 429 {
				return nil, fmt.Errorf("api error (status %d): %s", statusCode, string(bodyBytes))
			}
		}

		if statusCode != http.StatusOK {
			return nil, fmt.Errorf("api error (status %d): %s", statusCode, string(bodyBytes))
		}

		var geminiResp geminiResponse
		if err := json.Unmarshal(bodyBytes, &geminiResp); err != nil {
			return nil, fmt.Errorf("unmarshal api response: %w", err)
		}

		if geminiResp.Error != nil {
			return nil, fmt.Errorf("api returned error: %s", geminiResp.Error.Message)
		}

		if len(geminiResp.Candidates) == 0 {
			return nil, fmt.Errorf("no candidates in api response")
		}

		modelContent := geminiResp.Candidates[0].Content
		history = append(history, modelContent)

		// Collect function calls from model
		var functionCalls []*geminiFunctionCall
		for _, part := range modelContent.Parts {
			if part.FunctionCall != nil {
				functionCalls = append(functionCalls, part.FunctionCall)
			}
			if part.Text != "" {
				finalThought = strings.TrimSpace(part.Text)
			}
		}

		// If no function calls, agent has finished its task
		if len(functionCalls) == 0 {
			if len(finalThought) > 200 {
				log.Printf("[AI Agent] Turn %d model produced text: %s...", turn+1, finalThought[:200])
			} else {
				log.Printf("[AI Agent] Turn %d model produced text: %s", turn+1, finalThought)
			}
			hasAction := false
			hasWrittenFile := false
			hasInstall := false

			for _, act := range executedActions {
				if act.Type == "write_file" || act.Type == "create_file" || act.Type == "delete_file" {
					hasWrittenFile = true
					hasAction = true
				}
				if act.Type == "run_terminal_command" {
					hasAction = true
					if strings.Contains(act.Command, "install") || strings.Contains(act.Command, "add") {
						hasInstall = true
					}
				}
			}

			// Fallback: If no files were written via tools but the agent provided complete code in text, extract and write to src/App.tsx
			if !hasWrittenFile {
				if extracted := extractCodeBlock(finalThought); extracted != "" {
					_ = fs.WriteFile("src/App.tsx", extracted)
					executedActions = append(executedActions, AgentAction{
						Type:        "write_file",
						Path:        "src/App.tsx",
						Content:     extracted,
						Explanation: "Updated src/App.tsx from generated component",
					})
					hasWrittenFile = true
					hasAction = true
				}
			}

			// If packages were installed but no components were written yet, prompt the agent to write the code
			onlyInstalled := hasInstall && !hasWrittenFile

			if (!hasAction || onlyInstalled) && turn < maxTurns-1 {
				log.Printf("[AI Agent] Turn %d: Agent finished turn without completing necessary changes. Prompting to proceed.", turn+1)
				history = append(history, geminiContent{
					Role: "user",
					Parts: []geminiPart{
						{Text: "Now that dependencies and project files have been inspected/installed, please call write_file or create_file to implement the requested components, and verify the build."},
					},
				})
				continue
			}

			// ─── AUTOMATED BUILD VERIFICATION & REPAIR FLOW ────────────────
			// 1. Run the application/build
			passed, verifyOutput := verifyWorkspaceBuild(fs)

			if passed {
				log.Printf("[AI Agent Verification] Turn %d: Application build verification PASSED cleanly.", turn+1)
				executedActions = append(executedActions, AgentAction{
					Type:        "verify_build",
					Output:      verifyOutput,
					Explanation: "Application build verification succeeded cleanly.",
				})
				log.Printf("[AI Agent] Turn %d: Agent finished thinking and concluded tool loop successfully.", turn+1)
				break
			}

			// 2. Capture errors
			log.Printf("[AI Agent Verification] Turn %d: Build verification FAILED (repair attempt %d/%d):\n%s", turn+1, repairAttempts+1, maxRepairAttempts, verifyOutput)

			executedActions = append(executedActions, AgentAction{
				Type:        "verify_build_failed",
				Output:      verifyOutput,
				Explanation: fmt.Sprintf("Build verification failed (repair attempt %d/%d). Prompting agent to inspect and repair.", repairAttempts+1, maxRepairAttempts),
			})

			// 3. Give relevant errors back to the agent
			// 4. Let the agent inspect the affected files
			// 5. Fix the problem
			// 6. Run again (continue loop until successful or max attempts reached)
			if repairAttempts < maxRepairAttempts && turn < maxTurns-1 {
				repairAttempts++
				repairPrompt := fmt.Sprintf(
					"BUILD VERIFICATION FAILED (Repair attempt %d of %d):\n\n"+
						"The application build failed with the following error:\n\n"+
						"```\n%s\n```\n\n"+
						"Please:\n"+
						"1. Inspect the affected file(s) using read_file to locate the error.\n"+
						"2. Fix the error by calling write_file with the corrected full content (or run_terminal_command if a missing package is required).\n"+
						"3. Ensure the corrected code compiles cleanly.\n"+
						"The build will be re-verified after your changes.",
					repairAttempts, maxRepairAttempts, verifyOutput,
				)
				history = append(history, geminiContent{
					Role: "user",
					Parts: []geminiPart{
						{Text: repairPrompt},
					},
				})
				continue
			}

			// Reached max repair attempts: record clear failure state and terminate
			log.Printf("[AI Agent Verification] Maximum repair attempts (%d) reached without passing verification. Ending in failure state.", maxRepairAttempts)
			executedActions = append(executedActions, AgentAction{
				Type:        "verify_build_failed_final",
				Output:      verifyOutput,
				Explanation: fmt.Sprintf("Maximum repair attempts (%d) reached without passing build verification.", maxRepairAttempts),
			})
			finalThought = fmt.Sprintf("Build verification could not be resolved after %d repair attempts. Last error:\n%s", maxRepairAttempts, verifyOutput)
			break
		}

		// Execute function calls on ProjectFS and prepare functionResponse parts
		var responseParts []geminiPart

		for _, fc := range functionCalls {
			toolName := fc.Name
			args := fc.Args
			var toolResult map[string]interface{}

			switch toolName {
			case "list_files":
				filesList := fs.ListFiles()
				toolResult = map[string]interface{}{"files": filesList}
				executedActions = append(executedActions, AgentAction{
					Type:        "list_files",
					Explanation: "Listed project files",
				})
				log.Printf("[AI Agent Tool] list_files -> %v", filesList)

			case "read_file":
				path, _ := args["path"].(string)
				content, err := fs.ReadFile(path)
				if err != nil {
					toolResult = map[string]interface{}{"error": err.Error()}
				} else {
					toolResult = map[string]interface{}{"path": path, "content": content}
				}
				executedActions = append(executedActions, AgentAction{
					Type:        "read_file",
					Path:        path,
					Explanation: fmt.Sprintf("Read file content of %s", path),
				})
				log.Printf("[AI Agent Tool] read_file(%s) -> %d bytes", path, len(content))

			case "write_file":
				path, _ := args["path"].(string)
				content, _ := args["content"].(string)
				explanation, _ := args["explanation"].(string)
				if explanation == "" {
					explanation = fmt.Sprintf("Modified %s", path)
				}
				err := fs.WriteFile(path, content)
				if err != nil {
					toolResult = map[string]interface{}{"error": err.Error()}
				} else {
					toolResult = map[string]interface{}{"success": true, "path": path}
				}
				executedActions = append(executedActions, AgentAction{
					Type:        "write_file",
					Path:        path,
					Content:     content,
					Explanation: explanation,
				})
				log.Printf("[AI Agent Tool] write_file(%s): %s", path, explanation)

			case "create_file":
				path, _ := args["path"].(string)
				content, _ := args["content"].(string)
				explanation, _ := args["explanation"].(string)
				if explanation == "" {
					explanation = fmt.Sprintf("Created %s", path)
				}
				err := fs.CreateFile(path, content)
				if err != nil {
					toolResult = map[string]interface{}{"error": err.Error()}
				} else {
					toolResult = map[string]interface{}{"success": true, "path": path}
				}
				executedActions = append(executedActions, AgentAction{
					Type:        "create_file",
					Path:        path,
					Content:     content,
					Explanation: explanation,
				})
				log.Printf("[AI Agent Tool] create_file(%s): %s", path, explanation)

			case "delete_file":
				path, _ := args["path"].(string)
				explanation, _ := args["explanation"].(string)
				if explanation == "" {
					explanation = fmt.Sprintf("Deleted %s", path)
				}
				err := fs.DeleteFile(path)
				if err != nil {
					toolResult = map[string]interface{}{"error": err.Error()}
				} else {
					toolResult = map[string]interface{}{"success": true, "path": path}
				}
				executedActions = append(executedActions, AgentAction{
					Type:        "delete_file",
					Path:        path,
					Explanation: explanation,
				})
				log.Printf("[AI Agent Tool] delete_file(%s): %s", path, explanation)

			case "run_terminal_command":
				cmdStr, _ := args["command"].(string)
				explanation, _ := args["explanation"].(string)
				termResult, _ := ExecuteControlledTerminalCommand(cmdStr, explanation, fs)
				toolResult = termResult

				outSnippet := ""
				if out, ok := termResult["stdout"].(string); ok && out != "" {
					outSnippet = out
				} else if errOut, ok := termResult["stderr"].(string); ok && errOut != "" {
					outSnippet = errOut
				}
				if len(outSnippet) > 300 {
					outSnippet = outSnippet[:300] + "... (truncated)"
				}

				executedActions = append(executedActions, AgentAction{
					Type:        "run_terminal_command",
					Command:     cmdStr,
					Output:      outSnippet,
					Explanation: explanation,
				})
				log.Printf("[AI Agent Tool] run_terminal_command(%s) -> exit_code: %v", cmdStr, termResult["exit_code"])

			default:
				toolResult = map[string]interface{}{"error": fmt.Sprintf("unknown tool %q", toolName)}
			}

			responseParts = append(responseParts, geminiPart{
				FunctionResponse: &geminiFunctionResponse{
					Name:     toolName,
					Response: toolResult,
					ID:       fc.ID,
				},
			})
		}

		// Append function results to conversation history and loop to next turn
		history = append(history, geminiContent{
			Role:  "user",
			Parts: responseParts,
		})
	}

	if finalThought == "" && len(executedActions) > 0 {
		finalThought = fmt.Sprintf("Executed %d filesystem actions to fulfill user request.", len(executedActions))
	}

	return &AgentResult{
		Thought: finalThought,
		Actions: executedActions,
		Files:   fs.files,
	}, nil
}

func getInitialDefaultProject() map[string]FileItem {
	return map[string]FileItem{
		"src/App.tsx": {
			Name:     "src/App.tsx",
			Language: "typescript",
			Content: `import React from "react";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
          UI/UX Playground
        </h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          The sandbox executes the agent project filesystem live. Enter a prompt below to build and modify components.
        </p>
      </div>
    </div>
  );
}`,
		},
		"src/styles.css": {
			Name:     "src/styles.css",
			Language: "css",
			Content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`,
		},
		"package.json": {
			Name:     "package.json",
			Language: "json",
			Content: `{
  "name": "workspace",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "lucide-react": "^1.45.0"
  }
}`,
		},
	}
}

// LoadFilesFromWorkspace reads all current project files from the agent workspace directory on disk.
func LoadFilesFromWorkspace() map[string]FileItem {
	workspaceDir := getWorkspaceDir()
	files := make(map[string]FileItem)

	_ = filepath.Walk(workspaceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		rel, err := filepath.Rel(workspaceDir, path)
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if rel == "." {
				return nil
			}
			if rel == "node_modules" || rel == ".git" || rel == "dist" || strings.HasPrefix(rel, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(info.Name(), ".") || strings.HasPrefix(rel, "node_modules/") || strings.HasPrefix(rel, "dist/") {
			return nil
		}
		if rel == "package-lock.json" {
			return nil
		}

		ext := filepath.Ext(rel)
		lang := "typescript"
		switch ext {
		case ".tsx", ".ts":
			lang = "typescript"
		case ".jsx", ".js":
			lang = "javascript"
		case ".css":
			lang = "css"
		case ".json":
			lang = "json"
		case ".html":
			lang = "html"
		default:
			return nil
		}

		contentBytes, err := os.ReadFile(path)
		if err == nil {
			files[rel] = FileItem{
				Name:     rel,
				Language: lang,
				Content:  string(contentBytes),
			}
		}
		return nil
	})

	if len(files) == 0 {
		return getInitialDefaultProject()
	}

	return files
}

func extractCodeBlock(text string) string {
	patterns := []string{"```tsx\n", "```jsx\n", "```typescript\n", "```javascript\n", "```react\n", "```tsx", "```jsx", "```"}
	for _, p := range patterns {
		idx := strings.Index(text, p)
		if idx != -1 {
			start := idx + len(p)
			end := strings.Index(text[start:], "```")
			if end != -1 {
				code := strings.TrimSpace(text[start : start+end])
				if strings.Contains(code, "export default") || strings.Contains(code, "function") || strings.Contains(code, "return") {
					return code
				}
			}
		}
	}
	return ""
}
