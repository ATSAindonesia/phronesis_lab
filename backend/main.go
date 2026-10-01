package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"lab/internal/auth"
	"lab/internal/agent"
	"lab/internal/analytics"
	"lab/internal/builder"
	"lab/internal/chat"
	"lab/internal/commands"
	"lab/internal/console"
	"lab/internal/experiments"
	"lab/internal/files"
	"lab/internal/shared/config"
	"lab/internal/shared/database"
	httpx "lab/internal/shared/http"
)

func main() {
	// Daemon di bawah systemd berjalan sebagai session leader tanpa
	// controlling terminal. Operasi PTY console (setsid + TIOCSCTTY di
	// child) memicu SIGHUP palsu ke proses ini -> mati diam-diam tiap
	// buka terminal. Abaikan: lifecycle diatur systemd via SIGTERM.
	signal.Ignore(syscall.SIGHUP)

	cfg := config.LoadConfig()

	db, err := database.Connect(cfg)
	if err != nil {
		log.Fatalf("DB connection failed: %v", err)
	}
	defer db.Close()

	if err := database.Migrate(db); err != nil {
		log.Fatalf("DB migration failed: %v", err)
	}

	authService := auth.NewService(db, cfg.JWTSecret, cfg.JWTExpiry)
	authHandler := auth.NewHandler(authService)
	experimentsHandler := experiments.NewHandler()

	mux := http.NewServeMux()
	authHandler.RegisterRoutes(mux, authHandler.Middleware)
	experimentsHandler.RegisterRoutes(mux)

	// Self-hosted OpenComputer-compatible builder API (lab UI/UX experiment).
	builderStore := builder.NewStore()
	builderStore.RegisterRoutes(mux)

	// Chat completion (TokenPortal, streaming SSE) + riwayat chat (Postgres).
	chatHandler := chat.NewHandler(db)
	chatHandler.RegisterRoutes(mux)
	chatHandler.RegisterHistoryRoutes(mux, authHandler.Middleware)

	// Code Explorer (/lab/files): file tree + pembaca konten read-only
	// di dalam PROJECT_ROOT.
	filesHandler := files.NewHandler()
	filesHandler.RegisterRoutes(mux)

	// Command Sets (/lab/commands): CRUD command bash per service -> judul -> command.
	commandsHandler := commands.NewHandler(db)
	commandsHandler.RegisterRoutes(mux, authHandler.Middleware)

	// Analytics Server (/lab/analytics-server): snapshot + stream SSE
	// kondisi server realtime (CPU, RAM, disk, load, uptime).
	analyticsHandler := analytics.NewHandler()
	analyticsHandler.RegisterRoutes(mux)

	// Console (/lab/console): terminal lokal, maks 5 sesi PTY via SSE + POST.
	consoleHandler := console.NewHandler()
	consoleHandler.RegisterRoutes(mux)

	// Chat Agent Playground (/lab/chat mode Agent): loop LLM<->tool via SSE
	// + approval manusia untuk run_shell.
	agentHandler := agent.NewHandler()
	agentHandler.RegisterRoutes(mux)

	// Contoh endpoint terproteksi
	mux.Handle("GET /api/me", authHandler.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"user_uuid": auth.UserUUID(r.Context())})
	})))

	loginURL := strings.TrimRight(cfg.FrontendURL, "/") + "/login"

	// Catch-all: Setiap user yang mengakses link/URL selalu diarahkan langsung ke halaman login
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Jika request adalah ke endpoint API yang tidak ditemukan, berikan 404
		if strings.HasPrefix(r.URL.Path, "/api") {
			http.NotFound(w, r)
			return
		}
		// Preview sandbox builder (Vite di container) — butuh pass-through,
		// jangan di-redirect ke login.
		if strings.HasPrefix(r.URL.Path, "/b/") {
			http.NotFound(w, r)
			return
		}
		// Semua link selain endpoint API diarahkan langsung ke halaman login
		http.Redirect(w, r, loginURL, http.StatusFound)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server running on :%s", port)
	if err := http.ListenAndServe(":"+port, httpx.CORS(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
