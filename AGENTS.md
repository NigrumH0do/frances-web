# AGENTS.md — protocolo para agentes que construyen Frances Classroom

Lee en este orden: este archivo → `docs/superpowers/specs/2026-11-02-frances-v2-servidor-design.md` (spec v2, fuente de verdad) → `docs/superpowers/plans/2026-11-02-00-v2-master-plan.md` (contratos, interfaces y Global Constraints v2) → las decisiones v3 (`docs/decisions/ADR-021-*.md`…`ADR-024-*.md`, con migraciones `0005_google_auth.sql` y `0006_azure_pool.sql`) → el plan del subsistema de tu tarea (P08…P12). Si editas UI o escenas WebGL en `web/src/`, sigue `.agents/skills/cahier-3d-atelier/SKILL.md`. La spec y el plan maestro v1 (`2026-10-14-*`) siguen vigentes solo en lo que la v2/v3 no reemplaza. El índice de toda la documentación está en `docs/README.md`.

## Tomar una tarea

1. Elige una tarea de `docs/superpowers/plans/tasks.yaml` con `human: false` cuyas `deps` estén todas fusionadas en `main` y que nadie tenga reclamada (no hay issue con la etiqueta `claimed` ni PR abierto con su ID).
2. Reclámala: asígnate su issue `[<ID>] <título>` y ponle la etiqueta `claimed`. El issue lo crea `scripts/sync_issues.py`.
3. Trabaja en un worktree propio: `git worktree add ../wt-<ID> -b task/<ID>-<slug> origin/main`.
4. Un PR por tarea, con título `[<ID>] <título>`. Antes de pedir revisión puede ser draft.
5. Si en 48 h no hay commits, el reclamo caduca y otro agente puede tomar la tarea.

El trabajo que no sale de `tasks.yaml` (correcciones, mejoras pedidas por el dueño) va en una rama `fix/…` o `feat/…`, con un ADR en `docs/decisions/` si cambia una decisión de la spec.

## Reglas duras

- TDD: primero el test, verlo fallar, implementar, verlo pasar. Sigue los pasos del plan en orden.
- Solo tocas las rutas `owns` de tu tarea. Lees lo demás, no lo modificas.
- Los contratos (`src/frances/models/`, DDL en `src/frances/db/migrations/`, interfaces del plan maestro) no se cambian dentro de una tarea normal. Si uno no te alcanza: abre un issue `[CHG-<n>] <cambio>` con la propuesta y la lista de consumidores afectados, y detente. Un humano o el conductor lo aprueba; la tarea CHG actualiza contrato y consumidores en un solo PR.
- Nunca hay datos reales del Classroom en este repo, ni en tests, ni en fixtures, ni en logs. Todo fixture sale de `tests/fixtures/make_fixtures.py`. Los datos reales viven solo en el servidor (`/srv/frances/data`) o en la carpeta local fuera del repo.
- Nunca se commitea un secreto. Las variables sensibles (incluidas `FRANCES_SECRETS_KEY`, `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`, `FRANCES_ADMIN_EMAILS` y `FRANCES_FORWARDED_ALLOW_IPS`) están documentadas en el plan maestro y los ADRs; se leen solo en `frances.config`. `.env.example` e `infra/env.example` llevan solo valores de ejemplo.
- Sin red en los tests (`--disable-socket`). Lo que necesita red o modelos pesados va marcado `@pytest.mark.heavy`.
- Las dependencias van con versión exacta (`uv add pkg==X.Y.Z`; `npm install --save-exact`). Antes de agregar una, revisa la regla de licencias de Global Constraints. Una dependencia de Python nueva debe tener wheel `aarch64`: `uv run python scripts/check_aarch64_wheels.py`.
- No se desactivan hooks, lint ni checks de tipos para que algo pase.

## Revisión

Cada PR lo revisa un agente fresco, que no implementó la tarea, con esta lista:

1. ¿El PR implementa exactamente los pasos de la tarea y nada fuera de `owns`?
2. ¿Los nombres y tipos coinciden con el bloque **Interfaces** del plan y con el plan maestro?
3. ¿Se cumplen las Global Constraints?
4. Si la tarea tiene un ítem de Review Focus, ¿existe su test y prueba lo que dice?
5. ¿La Definition of Done está completa?

Veredicto: `APPROVE` o `REQUEST_CHANGES` con una lista numerada. Después de dos rechazos seguidos, la tarea vuelve a la cola con las notas del revisor. Solo un humano fusiona a `main`.

## Comandos

```bash
uv sync --all-groups
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
uv run python scripts/check_aarch64_wheels.py                                # después de tocar uv.lock
npm --prefix web ci
npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test
npm --prefix web run build && node web/scripts/check-no-demo.mjs web/dist   # build productivo sin demo
(cd web && npx playwright test -c playwright.v2.config.ts)                   # e2e v2
uv run frances schema export contracts/ && npm --prefix web run gen:types   # después de tocar modelos (solo tareas CHG)
uv run python scripts/tasks_check.py --waves                                 # validar el grafo y ver las tareas listas
uv run frances doctor && uv run frances coverage                             # estado del entorno y de la extracción de texto
```

## Tareas humanas

Las tareas con `human: true` las ejecuta el dueño del proyecto. Un agente puede preparar el material (guías, scripts, plantillas), pero no inventa sus resultados. Cada una deja un ADR o un checklist firmado en `docs/decisions/`.

Pendientes: SPK-02 (voces jóvenes), SPK-05 (OAuth de la universidad), LIVE-01 (Google en producción, se hace dentro de GOL-02) y GOL-01…GOL-05 (go-live en Oracle). LIVE-02 quedó cancelada con la v2. La lista con detalle está en `docs/PENDIENTES.md`.
