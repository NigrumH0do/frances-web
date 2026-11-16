CREATE TABLE text_blocks (id INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id),
  source TEXT NOT NULL, page INTEGER, position INTEGER NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL,
  extractor_version TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (item_id, source, page, position));
CREATE INDEX text_blocks_item ON text_blocks (item_id);
CREATE VIRTUAL TABLE text_blocks_fts USING fts5(text, content='text_blocks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER text_blocks_ai AFTER INSERT ON text_blocks BEGIN
  INSERT INTO text_blocks_fts(rowid, text) VALUES (new.id, new.text); END;
CREATE TRIGGER text_blocks_ad AFTER DELETE ON text_blocks BEGIN
  INSERT INTO text_blocks_fts(text_blocks_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
CREATE TRIGGER text_blocks_au AFTER UPDATE ON text_blocks BEGIN
  INSERT INTO text_blocks_fts(text_blocks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO text_blocks_fts(rowid, text) VALUES (new.id, new.text); END;
CREATE TABLE llm_cache (key TEXT PRIMARY KEY, task TEXT NOT NULL, prompt_version TEXT NOT NULL,
  model TEXT NOT NULL, input_sha256 TEXT NOT NULL, output_json TEXT NOT NULL,
  created_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, last_hit_at TEXT);
CREATE TABLE usage_daily (day TEXT NOT NULL, meter TEXT NOT NULL, amount INTEGER NOT NULL,
  PRIMARY KEY (day, meter));
INSERT INTO schema_version VALUES (3);
