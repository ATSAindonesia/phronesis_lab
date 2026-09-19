// Package commands menyediakan CRUD "Command Sets": kumpulan command bash
// yang dikelompokkan per service (github, docker, hermes, ...), lalu per
// judul command, lalu command bash-nya sendiri.
//
// Hierarki: command_services -> command_titles -> command_commands.
// Semua data di-scope per user (user_uuid dari JWT).
package commands

import (
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"
)

var errNotFound = errors.New("not found")

type Service struct {
	UUID         string    `json:"uuid" db:"uuid"`
	UserUUID     string    `json:"user_uuid" db:"user_uuid"`
	Name         string    `json:"name" db:"name"`
	Description  string    `json:"description" db:"description"`
	TitleCount   int       `json:"title_count" db:"title_count"`
	CommandCount int       `json:"command_count" db:"command_count"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type CommandTitle struct {
	UUID         string    `json:"uuid" db:"uuid"`
	ServiceUUID  string    `json:"service_uuid" db:"service_uuid"`
	Title        string    `json:"title" db:"title"`
	Description  string    `json:"description" db:"description"`
	CommandCount int       `json:"command_count" db:"command_count"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type Command struct {
	UUID        string    `json:"uuid" db:"uuid"`
	TitleUUID   string    `json:"title_uuid" db:"title_uuid"`
	Label       string    `json:"label" db:"label"`
	Body        string    `json:"body" db:"body"`
	Description string    `json:"description" db:"description"`
	SortOrder   int       `json:"sort_order" db:"sort_order"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type Store struct {
	db *sqlx.DB
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

// ─── Service ────────────────────────────────────────────────────────────────

const serviceColumns = `
	s.uuid, s.user_uuid, s.name, s.description, s.created_at, s.updated_at,
	(SELECT COUNT(*) FROM command_titles t WHERE t.service_uuid = s.uuid) AS title_count,
	(SELECT COUNT(*) FROM command_commands c
	   JOIN command_titles t2 ON c.title_uuid = t2.uuid
	  WHERE t2.service_uuid = s.uuid) AS command_count`

func (s *Store) ListServices(userUUID string) ([]Service, error) {
	var out []Service
	err := s.db.Select(&out, `
		SELECT `+serviceColumns+`
		FROM command_services s
		WHERE s.user_uuid = $1
		ORDER BY s.updated_at DESC`, userUUID)
	return out, err
}

func (s *Store) CreateService(userUUID, name, description string) (Service, error) {
	var svc Service
	err := s.db.Get(&svc, `
		INSERT INTO command_services (user_uuid, name, description)
		VALUES ($1, $2, $3)
		RETURNING uuid, user_uuid, name, description, created_at, updated_at,
		          0 AS title_count, 0 AS command_count`,
		userUUID, name, description)
	return svc, err
}

func (s *Store) GetService(userUUID, serviceUUID string) (Service, error) {
	var svc Service
	err := s.db.Get(&svc, `
		SELECT `+serviceColumns+`
		FROM command_services s
		WHERE s.uuid = $1 AND s.user_uuid = $2`, serviceUUID, userUUID)
	if err != nil {
		return svc, errNotFound
	}
	return svc, nil
}

func (s *Store) UpdateService(userUUID, serviceUUID, name, description string) error {
	res, err := s.db.Exec(`
		UPDATE command_services
		SET name = $3, description = $4, updated_at = CURRENT_TIMESTAMP
		WHERE uuid = $1 AND user_uuid = $2`, serviceUUID, userUUID, name, description)
	return affected(res, err)
}

func (s *Store) DeleteService(userUUID, serviceUUID string) error {
	res, err := s.db.Exec(`
		DELETE FROM command_services WHERE uuid = $1 AND user_uuid = $2`,
		serviceUUID, userUUID)
	return affected(res, err)
}

// ─── Judul command ──────────────────────────────────────────────────────────

func (s *Store) ListTitles(serviceUUID string) ([]CommandTitle, error) {
	var out []CommandTitle
	err := s.db.Select(&out, `
		SELECT t.uuid, t.service_uuid, t.title, t.description, t.created_at, t.updated_at,
		       (SELECT COUNT(*) FROM command_commands c WHERE c.title_uuid = t.uuid) AS command_count
		FROM command_titles t
		WHERE t.service_uuid = $1
		ORDER BY t.created_at ASC`, serviceUUID)
	return out, err
}

// CreateTitle memastikan service milik user sebelum menyimpan judul.
func (s *Store) CreateTitle(userUUID, serviceUUID, title, description string) (CommandTitle, error) {
	if _, err := s.GetService(userUUID, serviceUUID); err != nil {
		return CommandTitle{}, err
	}
	var t CommandTitle
	err := s.db.Get(&t, `
		INSERT INTO command_titles (service_uuid, title, description)
		VALUES ($1, $2, $3)
		RETURNING uuid, service_uuid, title, description, created_at, updated_at,
		          0 AS command_count`,
		serviceUUID, title, description)
	return t, err
}

func (s *Store) GetTitle(userUUID, titleUUID string) (CommandTitle, error) {
	var t CommandTitle
	err := s.db.Get(&t, `
		SELECT t.uuid, t.service_uuid, t.title, t.description, t.created_at, t.updated_at,
		       (SELECT COUNT(*) FROM command_commands c WHERE c.title_uuid = t.uuid) AS command_count
		FROM command_titles t
		JOIN command_services s ON s.uuid = t.service_uuid
		WHERE t.uuid = $1 AND s.user_uuid = $2`, titleUUID, userUUID)
	if err != nil {
		return t, errNotFound
	}
	return t, nil
}

func (s *Store) UpdateTitle(userUUID, titleUUID, title, description string) error {
	res, err := s.db.Exec(`
		UPDATE command_titles t
		SET title = $3, description = $4, updated_at = CURRENT_TIMESTAMP
		FROM command_services s
		WHERE t.uuid = $1 AND t.service_uuid = s.uuid AND s.user_uuid = $2`,
		titleUUID, userUUID, title, description)
	return affected(res, err)
}

func (s *Store) DeleteTitle(userUUID, titleUUID string) error {
	res, err := s.db.Exec(`
		DELETE FROM command_titles t
		USING command_services s
		WHERE t.uuid = $1 AND t.service_uuid = s.uuid AND s.user_uuid = $2`,
		titleUUID, userUUID)
	return affected(res, err)
}

// ─── Command bash ───────────────────────────────────────────────────────────

func (s *Store) ListCommands(titleUUID string) ([]Command, error) {
	var out []Command
	err := s.db.Select(&out, `
		SELECT uuid, title_uuid, label, body, description, sort_order, created_at, updated_at
		FROM command_commands
		WHERE title_uuid = $1
		ORDER BY sort_order ASC, created_at ASC`, titleUUID)
	return out, err
}

func (s *Store) CreateCommand(userUUID, titleUUID, label, body, description string) (Command, error) {
	if _, err := s.GetTitle(userUUID, titleUUID); err != nil {
		return Command{}, err
	}
	var c Command
	err := s.db.Get(&c, `
		INSERT INTO command_commands (title_uuid, label, body, description, sort_order)
		VALUES ($1, $2, $3, $4,
		        COALESCE((SELECT MAX(sort_order) + 1 FROM command_commands WHERE title_uuid = $1), 0))
		RETURNING uuid, title_uuid, label, body, description, sort_order, created_at, updated_at`,
		titleUUID, label, body, description)
	return c, err
}

func (s *Store) GetCommand(userUUID, commandUUID string) (Command, error) {
	var c Command
	err := s.db.Get(&c, `
		SELECT c.uuid, c.title_uuid, c.label, c.body, c.description, c.sort_order,
		       c.created_at, c.updated_at
		FROM command_commands c
		JOIN command_titles t ON t.uuid = c.title_uuid
		JOIN command_services s ON s.uuid = t.service_uuid
		WHERE c.uuid = $1 AND s.user_uuid = $2`, commandUUID, userUUID)
	if err != nil {
		return c, errNotFound
	}
	return c, nil
}

func (s *Store) UpdateCommand(userUUID, commandUUID, label, body, description string) error {
	res, err := s.db.Exec(`
		UPDATE command_commands c
		SET label = $3, body = $4, description = $5, updated_at = CURRENT_TIMESTAMP
		FROM command_titles t
		JOIN command_services s ON s.uuid = t.service_uuid
		WHERE c.uuid = $1 AND c.title_uuid = t.uuid AND s.user_uuid = $2`,
		commandUUID, userUUID, label, body, description)
	return affected(res, err)
}

func (s *Store) DeleteCommand(userUUID, commandUUID string) error {
	res, err := s.db.Exec(`
		DELETE FROM command_commands c
		USING command_titles t, command_services s
		WHERE c.uuid = $1 AND c.title_uuid = t.uuid
		  AND t.service_uuid = s.uuid AND s.user_uuid = $2`,
		commandUUID, userUUID)
	return affected(res, err)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func affected(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errNotFound
	}
	return nil
}
