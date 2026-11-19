-- Kennedy Labs: sessões de autenticação e e-mail de recuperação.
-- A tabela é compatível com connect-pg-simple; não armazena senhas em texto puro.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(254);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
  ON user_sessions (expire);
