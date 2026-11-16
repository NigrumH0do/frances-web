# ADR-017: AI-17 evalúa el LLM solo en sheet, topics, plan_why y chat

**Estado:** Aceptado (decisión del dueño, 2026-11-08)
**Tarea:** AI-17 (evaluación de calidad del LLM)
**Complementa:** ADR-016 (OneRouter / `qwen/qwen3.8-27b:free`)

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
