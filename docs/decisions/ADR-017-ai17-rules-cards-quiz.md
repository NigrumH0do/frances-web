# ADR-017: AI-17 evalúa el LLM solo en sheet, topics, plan_why y chat

**Estado:** Aceptado (decisión del dueño, 2026-11-08)
**Reemplazado en parte por:** ADR-024 (2026-11-19): `--task cards` volvió al LLM con el prompt `cards-3`; solo `quiz` se evalúa con reglas y sale 0 sin cliente.
**Tarea:** AI-17 (evaluación de calidad del LLM)
**Complementa:** ADR-016 (OneRouter / `qwen/qwen3.8-27b:free`)

> **Actualización (ADR-024):** la decisión de `quiz` sigue vigente (reglas,
> `rules_questions`/`dictation_questions`, sale 0 sin construir el cliente).
> `cards` ya no se evalúa con reglas: ADR-024 devolvió esa tarea al LLM con el
> prompt `cards-3` y su evaluación real. El resto de este ADR no cambia.

## Decisión

- `AI-17` deja de pedir al LLM las tareas `cards` y `quiz`.
- `cards` se evalúa con el generador por reglas (`RulesGenerator`) y sus tests
  de `tests/cards/`.
- `quiz` se evalúa con `rules_questions`/`dictation_questions` y sus tests de
  `tests/study/test_quiz_rules.py`.
- `scripts/llm_eval.py --task all` corre solo `sheet`, `topics`, `plan_why` y
  `chat`. `--task cards` y `--task quiz` responden que se evalúan con reglas y
  salen 0 sin construir el cliente del LLM.

## Motivo

Los modelos free probados fallan la evaluación estricta de `cards` (anclaje de
tarjetas al material) y `quiz` (opciones/orden/traducciones). El producto ya
tiene respaldo por reglas y filtros que descartan tarjetas o preguntas
inválidas; exigir esas dos tareas al LLM convertía `AI-17` en un falso
negativo permanente y no representaba la configuración recomendada.

## Consecuencias

- La corrida real de `AI-17` mide lo que realmente se usa con LLM:
  fichas, temas, «por qué» del plan y chat.
- `cards` y `quiz` siguen cubiertos por sus tests unitarios y por el respaldo
  de la etapa; no se debilita ninguna aserción de calidad.
- El pipeline puede seguir usando LLM para `cards`, pero el gate de calidad de
  `AI-17` no depende de que el modelo gratis las acierte.
- Si en el futuro se contrata un modelo que pase `cards`/`quiz`, se puede
  revertir esta decisión con otra ADR.
