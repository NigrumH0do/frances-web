# Pendientes de Frances Classroom (v2)

Lo que falta para producción, lo que solo decide el dueño y los límites conocidos.
Actualizado el 2026-11-21. Marca cada casilla al resolverla y anota la decisión.

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
  «Testing» caduca a los 7 días), Azure Speech, Azure Translator, LLM y backup,
  además de las variables v3 de login Google y cifrado del pool Azure
  (`GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`,
  `FRANCES_ADMIN_EMAILS`, `FRANCES_SECRETS_KEY`)
  → ADR-011.
- [ ] **GOL-03** Imágenes ARM construidas, HTTPS, primer admin y `frances auth check`
  → ADR-012.
- [ ] **GOL-04** Primera carga, `frances doctor`, `frances coverage`, backup y una
  restauración de prueba → ADR-013.
- [ ] **GOL-05** Checklist de aceptación → ADR-014.

## 2. Decisiones del dueño

- [x] **ADR-018 (Cahier y Texto libre):** aprobado (ampliado con Cahier Atelier 3D en ADR-023; Spectral + Lexend autoalojadas bajo `font-src 'self'`).
- [x] **ADR-019 (RapidOCR y Office):** aprobado para OCR local y extracción de PowerPoint y Word.
- [ ] **SPK-05 (ADR-005):** OAuth con la cuenta institucional de la universidad
  (Google Workspace UNAL): proyecto GCP, cliente OAuth en producción y refresh
  token de Classroom/Drive. `LIVE-01` depende de esta tarea y `GOL-02` reutiliza
  sus pasos 2–5 y 7; el ADR-005 sigue sin escribir.
- [ ] **Voces jóvenes (SPK-02, ADR-002):** escuchar las 4 voces sintéticas y fijar su
  tono. Hoy usan valores provisionales de `src/frances/audio/voices_default.yaml`.
- [ ] **Archivos de más de 50 MB:** subir `classroom.max_download_mb` o dejarlos
  fuera. Las carpetas de Drive enlazadas no se recorren.

## 3. Mejoras propuestas

| Tema | Qué falta | Por qué importa |
|---|---|---|
| Chat en español | Glosario de tarjetas ES→FR, lematización y chips iniciales integrados en ADR-024 (`CHG-22`) | Resuelto en v3 (`ADR-024`) |
| Fichas y tarjetas | Prompt `cards-3` (notas pedagógicas y contexto en frases), grounding lematizado con `spaCy`, respaldo de reglas si los sobrevivientes quedan vacíos y reverso enriquecido en `FlipCard` (`CHG-22` / `ADR-024`) | Resuelto en v3 (`ADR-024`) |
| Plan del día | Agregar práctica de pronunciación | Hoy el plan no la pide ni la cuenta |
| Proxy | `FRANCES_FORWARDED_ALLOW_IPS` configurado con la subred `172.28.0.0/24` de `edge` en `compose.yaml` | Resuelto en v3 |

## 4. Sin probar

- Build de la imagen Docker con RapidOCR y ONNX Runtime (los wheels ARM sí se
  comprobaron con `scripts/check_aarch64_wheels.py`).
- e2e en WebKit (Safari) fuera de CI.
- La imagen no trae LibreOffice: los `.ppt` y `.doc` antiguos quedan sin texto en
  producción.
