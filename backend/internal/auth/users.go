package auth

import (
	"database/sql"
	"errors"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// Guard errors untuk penghapusan user.
var (
	errSelfDelete = errors.New("cannot delete your own account")
	errLastUser   = errors.New("cannot delete the last user")
	errNotFound   = errors.New("user not found")
	errDupEmail   = errors.New("email is already registered")
)

// canDelete adalah guard murni penghapusan user: blokir hapus diri sendiri
// dan hapus user terakhir. Pure function agar mudah di-test.
func canDelete(requesterUUID, targetUUID string, totalCount int) error {
	if requesterUUID == targetUUID {
		return errSelfDelete
	}
	if totalCount <= 1 {
		return errLastUser
	}
	return nil
}

// ListUsers mengembalikan semua user tanpa password, urut tertua dulu.
func (s *Service) ListUsers() ([]UserResponse, error) {
	var users []UserResponse
	err := s.db.Select(&users,
		`SELECT uuid, name, email, created_at, updated_at FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	if users == nil {
		users = []UserResponse{}
	}
	return users, nil
}

// GetUser mengambil satu user tanpa password.
func (s *Service) GetUser(uuid string) (*UserResponse, error) {
	var u UserResponse
	err := s.db.Get(&u,
		`SELECT uuid, name, email, created_at, updated_at FROM users WHERE uuid = $1`, uuid)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	return &u, nil
}

// CountUsers menghitung total user.
func (s *Service) CountUsers() (int, error) {
	var n int
	if err := s.db.Get(&n, `SELECT COUNT(*) FROM users`); err != nil {
		return 0, err
	}
	return n, nil
}

// UpdateUser mengubah nama/email user. Pointer nil = tidak diubah.
func (s *Service) UpdateUser(uuid string, name, email *string) (*UserResponse, error) {
	current, err := s.GetUser(uuid)
	if err != nil {
		return nil, err
	}
	newName, newEmail := current.Name, current.Email
	if name != nil {
		newName = strings.TrimSpace(*name)
		if newName == "" {
			return nil, errors.New("name is required")
		}
	}
	if email != nil {
		newEmail = strings.TrimSpace(*email)
		if newEmail == "" {
			return nil, errors.New("email is required")
		}
	}
	var updated UserResponse
	err = s.db.Get(&updated,
		`UPDATE users SET name = $1, email = $2, updated_at = CURRENT_TIMESTAMP
		 WHERE uuid = $3
		 RETURNING uuid, name, email, created_at, updated_at`,
		newName, newEmail, uuid)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			return nil, errDupEmail
		}
		return nil, err
	}
	return &updated, nil
}

// SetPassword me-reset password user (bcrypt, minimal 6 karakter).
func (s *Service) SetPassword(uuid, password string) error {
	if len(password) < 6 {
		return errors.New("password must be at least 6 characters")
	}
	if _, err := s.GetUser(uuid); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE uuid = $2`,
		string(hash), uuid)
	return err
}

// DeleteUser menghapus user beserta datanya (FK cascade ke commands & chat).
// Menolak bila tinggal 1 user; cek diri-sendiri ada di handler (butuh JWT).
func (s *Service) DeleteUser(uuid string) error {
	if _, err := s.GetUser(uuid); err != nil {
		return err
	}
	n, err := s.CountUsers()
	if err != nil {
		return err
	}
	if n <= 1 {
		return errLastUser
	}
	_, err = s.db.Exec(`DELETE FROM users WHERE uuid = $1`, uuid)
	return err
}
