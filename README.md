# Frances Classroom

App personal para estudiar francés con el material de Google Classroom. Sincroniza
el curso, lee todos los archivos (PDF, PowerPoint, Word, imágenes), y con un LLM
convierte ese material en qué estudiar: fichas por clase, temas, tarjetas con audio,
quizzes, un plan diario y un chat que responde con citas. La práctica oral evalúa la
pronunciación sonido por sonido.

Corre en un servidor propio (API + worker) y se usa desde el teléfono como PWA.

> **Estado (2026-11-19):** la v3 («Cahier Atelier 3D», tarjetas IA `cards-3` con
> notas pedagógicas, login Google con aprobación admin y pool multicuenta Azure)
> funciona y está verificada en local. El despliegue en el servidor de
> producción está pendiente: son las tareas humanas GOL-01 a GOL-05. Lo que
> falta está en [`docs/PENDIENTES.md`](docs/PENDIENTES.md).

## Qué tiene la app

| Sección | Qué hace |
|---|---|
| **Hoy** | Plan del día (repasar, quiz, leer), próxima entrega de Classroom, brújula 3D de racha y actividad de la semana con cifras diarias |
| **Temas** | El curso agrupado en temas por el LLM. Cada tema tiene resumen, clases, tarjetas y quiz |
| **Publicación** | Texto de la clase, adjuntos (visor de PDF), ficha de estudio y tarjetas |
| **Repasar → Tarjetas** | Repaso espaciado con FSRS, audio en varias voces, «Más lento», reverso con recordatorio en francés/IPA/audio, ejemplos, notas pedagógicas (`cards-3`), editar tu copia y confeti WebGL al acertar |
| **Repasar → Pronunciación** | Orbe acústico 3D, frases del repaso de hoy o palabras por sonido (/ɑ̃/, /e/, /ʁ/…), anillo de puntaje, botón de audio por palabra y «Escucharme» |
| **Repasar → Texto libre** | Escribes en francés, el audio modelo se genera solo y te grabas para ver tu nota |
| **Chat** | Chips de inicio rápido y preguntas sobre el material (búsqueda con glosario ES→FR y citas con título legible de clase y página) |
| **Más** | Tema claro/oscuro, escenas 3D, tarjetas nuevas por día, voces preferidas, cuenta; **Administración** (usuarios/aprobaciones Google, invitaciones, pool Azure, pipeline, tarjetas, temas y audio) |

La interfaz usa el sistema visual **«Cahier Atelier 3D»**
([ADR-018](docs/decisions/ADR-018-cahier-y-texto-libre.md),
[ADR-023](docs/decisions/ADR-023-cahier-atelier-3d-y-animaciones.md)): papel
de cuaderno Seyès con tinta azul en claro, pizarra en oscuro y escenas WebGL
ligeras (`Three.js`, carga diferida con degradación limpia en CSS bajo
`prefers-reduced-motion` o sin WebGL). Funciona sin conexión para lo ya guardado y
cumple contraste AA y objetivos táctiles de 44 px.

## Cómo funciona

```
Google Classroom ─▶ sync ─▶ fetch ─▶ extract ─▶ cards ─▶ phonemize ─▶ audio
                                        │
                        cola de trabajos (worker)
                                        ├─▶ índice del chat (FTS5)
                                        ├─▶ fichas de estudio (LLM)
                                        ├─▶ temas del curso (LLM)
                                        ├─▶ quizzes (LLM o reglas)
                                        └─▶ plan diario por usuario (reglas)
                                                      │
                                     API FastAPI  ◀───┘  ─▶  PWA (React)
```

| Etapa | Qué hace | Comando |
|---|---|---|
| sync | Cursos, tareas, materiales, anuncios y temas de Classroom (incremental) | `frances sync` |
| reconcile | Recorrido completo semanal para detectar borrados | `frances reconcile` |
| fetch | Baja los adjuntos de Drive (hasta 50 MB) y exporta Docs/Slides | `frances fetch` |
| extract | Texto de PDF, Office e imágenes; OCR con RapidOCR y Tesseract de respaldo | `frances extract` |
| cards | Tarjetas por publicación con el LLM, o por reglas (spaCy + Azure Translator) | `frances cards` |
| phonemize | Pronunciación escrita (IPA) y sonidos de cada tarjeta | `frances phonemize` |
| audio | Audio de cada tarjeta con Edge TTS (Azure de respaldo) | `frances audio` |

