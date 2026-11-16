"""Reagrupado de las publicaciones del curso en temas de estudio (AI-07).

El plan del LLM se limpia y se reconcilia con los temas actuales antes de
escribirlo: las publicaciones y los temas que el admin editó
(``edited_by_human = 1``) no se renombran, no se unen, no se dividen y no
cambian de tema. Sin LLM (o si falla) se usa el respaldo por reglas, que agrupa
por tema de Classroom.

La entrada del LLM se lee en una lectura previa y la escritura corre en una
transacción propia: nunca hay una transacción abierta durante la llamada de red.
"""

import sqlite3
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import ValidationError

from frances.cards.llm import LlmUnavailable
from frances.log import redact
from frances.models.study import Cefr
from frances.stage import StageContext
from frances.study.llm_cache import JsonLlm, cached_json
from frances.study.prompts import PROMPT_VERSIONS, SYSTEM_PROMPTS, render_topics_input
from frances.study.quality import topics_problems
from frances.study.schemas import PromptItem, PromptTopic, TopicLlm, TopicsLlmOut
from frances.study.topics_repo import (
    CurrentTopic,
    PlannedTopic,
    TopicItemInfo,
    TopicPlan,
    apply_plan,
    load_items,
    load_topics,
    topic_input_hash,
)
from frances.textnorm import norm_key
from frances.timeutil import format_ts

OTHER_TOPIC = "Otros temas"
RULES_VERSION = "rules-1"

#: Problemas de ``topics_problems`` que ``merge_llm_plan`` repara antes de escribir.
_REPAIRABLE_PROBLEMS = (
    "id de publicación inventado",
    "id de publicación repetido",
    "publicación(es) sin tema",
    "publicación bloqueada fuera de su tema",
    "tema bloqueado ausente de la salida",
    "tema bloqueado con otro título",
)


@dataclass(frozen=True)
class TopicsRunResult:
    course_id: str
    changed: list[str]
    source: Literal["llm", "cached", "rules", "unchanged"]
    fallback_reason: str | None


@dataclass
class _Bucket:
    """Tema en construcción durante :func:`merge_llm_plan`."""

    id: str | None
    title: str
    description_es: str
    cefr: Cefr | None
    edited_by_human: bool
    item_ids: list[str]


def rules_plan(items: Sequence[TopicItemInfo], current: Sequence[CurrentTopic]) -> TopicPlan:
    """Respaldo sin LLM: conserva lo actual y agrupa lo nuevo por tema de Classroom."""
    item_by_id = {item.item_id: item for item in items}
    buckets: dict[str, list[str]] = {topic.id: [] for topic in current}
    assigned: set[str] = set()
    current_by_norm: dict[str, CurrentTopic] = {}
    for topic in current:
        current_by_norm.setdefault(norm_key(topic.title), topic)
        for item_id in topic.item_ids:
            if item_id in item_by_id and item_id not in assigned:
                buckets[topic.id].append(item_id)
                assigned.add(item_id)

    new_groups: dict[str, list[str]] = {}
    group_titles: dict[str, str] = {}
    for item in items:
        if item.item_id in assigned:
            continue
        if not item.classroom_topic:
            match = current_by_norm.get(norm_key(OTHER_TOPIC))
            if match is not None:
                buckets[match.id].append(item.item_id)
                assigned.add(item.item_id)
                continue
            key = norm_key(OTHER_TOPIC)
            new_groups.setdefault(key, []).append(item.item_id)
            group_titles.setdefault(key, OTHER_TOPIC)
            continue
        match = current_by_norm.get(norm_key(item.classroom_topic))
        if match is not None:
            buckets[match.id].append(item.item_id)
            assigned.add(item.item_id)
            continue
        key = norm_key(item.classroom_topic)
        new_groups.setdefault(key, []).append(item.item_id)
        group_titles.setdefault(key, item.classroom_topic)

    ordered: list[tuple[tuple[str, int, int, str], PlannedTopic]] = []
    for topic in current:
        item_ids = buckets[topic.id]
        if not item_ids and not topic.edited_by_human:
            continue
        ordered.append(
            (
                _sort_key(item_ids, item_by_id, 0, topic.position, topic.title),
                PlannedTopic(
                    id=topic.id,
                    title=topic.title,
                    description_es=topic.description_es,
                    cefr=topic.cefr,
                    item_ids=item_ids,
                    edited_by_human=topic.edited_by_human,
                ),
            )
        )
    for index, (key, item_ids) in enumerate(new_groups.items()):
        title = group_titles[key]
        ordered.append(
            (
                _sort_key(item_ids, item_by_id, 1, index, title),
                PlannedTopic(
                    id=None,
                    title=title,
                    description_es="",
                    cefr=None,
                    item_ids=item_ids,
                    edited_by_human=False,
                ),
            )
        )
    ordered.sort(key=lambda pair: pair[0])
    return TopicPlan(topics=[topic for _key, topic in ordered])


