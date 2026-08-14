package database

import (
	"fmt"
	"log"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"

	"lab/internal/shared/config"
)

// Connect membuat koneksi *sqlx.DB ke PostgreSQL.
func Connect(cfg *config.Config) (*sqlx.DB, error) {
	var connString string

	// Prioritaskan DATABASE_URL jika ada
	if cfg.DBURL != "" {
		connString = cfg.DBURL
	} else {
		connString = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBSSLMode,
		)
	}

	db, err := sqlx.Connect("pgx", connString)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to db: %w", err)
	}

	// Set pool size sederhana
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	log.Println("PostgreSQL connected successfully")
	return db, nil
}