Lo que hace el worker solo (hora de Bogotá):

| Hora | Trabajo |
|---|---|
| 04:30 | Backup de `state.db` y `blobs/` |
| 05:00 | Comprueba la autorización de Google |
| 05:17 | Pipeline diario; si hubo cambios, encola índice, fichas y temas |
| 05:45 | Plan del día de cada usuario |
| Domingo 06:00 | Reconciliación completa |

Cada generación con el LLM se guarda con una clave por entrada, versión de prompt y
modelo: si nada cambió, no se vuelve a pedir. Si el LLM falla, la app muestra lo que
ya había y usa el respaldo por reglas. Las ediciones de un humano nunca se pisan.

## Arquitectura

```
Internet ──HTTPS──▶ Caddy ──┬──▶ /        web (estáticos de Vite)
                            └──▶ /api/*   api (FastAPI)
                                             │
                    worker (mismo código) ───┤  cola de trabajos en SQLite
                                             │
                                    /srv/frances/data
                                    ├── state.db   (SQLite, WAL)
                                    ├── blobs/     (archivos del curso)
                                    ├── extractions/
                                    └── audio/
```

| Carpeta | Qué hay |
|---|---|
| `src/frances/sync`, `fetch`, `extract` | Classroom, Drive, lectura de archivos y OCR |
| `src/frances/cards`, `audio` | Tarjetas (`cards-3`), fonemas, voces y síntesis |
| `src/frances/azure` | Pool multicuenta Azure (cifrado Fernet, balanceo y failover Speech/Translator) |
| `src/frances/study` | Fichas, temas, quizzes, plan, chat, búsqueda y controles de calidad del LLM |
| `src/frances/api` | API REST + SSE, sesiones, login Google OIDC, cuentas y rutas de admin |
| `src/frances/jobs` | Cola, worker y programador |
| `src/frances/manage`, `accounts`, `backup`, `ops` | Gestión, usuarios, respaldo, `doctor` |
| `src/frances/models`, `db/migrations` | Contratos Pydantic y esquema SQLite (`0001`–`0006`) |
| `web/src/screens` | Pantallas de la PWA |
| `web/src/design` | Tokens, componentes y movimiento GPU (`motion.css`) de «Cahier Atelier 3D» |
| `web/src/three` | Escenas Three.js ligeras y carga diferida (`LazyScenes`) |
| `web/src/pron`, `media` | Grabación, evaluación, voces y reproductor |
| `.agents/skills/cahier-3d-atelier/` | Guía y restricciones del sistema visual y Three.js |
| `contracts/` | JSON Schema exportados; de ahí salen los tipos TypeScript |
| `infra/` | Dockerfile, compose y Caddy para producción |
| `deploy/` | `frances.toml` y `voices.yaml` de producción |
| `docs/` | Decisiones (ADR), specs, planes y pendientes |

## Requisitos

