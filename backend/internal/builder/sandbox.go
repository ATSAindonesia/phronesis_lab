package builder

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// sandboxImage is pre-warmed: node + vite + tailwind template in /opt/template,
// built from lab.phronesis/phronesis_lab/sandbox/Dockerfile.
const sandboxImage = "lab-builder:node"

const dockerCmd = "docker"

// hostUID is the uid of the backend process (william=1000). The sandbox user
// "node" shares uid 1000, so bind-mount writes land as the same owner.
func hostUID() string { return strconv.Itoa(os.Getuid()) }

func dockerArgs(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, dockerCmd, args...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("docker %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}

// startSandbox creates the session workspace, seeds it from the image's
// template via a throwaway container copy, then starts the dev-server container.
func startSandbox(ctx context.Context, s *Session) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return fmt.Errorf("mkdir workspace: %w", err)
	}
	appDir := filepath.Join(s.Dir, "app")

	// Container entrypoint seeds /data/app from /opt/template on first run
	// (idempotent) and chowns to the host uid — see sandbox/entry.sh.
	uid := hostUID()

	// Start long-running dev server container with port published.
	name := strings.TrimPrefix(s.CtrName, "/")
	if _, err := dockerArgs(ctx, "run", "-d", "--rm",
		"--name", name,
		"-p", fmt.Sprintf("%d:5173", s.HostPort),
		"-v", s.Dir+":/data",
		"-e", "BUILDER_UID="+uid,
		"-e", fmt.Sprintf("BASE_PATH=/b/%d/", s.HostPort),
		"--label", "lab.builder=1",
		"--memory", "1g", "--cpus", "2",
		sandboxImage); err != nil {
		return err
	}
	_ = appDir
	s.mu.Lock()
	s.Preview = fmt.Sprintf("http://localhost:%d", s.HostPort)
	s.mu.Unlock()

	// Wait until vite answers. Health check pakai base path (vite dengan
	// BASE_PATH meredirect / ke base-nya).
	healthURL := fmt.Sprintf("http://localhost:%d%s", s.HostPort, fmt.Sprintf("/b/%d/", s.HostPort))
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		rCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		c := exec.CommandContext(rCtx, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", healthURL)
		res, _ := c.Output()
		cancel()
		if strings.TrimSpace(string(res)) == "200" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(700 * time.Millisecond):
		}
	}
	return fmt.Errorf("dev server not reachable at %s", s.Preview)
}

// stopSandbox kills the container; the host workspace dir stays for restore.
func stopSandbox(ctx context.Context, s *Session) {
	_, _ = dockerArgs(ctx, "rm", "-f", s.CtrName)
}

// containerRunning reports whether the session dev-server container is up.
func containerRunning(ctx context.Context, s *Session) bool {
	out, err := dockerArgs(ctx, "inspect", "-f", "{{.State.Running}}", s.CtrName)
	return err == nil && strings.TrimSpace(out) == "true"
}

// execIn runs a shell command inside the session container at /data/app.
func execIn(ctx context.Context, s *Session, script string, timeout time.Duration) (string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, dockerCmd, "exec", "-u", hostUID(), s.CtrName,
		"bash", "-c", "cd /data/app && "+script)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	return out.String(), errb.String(), err
}

// writeFileOnHost writes a file into the session workspace (bind-mounted,
// visible live to the dev server inside the container).
func writeFileOnHost(s *Session, relPath, content string) error {
	full := filepath.Join(s.Dir, "app", filepath.Clean("/"+relPath))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(content), 0o644)
}
