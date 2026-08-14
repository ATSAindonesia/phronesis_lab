package auth

import (
	"errors"
	"time"

	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	UUID      string    `db:"uuid"`
	Name      string    `db:"name"`
	Email     string    `db:"email"`
	Password  string    `db:"password"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

type Service struct {
	db            *sqlx.DB
	jwtSecret     string
	jwtExpiryMins int
}

func NewService(db *sqlx.DB, jwtSecret string, jwtExpiryMins int) *Service {
	return &Service{db: db, jwtSecret: jwtSecret, jwtExpiryMins: jwtExpiryMins}
}

// CreateUser membuat user baru dengan password yang di-hash bcrypt.
// Dipakai oleh CLI adduser (tidak ada register publik).
func (s *Service) CreateUser(req CreateUserRequest) (*UserResponse, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	var user User
	err = s.db.QueryRowx(
		`INSERT INTO users (name, email, password) VALUES ($1, $2, $3)
		 RETURNING uuid, name, email, created_at, updated_at`,
		req.Name, req.Email, string(hash),
	).StructScan(&user)
	if err != nil {
		return nil, err
	}

	return &UserResponse{UUID: user.UUID, Name: user.Name, Email: user.Email}, nil
}

// Login memverifikasi email & password, lalu mengembalikan token JWT.
func (s *Service) Login(req LoginRequest) (*LoginResponse, error) {
	var user User
	err := s.db.Get(&user, `SELECT * FROM users WHERE email = $1`, req.Email)
	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return nil, errors.New("invalid email or password")
	}

	token, err := GenerateToken(s.jwtSecret, s.jwtExpiryMins, user.UUID)
	if err != nil {
		return nil, err
	}

	return &LoginResponse{
		Token: token,
		User:  UserResponse{UUID: user.UUID, Name: user.Name, Email: user.Email},
	}, nil
}
