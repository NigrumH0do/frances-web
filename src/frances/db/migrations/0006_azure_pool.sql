-- Pool multicuenta de Azure (Speech STT/TTS y Translator) con rotación y respaldo cifrado (ADR-022, CHG-24).
CREATE TABLE azure_accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('speech','translator')),
  region TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  monthly_stt_seconds_cap INTEGER NOT NULL DEFAULT 16200,
  monthly_tts_chars_cap INTEGER NOT NULL DEFAULT 450000,
  monthly_translator_chars_cap INTEGER NOT NULL DEFAULT 1800000,
  cooldown_until TEXT,
  last_error TEXT,
  last_error_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE azure_usage_monthly (
  account_id TEXT NOT NULL REFERENCES azure_accounts(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  meter TEXT NOT NULL CHECK (meter IN ('stt_seconds','tts_chars','translator_chars')),
  amount INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, month, meter)
);

CREATE INDEX azure_accounts_active ON azure_accounts (kind, enabled, priority);

INSERT INTO schema_version VALUES (6);
