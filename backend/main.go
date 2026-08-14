package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"lab/internal/auth"
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

	mux := http.NewServeMux()
	authHandler.RegisterRoutes(mux)

	// Contoh endpoint terproteksi
	mux.Handle("GET /api/me", authHandler.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"user_uuid": auth.UserUUID(r.Context())})
	})))

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
