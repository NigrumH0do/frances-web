import hashlib
import re

from frances.models.ids import (
    llm_cache_key,
    new_invite_id,
    new_secret_token,
    new_thread_id,
    new_topic_id,
    new_user_id,
    question_id,
    quiz_id,
    token_sha256,
    user_card_id,
)


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def test_ids_v2_shapes() -> None:
    assert re.fullmatch(r"u_[0-9a-f]{16}", new_user_id())
    assert re.fullmatch(r"inv_[0-9a-f]{16}", new_invite_id())
    assert re.fullmatch(r"th_[0-9a-f]{16}", new_thread_id())
    assert re.fullmatch(r"tp_[0-9a-f]{16}", new_topic_id())
    assert new_user_id() != new_user_id()
    assert len(new_secret_token()) >= 43 and token_sha256("abc") == _sha(b"abc")
    # norm_key: apóstrofo tipográfico y mayúsculas colapsan
    assert user_card_id("u_1", "l\u2019école", "vocab") == user_card_id("u_1", "L'école", "vocab")
    assert user_card_id("u_1", "x", "vocab") != user_card_id("u_2", "x", "vocab")
    assert re.fullmatch(r"uc_[0-9a-f]{16}", user_card_id("u_1", "x", "vocab"))
    assert llm_cache_key("sheet", "t", "v1", "m") != llm_cache_key("sheet", "t", "v2", "m")
    assert question_id("qz_a", 0) != question_id("qz_a", 1)


def test_ids_v2_exact_digests() -> None:
    assert quiz_id("topic", "tp_1", "h") == "qz_" + _sha(b"topic\x1ftp_1\x1fh")[:16]
    assert question_id("qz_a", 3) == "q_" + _sha(b"qz_a\x1f3")[:16]
    assert llm_cache_key("sheet", "txt", "v1", "m") == _sha(b"sheet\x1fv1\x1fm\x1ftxt")
    assert user_card_id("u_1", "x", "vocab") == "uc_" + _sha(b"u_1\x1fx\x1fvocab")[:16]
