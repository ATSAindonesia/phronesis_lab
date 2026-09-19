-- Command Sets: kumpulan command bash per service, per user.
-- Hierarki: service -> judul command -> command bash.
CREATE TABLE IF NOT EXISTS command_services (
    uuid        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uuid   UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_command_services_user
    ON command_services (user_uuid, updated_at DESC);

CREATE TABLE IF NOT EXISTS command_titles (
    uuid         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_uuid UUID NOT NULL REFERENCES command_services(uuid) ON DELETE CASCADE,
    title        VARCHAR(255) NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_command_titles_service
    ON command_titles (service_uuid, created_at);

CREATE TABLE IF NOT EXISTS command_commands (
    uuid        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_uuid  UUID NOT NULL REFERENCES command_titles(uuid) ON DELETE CASCADE,
    label       VARCHAR(255) NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_command_commands_title
    ON command_commands (title_uuid, sort_order, created_at);
