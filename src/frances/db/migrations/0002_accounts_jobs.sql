CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')), invited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL, last_login_at TEXT, disabled_at TEXT);
CREATE TABLE invites (id TEXT PRIMARY KEY, token_sha256 TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')), note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT, used_by TEXT REFERENCES users(id), revoked_at TEXT);
CREATE TABLE sessions (token_sha256 TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
  priority INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5, run_after TEXT NOT NULL, dedupe_key TEXT,
  locked_by TEXT, locked_at TEXT, last_error TEXT, result TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT);
CREATE INDEX jobs_ready ON jobs (state, run_after, priority);
CREATE UNIQUE INDEX jobs_dedupe_active ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND state IN ('queued','running');
CREATE TABLE schedule_slots (name TEXT NOT NULL, slot TEXT NOT NULL, job_id INTEGER REFERENCES jobs(id),
  enqueued_at TEXT NOT NULL, PRIMARY KEY (name, slot));
CREATE TABLE worker_heartbeat (worker_id TEXT PRIMARY KEY, seen_at TEXT NOT NULL, current_job_id INTEGER);
INSERT INTO schema_version VALUES (2);
