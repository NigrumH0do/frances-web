"""Repositorio de repaso (UI-05): transacción, idempotencia, cola y preferencias."""

import sqlite3
import threading
from typing import Any

import pytest

from frances.api.review_repo import (
    ReviewRejected,
    apply_review,
    get_prefs_row,
    get_state,
    new_introduced_today,
    queue_card_ids,
    set_flags,
)
from frances.db.store import Store
from frances.models.study import CardFlagsIn, FsrsCard, UserCardStateOut, UserPrefs
from frances.timeutil import format_ts
from tests.api._helpers_ui05 import (
    NOW,
    T_EARLIER,
    T_REVIEW,
    Clock,
    ReviewSeed,
    next_of,
    put_prefs,
    put_state,
    review_in,
)
from tests.testkit.api import create_user

pytest_plugins = ("tests.api._helpers_ui05",)


def _log(
    conn: sqlite3.Connection,
    user_id: str,
    card_id: str,
    *,
    state: int,
    review_at: str,
) -> None:
    conn.execute(
        "INSERT INTO review_log (user_id, card_id, rating, state, due, stability,"
        " difficulty, elapsed_days, scheduled_days, review_at)"
        " VALUES (?, ?, 3, ?, ?, 1.0, 5.0, 0, 1, ?)",
        (user_id, card_id, state, review_at, review_at),
    )


def test_get_state_is_none_until_review(review_seed: ReviewSeed, seeded_cards: list[str]) -> None:
    assert get_state(review_seed.conn, review_seed.user_id, seeded_cards[0]) is None
    state = apply_review(review_seed.conn, review_seed.user_id, review_in(seeded_cards[0]), NOW)
    assert get_state(review_seed.conn, review_seed.user_id, seeded_cards[0]) == state


