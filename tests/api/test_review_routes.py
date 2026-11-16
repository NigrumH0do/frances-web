"""API de repaso (UI-05): cola, reseñas FSRS, banderas y aislamiento por usuario."""

import time
from typing import Any

from fastapi.testclient import TestClient

from tests.api._helpers_ui05 import (
    OTHER_EMAIL,
    T_EARLIER,
    T_REVIEW,
    Actor,
    Clock,
    next_of,
    put_prefs,
    put_state,
    review_body,
)

pytest_plugins = ("tests.api._helpers_ui05",)


def _queue_ids(client: TestClient) -> list[str]:
    response = client.get("/api/review/queue")
    assert response.status_code == 200, response.text
    return [str(card["id"]) for card in response.json()]


def test_review_validation_r38(user_client: TestClient, seeded_cards: list[str]) -> None:
    """REVIEW FOCUS P09-3: R-38 y la ventana de ``reviewed_at`` se validan en el servidor."""
    for bad in (
        next_of(stability=0),
        next_of(difficulty=11),
        next_of(due="2026-11-01T00:00:00.000Z"),
        next_of(last_review=None),
    ):
        response = user_client.post(
            "/api/reviews",
            json={
                "card_id": seeded_cards[0],
                "rating": 3,
                "reviewed_at": T_REVIEW,
                "next": bad,
            },
        )
        assert response.status_code == 400, bad
        assert response.json()["code"] == "bad_request"

    future = {
        "card_id": seeded_cards[0],
        "rating": 3,
        "reviewed_at": "2027-01-01T00:00:00.000Z",
        "next": next_of(last_review="2027-01-01T00:00:00.000Z", due="2027-01-04T00:00:00.000Z"),
    }
    assert user_client.post("/api/reviews", json=future).status_code == 400


def test_review_with_malformed_last_review_is_400(
    user_client: TestClient, seeded_cards: list[str]
) -> None:
    """R-38: un ``last_review`` que no es un timestamp es entrada inválida, no un 500."""
    body = review_body(seeded_cards[0])
    body["next"]["last_review"] = "no-es-fecha"
    response = user_client.post("/api/reviews", json=body)
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"


def test_review_replay_is_idempotent_and_out_of_order_is_409(
    user_client: TestClient, seeded_cards: list[str], db: Any
) -> None:
    """REVIEW FOCUS P09-3: misma ``reviewed_at`` no duplica; una más vieja es 409."""
    body = review_body(seeded_cards[0])
    first = user_client.post("/api/reviews", json=body)
    replay = user_client.post("/api/reviews", json=body)
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    assert db.execute("SELECT COUNT(*), MIN(state) FROM review_log").fetchone() == (1, 0)

    older = review_body(
        seeded_cards[0],
        reviewed_at=T_EARLIER,
        next_state=next_of(last_review=T_EARLIER),
    )
    response = user_client.post("/api/reviews", json=older)
    assert response.status_code == 409
    assert response.json()["code"] == "conflict"


def test_queue_due_first_then_new_capped_by_prefs(
    user_client: TestClient,
    user_id: str,
    seeded_cards: list[str],
    db: Any,
    clock: Clock,
) -> None:
    put_state(db, user_id, seeded_cards[3], due=clock.minus(hours=2))
    put_state(db, user_id, seeded_cards[4], due=clock.minus(hours=5))
    put_prefs(db, user_id, daily_new_cards=2)

    ids = _queue_ids(user_client)
    assert ids[:2] == [seeded_cards[4], seeded_cards[3]]
    assert len(ids) == 4


def test_queue_excludes_suspended_stale_removed_and_others_own_cards(
    two_users: tuple[Actor, Actor], seeded_cards: list[str], db: Any, clock: Clock
) -> None:
    ana, leo = two_users
    put_state(db, ana.user_id, seeded_cards[2], suspended=1)
    put_state(db, ana.user_id, seeded_cards[5], due=clock.minus(hours=1))
    db.execute("UPDATE cards SET stale = 1 WHERE id = ?", (seeded_cards[5],))
    put_state(db, ana.user_id, seeded_cards[3], due=clock.minus(hours=1))
    db.execute("UPDATE cards SET removed_at = ? WHERE id = ?", (T_REVIEW, seeded_cards[3]))

    private_id = "uc_" + "e" * 16
    db.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id)"
        " VALUES (?, 'vocab', 'privé', 'privado', 'user', '1', 0, ?, ?, ?)",
        (private_id, "2026-08-01T00:00:00.000000Z", "2026-08-01T00:00:00.000000Z", leo.user_id),
    )
    put_state(db, ana.user_id, private_id, due=clock.minus(hours=1))

    ids = _queue_ids(ana.client)
    assert seeded_cards[0] in ids
    assert seeded_cards[2] not in ids
    assert seeded_cards[3] not in ids
    assert seeded_cards[5] not in ids
    assert private_id not in ids


