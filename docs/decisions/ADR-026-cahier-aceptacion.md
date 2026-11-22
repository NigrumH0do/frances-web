# ADR-026: Acta de aceptación de Cahier Atelier 3D — Edición Definitiva

**Estado:** Pendiente de firma del dueño
**Tarea:** QA-04
**No reemplaza:** ADR-025 (la decisión de diseño sigue siendo la de GOV-01)
**Fecha de la medición:** 2026-11-22, 13:47–14:03 (UTC−5)
**SHA auditado:** `1c68aa194208c5b9967f85448c505b08956cbff7`
**Rama:** `NigrumH0do/qa-04-final`
**Base del diff protegido:** `fix/post-audit-f1-f4` (`847fbcb644c0c687ec26f165fe6346c140c51a04`)

## Contexto

Esta acta registra la matriz de QA-04 ejecutada en el SHA de arriba. El agente midió los comandos y dejó los huecos de firma vacíos. No modifica código, no llama a `POST /api/speech/usage` y no declara verde el paso `Smoke arm64` de GitHub Actions: en este SHA no hay corrida.

La preparación, fuera de la matriz, fue `uv sync --all-groups` (CPython 3.13.13, `.venv` local, sin cambios en archivos versionados). El enlace simbólico prescrito de `web/node_modules` hacia el árbol `Frontend` hizo que Vite negara `pdfjs-dist/build/pdf.worker.min.mjs` por quedar fuera del worktree. Esa primera corrida de Vitest (13:51:37, 107.48 s) salió **1**: 4 suites no cargaron (`AttachmentView.test.tsx`, `Publicacion.test.tsx`, `Publicacion.manage.test.tsx`, `PdfViewer.test.tsx`) y 771 tests de las suites que sí cargaron pasaron. Se materializó el mismo `node_modules` dentro del worktree con hardlinks, sin tocar el lock ni el código. El resultado de la tabla es esa segunda corrida.

## Matriz medida

### Python y contratos

| Comando | Exit | Resultado |
|---|---:|---|
| `uv run ruff check .` | 0 | `All checks passed!` |
| `uv run ruff format --check .` | 0 | `345 files already formatted` |
| `uv run mypy src` | 0 | `Success: no issues found in 148 source files` |
| `uv run pytest --no-cov -W error::ResourceWarning -q` | 0 | `1457 passed, 10 deselected, 3 warnings in 142.46s (0:02:22)` |
| `uv run python scripts/tasks_check.py --waves` | 0 | Olas 0–20; la última línea es `Ola 20 (1): QA-04` |
| `uv run frances schema export contracts/` | 0 | Reescribió los cuatro schema; el diff posterior está vacío |
| `npm --prefix web run gen:types` | 0 | `Tipos generados en web/src/contracts/generated.ts`; el diff posterior está vacío |
| `git diff --exit-code contracts web/src/contracts` | 0 | Sin diferencias |
| `uv run python scripts/check_aarch64_wheels.py` | 0 | stdout y stderr vacíos (el script usa CPython 3.12 por defecto y no imprime nada si todos los wheels pasan) |

Stdout íntegro de `scripts/tasks_check.py --waves`:

