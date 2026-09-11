package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	DBSSLMode  string
	DBURL      string // alternatif pakai URL

	JWTSecret string
	JWTExpiry int // dalam menit

	FrontendURL string

	GeminiAPIKey string
	GeminiModel  string
}

func LoadConfig() *Config {
	// Load .env file (abaikan jika file tidak ada, misal di production)
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: .env file not found, using system env")
	}

	return &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "postgres"),
		DBPassword: getEnv("DB_PASSWORD", "postadminerere"),
		DBName:     getEnv("DB_NAME", "lab"),
		DBSSLMode:  getEnv("DB_SSLMODE", "disable"),
		DBURL:      getEnv("DATABASE_URL", ""),

		JWTSecret: getEnv("JWT_SECRET", "secret-key-ganti-ini"),
		JWTExpiry: getEnvInt("JWT_EXPIRY_MINUTES", 60),

		FrontendURL: getEnv("FRONTEND_URL", "http://localhost:3000"),

		GeminiAPIKey: getEnv("GEMINI_API_KEY", ""),
		GeminiModel:  getEnv("GEMINI_MODEL", "gemini-3.6-flash"),
	}
}

// Helper untuk default value
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		if n, err := strconv.Atoi(value); err == nil {
			return n
		}
	}
	return defaultValue
}