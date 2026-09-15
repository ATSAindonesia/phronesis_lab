-- Riwayat chat: percakapan per user + pesan-pesannya.
CREATE TABLE IF NOT EXISTS chat_conversations (
    uuid       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uuid  UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    title      VARCHAR(255) NOT NULL DEFAULT 'Chat baru',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user
    ON chat_conversations (user_uuid, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    uuid              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_uuid UUID NOT NULL REFERENCES chat_conversations(uuid) ON DELETE CASCADE,
    role              VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
    content           TEXT NOT NULL DEFAULT '',
    reasoning         TEXT,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv
    ON chat_messages (conversation_uuid, created_at);
