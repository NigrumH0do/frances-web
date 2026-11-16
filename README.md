# Frances Classroom

App personal para estudiar francés con el material de Google Classroom. Sincroniza
el curso, lee todos los archivos (PDF, PowerPoint, Word, imágenes), y con un LLM
convierte ese material en qué estudiar: fichas por clase, temas, tarjetas con audio,
quizzes, un plan diario y un chat que responde con citas. La práctica oral evalúa la
pronunciación sonido por sonido.

Corre en un servidor propio (API + worker) y se usa desde el teléfono como PWA.

> **Estado (2026-11-16):** la v2 funciona completa en local. El despliegue en el
> servidor de producción está pendiente: son las tareas humanas GOL-01 a GOL-05.
> Lo que falta está en [`docs/PENDIENTES.md`](docs/PENDIENTES.md).

## Qué tiene la app

| Sección | Qué hace |
|---|---|
| **Hoy** | Plan del día (repasar, quiz, leer), próxima entrega de Classroom, racha y actividad de la semana |
| **Temas** | El curso agrupado en temas por el LLM. Cada tema tiene resumen, clases, tarjetas y quiz |
| **Publicación** | Texto de la clase, adjuntos (visor de PDF), ficha de estudio y tarjetas |
| **Repasar → Tarjetas** | Repaso espaciado con FSRS, audio en varias voces, «Más lento», editar tu copia |
| **Repasar → Pronunciación** | Frases del repaso de hoy o palabras por sonido (/ɑ̃/, /e/, /ʁ/…). Nota por frase, palabra y sonido; «Escucharme» |
| **Repasar → Texto libre** | Escribes en francés, el audio modelo se genera solo y te grabas para ver tu nota |
| **Chat** | Preguntas sobre el material; cada respuesta cita la clase y la página |
| **Más** | Tema claro u oscuro, tarjetas nuevas por día, voces preferidas, cuenta; **Administración** para el admin |

La interfaz usa el sistema visual «Cahier»: papel de cuaderno Seyès, tinta azul y
pizarra en modo oscuro ([ADR-018](docs/decisions/ADR-018-cahier-y-texto-libre.md)).
Funciona sin conexión para lo ya guardado y cumple contraste AA y objetivos táctiles
de 44 px.

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
| `src/frances/cards`, `audio` | Tarjetas, fonemas, voces y síntesis |
| `src/frances/study` | Fichas, temas, quizzes, plan, chat, búsqueda y controles de calidad del LLM |
| `src/frances/api` | API REST + SSE, sesiones, cuentas y rutas de admin |
| `src/frances/jobs` | Cola, worker y programador |
| `src/frances/manage`, `accounts`, `backup`, `ops` | Gestión, usuarios, respaldo, `doctor` |
| `src/frances/models`, `db/migrations` | Contratos Pydantic y esquema SQLite |
| `web/src/screens` | Pantallas de la PWA |
| `web/src/design` | Tokens y componentes CSS del sistema «Cahier» |
| `web/src/pron`, `media` | Grabación, evaluación, voces y reproductor |
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

3. Crea un archivo `.env` **fuera del repo** con las variables de
   [Configuración](#variables-de-entorno). En local, el origen es el de Vite:

   ```bash
   FRANCES_PUBLIC_ORIGIN=http://localhost:5173
   FRANCES_DATA_DIR=/ruta/a/frances-data
   FRANCES_STATE_DB=/ruta/a/frances-data/state.db
   ```

4. En una terminal por proceso, con el `.env` cargado (`set -a; . /ruta/.env; set +a`):

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
nunca se escriben en logs. Lista completa: [`infra/env.example`](infra/env.example).

| Variable | Para qué |
|---|---|
| `FRANCES_PUBLIC_ORIGIN` | Origen público de la web (`https://…`; `http` solo en `localhost`) |
| `FRANCES_DATA_DIR`, `FRANCES_STATE_DB` | Carpeta de datos y base SQLite |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Lectura de Classroom y Drive |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | LLM con API compatible con OpenAI; sin ellas, todo usa reglas |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Evaluación de pronunciación y TTS de respaldo |
| `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` | Traducción de las tarjetas por reglas |
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
| Proveedor del LLM | Textos del curso (fichas, temas, quizzes, chat) — [ADR-008](docs/decisions/ADR-008-llm-datos-curso.md) |
| Edge TTS (Microsoft) | Texto de tarjetas y del «Texto libre» para hacer el audio |
| Azure Speech | Tu voz al evaluar la pronunciación (token de 10 min; la clave queda en el servidor) |
| Azure Translator | Texto de las tarjetas hechas por reglas |
| Oracle Object Storage | Copia diaria de la base y los archivos |

El OCR, el repaso FSRS y la búsqueda del chat corren en el servidor. Las notas de
pronunciación y la grabación de «Escucharme» se quedan en el navegador. El material
solo lo ven las cuentas que invita el admin. El repo nunca tiene datos reales del
curso: los fixtures salen de `tests/fixtures/make_fixtures.py`.

## Pruebas

```bash
# Python: sin red, cobertura mínima 85 %
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest

# Web
npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test

# e2e sobre el demo (Chromium y WebKit)
npx --prefix web playwright install chromium webkit
(cd web && npx playwright test -c playwright.v2.config.ts)
```

Las pruebas que necesitan red o modelos pesados llevan `@pytest.mark.heavy` y no
corren por defecto. Después de tocar modelos:

```bash
uv run frances schema export contracts/ && npm --prefix web run gen:types
```

## Demo

`npm --prefix web run build -- --mode demo` arma la web sin servidor, con una
instantánea sintética de la API (`scripts/demo_api_snapshot.py`). El workflow
`pages.yml` la publica en GitHub Pages al subir a `main`. Usuario del demo:
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
