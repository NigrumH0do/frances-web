"""Migración 0004: estado FSRS por usuario, ediciones, temas, quizzes, plan y chat (CHG-04)."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from frances.db.store import LATEST_SCHEMA, Store


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    s = Store.open(tmp_path / "s.db")
    yield s
    s.close()


@pytest.fixture
def store_with_user_and_card(store: Store) -> Store:
    store.conn.execute(
        "INSERT INTO users VALUES ('u_1', 'ana@ex.org', 'Ana', 'h', 'user', NULL, 't', NULL, NULL)"
    )
    store.conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " created_at, updated_at)"
        " VALUES ('c_1', 'vocab', 'le chat', 'el gato', 'rules', '1', 't', 't')"
    )
    return store


@pytest.fixture
def store_with_course_item_and_topics(store: Store) -> Store:
    c = store.conn
    c.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', 't', '{}')"
    )
    c.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES ('cw_1', 'c_1', 'material', 'a-1', 'Leçon', '', 'PUBLISHED',"
        " 't', 't', 'h', '{}', 't', 't')"
    )
    for topic_id in ("tp_a", "tp_b"):
        c.execute(
            "INSERT INTO study_topics (id, course_id, title, position, generator,"
            " generator_version, input_hash, created_at, updated_at)"
            " VALUES (?, 'c_1', 'Tema', 0, 'llm', 'v1', 'h', 't', 't')",
            (topic_id,),
        )
    return store


def test_0004_tables_and_columns(store: Store) -> None:
    cols = {r[1] for r in store.conn.execute("PRAGMA table_info(cards)")}
    assert {"owner_user_id", "edited_by_human", "edited_input_hash", "removed_at"} <= cols
    sheet_cols = {r[1] for r in store.conn.execute("PRAGMA table_info(sheets)")}
    assert {"edited_by_human", "edited_input_hash"} <= sheet_cols
    names = {r[0] for r in store.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {
        "user_card_state",
        "review_log",
        "card_overrides",
        "user_prefs",
        "app_settings",
        "study_topics",
        "study_topic_items",
        "quizzes",
        "questions",
        "quiz_attempts",
        "study_plan",
        "chat_threads",
        "chat_messages",
    } <= names


def test_0004_version_is_latest(store: Store) -> None:
    assert LATEST_SCHEMA >= 4
    assert store.conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] >= 4


def test_item_belongs_to_one_study_topic(store_with_course_item_and_topics: Store) -> None:
    c = store_with_course_item_and_topics.conn
    c.execute("INSERT INTO study_topic_items VALUES ('tp_a', 'cw_1', 0, 0)")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO study_topic_items VALUES ('tp_b', 'cw_1', 0, 0)")


def test_fsrs_state_check(store_with_user_and_card: Store) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        store_with_user_and_card.conn.execute(
            "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty, "
            "elapsed_days, scheduled_days, learning_steps, reps, lapses, state, updated_at) "
            "VALUES ('u_1', 'c_1', 't', 1, 5, 0, 0, 0, 0, 0, 7, 't')"
        )


def test_v1_card_insert_without_new_columns_still_works(store: Store) -> None:
    store.conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " created_at, updated_at)"
        " VALUES ('c_9', 'vocab', 'le chat', 'el gato', 'rules', '1', 't', 't')"
    )
    row = store.conn.execute(
        "SELECT owner_user_id, edited_by_human, removed_at FROM cards WHERE id='c_9'"
    ).fetchone()
    assert row == (None, 0, None)
