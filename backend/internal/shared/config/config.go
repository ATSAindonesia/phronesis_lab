package config

import (
	"log"
	"os"
    
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
		DBURL:      getEnv("DATABASE_URL", ""),
	}
}

// Helper untuk default value
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return defaultValue
}