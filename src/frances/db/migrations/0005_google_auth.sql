-- Login web con Google (OIDC/PKCE), estados de aprobación y revocación limpia (ADR-021, CHG-23).
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','disabled'));
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local' CHECK (auth_provider IN ('local','google','both'));
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE UNIQUE INDEX users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
UPDATE users SET status = 'disabled' WHERE disabled_at IS NOT NULL;

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  next_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO schema_version VALUES (5);