def merge_llm_plan(
    out: TopicsLlmOut,
    items: Sequence[TopicItemInfo],
    current: Sequence[CurrentTopic],
) -> TopicPlan:
    """Limpia el plan del LLM y lo reconcilia con el estado actual.

    Gana la primera aparición de cada publicación. Las publicaciones y los temas
    bloqueados vuelven a su sitio. Un tema del LLM continúa un tema actual por
    ``existing_topic_id`` o, si no, por solapamiento de publicaciones (Jaccard
    ≥ 0,5). Lo que el LLM omitió se queda donde estaba o cae en las reglas.
    """
    item_by_id = {item.item_id: item for item in items}
    known = set(item_by_id)
    current_by_id = {topic.id: topic for topic in current}
    matched: set[str] = set()

    item_topic: dict[str, str] = {}
    fixed_items: dict[str, str] = {}
    for topic in current:
        for item_id in topic.item_ids:
            if item_id in known:
                item_topic.setdefault(item_id, topic.id)
        if topic.edited_by_human:
            for item_id in topic.item_ids:
                if item_id in known:
                    fixed_items[item_id] = topic.id
        for item_id in topic.locked_item_ids:
            if item_id in known:
                fixed_items.setdefault(item_id, topic.id)

    states: list[_Bucket] = []
    state_by_id: dict[str, _Bucket] = {}

    def add_bucket(bucket: _Bucket) -> _Bucket:
        states.append(bucket)
        if bucket.id is not None:
            state_by_id[bucket.id] = bucket
            matched.add(bucket.id)
        return bucket

    def locked_bucket(topic: CurrentTopic) -> _Bucket:
        existing = state_by_id.get(topic.id)
        if existing is None:
            existing = add_bucket(
                _Bucket(
                    id=topic.id,
                    title=topic.title,
                    description_es=topic.description_es,
                    cefr=topic.cefr,
                    edited_by_human=True,
                    item_ids=list(topic.item_ids),
                )
            )
        return existing

    cleaned = _clean_llm_topics(out, known)
    for llm_topic, item_ids in cleaned:
        existing = (
            current_by_id.get(llm_topic.existing_topic_id)
            if llm_topic.existing_topic_id is not None
            else None
        )
        if existing is not None and existing.edited_by_human:
            locked_bucket(existing).item_ids.extend(
                item_id for item_id in item_ids if item_topic.get(item_id) in (None, existing.id)
            )
            continue
        if existing is not None and existing.id not in matched:
            add_bucket(
                _Bucket(
                    id=existing.id,
                    title=llm_topic.title,
                    description_es=llm_topic.description_es,
                    cefr=llm_topic.cefr,
                    edited_by_human=False,
                    item_ids=item_ids,
                )
            )
            continue
        candidate = _best_overlap(item_ids, current, matched, fixed_items)
        if candidate is not None:
            add_bucket(
                _Bucket(
                    id=candidate.id,
                    title=llm_topic.title,
                    description_es=llm_topic.description_es,
                    cefr=llm_topic.cefr,
                    edited_by_human=False,
                    item_ids=item_ids,
                )
            )
            continue
        add_bucket(
            _Bucket(
                id=None,
                title=llm_topic.title,
                description_es=llm_topic.description_es,
                cefr=llm_topic.cefr,
                edited_by_human=False,
                item_ids=item_ids,
            )
        )

    # Las publicaciones bloqueadas vuelven a su tema y no se pueden mover.
    for bucket in states:
        if bucket.id is None:
            bucket.item_ids = [item_id for item_id in bucket.item_ids if item_id not in fixed_items]
        else:
            bucket.item_ids = [
                item_id
                for item_id in bucket.item_ids
                if fixed_items.get(item_id, bucket.id) == bucket.id
            ]
    for item_id in sorted(fixed_items):
        fixed_topic_id = fixed_items[item_id]
        target_bucket = state_by_id.get(fixed_topic_id)
        if target_bucket is None:
            fixed_topic = current_by_id.get(fixed_topic_id)
            if fixed_topic is None:
                continue
            target_bucket = add_bucket(
                _Bucket(
                    id=fixed_topic.id,
                    title=fixed_topic.title,
                    description_es=fixed_topic.description_es,
                    cefr=fixed_topic.cefr,
                    edited_by_human=fixed_topic.edited_by_human,
                    item_ids=list(fixed_topic.item_ids),
                )
            )
        if item_id not in target_bucket.item_ids:
            target_bucket.item_ids.append(item_id)

    assigned = {item_id for bucket in states for item_id in bucket.item_ids}
    omitted = [item for item in items if item.item_id not in assigned]
    without_topic: list[TopicItemInfo] = []
    for item in omitted:
        current_topic_id = item_topic.get(item.item_id)
        if current_topic_id is None:
            without_topic.append(item)
            continue
        omitted_bucket = state_by_id.get(current_topic_id)
        if omitted_bucket is None:
            topic = current_by_id[current_topic_id]
            omitted_bucket = add_bucket(
                _Bucket(
                    id=topic.id,
                    title=topic.title,
                    description_es=topic.description_es,
                    cefr=topic.cefr,
                    edited_by_human=topic.edited_by_human,
                    item_ids=[],
                )
            )
        omitted_bucket.item_ids.append(item.item_id)
        assigned.add(item.item_id)

    for rule_topic in rules_plan(without_topic, current).topics:
        item_ids = [item_id for item_id in rule_topic.item_ids if item_id not in assigned]
        if not item_ids and not rule_topic.edited_by_human:
            continue
        rule_bucket = state_by_id.get(rule_topic.id) if rule_topic.id is not None else None
        if rule_bucket is None and rule_topic.id is None:
            key = norm_key(rule_topic.title)
            rule_bucket = next(
                (state for state in states if state.id is None and norm_key(state.title) == key),
                None,
            )
        if rule_bucket is None:
            rule_bucket = add_bucket(
                _Bucket(
                    id=rule_topic.id,
                    title=rule_topic.title,
                    description_es=rule_topic.description_es,
                    cefr=rule_topic.cefr,
                    edited_by_human=rule_topic.edited_by_human,
                    item_ids=[],
                )
            )
        rule_bucket.item_ids.extend(item_ids)
        assigned.update(item_ids)

    for topic in current:
        if topic.edited_by_human and topic.id not in state_by_id:
            add_bucket(
                _Bucket(
                    id=topic.id,
                    title=topic.title,
                    description_es=topic.description_es,
                    cefr=topic.cefr,
                    edited_by_human=True,
                    item_ids=[
                        item_id
                        for item_id in topic.item_ids
                        if item_id in known and item_id not in assigned
                    ],
                )
            )

    seen: set[str] = set()
    for bucket in states:
        unique: list[str] = []
        for item_id in bucket.item_ids:
            if item_id in known and item_id not in seen:
                seen.add(item_id)
                unique.append(item_id)
        bucket.item_ids = unique
    missing = known - seen
    if missing:
        raise ValueError(f"el plan dejó {len(missing)} publicación(es) sin tema")

    return TopicPlan(
        topics=[
            PlannedTopic(
                id=bucket.id,
                title=bucket.title,
                description_es=bucket.description_es,
                cefr=bucket.cefr,
                item_ids=bucket.item_ids,
                edited_by_human=bucket.edited_by_human,
            )
            for bucket in states
            if bucket.item_ids or bucket.edited_by_human
        ]
    )


