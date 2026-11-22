# ADR-026: Acta de aceptación de Cahier Atelier 3D — Edición Definitiva

**Estado:** Decisiones D0 aprobadas por el dueño — pendiente de verificación en hardware real y CI Smoke arm64
**Tarea:** QA-04 · actualización REM-06
**No reemplaza:** ADR-025 (la decisión de diseño sigue siendo la de GOV-01)
**Fecha de la medición:** 2026-11-22, 17:33–17:43 (UTC−5)
**SHA auditado:** `906ebe9a3a56e41ad6602a63011a94a3e39f6fc1` (incluye las remediaciones `REM-01`…`REM-05` posteriores a la validación E2E en vivo)
**Rama:** `NigrumH0do/rem-06-adr-026`
**Base del diff protegido:** `fix/post-audit-f1-f4` (`847fbcb644c0c687ec26f165fe6346c140c51a04`)

## Contexto

Esta acta registra la matriz de QA-04 re-ejecutada en el SHA de arriba, que ya incorpora `REM-01`…`REM-05`: los cinco arreglos que cerraron los hallazgos B1–B7 de la validación E2E en vivo (§ «Validación E2E en vivo»). El agente midió los comandos y dejó los huecos de firma vacíos. No modifica código, no llama a `POST /api/speech/usage` y no declara verde el paso `Smoke arm64` de GitHub Actions: en este SHA no hay corrida.

La acta anterior (QA-04) midió `1c68aa194208c5b9967f85448c505b08956cbff7` con 792 tests de Vitest y `76 + 2` de Playwright. Aquella corrida tropezó con el enlace simbólico prescrito de `web/node_modules` hacia el árbol `Frontend`: Vite negaba `pdfjs-dist/build/pdf.worker.min.mjs` por quedar fuera del worktree y 4 suites no cargaban. Aquí el mismo árbol se materializó dentro del worktree con hardlinks (`cp -al …/Frontend/web/node_modules web/node_modules`, 549 MB, sin tocar `package-lock.json` ni código) y se borró al terminar. La preparación fue `uv sync --all-groups` (CPython 3.13.13, `.venv` local). Ningún archivo versionado cambió salvo este ADR.

## Matriz medida

### Python y contratos

| Comando | Exit | Resultado |
|---|---:|---|
| `uv run ruff check .` | 0 | `All checks passed!` |
| `uv run ruff format --check .` | 0 | `345 files already formatted` |
| `uv run mypy src` | 0 | `Success: no issues found in 148 source files` |
| `uv run pytest --no-cov -W error::ResourceWarning -q` | 0 | `1461 passed, 10 deselected, 2 warnings in 193.52s (0:03:13)` |
| `uv run python scripts/tasks_check.py --waves` | 0 | Olas 0–20; la última línea es `Ola 20 (1): QA-04` |
| `uv run python scripts/check_aarch64_wheels.py` | 0 | stdout y stderr vacíos (el script usa CPython 3.12 por defecto y no imprime nada si todos los wheels pasan) |
| `git diff --exit-code fix/post-audit-f1-f4..HEAD -- src/frances/api/routes/speech.py src/frances/models src/frances/db/migrations contracts web/src/contracts` | 0 | 0 rutas: `speech.py`, los modelos, las migraciones y los dos árboles de contratos no cambiaron desde `fix/post-audit-f1-f4` |

Los dos warnings de pytest no son `ResourceWarning` (por eso `-W error::ResourceWarning` sigue en 0): `PytestAssertRewriteWarning` sobre `tests.api._helpers_ui05` y `StarletteDeprecationWarning` de `httpx` con `starlette.testclient`. El `UserWarning` de `pytest-socket` que la acta anterior anotaba ya no aparece en esta corrida.

Las filas `uv run frances schema export contracts/` y `npm --prefix web run gen:types` de QA-04 no se repitieron: la compuerta de caminos protegidos de arriba confirma que `contracts/` y `web/src/contracts/` no cambiaron desde `fix/post-audit-f1-f4`, así que los artefactos generados son los mismos.

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

### Web y presupuesto de three

| Comando | Exit | Resultado |
|---|---:|---|
| `npm --prefix web run lint` | 0 | ESLint en silencio y `All matched files use Prettier code style!` |
| `npm --prefix web run typecheck` | 0 | `tsc --noEmit` sin diagnósticos |
| `npm --prefix web test -- --maxWorkers=2 --testTimeout=20000` | 0 | `Test Files  125 passed (125)` / `Tests  811 passed (811)` / `Duration  122.98s` |
| `npm --prefix web run build` | 0 | `✓ built in 861ms`; precache PWA de 107 entradas (2918.84 KiB) |
| `node web/scripts/check-no-demo.mjs web/dist` | 0 | `Sin código demo en 114 archivos de …/web/dist.` |
| `THREE_BUDGET_STRICT=1 node web/scripts/check-three-budget.mjs web/dist` | 0 | `three assets/three-MiXgXZou.js gzip=142105 B objetivo=148480 tope=163840` |

