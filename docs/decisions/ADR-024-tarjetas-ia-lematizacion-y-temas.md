# ADR-024: Generación de tarjetas IA v2, lematización con spaCy y evaluación de `cards`

**Estado:** Aceptado (2026-11-19)
**Tarea:** CHG-22 / AI-19
**Reemplaza en parte:** ADR-017 (reactiva `--task cards` en `llm_eval.py`; `quiz` sigue con reglas)

## Contexto

La versión `cards-1` generaba tarjetas pobres o desalineadas respecto al tema de la unidad porque:

1. `GenerationInput` no recibía el tema de Classroom (`topics.name`) ni el tema de estudio (`study_topics.title`).
2. `render_input` ordenaba bloques `[fr]`/`[mixed]` antes de `[es]`, de modo que un PDF largo en francés podía dejar fuera las consignas en español del docente, o viceversa.
3. El validador `grounded()` comparaba subcadenas literales sin artículos simples: rechazaba formas correctas como el infinitivo *voyager* cuando el texto decía *nous voyageons*, o plurales/contracciones frecuentes.
4. `LlmGenerator.generate` no pasaba por `llm_cache` ni tenía respaldo automático si todas las tarjetas generadas por el LLM caían en la validación de anclaje.
5. `scripts/llm_eval.py` había deshabilitado `--task cards` junto con `--task quiz` tras ADR-017.

## Decisión

- Se añaden los campos opcionales `classroom_topic` y `study_topic` a `GenerationInput` (inyectados desde `cards/input.py`), conservando estable `CardDraft` para compatibilidad estricta `strict: true`.
- Se sube el prompt de tarjetas a `CARDS_PROMPT_VERSION = "cards-2"` (`LlmGenerator.version = CARDS_PROMPT_VERSION`), enfocando vocabulario, frases y gramática en la preparación de evaluaciones del tema indicado y reservando hasta `MAX_ES_INPUT_CHARS = 2000` para instrucciones en español junto con prioridad para el contenido en francés.
- `study/quality.grounded` mantiene la búsqueda exacta como ruta rápida y añade respaldo por lemas en francés usando `fr_core_news_sm` (spaCy) y lista ampliada de artículos/contracciones/determinantes; `is_french` rechaza marcadores españoles explícitos (`¿`, `¡`, `ñ`, tildes exclusivas) incluso en frases de 1 a 2 palabras.
- `run_cards_with` y `manage/cards.regenerate_item` reutilizan `llm_cache` mediante `LlmGenerator.generate_cached` y, solo si tras filtrar el LLM quedan 0 tarjetas ancladas, respaldan las tarjetas con `RulesGenerator` preservando la ficha (`sheet`).
- Se reactiva `--task cards` en `scripts/llm_eval.py` manteniendo `--task quiz` con reglas.
- `search.search_blocks` amplía consultas en español hacia su equivalente en francés mediante un glosario pedagógico A1–A2 y las tarjetas ya enseñadas (`cards.back_es`), sin alterar la API pura de `query_tokens` ni `fts_query`.
- `CardView.source_titles` y `Citation.item_title` exponen los títulos legibles de las publicaciones para mostrarlos en Repasar y Chat.

## Consecuencias

- Las publicaciones ya generadas con `llm` v1 se actualizan automáticamente a `cards-2` al correr la etapa `cards`.
- No se rompe ningún contrato de salida JSON estricto (`cards_strict_schema_v1.json`) ni fixture v2 existente.

## Actualización (cards-3)

- Se sube `CARDS_PROMPT_VERSION = "cards-3"` manteniendo intacto el esquema `cards_strict_schema_v1.json`.
- El prompt ahora exige llenar `notes` con explicaciones breves y accionables para hispanohablantes (concordancia género/número, conjugación, elisión/contracción, registro o pista de pronunciación), pide contexto/variantes en tarjetas `phrase` cuando existen en el material, evita frases aisladas triviales y solicita de 1 a 3 `tags` temáticos en español.
- Todas las publicaciones generadas con `cards-2` (y las de respaldo `rules`) se actualizan automáticamente a `cards-3` al correr la etapa `cards`.