def regroup_course(
    ctx: StageContext,
    llm: JsonLlm | None,
    course_id: str,
    *,
    allow_rules: bool,
) -> TopicsRunResult:
    """Reagrupa un curso entero a partir de sus publicaciones vivas.

    ``llm is None`` siempre escribe el plan por reglas. Si el LLM falla, escribe
    el respaldo cuando ``allow_rules`` es verdadero o el curso aún no tiene
    temas; en el primer caso devuelve el resultado y en el segundo relanza para
    que la cola decida el reintento (AI-13).
    """
    conn = ctx.store.conn
    items = load_items(conn, course_id)
    current = load_topics(conn, course_id)

    if llm is None:
        changed = _write_plan(ctx, course_id, rules_plan(items, current), "rules", RULES_VERSION)
        return TopicsRunResult(
            course_id=course_id,
            changed=changed,
            source="rules",
            fallback_reason="llm_off",
        )

    if _is_up_to_date(conn, course_id, items, current):
        return TopicsRunResult(
            course_id=course_id, changed=[], source="cached", fallback_reason=None
        )

    prompt_topics = [
        PromptTopic(
            id=topic.id,
            title=topic.title,
            description_es=topic.description_es,
            locked=topic.edited_by_human,
        )
        for topic in current
    ]
    item_topic = {item_id: topic.id for topic in current for item_id in topic.item_ids}
    locked_items = {item_id: topic.id for topic in current for item_id in topic.locked_item_ids}
    prompt_items = [
        PromptItem(
            id=item.item_id,
            title=item.title,
            classroom_topic=item.classroom_topic,
            summary_es=item.summary_es,
            tags=item.tags,
            current_topic_id=item_topic.get(item.item_id),
            locked=item.item_id in locked_items,
        )
        for item in items
    ]
    user_text = render_topics_input(prompt_topics, prompt_items)
    item_ids = [item.item_id for item in items]
    locked_titles = {topic.id: topic.title for topic in current if topic.edited_by_human}

    def accept(data: dict[str, Any]) -> list[str]:
        try:
            parsed = TopicsLlmOut.model_validate(data)
        except ValidationError:
            return ["salida con esquema topics inválido"]
        problems = topics_problems(parsed, item_ids, locked_items, locked_titles)
        return [
            problem
            for problem in problems
            if not any(marker in problem for marker in _REPAIRABLE_PROBLEMS)
        ]

    try:
        cached = cached_json(
            ctx.store,
            llm,
            task="topics",
            system=SYSTEM_PROMPTS["topics"],
            user=user_text,
            schema=TopicsLlmOut,
            prompt_version=PROMPT_VERSIONS["topics"],
            now=ctx.now,
            accept=accept,
        )
    except LlmUnavailable as exc:
        reason = redact(str(exc), ctx.env)
        result: TopicsRunResult | None = None
        if allow_rules or not current:
            changed = _write_plan(
                ctx, course_id, rules_plan(items, current), "rules", RULES_VERSION
            )
            result = TopicsRunResult(
                course_id=course_id,
                changed=changed,
                source="rules",
                fallback_reason=reason,
            )
        if not allow_rules:
            raise
        assert result is not None
        return result

    plan = merge_llm_plan(TopicsLlmOut.model_validate(cached.data), items, current)
    changed = _write_plan(ctx, course_id, plan, "llm", PROMPT_VERSIONS["topics"])
    if cached.hit:
        source: Literal["llm", "cached", "rules", "unchanged"] = "cached"
    elif changed:
        source = "llm"
    else:
        source = "unchanged"
    return TopicsRunResult(
        course_id=course_id, changed=changed, source=source, fallback_reason=None
    )


