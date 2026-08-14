package main

import (
	"fmt"
	"log"
	"os"

	"lab/internal/auth"
	"lab/internal/shared/config"
	"lab/internal/shared/database"
)

// Cara pakai: go run ./cmd/adduser <email> <name> <password>
func main() {
	if len(os.Args) != 4 {
		fmt.Println("Usage: go run ./cmd/adduser <email> <name> <password>")
		os.Exit(1)
	}

	email, name, password := os.Args[1], os.Args[2], os.Args[3]
	if email == "" || name == "" || password == "" {
		fmt.Println("Error: email, name, dan password tidak boleh kosong")
		os.Exit(1)
	}

	cfg := config.LoadConfig()

	db, err := database.Connect(cfg)
	if err != nil {
		log.Fatalf("DB connection failed: %v", err)
	}
	defer db.Close()

	service := auth.NewService(db, cfg.JWTSecret, cfg.JWTExpiry)

	user, err := service.CreateUser(auth.CreateUserRequest{
		Name:     name,
		Email:    email,
		Password: password,
	})
	if err != nil {
		log.Fatalf("Failed to create user: %v", err)
	}

	fmt.Printf("User created successfully:\n  uuid: %s\n  name: %s\n  email: %s\n", user.UUID, user.Name, user.Email)
}