La primera corrida de Vitest se hizo con `pytest` ocupando la máquina y salió `1 failed | 124 passed` en archivos y `1 failed | 810 passed` en tests: el único fallo fue `src/screens/texto/Texto.test.tsx > escribir genera el audio solo, con la voz preferida`, donde la lectura de `localStorage` del historial volvió vacía. El archivo, re-ejecutado solo, dio `11 passed (11)` y la corrida limpia sin carga concurrente dio `125 passed (125)` / `811 passed (811)` en 122,98 s. Se registra como fallo intermitente bajo carga concurrente, no como regresión reproducible en este SHA.

`142105` B son **138.774 KiB**. El objetivo es 148480 B (145 KiB) y el tope es 163840 B (160 KiB). El tamaño queda **por debajo del objetivo**, así que `THREE_BUDGET_STRICT=1` sale 0 y **no hay desvío de 145–160 KiB** que el dueño tenga que aprobar. El reporter de Vite, con otro gzip, imprimió `three-MiXgXZou.js` en 143.67 kB; la compuerta usa zlib nivel 9 y manda la cifra de 142105 B.

### Playwright e2e v2

| Comando | Exit | Resultado |
|---|---:|---|
| `(cd web && npx playwright test -c playwright.v2.config.ts e2e-v2/temas.e2e.ts e2e-v2/repasar.e2e.ts e2e-v2/chat.e2e.ts e2e-v2/hoy.e2e.ts e2e-v2/a11y.e2e.ts)` | 0 | `26 passed (3.5m)`: 13 en `mobile-chromium` y 13 en `mobile-webkit`, 2 workers |

La corrida **completa** de `e2e-v2` sobre `9e4aebe4` — la última anterior al ajuste CSS de `REM-05` — había dado `76 passed` (`--grep-invert @stress`) y `2 passed` (`--grep @stress --workers=1`). En `906ebe9a` esta acta re-ejecutó las cinco suites que cubren lo tocado por `REM-01`…`REM-05`: `temas`, `repasar`, `chat`, `hoy` y `a11y`, 26 tests, sin fallos. Las suites restantes del árbol no se repitieron aquí.

El reporter de lista no imprimió la anotación `webkit-webgl-unavailable`.

### Docker: Smoke arm64

No se construyó la imagen en esta máquina. `gh run list --commit 906ebe9a3a56e41ad6602a63011a94a3e39f6fc1` no devolvió ninguna corrida.

Antes de fusionar a `main`, el paso **`Smoke arm64`** del job `docker` en `.github/workflows/docker.yml` tiene que estar verde **en el SHA final del PR**. El paso hace:

```bash
docker buildx build --platform linux/arm64 --target app --load \
  -t frances-app:ci -f infra/Dockerfile .
docker run --rm --platform linux/arm64 frances-app:ci --help
docker run --rm --platform linux/arm64 --entrypoint python frances-app:ci \
  -c "import onnxruntime, rapidocr"
```

Esa casilla del checklist queda sin marcar.

## Validación E2E en vivo con `.env` local y cierre de hallazgos (B1–B7 + REM-05)

Instancia viva en `http://localhost:5173` sirviendo el `web/dist` productivo con la CSP de `infra/Caddyfile` (proxy Node) delante de FastAPI en `127.0.0.1:8765`, sobre una copia aislada con el `.env` real en `/tmp/frances-live-e2e/`. Navegador: Chromium real de Playwright con GPU `ANGLE (AMD, AMD Radeon Graphics (radeonsi renoir ACO), OpenGL ES 3.2)` sobre `/dev/dri/renderD128` (sonda con `failIfMajorPerformanceCaveat: true` concedida, nunca SwiftShader). Usuarios efímeros de QA. Evidencia: `/tmp/frances-live-e2e/report-reverify-{1,2,3}.md` y `results/rv1-*.json`, `results/rv2-*.json`. Sin secretos ni PII: las claves solo aparecen con la máscara que la propia UI muestra (`••••2b7c`).