def regroup_all(
    ctx: StageContext, llm: JsonLlm | None, *, allow_rules: bool
) -> list[TopicsRunResult]:
    """Reagrupa cada curso incluido, en orden de id."""
    return [
        regroup_course(ctx, llm, str(row[0]), allow_rules=allow_rules)
        for row in ctx.store.conn.execute("SELECT id FROM courses WHERE included = 1 ORDER BY id")
    ]


def _write_plan(
    ctx: StageContext,
    course_id: str,
    plan: TopicPlan,
    generator: Literal["llm", "rules"],
    generator_version: str,
) -> list[str]:
    with ctx.store.tx() as conn:
        return apply_plan(
            conn,
            course_id,
            plan,
            generator=generator,
            generator_version=generator_version,
            now=format_ts(ctx.now()),
        )


def _is_up_to_date(
    conn: sqlite3.Connection,
    course_id: str,
    items: Sequence[TopicItemInfo],
    current: Sequence[CurrentTopic],
) -> bool:
    """True si los temas guardados ya corresponden a la entrada actual.

    Evita llamar al LLM cuando el sync no cambió ninguna publicación. Un tema
    bloqueado sigue contando: su ``input_hash`` también se actualiza al reagrupar.
    """
    live = {item.item_id for item in items}
    if not current:
        return not live
    if any(not topic.item_ids and not topic.edited_by_human for topic in current):
        return False
    assigned = [item_id for topic in current for item_id in topic.item_ids]
    if len(assigned) != len(set(assigned)) or set(assigned) != live:
        return False
    stored = {
        str(row[0]): (str(row[1]), str(row[2]))
        for row in conn.execute(
            "SELECT id, input_hash, generator_version FROM study_topics"
            " WHERE course_id = ? AND removed_at IS NULL",
            (course_id,),
        )
    }
    prompt_version = PROMPT_VERSIONS["topics"]
    return all(
        stored.get(topic.id) == (topic_input_hash(conn, topic.item_ids), prompt_version)
        for topic in current
    )


