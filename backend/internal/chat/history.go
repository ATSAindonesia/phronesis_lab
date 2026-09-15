package chat

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"lab/internal/auth"
)

// ─── Riwayat chat (Postgres) ────────────────────────────────────────────────
// Percakapan + pesan tersimpan per user (user_uuid dari JWT).
// Endpoint dipanggil lewat proxy Next.js yang meneruskan cookie session
// sebagai Authorization: Bearer.

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type Conversation struct {
	UUID         string    `json:"uuid" db:"uuid"`
	UserUUID     string    `json:"user_uuid" db:"user_uuid"`
	Title        string    `json:"title" db:"title"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
	MessageCount int       `json:"message_count" db:"message_count"`
}

type StoredMessage struct {
	UUID             string    `json:"uuid" db:"uuid"`
	ConversationUUID string    `json:"conversation_uuid" db:"conversation_uuid"`
	Role             string    `json:"role" db:"role"`
	Content          string    `json:"content" db:"content"`
	Reasoning        *string   `json:"reasoning,omitempty" db:"reasoning"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
}

type HistoryStore struct {
	db *sqlx.DB
}

func NewHistoryStore(db *sqlx.DB) *HistoryStore {
	return &HistoryStore{db: db}
}

func (s *HistoryStore) ListConversations(userUUID string) ([]Conversation, error) {
	var convs []Conversation
	err := s.db.Select(&convs, `
		SELECT c.uuid, c.user_uuid, c.title, c.created_at, c.updated_at,
		       COUNT(m.uuid) AS message_count
		FROM chat_conversations c
		LEFT JOIN chat_messages m ON m.conversation_uuid = c.uuid
		WHERE c.user_uuid = $1
		GROUP BY c.uuid
		ORDER BY c.updated_at DESC`, userUUID)
	return convs, err
}

func (s *HistoryStore) CreateConversation(userUUID, title string) (Conversation, error) {
	var c Conversation
	err := s.db.Get(&c, `
		INSERT INTO chat_conversations (user_uuid, title)
		VALUES ($1, $2)
		RETURNING uuid, user_uuid, title, created_at, updated_at`,
		userUUID, title)
	return c, err
}

func (s *HistoryStore) GetConversation(userUUID, convUUID string) (Conversation, error) {
	var c Conversation
	err := s.db.Get(&c, `
		SELECT uuid, user_uuid, title, created_at, updated_at, 0 AS message_count
		FROM chat_conversations
		WHERE uuid = $1 AND user_uuid = $2`, convUUID, userUUID)
	return c, err
}

func (s *HistoryStore) RenameConversation(userUUID, convUUID, title string) error {
	res, err := s.db.Exec(`
		UPDATE chat_conversations SET title = $3, updated_at = CURRENT_TIMESTAMP
		WHERE uuid = $1 AND user_uuid = $2`, convUUID, userUUID, title)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errNotFound
	}
	return nil
}

func (s *HistoryStore) DeleteConversation(userUUID, convUUID string) error {
	res, err := s.db.Exec(`
		DELETE FROM chat_conversations WHERE uuid = $1 AND user_uuid = $2`,
		convUUID, userUUID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errNotFound
	}
	return nil
}

func (s *HistoryStore) ListMessages(convUUID string) ([]StoredMessage, error) {
	var msgs []StoredMessage
	err := s.db.Select(&msgs, `
		SELECT uuid, conversation_uuid, role, content, reasoning, created_at
		FROM chat_messages
		WHERE conversation_uuid = $1
		ORDER BY created_at ASC`, convUUID)
	return msgs, err
}

// AppendMessages menyimpan batch pesan (urut sesuai input) + touch updated_at.
func (s *HistoryStore) AppendMessages(convUUID string, msgs []StoredMessage) ([]StoredMessage, error) {
	tx, err := s.db.Beginx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	out := make([]StoredMessage, 0, len(msgs))
	for i := range msgs {
		var m StoredMessage
		err := tx.Get(&m, `
			INSERT INTO chat_messages (conversation_uuid, role, content, reasoning)
			VALUES ($1, $2, $3, $4)
			RETURNING uuid, conversation_uuid, role, content, reasoning, created_at`,
			convUUID, msgs[i].Role, msgs[i].Content, msgs[i].Reasoning)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}

	if _, err := tx.Exec(`
		UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP
		WHERE uuid = $1`, convUUID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

var errNotFound = errors.New("not found")

// ─── Handler ────────────────────────────────────────────────────────────────

// RegisterHistoryRoutes mendaftarkan endpoint riwayat. Semua route dibungkus
// requireKey (X-API-Key dari proxy) + middleware JWT supaya user_uuid valid.
func (h *Handler) RegisterHistoryRoutes(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	wrap := func(next http.Handler) http.Handler {
		return h.requireKey(authMW(next))
	}
	mux.Handle("GET /v1/chat/conversations", wrap(http.HandlerFunc(h.handleListConversations)))
	mux.Handle("POST /v1/chat/conversations", wrap(http.HandlerFunc(h.handleCreateConversation)))
	mux.Handle("GET /v1/chat/conversations/{id}", wrap(http.HandlerFunc(h.handleGetConversation)))
	mux.Handle("PATCH /v1/chat/conversations/{id}", wrap(http.HandlerFunc(h.handleRenameConversation)))
	mux.Handle("DELETE /v1/chat/conversations/{id}", wrap(http.HandlerFunc(h.handleDeleteConversation)))
	mux.Handle("POST /v1/chat/conversations/{id}/messages", wrap(http.HandlerFunc(h.handleAppendMessages)))
}

func (h *Handler) handleListConversations(w http.ResponseWriter, r *http.Request) {
	convs, err := h.store.ListConversations(auth.UserUUID(r.Context()))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to list conversations")
		return
	}
	if convs == nil {
		convs = []Conversation{}
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"conversations": convs})
}

