package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"lab/internal/auth"
	"lab/internal/builder"
	"lab/internal/experiments"
	"lab/internal/shared/config"
	"lab/internal/shared/database"
	httpx "lab/internal/shared/http"
)

func main() {
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
	authHandler.RegisterRoutes(mux)
	experimentsHandler.RegisterRoutes(mux)

	// Self-hosted OpenComputer-compatible builder API (lab UI/UX experiment).
	builderStore := builder.NewStore()
	builderStore.RegisterRoutes(mux)

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