def test_apply_review_reads_previous_state_and_writes_inside_begin_immediate(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    """REVIEW FOCUS P09-3: la lectura previa y la escritura van en el mismo ``BEGIN IMMEDIATE``."""
    statements: list[str] = []
    review_seed.conn.set_trace_callback(statements.append)
    try:
        apply_review(review_seed.conn, review_seed.user_id, review_in(seeded_cards[0]), NOW)
    finally:
        review_seed.conn.set_trace_callback(None)

    upper = [statement.strip().upper() for statement in statements]
    begin = next(index for index, sql in enumerate(upper) if sql.startswith("BEGIN IMMEDIATE"))
    read_state = next(
        index
        for index, sql in enumerate(upper)
        if "SELECT DUE, STABILITY" in sql and "FROM USER_CARD_STATE" in sql
    )
    insert_log = next(
        index for index, sql in enumerate(upper) if sql.startswith("INSERT INTO REVIEW_LOG")
    )
    commit = next(index for index, sql in enumerate(upper) if sql.startswith("COMMIT"))
    assert begin < read_state < insert_log < commit


def test_replay_same_reviewed_at_returns_saved_state_without_duplicate(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    rv = review_in(seeded_cards[0])
    first = apply_review(review_seed.conn, review_seed.user_id, rv, NOW)
    replay = apply_review(review_seed.conn, review_seed.user_id, rv, NOW)
    assert first == replay
    row = review_seed.conn.execute(
        "SELECT COUNT(*) FROM review_log WHERE user_id = ? AND card_id = ?",
        (review_seed.user_id, seeded_cards[0]),
    ).fetchone()
    assert row == (1,)


def test_older_review_raises_conflict(review_seed: ReviewSeed, seeded_cards: list[str]) -> None:
    apply_review(review_seed.conn, review_seed.user_id, review_in(seeded_cards[0]), NOW)
    older = review_in(
        seeded_cards[0],
        reviewed_at=T_EARLIER,
        next_state=next_of(last_review=T_EARLIER),
    )
    with pytest.raises(ReviewRejected) as caught:
        apply_review(review_seed.conn, review_seed.user_id, older, NOW)
    assert caught.value.code == "conflict"


@pytest.mark.parametrize(
    ("reviewed_at", "next_state"),
    [
        (
            "2027-01-01T00:00:00.000Z",
            next_of(last_review="2027-01-01T00:00:00.000Z", due="2027-01-04T00:00:00.000Z"),
        ),
        (
            "2026-10-01T00:00:00.000Z",
            next_of(last_review="2026-10-01T00:00:00.000Z"),
        ),
        (
            T_REVIEW,
            next_of(last_review="2026-11-02T22:00:00.000Z"),
        ),
    ],
)
def test_reviewed_at_window_and_next_last_review_are_validated(
    review_seed: ReviewSeed,
    seeded_cards: list[str],
    reviewed_at: str,
    next_state: dict[str, Any],
) -> None:
    rv = review_in(seeded_cards[0], reviewed_at=reviewed_at, next_state=next_state)
    with pytest.raises(ReviewRejected) as caught:
        apply_review(review_seed.conn, review_seed.user_id, rv, NOW)
    assert caught.value.code == "bad_request"
    assert review_seed.conn.execute("SELECT COUNT(*) FROM review_log").fetchone() == (0,)


def test_concurrent_same_review_inserts_one_log(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    """Dos dispositivos con la misma reseña: una fila y el mismo estado guardado."""
    rv = review_in(seeded_cards[0])
    barrier = threading.Barrier(2)
    results: list[UserCardStateOut] = []
    errors: list[BaseException] = []

    def worker() -> None:
        store = Store.connect(review_seed.ctx.db_path)
        try:
            barrier.wait(timeout=5)
            results.append(apply_review(store.conn, review_seed.user_id, rv, NOW))
        except BaseException as exc:  # pragma: no cover - solo si falla la carrera
            errors.append(exc)
        finally:
            store.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert not errors
    assert len(results) == 2
    assert results[0] == results[1]
    row = review_seed.conn.execute("SELECT COUNT(*) FROM review_log").fetchone()
    assert row == (1,)


def test_apply_review_logs_previous_state_code(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    put_state(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[0],
        state=2,
        reps=4,
        last_review=T_EARLIER,
    )
    apply_review(review_seed.conn, review_seed.user_id, review_in(seeded_cards[0]), NOW)
    row = review_seed.conn.execute(
        "SELECT state FROM review_log WHERE user_id = ? AND card_id = ?",
        (review_seed.user_id, seeded_cards[0]),
    ).fetchone()
    assert row == (2,)


def test_set_flags_creates_empty_card_and_keeps_existing_flags(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    created = set_flags(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[0],
        CardFlagsIn(suspended=True),
        NOW,
    )
    assert created.suspended is True
    assert created.flagged_hard is False
    assert created.fsrs == FsrsCard(
        due=format_ts(NOW),
        stability=0.0,
        difficulty=0.0,
        elapsed_days=0,
        scheduled_days=0,
        learning_steps=0,
        reps=0,
        lapses=0,
        state=0,
        last_review=None,
    )

    updated = set_flags(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[0],
        CardFlagsIn(flagged_hard=True),
        NOW,
    )
    assert updated.suspended is True
    assert updated.flagged_hard is True

    reviewed = apply_review(review_seed.conn, review_seed.user_id, review_in(seeded_cards[0]), NOW)
    assert reviewed.suspended is True
    assert reviewed.flagged_hard is True


def test_get_prefs_row_returns_defaults_and_stored_values(
    review_seed: ReviewSeed,
) -> None:
    assert get_prefs_row(review_seed.conn, review_seed.user_id) == UserPrefs()
    put_prefs(review_seed.conn, review_seed.user_id, daily_new_cards=3, theme="dark")
    prefs = get_prefs_row(review_seed.conn, review_seed.user_id)
    assert prefs.daily_new_cards == 3
    assert prefs.theme == "dark"
    assert prefs.preferred_voice_ids == []


def test_get_prefs_row_ignores_corrupt_values(review_seed: ReviewSeed) -> None:
    put_prefs(review_seed.conn, review_seed.user_id, daily_new_cards=3, theme="dark")
    review_seed.conn.execute(
        "INSERT INTO user_prefs (user_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)"
        " ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json,"
        " updated_at = excluded.updated_at",
        (review_seed.user_id, "daily_new_cards", "no-es-json", format_ts(NOW)),
    )
    prefs = get_prefs_row(review_seed.conn, review_seed.user_id)
    assert prefs.daily_new_cards == 10
    assert prefs.theme == "dark"


def test_get_prefs_row_ignores_unknown_keys_and_invalid_values(
    review_seed: ReviewSeed,
) -> None:
    put_prefs(review_seed.conn, review_seed.user_id, theme="neon", unknown="x")
    prefs = get_prefs_row(review_seed.conn, review_seed.user_id)
    assert prefs.theme == "system"


def test_queue_with_no_new_cards_left_returns_only_due(
    review_seed: ReviewSeed, seeded_cards: list[str], clock: Clock
) -> None:
    put_prefs(review_seed.conn, review_seed.user_id, daily_new_cards=0)
    put_state(review_seed.conn, review_seed.user_id, seeded_cards[3], due=clock.minus(hours=1))
    assert queue_card_ids(review_seed.conn, review_seed.user_id, NOW, 50) == [seeded_cards[3]]


def test_new_introduced_today_uses_bogota_day(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    # NOW = 2026-11-03T00:00Z = 2026-11-02 19:00 en Bogotá.
    _log(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[0],
        state=0,
        review_at="2026-11-02T05:00:00.000000Z",
    )
    _log(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[1],
        state=0,
        review_at="2026-11-02T04:59:59.000000Z",
    )
    _log(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[2],
        state=2,
        review_at="2026-11-02T06:00:00.000000Z",
    )
    assert new_introduced_today(review_seed.conn, review_seed.user_id, NOW) == 1


def test_queue_caps_new_cards_by_those_already_introduced_today(
    review_seed: ReviewSeed, seeded_cards: list[str], clock: Clock
) -> None:
    put_prefs(review_seed.conn, review_seed.user_id, daily_new_cards=2)
    put_state(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[0],
        due=clock.plus(hours=24),
        state=2,
        reps=1,
        last_review=T_REVIEW,
    )
    _log(
        review_seed.conn,
        review_seed.user_id,
        seeded_cards[0],
        state=0,
        review_at=T_REVIEW,
    )
    assert queue_card_ids(review_seed.conn, review_seed.user_id, NOW, 50) == [seeded_cards[1]]


def test_queue_card_ids_orders_due_first_then_new(
    review_seed: ReviewSeed, seeded_cards: list[str], clock: Clock
) -> None:
    put_state(review_seed.conn, review_seed.user_id, seeded_cards[3], due=clock.minus(hours=2))
    put_state(review_seed.conn, review_seed.user_id, seeded_cards[4], due=clock.minus(hours=5))
    put_prefs(review_seed.conn, review_seed.user_id, daily_new_cards=2)
    assert queue_card_ids(review_seed.conn, review_seed.user_id, NOW, 50) == [
        seeded_cards[4],
        seeded_cards[3],
        seeded_cards[0],
        seeded_cards[1],
    ]


def test_queue_card_ids_hides_other_users_private_cards(
    review_seed: ReviewSeed, seeded_cards: list[str]
) -> None:
    other_id = create_user(review_seed.conn, "otro@ui05.test")
    private_id = "uc_" + "a" * 16
    review_seed.conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id)"
        " VALUES (?, 'vocab', 'privé', 'privado', 'user', '1', 0, ?, ?, ?)",
        (private_id, "2026-08-01T00:00:00.000000Z", "2026-08-01T00:00:00.000000Z", other_id),
    )

    ana_ids = queue_card_ids(review_seed.conn, review_seed.user_id, NOW, 50)
    other_ids = queue_card_ids(review_seed.conn, other_id, NOW, 50)
    assert private_id not in ana_ids
    assert private_id in other_ids
    assert seeded_cards[0] in other_ids
