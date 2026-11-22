# syntax=docker/dockerfile:1.12

# --- web: Vite corre en la arquitectura del builder, no se emula -----------------
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS web-build
WORKDIR /src
COPY web/package.json web/package-lock.json web/.npmrc ./web/
RUN --mount=type=cache,target=/root/.npm npm --prefix web ci
COPY web/ ./web/
COPY contracts/ ./contracts/
# `tsc --noEmit` también revisa los tests de web/src, que importan fixtures de
# tests/fixtures/ (fuera del contexto de build). La imagen no lleva tests.
RUN find web/src -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -delete \
    && VITE_BASE=/ npm --prefix web run build

# --- web: Caddy + estáticos ------------------------------------------------------
FROM caddy:2.11.7@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e AS web
COPY --from=web-build /src/web/dist /srv/web
COPY infra/Caddyfile /etc/caddy/Caddyfile

# --- app: API, worker y backup (la misma imagen, otro comando) -------------------
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS app

COPY --from=ghcr.io/astral-sh/uv:0.12.17@sha256:10787c682e4184e4f290de1171fd4703dc63de99221f10fe1c99002ce7fa9acc /uv /usr/local/bin/uv

# libgomp1 es la runtime OpenMP que exige onnxruntime (RapidOCR) en Debian slim ARM64.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        espeak-ng \
        ffmpeg \
        libgomp1 \
        sqlite3 \
        tesseract-ocr \
        tesseract-ocr-fra \
        tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy

WORKDIR /src
COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable \
    && rm -rf /src

# El CLI resuelve su directorio de datos por defecto con Path("."); /src ya no
# existe y con read_only no se puede crear .cache. /data es el volumen montado.
WORKDIR /data

RUN useradd --uid 10001 --create-home frances

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    FRANCES_DATA_DIR=/data

USER 10001:10001

ENTRYPOINT ["frances"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8000"]
