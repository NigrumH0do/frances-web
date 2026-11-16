# ADR-020: Sin GitHub Pages; la app solo vive en el servidor

**Estado:** Aceptado (decisión del dueño, 2026-11-16)
**Cancela:** OPS-06 (publicar la app y el demo en GitHub Pages)
**Complementa:** la spec v2, que ya sustituyó el sitio estático por el servidor propio

## Decisión

- No hay sitio en GitHub Pages. El único despliegue es el servidor
  (`caddy`, `api`, `worker`, `backup` sobre `/srv/frances`).
- Se retiran `.github/workflows/pages.yml` y `tests/ops/test_pages.py`.
- El modo demo (`vite build --mode demo` y `scripts/demo_api_snapshot.py`)
  sigue para el e2e local y el de CI (`e2e.yml`). No se publica.

## Consecuencias

- Un push a `main` ya no intenta crear un despliegue de Pages.
- `tests/ops/test_retired_v1.py` exige que el workflow y su test no existan.
- OPS-06 queda en el grafo con el título «CANCELADA (v2):» y `owns` vacío,
  igual que LIVE-02 y LIVE-03. CHG-14 y CHG-16 siguen dependiendo de ella.
- Los planes históricos que describen Pages se conservan como registro.
  Manda este ADR.