func (h *Handler) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string `json:"title"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		title = "Chat baru"
	}
	title = truncateRunes(title, 255)

	conv, err := h.store.CreateConversation(auth.UserUUID(r.Context()), title)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to create conversation")
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]interface{}{"conversation": conv})
}

func (h *Handler) handleGetConversation(w http.ResponseWriter, r *http.Request) {
	convUUID := r.PathValue("id")
	if !uuidRe.MatchString(convUUID) {
		jsonErr(w, http.StatusBadRequest, "Invalid conversation id")
		return
	}
	userUUID := auth.UserUUID(r.Context())
	conv, err := h.store.GetConversation(userUUID, convUUID)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "Conversation not found")
		return
	}
	msgs, err := h.store.ListMessages(convUUID)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to list messages")
		return
	}
	if msgs == nil {
		msgs = []StoredMessage{}
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"conversation": conv, "messages": msgs})
}

func (h *Handler) handleRenameConversation(w http.ResponseWriter, r *http.Request) {
	convUUID := r.PathValue("id")
	if !uuidRe.MatchString(convUUID) {
		jsonErr(w, http.StatusBadRequest, "Invalid conversation id")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		jsonErr(w, http.StatusBadRequest, "Title is required")
		return
	}
	if err := h.store.RenameConversation(auth.UserUUID(r.Context()), convUUID, truncateRunes(title, 255)); err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Conversation not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to rename conversation")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (h *Handler) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	convUUID := r.PathValue("id")
	if !uuidRe.MatchString(convUUID) {
		jsonErr(w, http.StatusBadRequest, "Invalid conversation id")
		return
	}
	if err := h.store.DeleteConversation(auth.UserUUID(r.Context()), convUUID); err != nil {
		if err == errNotFound {
			jsonErr(w, http.StatusNotFound, "Conversation not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to delete conversation")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]string{"ok": "true"})
}

type appendMessageInput struct {
	Role      string  `json:"role"`
	Content   string  `json:"content"`
	Reasoning *string `json:"reasoning"`
}

func (h *Handler) handleAppendMessages(w http.ResponseWriter, r *http.Request) {
	convUUID := r.PathValue("id")
	if !uuidRe.MatchString(convUUID) {
		jsonErr(w, http.StatusBadRequest, "Invalid conversation id")
		return
	}
	var body struct {
		Messages []appendMessageInput `json:"messages"`
	}
	if err := decodeBody(r, &body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(body.Messages) == 0 {
		jsonErr(w, http.StatusBadRequest, "messages is required")
		return
	}
	if len(body.Messages) > 200 {
		jsonErr(w, http.StatusBadRequest, "Too many messages (max 200)")
		return
	}

	// Ownership check: conversation harus milik user ini.
	userUUID := auth.UserUUID(r.Context())
	if _, err := h.store.GetConversation(userUUID, convUUID); err != nil {
		jsonErr(w, http.StatusNotFound, "Conversation not found")
		return
	}

	msgs := make([]StoredMessage, 0, len(body.Messages))
	for _, in := range body.Messages {
		role := strings.TrimSpace(in.Role)
		if role != "user" && role != "assistant" {
			jsonErr(w, http.StatusBadRequest, "Invalid message role: "+role)
			return
		}
		if strings.TrimSpace(in.Content) == "" {
			jsonErr(w, http.StatusBadRequest, "Message content is required")
			return
		}
		msgs = append(msgs, StoredMessage{
			ConversationUUID: convUUID,
			Role:             role,
			Content:          in.Content,
			Reasoning:        in.Reasoning,
		})
	}

	saved, err := h.store.AppendMessages(convUUID, msgs)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to save messages")
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]interface{}{"messages": saved})
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func decodeBody(r *http.Request, v interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

func writeJSONStatus(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}