```text
Ola 0 (6): FND-01 SPK-01 SPK-02 SPK-04 SPK-05 SPK-06
Ola 1 (9): AGT-01 AI-18 BND-01 FND-02 FND-04 FND-05 OPS-09 SRV-01 WEB-01
Ola 2 (19): AUD-01 AUD-03 AUD-05 BND-03 CHG-05 CHG-07 CRD-02 CRD-04 EXT-01 EXT-02 EXT-03 FET-02 FND-03 OPS-04 PRN-01 SYN-02 SYN-05 UI-01 WEB-02
Ola 3 (17): AUD-02 AUD-04 BND-02 CHG-01 CHG-06 CRD-01 CRD-03 CRD-06 EXT-04 FET-01 OPS-03 OPS-07 PRN-04 SYN-01 SYN-03 UI-02 WEB-03
Ola 4 (19): AI-16 AUD-06 BUG-01 CHG-02 CHG-11 CRD-05 CRD-07 EXT-05 EXT-06 FET-03 LIVE-01 PRN-02 PRN-06 SYN-04 UI-03 WEB-04 WEB-06 WEB-10 WEB-12
Ola 5 (14): BND-04 CHG-03 CHG-12 CHG-15 EXT-07 PRN-03 PRN-07 SRV-02 SRV-03 SRV-05 SYN-06 WEB-07 WEB-08 WEB-09
Ola 6 (11): CHG-04 CHG-08 CHG-13 CHG-17 PRN-05 SRV-04 SRV-06 SYN-07 UI-04 WEB-05 WEB-11
Ola 7 (16): AI-01 AI-02 AI-04 AI-09 AI-10 CHG-09 CHG-18 CHG-19 CHG-23 OPS-02 SRV-08 SRV-10 UI-07 UI-11 UI-21 WEB-13
Ola 8 (9): AI-03 AI-05 CHG-24 OPS-01 OPS-05 SRV-07 SRV-09 UI-08 UI-10
Ola 9 (11): AI-07 AI-11 AI-12 CHG-10 LIVE-02 MGT-02 OPS-06 SRV-11 SRV-12 UI-05 UI-09
Ola 10 (17): AI-06 AI-08 AI-15 CHG-14 CHG-22 CHG-25 LIVE-03 MGT-01 MGT-03 SRV-13 UI-06 UI-12 UI-14 UI-15 UI-17 UI-18 UI-19
Ola 11 (9): AI-13 AI-14 AI-17 DS-01 MGT-04 MGT-05 SRV-14 UI-13 UI-16
Ola 12 (8): AI-19 GOL-01 MGT-06 MGT-07 MGT-08 PRACTICE-01 SHL-02 UI-20
Ola 13 (3): CHG-20 GOV-01 UI-22
Ola 14 (5): CHG-16 DS-02 DS-03 GL-01 GL-03
Ola 15 (7): CHG-21 DS-04 GL-04 GL-05 GL-06 GL-07 SHL-01
Ola 16 (8): GL-02 GOL-02 QA-02 SCR-03 SCR-04 SCR-07 SCR-08 SCR-09
Ola 17 (5): GOL-03 SCR-01 SCR-02 SCR-05 SCR-06
Ola 18 (2): GOL-04 QA-01
Ola 19 (2): GOL-05 QA-03
Ola 20 (1): QA-04
```

Los tres warnings de pytest no son `ResourceWarning` (por eso `-W error::ResourceWarning` sigue en 0): `PytestAssertRewriteWarning` sobre `tests.api._helpers_ui05`, `StarletteDeprecationWarning` de `httpx` con `starlette.testclient`, y `UserWarning` de `pytest-socket` (`socket.getaddrinfo`).

### Caminos protegidos

```bash
git diff fix/post-audit-f1-f4..HEAD -- src/frances/api/routes/speech.py src/frances/models src/frances/db/migrations contracts web/src/contracts
```

Exit 0. `git diff --name-only` sobre esos caminos devuelve **0** rutas. `speech.py`, los modelos, las migraciones y los dos árboles de contratos no cambiaron desde `fix/post-audit-f1-f4`.

### Web y presupuesto de three

| Comando | Exit | Resultado |
|---|---:|---|
| `npm --prefix web run lint` | 0 | ESLint en silencio y `All matched files use Prettier code style!` |
| `npm --prefix web run typecheck` | 0 | `tsc --noEmit` sin diagnósticos |
| `npm --prefix web test -- --maxWorkers=2` | 0 | `Test Files  125 passed (125)` / `Tests  792 passed (792)` / `Duration  102.61s` |
| `npm --prefix web run build` | 0 | `✓ built in 548ms`; precache PWA de 107 entradas (2916.25 KiB) |
| `node web/scripts/check-no-demo.mjs web/dist` | 0 | `Sin código demo en 114 archivos de …/web/dist.` |
| `THREE_BUDGET_STRICT=1 node web/scripts/check-three-budget.mjs web/dist` | 0 | `three assets/three-MiXgXZou.js gzip=142105 B objetivo=148480 tope=163840` |

`142105` B son **138.774 KiB**. El objetivo es 148480 B (145 KiB) y el tope es 163840 B (160 KiB). El tamaño queda **por debajo del objetivo**, así que `THREE_BUDGET_STRICT=1` sale 0 y **no hay desvío de 145–160 KiB** que el dueño tenga que aprobar. El reporter de Vite, con otro gzip, imprimió `three-MiXgXZou.js` en 143.67 kB; la compuerta usa zlib nivel 9 y manda la cifra de 142105 B.

### Playwright e2e v2