- **Python** 3.11–3.13 con [**uv**](https://docs.astral.sh/uv/).
- **Node.js** 22 con npm.
- **ffmpeg** y **espeak-ng** (audio y fonemas).
- Opcionales: **Tesseract** con `fra` y `spa` (respaldo del OCR) y **LibreOffice**
  (lee `.ppt` y `.doc` antiguos).

En Debian/Ubuntu:

```bash
sudo apt-get install -y ffmpeg espeak-ng tesseract-ocr tesseract-ocr-fra tesseract-ocr-spa
```

RapidOCR y sus modelos se instalan con las dependencias de Python; no necesitan red.

## Puesta en marcha local

1. Instala las dependencias:

   ```bash
   uv sync --all-groups
   npm --prefix web ci
   ```

2. Crea la carpeta de datos y su configuración:

   ```bash
   mkdir -p ../frances-data
   cp frances.example.toml ../frances-data/frances.toml
   ```

3. Copia el ejemplo de variables y llena los valores
   ([Configuración](#variables-de-entorno)). Git ignora `.env`:

   ```bash
   cp .env.example .env
   ```

   En local, el origen es el de Vite y la carpeta de datos es la del paso 2:

   ```bash
   FRANCES_PUBLIC_ORIGIN=http://localhost:5173
   FRANCES_DATA_DIR=/ruta/a/frances-data
   FRANCES_STATE_DB=/ruta/a/frances-data/state.db
   ```

4. En una terminal por proceso, con el `.env` cargado (`set -a; . ./.env; set +a`):

   ```bash
   uv run frances serve --host 127.0.0.1 --port 8765        # API
   uv run frances worker --data "$FRANCES_DATA_DIR"         # cola y programador
   npm --prefix web run dev                                 # web en http://localhost:5173
   ```

   Vite pasa `/api` a `127.0.0.1:8765`.

5. Crea el primer administrador (pide la contraseña):

   ```bash
   uv run frances admin create-user --data "$FRANCES_DATA_DIR" \
     --email tu@correo.com --name "Tu nombre" --role admin
   ```

6. Primera carga del curso. El worker corre el pipeline y después encadena el
   índice del chat, las fichas, los temas y los quizzes:

   ```bash
   uv run frances auth check
   uv run frances jobs enqueue pipeline.daily --data "$FRANCES_DATA_DIR"
   uv run frances jobs list --data "$FRANCES_DATA_DIR"
   ```

   Para revisar el resultado:

   ```bash
   uv run frances coverage --data "$FRANCES_DATA_DIR"   # qué archivos tienen texto
   uv run frances doctor --data "$FRANCES_DATA_DIR"     # tamaños, cuotas y pendientes
   ```

## Configuración

### `frances.toml`

Vive en la carpeta de datos. Sin el archivo, todo toma sus valores por defecto.
El ejemplo comentado es [`frances.example.toml`](frances.example.toml).

| Sección | Para qué |
|---|---|
| `classroom` | Qué cursos incluir y tamaño máximo de descarga |
| `cards` | LLM sí o no, publicaciones con LLM por día, palabras por publicación |
| `audio` | Voces fijas y rotativas, topes de Azure TTS |
| `translator` | Tope mensual del traductor de Azure |
| `server` | Sesiones, invitaciones, límite de login y de cuentas |
| `llm` | Encendido, llamadas por día (300) y tiempo máximo |
| `jobs` | Reintentos de la cola |
| `scheduler` | Horas de los trabajos diarios |
| `backup` | Hora, días que se guardan y prefijo del bucket |

### Variables de entorno

Los secretos **solo** van en variables de entorno; se leen en `frances.config` y
nunca se escriben en logs. Ejemplos: [`.env.example`](.env.example) para local e
[`infra/env.example`](infra/env.example) para producción.

| Variable | Para qué |
|---|---|
| `FRANCES_PUBLIC_ORIGIN` | Origen público de la web (`https://…`; `http` solo en `localhost`) |
| `FRANCES_DATA_DIR`, `FRANCES_STATE_DB` | Carpeta de datos y base SQLite |
| `FRANCES_FORWARDED_ALLOW_IPS` | IPs/CIDR de proxy de confianza (`172.28.0.0/24` en Compose; `127.0.0.1` en local) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Lectura de Classroom y Drive |
| `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET` | Login web opcional con Google OIDC (flujo PKCE en servidor) |
| `FRANCES_ADMIN_EMAILS` | Lista separada por comas de correos Google promovidos automáticamente a admin |
| `FRANCES_SECRETS_KEY` | Clave Fernet (32 bytes base64 urlsafe) para cifrar cuentas del pool Azure |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | LLM con API compatible con OpenAI; sin ellas, todo usa reglas |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Evaluación de pronunciación y TTS de respaldo (o pool en Admin) |
| `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` | Traducción de las tarjetas por reglas (o pool en Admin) |
| `FRANCES_BACKUP_*` | Bucket compatible con S3 para el backup (Oracle Object Storage) |

## Comandos

Todos se corren con `uv run frances …` y reciben `--data DIR`, salvo `serve`, que
lee `FRANCES_DATA_DIR`.

| Comando | Qué hace |
|---|---|
| `serve` | API en `/api/*` (migra la base al arrancar) |
| `worker` | Cola de trabajos y programador; `--once` hace un ciclo, `--check` revisa su salud |
| `run-daily` | Pipeline completo del día |
| `sync`, `reconcile`, `fetch`, `extract`, `cards`, `phonemize`, `audio` | Cada etapa por separado |
| `coverage` | Qué adjuntos tienen texto y por qué otros no (`--json`, `--all`) |
| `doctor` | Tamaños, cuotas, pendientes, voces y motores de OCR |
| `auth check` | Prueba el token de Google |
| `admin create-user`, `admin invite`, `admin disable` | Cuentas |
| `jobs enqueue`, `jobs list`, `jobs retry` | Cola de trabajos |
| `backup run`, `backup list`, `backup restore` | Respaldo |
| `dump`, `restore` | Volcado SQL determinista del estado |
| `schema export DIR` | JSON Schema de los contratos |

## Servicios externos y privacidad

| Servicio | Qué recibe |
|---|---|
| Google Classroom y Drive | Solo lectura del curso |
| Google OIDC (opcional) | Autenticación web con cualquier cuenta verificada; los registros nuevos quedan `pending` hasta aprobación admin ([ADR-021](docs/decisions/ADR-021-login-google-y-aprobacion-admin.md)) |
| Proveedor del LLM | Textos del curso (tarjetas, fichas, temas, quizzes, chat) — [ADR-008](docs/decisions/ADR-008-llm-datos-curso.md) |
| Edge TTS (Microsoft) | Texto de tarjetas y del «Texto libre» para hacer el audio |
| Azure Speech / Translator (pool) | Tu voz al evaluar la pronunciación (token temporal) y traducción/TTS de respaldo con failover entre cuentas ([ADR-022](docs/decisions/ADR-022-pool-multicuenta-azure.md)) |
| Oracle Object Storage | Copia diaria de la base y los archivos |

El OCR, el repaso FSRS y la búsqueda del chat corren en el servidor. Las notas de
pronunciación y la grabación de «Escucharme» se quedan en el navegador. El material
solo lo ven las cuentas activas invitadas o aprobadas por el admin. El repo nunca
tiene datos reales del curso: los fixtures salen de `tests/fixtures/make_fixtures.py`.

## Pruebas

```bash
# Python: sin red, cobertura mínima 85 %
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
uv run python scripts/check_aarch64_wheels.py

# Web y verificación de build productivo sin código demo
npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test
npm --prefix web run build && node web/scripts/check-no-demo.mjs web/dist

# e2e sobre el demo (Chromium y WebKit)
npx --prefix web playwright install chromium webkit
(cd web && npx playwright test -c playwright.v2.config.ts)
```

Las pruebas que necesitan red o modelos pesados llevan `@pytest.mark.heavy` y no
corren por defecto. Después de tocar modelos:

```bash
uv run frances schema export contracts/ && npm --prefix web run gen:types
```

## Demo local

`npm --prefix web run build -- --mode demo` arma la web sin servidor, con una
instantánea sintética de la API (`scripts/demo_api_snapshot.py`). Sirve para
el e2e. No se publica: la app solo se monta en el servidor
([ADR-020](docs/decisions/ADR-020-sin-github-pages.md)). Usuario del demo:
`demo@example.com` / `demo-demo-demo`.

## Producción

Un solo comando en el servidor (`docker compose up -d --build`), con HTTPS
automático. Preparación, secretos, primer admin y restauración:
[`infra/README.md`](infra/README.md).

## Documentación

Índice de specs, planes y decisiones: [`docs/README.md`](docs/README.md). Para
agentes que trabajan en el repo: [`AGENTS.md`](AGENTS.md).

## Licencia

[MIT](LICENSE)