def test_queue_and_state_are_per_user(
    two_users: tuple[Actor, Actor], seeded_cards: list[str]
) -> None:
    """REVIEW FOCUS P09-10: cada usuario solo ve y escribe su propio estado."""
    ana, leo = two_users
    reviewed = ana.post("/api/reviews", json=review_body(seeded_cards[0]))
    assert reviewed.status_code == 200

    assert leo.get(f"/api/cards/{seeded_cards[0]}").json()["state"] is None
    assert seeded_cards[0] in _queue_ids(leo.client)
    assert leo.get("/api/review/queue").status_code == 200


def test_other_users_private_card_cannot_be_reviewed_or_flagged(
    two_users: tuple[Actor, Actor], db: Any
) -> None:
    """P09-10: una tarjeta propia de otro usuario responde 404, como si no existiera."""
    ana, leo = two_users
    private_id = "uc_" + "f" * 16
    db.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id)"
        " VALUES (?, 'vocab', 'secret', 'secreto', 'user', '1', 0, ?, ?, ?)",
        (private_id, T_REVIEW, T_REVIEW, leo.user_id),
    )
    assert ana.post("/api/reviews", json=review_body(private_id)).status_code == 404
    assert ana.patch(f"/api/cards/{private_id}/flags", json={"suspended": True}).status_code == 404


def test_flags_create_empty_state_and_survive_review(
    user_client: TestClient, seeded_cards: list[str]
) -> None:
    state = user_client.patch(
        f"/api/cards/{seeded_cards[1]}/flags", json={"suspended": True}
    ).json()
    assert state["suspended"] is True
    assert state["fsrs"]["state"] == 0
    assert state["fsrs"]["reps"] == 0
    assert seeded_cards[1] not in _queue_ids(user_client)

    reviewed = user_client.post("/api/reviews", json=review_body(seeded_cards[1]))
    assert reviewed.status_code == 200
    assert reviewed.json()["suspended"] is True
    assert reviewed.json()["flagged_hard"] is False


def test_flags_require_at_least_one_field(user_client: TestClient, seeded_cards: list[str]) -> None:
    response = user_client.patch(f"/api/cards/{seeded_cards[1]}/flags", json={})
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"


def test_unsafe_methods_require_csrf(
    user_client: TestClient, seeded_cards: list[str], db: Any
) -> None:
    assert (
        user_client.patch(
            f"/api/cards/{seeded_cards[1]}/flags",
            json={"suspended": True},
            headers={"X-CSRF-Token": ""},
        ).status_code
        == 403
    )
    assert (
        user_client.post(
            "/api/reviews",
            json=review_body(seeded_cards[0]),
            headers={"X-CSRF-Token": ""},
        ).status_code
        == 403
    )
    assert db.execute("SELECT COUNT(*) FROM review_log").fetchone() == (0,)


def test_unknown_and_removed_cards_are_404(
    user_client: TestClient, seeded_cards: list[str], db: Any
) -> None:
    assert user_client.post("/api/reviews", json=review_body("no-existe")).status_code == 404
    db.execute("UPDATE cards SET removed_at = ? WHERE id = ?", (T_REVIEW, seeded_cards[2]))
    assert user_client.post("/api/reviews", json=review_body(seeded_cards[2])).status_code == 404
    assert (
        user_client.patch(
            f"/api/cards/{seeded_cards[2]}/flags", json={"suspended": True}
        ).status_code
        == 404
    )


def test_queue_under_300ms(user_client: TestClient, big_card_seed: None) -> None:
    started = time.perf_counter()
    response = user_client.get("/api/review/queue")
    elapsed = time.perf_counter() - started
    assert response.status_code == 200
    assert len(response.json()) == 50
    assert elapsed < 0.3


def test_review_queue_requires_session(user_client: TestClient) -> None:
    """R-33: las rutas nuevas están en la política de autorización."""
    anonymous = TestClient(user_client.app, base_url="https://testserver")
    try:
        assert anonymous.get("/api/review/queue").status_code == 401
        assert anonymous.post("/api/reviews", json=review_body("x")).status_code == 401
        assert anonymous.patch("/api/cards/x/flags", json={"suspended": True}).status_code == 401
    finally:
        anonymous.close()


def test_queue_never_leaks_another_users_private_card(
    two_users: tuple[Actor, Actor], db: Any
) -> None:
    """P09-10: la cola de Ana no expone la tarjeta privada ni el correo de Leo."""
    ana, leo = two_users
    private_id = "uc_" + "b" * 16
    db.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id)"
        " VALUES (?, 'vocab', 'secret de Léo', 'secreto de Leo', 'user', '1', 0, ?, ?, ?)",
        (private_id, "2026-08-01T00:00:00.000000Z", "2026-08-01T00:00:00.000000Z", leo.user_id),
    )
    payload = ana.client.get("/api/review/queue").text
    assert OTHER_EMAIL not in payload
    assert "secret de Léo" not in payload
    assert private_id not in payload
