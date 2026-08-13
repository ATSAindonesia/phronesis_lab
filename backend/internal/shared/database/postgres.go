package database

import (
	"context"
	"fmt"
	"log"
	"time"
    
	"github.com/jackc/pgx/v5/pgxpool"
	"lab/internal/shared/config"
)

type PostgresDB struct {
	Pool *pgxpool.Pool
}

// NewPostgresDB membuat koneksi pool ke PostgreSQL
func NewPostgresDB(cfg *config.Config) (*PostgresDB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
    
	var connString string
    
	// Prioritaskan DATABASE_URL jika ada
	if cfg.DBURL != "" {
		connString = cfg.DBURL
	} else {
		// Build manual dari komponen
		connString = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBSSLMode,
		)
	}
    
	// Parse config dan buat pool
	poolConfig, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("failed to parse db config: %w", err)
	}
    
	// Optional: set pool size (default = runtime.GOMAXPROCS * 2)
	poolConfig.MaxConns = 20
	poolConfig.MinConns = 5
    
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to db: %w", err)
	}
    
	// Ping untuk memastikan koneksi berhasil
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping db: %w", err)
	}
    
	log.Println("✅ PostgreSQL connected successfully")
	return &PostgresDB{Pool: pool}, nil
}

// Close menutup pool koneksi
func (db *PostgresDB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
		log.Println("PostgreSQL connection closed")
	}
}