def _clean_llm_topics(
    out: TopicsLlmOut, known: Collection[str]
) -> list[tuple[TopicLlm, list[str]]]:
    """Quita ids inventados y repetidos; gana la primera aparición."""
    seen: set[str] = set()
    cleaned: list[tuple[TopicLlm, list[str]]] = []
    for topic in out.topics:
        item_ids: list[str] = []
        for item_id in topic.item_ids:
            if item_id in known and item_id not in seen:
                seen.add(item_id)
                item_ids.append(item_id)
        cleaned.append((topic, item_ids))
    return cleaned


def _best_overlap(
    item_ids: Sequence[str],
    current: Sequence[CurrentTopic],
    matched: Collection[str],
    fixed_items: Collection[str],
) -> CurrentTopic | None:
    """Tema actual no emparejado con mayor Jaccard (≥ 0,5) sobre ítems libres."""
    wanted = {item_id for item_id in item_ids if item_id not in fixed_items}
    best: CurrentTopic | None = None
    best_score = 0.0
    for topic in current:
        if topic.id in matched or topic.edited_by_human:
            continue
        existing = {item_id for item_id in topic.item_ids if item_id not in fixed_items}
        union = wanted | existing
        if not union:
            continue
        score = len(wanted & existing) / len(union)
        if score >= 0.5 and score > best_score:
            best = topic
            best_score = score
    return best


def _sort_key(
    item_ids: Sequence[str],
    item_by_id: dict[str, TopicItemInfo],
    is_new: int,
    index: int,
    title: str,
) -> tuple[str, int, int, str]:
    first_seen = min(
        (item_by_id[item_id].first_seen_at for item_id in item_ids if item_id in item_by_id),
        default="\uffff",
    )
    return (first_seen, is_new, index, title)
