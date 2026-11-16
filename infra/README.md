# Infraestructura de Frances Classroom v2

Cuatro servicios sobre `/srv/frances`:

| Servicio | Imagen | Qué hace |
|---|---|---|
| `caddy` | `infra/Dockerfile` target `web` | HTTPS con Let's Encrypt, sirve `web/dist` y proxya `/api/*` |
| `api` | target `app` | FastAPI + SSE, sesiones por cookie |
| `worker` | target `app` | Programador y cola de trabajos |
| `backup` | target `app` | Copia diaria de `state.db` y `blobs/` a Object Storage |

Solo `caddy` publica los puertos 80 y 443 (TCP y UDP). `api` escucha en la red
interna de compose y no monta secretos en `caddy`.

## Qué trae la imagen `app`

| Pieza | Origen | Para qué |
|---|---|---|
| espeak-ng | `apt` | IPA de las tarjetas |
| ffmpeg | `apt` | Convertir y ajustar el tono de los audios |
| sqlite3 | `apt` | Inspección y restauración manual |
| tesseract-ocr con `fra` y `spa` | `apt` | OCR de respaldo (ADR-019) |
| RapidOCR y ONNX Runtime | wheels de `uv.lock` | OCR principal; los modelos PP-OCRv6 vienen dentro del paquete y no se descargan (unos 110 MB) |
| python-pptx, python-docx, pypdfium2 | wheels de `uv.lock` | Texto de PowerPoint y Word, y páginas de PDF a imagen para el OCR |

La imagen **no** trae LibreOffice: los `.ppt` y `.doc` antiguos (no OOXML) quedan
sin texto y `frances coverage` los marca. El build de la imagen con RapidOCR aún no
se probó; los wheels `aarch64` sí (`scripts/check_aarch64_wheels.py`).

El LLM (tarjetas, fichas, temas, quizzes y chat) es OneRouter con
`qwen/qwen3.8-27b:free` según ADR-016. Cualquier API compatible con OpenAI sirve
cambiando `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL` en `/srv/frances/.env`.

## Preparación del servidor

```bash
sudo mkdir -p /srv/frances/data /srv/frances/caddy/data /srv/frances/caddy/config
sudo chown -R 10001:10001 /srv/frances/data
sudo install -m 600 -o root -g root infra/env.example /srv/frances/.env
sudo install -m 644 -o root -g root infra/caddy.env.example /srv/frances/caddy.env
```

Editar `/srv/frances/.env` con los valores reales (nunca se commitea) y
`/srv/frances/caddy.env` con el dominio, el correo de Let's Encrypt y la región
de Azure Speech. El clon del repo vive en `/srv/frances/app`; los contenedores
no montan ese directorio, solo se usa como contexto de build.

Copiar la configuración de producción al volumen de datos:

```bash
sudo install -m 644 -o 10001 -g 10001 deploy/frances.toml /srv/frances/data/frances.toml
sudo install -m 644 -o 10001 -g 10001 deploy/voices.yaml /srv/frances/data/voices.yaml
```

## Primer arranque

```bash
cd /srv/frances/app/infra
docker compose up -d --build
docker compose ps
```

El primer arranque crea `state.db` (WAL), pide el certificado a Let's Encrypt y
deja `api` sana cuando `GET /api/health` responde 200. Antes de arrancar deben
existir `/srv/frances/.env` y `/srv/frances/caddy.env`; `docker compose` falla
si faltan.

Crear el primer administrador:

```bash
docker compose run --rm api admin create-user --email dueno@example.org --name "Dueño" --role admin
```

La imagen usa `/data` como directorio de trabajo, así que el comando anterior
funciona sin `--data`; `--data /data` es equivalente si se ejecuta el CLI desde
otro contexto. Después, las invitaciones se crean desde la app
(`POST /api/admin/invites`).

Revisar el entorno y la primera carga:

```bash
docker compose run --rm api auth check   # el refresh token de Google sirve
docker compose run --rm api doctor       # tamaños, cuotas, voces, LLM y motor de OCR
docker compose run --rm api coverage     # qué archivos del curso tienen texto y cuáles no
```

`doctor` imprime una línea `ocr:` con los motores que sirven (`rapidocr`,
`tesseract`) y avisa si no queda ninguno; Tesseract sin el idioma `fra` no cuenta.
`coverage --json` da el mismo informe para scripts.

## Restauración desde backup

El procedimiento completo de `frances backup restore` está en la tarea SRV-12
del plan `docs/superpowers/plans/2026-11-02-08-servidor.md`. En el servidor:

```bash
docker compose run --rm backup backup restore
```

Restaura la copia más nueva y baja los blobs que falten. Usar `--key` para una
copia concreta y `--force` solo si se quiere reemplazar `state.db`.

## Proxy y X-Forwarded-For

`frances serve` (SRV-02) arranca uvicorn con `proxy_headers=True`. El comando
todavía fija `forwarded_allow_ips="*"` en el código; SRV-13 no puede cambiarlo
porque `src/frances/api/cli.py` está fuera de sus rutas. Para que ese `*` no
confíe en cualquier contenedor, `caddy` y `api` comparten solo la red `edge` y
ningún otro servicio está en ella: las cabeceras `X-Forwarded-For` solo pueden
llegar desde Caddy. Queda como seguimiento agregar `--forwarded-allow-ips` a
`frances serve` y pasar el CIDR de esa red desde compose.

## Verificación local (sin datos reales)

```bash
# Valida el compose; necesita que existan los env_file de /srv/frances.
docker compose -f infra/compose.yaml config -q

# Valida el Caddyfile con variables de ejemplo.
docker run --rm -e FRANCES_DOMAIN=localhost -e FRANCES_ACME_EMAIL=admin@example.org \
  -e AZURE_SPEECH_REGION=brazilsouth \
  -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.7 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Build multi-arch (en una máquina con Docker y QEMU).
docker buildx build --platform linux/arm64,linux/amd64 -f infra/Dockerfile --target app .
```

Si no existen los archivos de `/srv/frances`, `docker compose config -q`
falla antes de validar; crear los ejemplos con los comandos de preparación o
usar `--no-env-resolution` para validar solo la estructura.

## Lo que hace el dueño (spec v2 §12, tareas GOL-01…GOL-05)

1. Tener el dominio y abrir los puertos 80/443 en la Security List de Oracle y
   en el firewall de la instancia (GOL-01).
2. Crear el refresh token de Google (pantalla de consentimiento «In production»)
   y las claves de Azure, OneRouter y Object Storage, y escribirlos en
   `/srv/frances/.env` (GOL-02).
3. Primer despliegue, primera carga, backup y restauración de prueba (GOL-03 y
   GOL-04), y el checklist de aceptación (GOL-05).

Ya están aceptados el riesgo de mandar textos del curso al LLM (ADR-008) y las
maquetas del rediseño (ADR-009). Faltan por aprobar ADR-018 (diseño «Cahier») y
ADR-019 (RapidOCR). La lista completa está en
[`docs/PENDIENTES.md`](../docs/PENDIENTES.md).

Nunca se copian al repo ni a la imagen datos del curso, `.env`, `data/`,
`.venv` ni `node_modules` (ver `.dockerignore`).