| Hallazgo | Remediación | Evidencia medida |
|---|---|---|
| **B1** — el shell no hacía scroll (`main` con `clientHeight === scrollHeight`) y `.admin-subnav` se iba con el documento | `REM-01` | Rueda real (`page.mouse.wheel(0, 800)`) con el cursor sobre el contenido: `main.scrollTop` **0 → 800** (`clientHeight 800`, `scrollHeight 2956`). Gesto táctil CDP de 10 pasos (`y 640 → 150`, `x 195`) en móvil 390×844: **0 → 829**. `PageDown` con foco en `#main`: **800 → 1500**. `.admin-subnav` `position: sticky` en **+8 px** con el contenido desplazado (antes **−692 px**). Documento sin scroll (`body.scrollHeight 800`). 0 violaciones CSP, 0 `pageerror`, 0 HTTP ≥ 500 |
| **B2** — `setPointerCapture` de `FlipCard` se tragaba los clics de los controles internos | `REM-02` | Clic real de ratón en «Reproducir» → **1** `GET /api/audio` `200 audio/mpeg` de **11 756 B** (sonda `fetch` en la página), `<audio>` con `paused=false`, `readyState=4`, `currentTime 1.233 → 1.872 s`. Clic real en «Lento» → `aria-pressed="true"`, `playbackRate` **0.75** y **0** peticiones extra. Cara trasera, cambio de voz (`fr-FR-EloiseNeural`, URL distinta), enlace «Fuente», calificación (`POST /api/reviews` 200) y swipe de 70 px: **11/11 PASS** |
| **B3** — citas inline con numeración de fragmento (`[5]`, `[6]`) quedaban como texto plano | `REM-03` | Chat SSE real con Mistral DeepSeek (`deepseek-v4-1-flash-1017`), 4 respuestas `HTTP 200 text/event-stream`. Marcas guardadas renumeradas dentro de `1..citations.length` (`[1],[1]` con 1 cita; `[1],[1],[2],[1]` con 2), **0** marcas huérfanas `[5]`/`[6]`, `a.cite` clicables igual al número de marcas válidas y **0** marcas en texto plano. `CitationPopover` abre con `role="dialog"` y **0 warnings de React**; cada chip navega a su `item_id` y `.is-cited` se ve en `/publicaciones/…?pagina=2`. Hilo efímero borrado (204 → 404) |
| **B4 + B7** — hero de `Hoy` desbordaba en móvil y la racha decía «1 días» | `REM-01` | A **390 px** y **360 px**: `#main.scrollWidth − clientWidth` = **0 px** (antes **+32 / +62 px**, chip en `right 422`), `grid-template-columns` `358px` / `328px`, 0 elementos fuera del viewport. Chip **«racha · 1 día»** exacto con `streak_days 1`, `reviews_today 3`, `hasPluralOneDay false` en los tres anchos |
| **B5 + REM-05** — canvas PDF recortado o tapado, visor de imagen sin límite y ficha sticky sin recorrido | `REM-04`, `REM-05` | 3 PDFs reales con `paintedRatio 1.0`; **0 px** de recorte en móvil (`canvas 358 px = .pdf-page clientWidth`, `clipRightPx 0/0/0`); **0 px** de solapamiento con la ficha en escritorio (`canvas right 768,78 ≤ ficha left 792,80`). Imagen adjunta de **800 px** acotada a **358 px** (`right 374 ≤ 390`). Ficha sticky fija en **`top = 24 px`** durante el scroll: `scrollTop` 200/500/900 → `fichaTop` **24 / 24 / 24** mientras la columna izquierda sube a `splitTop 22 / −278 / −678`; prueba directa de pinzado `scrollTop 700 → 1000` con `top 24` constante. Los 24 px son los `top: var(--sp-4)` (16 px) declarados más los `padding-top: var(--sp-2)` (8 px) del scroller `.content` |
| **B6** — `useVoices` pedía `/api/voices` una vez por reproductor | `REM-04` | Resumen de un tema real con **127 reproductores** y 7 fichas: **1** `GET /api/voices` (200) + **1** `GET /api/me/prefs` del store compartido con caché `WeakMap`, frente a **~256** peticiones antes (127 + 129). Total **3** peticiones contando la lectura de preferencias de `SessionBootstrap` a 140 ms, ajena a `useVoices`: reducción ≈ **98,8 %**. Remontaje por navegación interna: **0 + 0**. 0 errores de consola, 0 `pageerror`, 0 5xx, 0 CSP |

Integraciones reales del `.env` verificadas en la misma instancia:

