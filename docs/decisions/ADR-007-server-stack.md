# ADR-007: Stack del servidor (FastAPI, Uvicorn, argon2-cffi)

**Estado:** Aceptado
**Fecha:** 2026-11-02
**Contexto:** SRV-01 — dependencias del servidor v2 (plan P08). El servidor
corre en Linux aarch64 con CPython 3.12; toda dependencia necesita wheel
para esa plataforma (Global Constraints v2, «Dependencias y ARM»).

## Decisión

- **API:** `fastapi==0.162.0`, sin extras. `fastapi[standard]` arrastra
  `fastapi-cli`, `jinja2`, `python-multipart`, `email-validator`,
  `uvicorn[standard]` y otros paquetes que no se usan.
- **Servidor ASGI:** `uvicorn==0.54.0`, sin `[standard]` (nada de
  `uvloop`, `httptools`, `watchfiles` ni `websockets`). Usa `h11` y `click`,
  que ya estaban en el lock.
- **Contraseñas:** `argon2-cffi==25.1.0` con `argon2.PasswordHasher()` y sus
  parámetros por defecto (argon2id, perfil RFC 9106 de baja memoria).
  `argon2-cffi-bindings==26.1.0` se fija aparte porque es el paquete que
  trae los binarios.
- **SSE:** no se agrega `sse-starlette`. FastAPI trae
  `fastapi.sse.EventSourceResponse` desde 0.135.
- **Licencia MIT-0:** se acepta (Global Constraints v2). Es la licencia de
  `cffi`, que ya estaba en `uv.lock` por `cryptography` y ahora también la
  usa `argon2-cffi-bindings`. MIT-0 es MIT sin la cláusula de atribución.

## Paquetes nuevos en `uv.lock`

Re-verificado en PyPI el 2026-11-02 (versión, licencia y wheels del lock);
sin cambios respecto al plan.

| Paquete | Versión | Licencia | Wheel aarch64 | Nota |
|---|---|---|---|---|
| fastapi | 0.162.0 | MIT | `py3-none-any` | requiere starlette ≥ 0.46, pydantic ≥ 2.9, opentelemetry-api ≥ 1.44 |
| starlette | 1.10.0 (transitiva) | BSD-3-Clause | `py3-none-any` | `FileResponse` con `Range` |
| opentelemetry-api | 1.45.2 (transitiva) | Apache-2.0 | `py3-none-any` | |
| annotated-doc | 0.0.5 (transitiva, ya en el lock por typer) | MIT | `py3-none-any` | |
| uvicorn | 0.54.0 | BSD-3-Clause | `py3-none-any` | sin `[standard]`: h11 + click (ya en el lock) |
| argon2-cffi | 25.1.0 | MIT | `py3-none-any` | |
| argon2-cffi-bindings | 26.1.0 | MIT | `cp310-abi3-manylinux_2_26_aarch64` | |
| cffi | 2.1.1 (ya en el lock) | MIT-0 | `cp312-cp312-manylinux2014_aarch64` | ya llegaba por `cryptography` |

## Verificación

`scripts/check_aarch64_wheels.py [--lock uv.lock] [--python 3.12]` recorre
`uv.lock` y sale 1 con la lista de paquetes sin wheel aarch64 compatible.
Acepta `py3-none-any`, y `manylinux*_aarch64` con `cp312-cp312`,
`cp3XX-abi3` (XX ≤ 12) o `py3-none` (binarios que no usan la ABI de Python:
`ruff` y `pypdfium2`, que ya estaban en el lock). Corre en CI.
