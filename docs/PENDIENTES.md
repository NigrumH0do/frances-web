# Pendientes de Frances Classroom (v2)

Lo que falta para producción, lo que solo decide el dueño y los límites conocidos.
Actualizado el 2026-11-16. Marca cada casilla al resolverla y anota la decisión.

La lista de la v1 (R2, Worker de Cloudflare, GitHub Pages con bundle cifrado) quedó
sin efecto con la spec v2; su historia está en el git. El demo v2 tampoco se
publica en Pages ([ADR-020](decisions/ADR-020-sin-github-pages.md)): la app solo
vive en el servidor.

## 1. Go-live (tareas humanas del plan P12)

Pasos y comandos exactos en
[`superpowers/plans/2026-11-02-12-golive.md`](superpowers/plans/2026-11-02-12-golive.md)
e [`../infra/README.md`](../infra/README.md). Cada uno deja un ADR firmado.

- [ ] **GOL-01** Instancia Oracle ARM, puertos 80/443 en la Security List y en el
  firewall, y un dominio que apunte a su IP → ADR-010.
- [ ] **GOL-02** Secretos en `/srv/frances/.env` y `/srv/frances/caddy.env`:
  refresh token de Google (pantalla de consentimiento en «In production»; en
  «Testing» caduca a los 7 días), Azure Speech, Azure Translator, LLM y backup
  → ADR-011.
- [ ] **GOL-03** Imágenes ARM construidas, HTTPS, primer admin y `frances auth check`
  → ADR-012.
- [ ] **GOL-04** Primera carga, `frances doctor`, `frances coverage`, backup y una
  restauración de prueba → ADR-013.
- [ ] **GOL-05** Checklist de aceptación → ADR-014.

## 2. Decisiones del dueño

- [ ] **ADR-018 (Cahier y Texto libre):** aprobar el diseño. Las fuentes Spectral y
  Lexend tienen licencia OFL-1.1, que no está en la lista de licencias del plan
  maestro. Son archivos de fuente, no código; si no se aprueban, se quitan los dos
  `@import` de `web/src/design/index.css`.
- [ ] **ADR-019 (RapidOCR y Office):** aprobar el cambio de OCR y la lectura de
  PowerPoint y Word.
- [ ] **Voces jóvenes (SPK-02, ADR-002):** escuchar las 4 voces sintéticas y fijar su
  tono. Hoy usan valores provisionales de `src/frances/audio/voices_default.yaml`.
- [ ] **Archivos de más de 50 MB:** subir `classroom.max_download_mb` o dejarlos
  fuera. Las carpetas de Drive enlazadas no se recorren.

## 3. Mejoras propuestas

| Tema | Qué falta | Por qué importa |
|---|---|---|
| Chat en español | Ampliar la pregunta con el glosario de tarjetas, raíces de palabras e historial; si no hay resultados, que el LLM proponga palabras en francés | Hoy «qué profesiones hay» responde «no cubre» porque el material está en francés |
| Fichas | 2 de 42 publicaciones no pasan el control de frases clave y se quedan con la ficha básica | El LLM reescribe las frases y no coinciden con el texto |
| Plan del día | Agregar práctica de pronunciación | Hoy el plan no la pide ni la cuenta |
| Proxy | `frances serve` fija `forwarded_allow_ips="*"`; pasar el CIDR de la red `edge` desde compose | Ver `infra/README.md` |

## 4. Sin probar

- Build de la imagen Docker con RapidOCR y ONNX Runtime (los wheels ARM sí se
  comprobaron con `scripts/check_aarch64_wheels.py`).
- e2e en WebKit (Safari) fuera de CI.
- La imagen no trae LibreOffice: los `.ppt` y `.doc` antiguos quedan sin texto en
  producción.