| Integración | Evidencia medida |
|---|---|
| Mistral DeepSeek SSE (`https://api.mistral.ai/v1`) | 4 respuestas `HTTP 200 text/event-stream; charset=utf-8` con citas renderizadas como chips (B3) |
| Azure Speech `westus` — token | `POST /api/speech/token` **200**, `region=westus`, `locale=fr-FR`, `tokenLength=756`, 1,77 s |
| Azure Speech `westus` — WSS y evaluación | 1 socket a `wss://westus.stt.speech.microsoft.com/stt/speech/universal/v2?language=fr-FR…`, 28 frames enviados / 6 recibidos, `speech.phrase` con `RecognitionStatus: Success` y `«Au Portugal.»` (SNR 62,07) → tarjeta **98 / Excelente** (exactitud 97, fluidez 100, completitud 100) con audio francés real de entrada |
| Azure TTS | `POST /api/practice/tts` **200**, `voice_id=fr-FR-DeniseNeural`, `duration_ms=3768`; `GET /api/audio/:key` **200 `audio/mpeg` 23 132 B** y reproducción real (`paused=false`, `currentTime 2,32 s` de 3,77 s, `readyState=4`) |
| RBAC | Rol `user` contra 5 endpoints de administración → **403 `forbidden`** en todos; **0** enlaces `/mas/admin` en la UI |
| Cifrado Fernet del pool Azure | Alta real (`POST …/azure/accounts` **201**) con respuesta sin `api_key` y `key_hint ••••2b7c`; en SQLite `key_ciphertext` de **120** caracteres con prefijo **`gAAAAA`** y sin clave en claro; recarga con la máscara persistente; borrado **200** y **0** filas del sintético. La clave usada es sintética de QA y nunca se envió a Azure |
| WebGL2 con GPU real | `AuthNotebookScene` y `StreakCompassScene` montan **1** canvas `webgl2` cada una con renderer AMD Radeon, `contextLost=false`, 0 overlays de fallback |
| Auditoría transversal | **0** HTTP ≥ 500, **0** `pageerror`, **0** `securitypolicyviolation`, y en `api.log`/`proxy.log` **0** `Traceback`, **0** `ERROR`, **0** `ResourceWarning`, **0** filtraciones de secretos; `PRAGMA quick_check` e `integrity_check` = `ok` |

Nota de método: el arnés `rv2_b5.mjs` conserva `pass: false` en dos aserciones. La de sticky compara el rect contra los 16 px declarados en CSS y no contra los 24 px reales (que son los medidos y los que cita la tabla); la de desborde móvil sigue viendo `#main.scrollWidth 435` frente a `390` por contenido de la ficha ajeno a los PDF y al visor de imagen, que ya aportan 0 px (`passCanvas: true`). Los valores crudos están en `/tmp/frances-live-e2e/results/rv2-b5.json`.

## Decisiones D0

La misma lista que autorizó el diseño. El dueño aprobó las cinco decisiones el **2026-11-22** y firmó cada fila; ninguna dice «Pide cambio». Queda pendiente únicamente marcar en el PR el checklist de hardware real y el CI `Smoke arm64` antes de fusionar a `main`: este agente no puede medir ni declarar verde ninguno de los dos.

| # | Decisión | Efecto si se aprueba | Aprueba / Pide cambio | Fecha | Firma del dueño |
|---|---|---|---|---|---|
| 1 | Paleta única y `--c-gold-3d` | Papel `#f8f6ed`, pizarra `#10131a`, tinta `#2147a3` / `#98b9fa`. El metal se llama `--c-gold-3d` (`#d3ac41` / `#d9b65e`), nunca `--c-brass`, y no entra en `color:`. | Aprueba | 2026-11-22 | NigrumH0do (aprobado en sesión) |
| 2 | Anillo de puntaje | Arco proporcional con el color de banda, cifra en `--c-text`, icono y palabra. No un `strokeDasharray` distinto sobre el mismo círculo que se anima. | Aprueba | 2026-11-22 | NigrumH0do (aprobado en sesión) |
| 3 | Refinamientos de SceneHost | `unmasked` es `WebGL2RenderingContext` \| `WebGLRenderingContext` \| `null`. El puntero de `window` ignora lo que no sea `mouse`. `resize()` solo cuando el techo DPR cambia. Al pasar de `mix > 0.999` se copia el color de destino. | Aprueba | 2026-11-22 | NigrumH0do (aprobado en sesión) |
| 4 | Frontera del 3D | Solo cuaderno, brújula, orbe y ráfaga. Publicación, Chat, Admin, Quiz, Temas, Ajustes y el volteo de `FlipCard` se quedan en DOM. Cero `react-three-fiber`, `drei` y motor de física. | Aprueba | 2026-11-22 | NigrumH0do (aprobado en sesión) |
| 5 | Secuencia | Tokens y movimiento antes que escenas. Cada tarea cierra en verde antes de mezclarse a la rama de integración. | Aprueba | 2026-11-22 | NigrumH0do (aprobado en sesión) |

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