| Comando | Exit | Resultado |
|---|---:|---|
| `(cd web && npx playwright test -c playwright.v2.config.ts --grep-invert @stress)` | 0 | `76 passed (4.8m)`. Reloj de pared 287968 ms. Proyectos `mobile-chromium` y `mobile-webkit`, 2 workers |
| `(cd web && npx playwright test -c playwright.v2.config.ts --grep @stress --workers=1)` | 0 | `2 passed (1.4m)`. Chromium 23.5 s, WebKit 40.4 s. Reloj de pared 87071 ms |

El reporter de lista no imprimió la anotación `webkit-webgl-unavailable`. Los dos proyectos pasaron «perder el contexto WebGL muestra la brújula editorial».

### Docker: Smoke arm64

No se construyó la imagen en esta máquina. `gh run list --commit 1c68aa194208c5b9967f85448c505b08956cbff7` no devolvió ninguna corrida.

Antes de fusionar a `main`, el paso **`Smoke arm64`** del job `docker` en `.github/workflows/docker.yml` tiene que estar verde **en el SHA final del PR**. El paso hace:

```bash
docker buildx build --platform linux/arm64 --target app --load \
  -t frances-app:ci -f infra/Dockerfile .
docker run --rm --platform linux/arm64 frances-app:ci --help
docker run --rm --platform linux/arm64 --entrypoint python frances-app:ci \
  -c "import onnxruntime, rapidocr"
```

Esa casilla del checklist queda sin marcar.

## Decisiones D0

La misma lista que autorizó el diseño. Cada fila espera veredicto, fecha y firma del dueño. Este agente no las llena. El PR hacia `main` no se abre mientras alguna siga vacía o diga «Pide cambio».

| # | Decisión | Efecto si se aprueba | Aprueba / Pide cambio | Fecha | Firma del dueño |
|---|---|---|---|---|---|
| 1 | Paleta única y `--c-gold-3d` | Papel `#f8f6ed`, pizarra `#10131a`, tinta `#2147a3` / `#98b9fa`. El metal se llama `--c-gold-3d` (`#d3ac41` / `#d9b65e`), nunca `--c-brass`, y no entra en `color:`. | | | |
| 2 | Anillo de puntaje | Arco proporcional con el color de banda, cifra en `--c-text`, icono y palabra. No un `strokeDasharray` distinto sobre el mismo círculo que se anima. | | | |
| 3 | Refinamientos de SceneHost | `unmasked` es `WebGL2RenderingContext` \| `WebGLRenderingContext` \| `null`. El puntero de `window` ignora lo que no sea `mouse`. `resize()` solo cuando el techo DPR cambia. Al pasar de `mix > 0.999` se copia el color de destino. | | | |
| 4 | Frontera del 3D | Solo cuaderno, brújula, orbe y ráfaga. Publicación, Chat, Admin, Quiz, Temas, Ajustes y el volteo de `FlipCard` se quedan en DOM. Cero `react-three-fiber`, `drei` y motor de física. | | | |
| 5 | Secuencia | Tokens y movimiento antes que escenas. Cada tarea cierra en verde antes de mezclarse a la rama de integración. | | | |

## Checklist manual en hardware real

Playwright WebKit en este Ubuntu no sustituye estas tres comprobaciones. Quedan sin marcar.

- [ ] iPhone Safari: grabación en pronunciación (orbe activo, sin 3.er diálogo de micrófono), cambio de tema en caliente, y 10 ciclos Hoy → Repasar → Chat sin lienzo negro.
- [ ] Android y Escritorio: calibración visual de `NeutralToneMapping` (cobalto botón vs cuaderno).
- [ ] CI en PR a `main`: jobs Python, Web (con `check-three-budget`), `e2e`, `e2e-stress` y `docker.yml` `Smoke arm64` en verde.

## Avisos que no cambian el exit

- Vitest y el build de Vite avisan que `vite.config.ts` importa `./src/sw/pwaConfig` sin extensión (`configLoader: 'native'`).
- jsdom avisa `Not implemented: HTMLCanvasElement's getContext()` durante Vitest. La suite igual salió 0.
- El build de producción avisa de chunks por encima de 500 kB (`boot`, el SDK de Speech, `Publicacion` y `three`). La compuerta de three es la de gzip zlib, ya medida.
- Playwright avisa que `NO_COLOR` se ignora porque `FORCE_COLOR` está definido.
