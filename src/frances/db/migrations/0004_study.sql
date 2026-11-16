ALTER TABLE cards ADD COLUMN owner_user_id TEXT REFERENCES users(id);   -- NULL = compartida
ALTER TABLE cards ADD COLUMN edited_by_human INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN edited_input_hash TEXT;                    -- input_hash de la publicación al editar
ALTER TABLE cards ADD COLUMN removed_at TEXT;                           -- borrada por el admin (conserva historial)
ALTER TABLE sheets ADD COLUMN edited_by_human INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sheets ADD COLUMN edited_input_hash TEXT;
CREATE TABLE user_card_state (user_id TEXT NOT NULL REFERENCES users(id), card_id TEXT NOT NULL REFERENCES cards(id),
  due TEXT NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL, learning_steps INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL,
  state INTEGER NOT NULL CHECK (state BETWEEN 0 AND 3), last_review TEXT,
  suspended INTEGER NOT NULL DEFAULT 0, flagged_hard INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id));
CREATE INDEX user_card_state_due ON user_card_state (user_id, suspended, due);
CREATE TABLE review_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT NOT NULL REFERENCES cards(id), rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state INTEGER NOT NULL, due TEXT NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL, review_at TEXT NOT NULL);
CREATE INDEX review_log_user ON review_log (user_id, review_at);
CREATE TABLE card_overrides (user_id TEXT NOT NULL REFERENCES users(id), card_id TEXT NOT NULL REFERENCES cards(id),
  front_fr TEXT NOT NULL, back_es TEXT NOT NULL, example_fr TEXT, example_es TEXT, notes TEXT,
  base_updated_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, card_id));
CREATE TABLE user_prefs (user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL);
CREATE TABLE study_topics (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL, description_es TEXT NOT NULL DEFAULT '',
  cefr TEXT CHECK (cefr IS NULL OR cefr IN ('A1','A2','B1','B2','C1','C2')), position INTEGER NOT NULL,
  generator TEXT NOT NULL, generator_version TEXT NOT NULL, input_hash TEXT NOT NULL,
  edited_by_human INTEGER NOT NULL DEFAULT 0, edited_input_hash TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, removed_at TEXT);
CREATE TABLE study_topic_items (topic_id TEXT NOT NULL REFERENCES study_topics(id),
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id), position INTEGER NOT NULL,
  edited_by_human INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (topic_id, item_id));
CREATE TABLE quizzes (id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK (scope_kind IN ('topic','item')),
  scope_id TEXT NOT NULL, title_es TEXT NOT NULL, input_hash TEXT NOT NULL, prompt_version TEXT NOT NULL,
  model TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX quizzes_scope ON quizzes (scope_kind, scope_id);
CREATE TABLE questions (id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id), position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mcq','cloze','translate','order','dictation')),
  prompt_es TEXT NOT NULL, prompt_fr TEXT, options_json TEXT NOT NULL DEFAULT '[]', answer_json TEXT NOT NULL,
  explanation_es TEXT, audio_cache_key TEXT REFERENCES audio(cache_key),
  source_block_id INTEGER REFERENCES text_blocks(id), UNIQUE (quiz_id, position));
CREATE TABLE quiz_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
  quiz_id TEXT NOT NULL REFERENCES quizzes(id), answers_json TEXT NOT NULL, score REAL NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT NOT NULL);
CREATE INDEX quiz_attempts_user ON quiz_attempts (user_id, quiz_id);
CREATE TABLE study_plan (user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('review','quiz','read','drill')), ref_id TEXT, title_es TEXT NOT NULL,
  reason_es TEXT NOT NULL, why_llm_es TEXT, done_at TEXT, generated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day, position));
CREATE TABLE chat_threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX chat_threads_user ON chat_threads (user_id, updated_at);
CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('ok','no_material','error','partial')),
  model TEXT, prompt_version TEXT, created_at TEXT NOT NULL);
INSERT INTO schema_version VALUES (4);
