# Documentación de Frances Classroom

Qué leer según lo que necesites. Lo **vigente** describe la app v2 y su evolución v3
(servidor propio, `ADRs 021–024`). Lo **histórico** describe la v1 (sitio estático
con bundle cifrado en R2 y Worker de Cloudflare), retirada en CHG-16 y CHG-21; se
guarda como registro de decisiones.

## Empezar

| Documento | Para qué |
|---|---|
| [`../README.md`](../README.md) | Qué hace la app, cómo correrla en local, configuración y comandos |
| [`../infra/README.md`](../infra/README.md) | Despliegue en el servidor con Docker y Caddy |
| [`../deploy/README.md`](../deploy/README.md) | Configuración de producción que se copia al servidor |
| [`PENDIENTES.md`](PENDIENTES.md) | Lo que falta, lo que decide el dueño y los límites conocidos |
| [`../AGENTS.md`](../AGENTS.md) | Reglas para agentes que trabajan en el repo |

## Diseño y planes

| Documento | Estado |
|---|---|
| [`superpowers/specs/2026-11-02-frances-v2-servidor-design.md`](superpowers/specs/2026-11-02-frances-v2-servidor-design.md) | **Vigente.** Spec v2: servidor, IA de estudio, gestión, rediseño |
| [`superpowers/plans/2026-11-02-00-v2-master-plan.md`](superpowers/plans/2026-11-02-00-v2-master-plan.md) | **Vigente.** Contratos, interfaces y reglas globales de la v2 |
| `superpowers/plans/2026-11-02-08…12-*.md` | Planes P08–P12 (servidor, rediseño, IA, gestión, go-live). P08–P11 están hechos; P12 espera las tareas humanas |
| [`superpowers/plans/tasks.yaml`](superpowers/plans/tasks.yaml) | Grafo de tareas (`uv run python scripts/tasks_check.py --waves`) |
| [`superpowers/plans/2026-11-06-manual-subagentes.md`](superpowers/plans/2026-11-06-manual-subagentes.md) | Cómo se repartió el trabajo entre agentes |
| [`design/v2/`](design/v2/README.md) | Maquetas HTML aprobadas (ADR-009); el estilo final cambió con ADR-018 |
| `superpowers/specs/2026-10-14-*.md`, `superpowers/plans/2026-10-14-*.md` | **Histórico (v1).** Lo que sigue en pie de la v1 lo dice la spec v2 |

## Decisiones (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| [001](decisions/ADR-001-edge-tts.md) | Voces y límites de Edge TTS | Aceptado |
| 002 | Voces jóvenes sintéticas (SPK-02) | Sin escribir: los valores son provisionales |
| [003](decisions/ADR-003-clone-engine.md) | Motor de clonación de voz | Aceptado, pero sin uso: la spec descarta clonar voces |
| [004](decisions/ADR-004-azure-phonemes.md) | Etiquetas de fonemas de Azure | Aceptado |
| 005 | OAuth con la cuenta de la universidad (SPK-05) | Sin escribir |
| [006](decisions/ADR-006-llm.md) | Primer proveedor del LLM | Reemplazado por 016 |
| [007](decisions/ADR-007-server-stack.md) | FastAPI, Uvicorn y argon2 | Aceptado |
| [008](decisions/ADR-008-llm-datos-curso.md) | Riesgo de mandar textos del curso al LLM | Aceptado |
| [009](decisions/ADR-009-maquetas-v2.md) | Maquetas v2 | Aceptado |
| 010–014 | Go-live: instancia, secretos, primer despliegue, backfill, aceptación | Sin escribir: los firma el dueño en GOL-01…GOL-05 |
| [015](decisions/ADR-015-groq-llm.md) | LLM en Groq | Reemplazado por 016 |
| [016](decisions/ADR-016-onerouter-llm.md) | LLM en OneRouter | Aceptado |
| [017](decisions/ADR-017-ai17-rules-cards-quiz.md) | Evaluación del LLM sin tarjetas ni quiz | Aceptado; reemplazado en parte por [024](decisions/ADR-024-tarjetas-ia-lematizacion-y-temas.md): `--task cards` volvió al LLM (`cards-3`) y solo `quiz` sale 0 con reglas |
| [018](decisions/ADR-018-cahier-y-texto-libre.md) | Sistema visual «Cahier» y Texto libre | Aceptado |
| [019](decisions/ADR-019-ocr-rapidocr-y-office.md) | RapidOCR y lectura de Office | Aceptado |
| [020](decisions/ADR-020-sin-github-pages.md) | Sin GitHub Pages; solo el servidor | Aceptado |
| [021](decisions/ADR-021-login-google-y-aprobacion-admin.md) | Login web con Google y aprobación admin | Aceptado |
| [022](decisions/ADR-022-pool-multicuenta-azure.md) | Pool multicuenta Azure Speech y Translator | Aceptado |
| [023](decisions/ADR-023-cahier-atelier-3d-y-animaciones.md) | Sistema visual «Cahier Atelier 3D» y animaciones WebGL | Aceptado |
| [024](decisions/ADR-024-tarjetas-ia-lematizacion-y-temas.md) | Tarjetas IA v2/v3 (`cards-3` con notas pedagógicas), lematización y temas | Aceptado |

## Otros

| Documento | Para qué |
|---|---|
| [`../.agents/skills/cahier-3d-atelier/SKILL.md`](../.agents/skills/cahier-3d-atelier/SKILL.md) | Sistema visual «Cahier Atelier 3D», escenas Three.js y reglas de CSS/movimiento |
| [`../tests/fixtures/llm_eval/README.md`](../tests/fixtures/llm_eval/README.md) | Set sintético para evaluar las salidas del LLM |
| [`../contracts/`](../contracts/) | JSON Schema de la API y de los modelos (`frances schema export`) |
