# Spec v2 — Frances Classroom en servidor propio, con estudio guiado por IA

Estado: **aprobado por el dueño, 2026-11-02**. Reemplaza las decisiones D1, D2, D3, D7, D11
y D12 del spec v1 (`2026-10-14-frances-classroom-design.md`). Lo demás del v1
sigue vigente salvo que aquí se diga otra cosa.

> **Cambios posteriores a la aprobación** (el texto de abajo no se reescribió;
> mandan los ADR):
>
> - **LLM:** ya no es Kiosapi. ADR-015 pasó a Groq y ADR-016 a OneRouter
>   (`qwen/qwen3.8-27b:free`). Cualquier API compatible con OpenAI sirve vía
>   `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL`.
> - **Diseño:** ADR-018 (**Aceptado**, 2026-11-19) reemplaza la paleta y las
>   fuentes de §8 por el sistema «Cahier» (papel frío `#f7f7fb`, pizarra
>   `#121917`, tinta azul `#2b37b8`, Spectral y Lexend; ver
>   `web/src/design/tokens.css`) y agrega la sección «Texto libre» en Repasar:
>   texto propio → audio con Edge TTS (`POST /api/practice/tts`) → grabarse y
>   puntuar con Azure.
> - **Movimiento:** ADR-023 (**Aceptado**) amplía «Cahier» con «Cahier Atelier
>   3D»: escenas Three.js con carga diferida, movimiento CSS y preferencia
>   `frances.motion3d`, con equivalente editorial si no hay WebGL.
> - **Lectura del material:** ADR-019 (**Aceptado**, 2026-11-19) cambia el OCR a
>   RapidOCR (PP-OCRv6, sin red) con Tesseract `fra+spa` de respaldo, y agrega
>   texto de PowerPoint y Word. `frances coverage` dice qué archivos tienen
>   texto. El `Dockerfile` instala `libgomp1` para `onnxruntime` en ARM64.
> - **Publicación:** ADR-020 retira GitHub Pages. El único despliegue es el
>   servidor. El modo demo queda para el e2e y no se publica.
> - **Cuentas:** ADR-021 (**Aceptado**) agrega login web con Google OIDC (PKCE)
>   y aprobación por administrador; los correos de `FRANCES_ADMIN_EMAILS` entran
>   como admin y el resto queda `pending` hasta aprobación.
> - **Azure:** ADR-022 (**Aceptado**) añade el pool multicuenta cifrado con
>   `FRANCES_SECRETS_KEY`, failover por enfriamiento y medición de STT. La CSP de
>   Caddy usa `wss://*.stt.speech.microsoft.com` y ya no depende de la región.
> - **Tarjetas IA:** ADR-024 (**Aceptado**) devuelve `cards` al LLM con el prompt
>   `cards-3` (notas pedagógicas), lematización con spaCy y temas reeditables;
>   `quiz` sigue con reglas. Reemplaza en parte ADR-017.
> - **Retiro de la v1:** CHG-16 retiró la web v1 y **CHG-21 ya retiró el runtime
>   FRB1, R2 y el Worker de Cloudflare**; los fixtures sintéticos del demo
>   (`tests/fixtures/demo_state.sql` y `demo_audio/`) se conservan para el e2e.

## 1. Intención

La app deja de ser un sitio estático que lee un paquete cifrado diario. Pasa a
ser una app con servidor propio que:

1. sincroniza el Classroom, descarga y lee todo el material (ya existe);
2. con un LLM, convierte ese material en **qué estudiar**: resúmenes por clase,
   temas del curso, tarjetas, quizzes, un plan de estudio y un chat sobre el
   material;
3. guarda el progreso y las ediciones de cada usuario;
4. se ve y se usa bien en el teléfono.

## 2. Datos dados por el dueño (2026-11-02)

| Tema | Respuesta |
|---|---|
| Servidor | Instancia Oracle Cloud ARM (Ampere A1, aarch64) |
| Usuarios | El dueño y algunos compañeros del mismo curso |
| LLM | Sigue Kiosapi gratis (`glm-5.3-flash-free`, ADR-006) |
| Funciones IA | Tarjetas por publicación, temas del curso, plan de estudio, quizzes y ejercicios, chat con el material, resúmenes por clase |

## 3. Metas v2

- M1. Despliegue en un solo comando en la instancia ARM (`docker compose up -d`),
  con HTTPS automático.
- M2. Cuentas: un admin (el dueño) que invita compañeros con enlace de un solo
  uso. Cada usuario tiene su propio progreso FSRS, quizzes y ediciones.
- M3. El pipeline v1 (sync → fetch → extract → cards → phonemize → audio) corre
  en el servidor con un programador interno, no en GitHub Actions.
- M4. Capa de estudio IA (sección 6), toda generada en segundo plano y
  guardada; nada se genera al abrir una pantalla, salvo el chat.
- M5. Gestión de tarjetas y audios desde la app (sección 7).
- M6. Rediseño visual completo (sección 8).

## 4. No-metas v2

- Más de un curso de idioma o más de un Classroom fuente. Solo hay una cuenta
  de Google que sincroniza (la del dueño); los compañeros no conectan su Google.
- App nativa. Sigue siendo PWA.
- Modelos LLM locales. Kiosapi es el único proveedor; el contrato
  `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL` permite cambiarlo sin código.
- Grabar o clonar voces de personas (D8 sigue vigente).

## 5. Arquitectura

```
Internet ──HTTPS──> Caddy ──┬──> /        web (estáticos de Vite)
                            └──> /api/*   api (FastAPI, Python 3.12)
                                            │
                     worker (mismo código) ─┤  cola de trabajos en SQLite
                                            │
                                   /srv/frances/data
                                   ├── state.db  (SQLite, WAL)
                                   ├── blobs/    (PDF, imágenes)
                                   └── audio/    (MP3/Opus)
```

| Servicio | Qué hace | Imagen |
|---|---|---|
| `caddy` | HTTPS con Let's Encrypt, sirve `web/dist`, proxy a `api` | `caddy` oficial, `linux/arm64` |
| `api` | REST + SSE para el chat; sesiones con cookie | propia, `python:3.12-slim` arm64 |
| `worker` | Programador diario y cola de trabajos (pipeline + IA) | la misma imagen que `api`, otro comando |
| `backup` | Copia diaria de `state.db` (`sqlite3 .backup`) y de `blobs/` a Object Storage de Oracle | la misma imagen |

Decisiones:

- **D1'.** Los datos del curso viven solo en el disco del servidor
  (`/srv/frances/data`, fuera del repo). El repo sigue público y solo con
  fixtures sintéticos.
- **D2'.** El acceso se protege con cuentas y sesiones (cookie `HttpOnly`,
  `Secure`, `SameSite=Lax`; contraseña con argon2id). Se elimina el bundle
  cifrado FRB1 y el Worker de Cloudflare. El código de FRB1 queda solo para
  el demo de Pages hasta que se borre en una tarea CHG.
- **D3'.** SQLite directo en el disco (WAL) en vez del volcado `state.sql` en
  R2. Las migraciones siguen en `src/frances/db/migrations/`; las nuevas tablas
  entran con `0002_*`, `0003_*`… por tareas CHG.
- **D7'.** Todo corre en el servidor. Ya no se usan GitHub Actions para
  producción; Actions queda solo para CI.
- **D11'.** El worker corre el pipeline a las 05:17 de Bogotá y la
  reconciliación los domingos 06:00, igual que v1. El admin puede lanzarlo a
  mano desde la app.
- **D12'.** Secretos en `/srv/frances/.env` (permisos `600`, dueño root),
  leídos solo por `frances.config`. Nunca en el repo ni en logs.
- **Cola de trabajos.** Una tabla `jobs` en SQLite (tipo, payload, estado,
  intentos, `run_after`). Sin Redis: un solo worker basta para un curso.
  Reintentos con espera exponencial; un trabajo con 5 fallos queda `failed`
  y se ve en la pantalla de admin.
- **ARM.** Todas las dependencias deben tener wheel o build para `aarch64`.
  espeak-ng y ffmpeg vienen de los paquetes de Debian en la imagen. CI agrega
  un build `linux/arm64` con QEMU.

## 6. Capa de estudio IA

Todo usa el mismo cliente de CRD-04 (`LlmGenerator`): `json_schema` estricto,
`User-Agent` fijo, timeout amplio. Kiosapi tarda 12–29 s por llamada y no tiene
SLA, así que:

- toda generación (salvo el chat) es un trabajo en la cola, se guarda y se
  versiona por `sha256(entrada + prompt_version + modelo)`; si la entrada no
  cambia, no se vuelve a llamar;
- si el LLM falla, la app muestra lo que ya hay y el respaldo por reglas de v1
  para tarjetas; nunca una pantalla vacía;
- un límite diario de llamadas (`llm.max_calls_per_day`, por defecto 300) y un
  medidor en `usage`.

| Función | Unidad | Entrada | Salida guardada | Cuándo se genera |
|---|---|---|---|---|
| Resumen por clase | Publicación | Texto de la publicación + adjuntos extraídos | `StudySheet` ampliada: resumen, objetivos, vocabulario, gramática, frases clave, errores típicos | Al llegar o cambiar la publicación |
| Tarjetas | Publicación | Igual | Tarjetas v1 (`front_fr`, `back_es`, ejemplo, tipo) | Igual; ya existe en CRD-04/CRD-05 |
| Temas del curso | Curso | Resúmenes de todas las publicaciones + temas de Classroom (`topics.readonly`) | `Topic`: título, descripción, publicaciones y tarjetas ligadas, nivel MCER estimado | Tras cada sync con cambios; reagrupa todo el curso |
| Quizzes y ejercicios | Tema y publicación | Resumen + tarjetas del tema | Preguntas: opción múltiple, completar, traducir, ordenar frase, dictado (con audio) | Al crear o cambiar un tema |
| Plan de estudio | Usuario | Temas, fechas de entrega de Classroom, progreso FSRS y notas de quiz del usuario | Lista de hoy y de la semana: repasar X, hacer quiz Y, leer Z | Cada mañana por usuario, sin LLM (reglas); el LLM solo redacta el «por qué» opcional |
| Chat con el material | Pregunta | Pregunta + fragmentos recuperados | Respuesta en SSE con citas a la publicación y la página | En vivo, al preguntar |

**Recuperación para el chat.** Se indexan los bloques de texto extraídos
(v1 `TextBlock`) con SQLite FTS5 (BM25), con el tokenizador `unicode61` y
`remove_diacritics 2` para francés y español. Sin embeddings en v2.0: no hay
endpoint de embeddings garantizado en Kiosapi y FTS5 no agrega dependencias.
Se revisa en v2.1 si la calidad no alcanza. Cada respuesta debe citar al menos
un fragmento; si no hay fragmentos relevantes, responde que el material no lo
cubre.

**Calidad.** Cada prompt tiene `prompt_version` y un set de evaluación
sintético en `tests/fixtures/llm_eval/` (salidas esperadas que se validan con
el esquema y con reglas: el francés de `front_fr` está en francés, cada
tarjeta apunta a un fragmento real, etc.). Las pruebas que llaman al LLM real
llevan `@pytest.mark.heavy`.

## 7. Gestión desde la app

| Qué | Usuario | Admin |
|---|---|---|
| Tarjetas | Suspender, marcar «difícil», editar su copia personal, crear tarjetas propias | Editar la tarjeta compartida, borrarla, regenerar las de una publicación |
| Audios | Oír cada voz, elegir sus voces preferidas | Regenerar un audio, cambiar la voz por defecto, ver la cola de audio |
| Temas | Ver y filtrar | Renombrar, unir, dividir, mover publicaciones entre temas; las ediciones del admin se respetan en el siguiente reagrupado |
| Pipeline | — | Ver el último run, lanzarlo a mano, ver trabajos fallidos y reintentarlos |
| Usuarios | — | Invitar con enlace, quitar acceso |

Una edición del admin marca la fila con `edited_by_human = 1` y el pipeline no
la pisa. Si la fuente cambia, la app muestra «la publicación cambió» y ofrece
regenerar.

## 8. Rediseño visual

- Diseño móvil primero, con barra inferior de 5 secciones: **Hoy**, **Temas**,
  **Repasar**, **Chat**, **Más**.
- Un sistema de diseño propio en CSS (variables, modo claro y oscuro), sin
  librería de componentes pesada. El `web/src/ui/theme.css` sin commit del
  dueño se toma como punto de partida.
- Cada pantalla tiene sus estados de carga, vacío y error.
- Antes de codificar: maquetas de baja fidelidad de las 5 secciones, que el
  dueño aprueba.
- Accesibilidad: contraste AA, objetivos táctiles de 44 px, `prefers-reduced-motion`.

## 9. Privacidad y licencias

- El material del curso lo ven solo cuentas invitadas por el admin. Riesgo: el
  material es de la profesora; no se comparte fuera del grupo del curso.
- Los textos del curso se mandan a Kiosapi. Riesgo: Kiosapi es un tercero
  gratuito sin acuerdo de datos. Se documenta en un ADR y el admin puede poner
  `llm = "off"`.
- Las reglas de licencias de Global Constraints siguen igual. FastAPI, Uvicorn
  (BSD/MIT) y argon2-cffi (MIT) cumplen.

## 10. Presupuestos

| Recurso | Límite |
|---|---|
| Instancia | Siempre gratis de Oracle: hasta 4 OCPU y 24 GB RAM ARM, 200 GB de disco |
| LLM | 300 llamadas/día (configurable) |
| Respuesta del chat | Primer token en < 30 s; se muestra «pensando» mientras tanto |
| Pantallas (salvo chat) | < 300 ms en el servidor; leen datos ya generados |
| Backup | Diario, se guardan 14 días |

## 11. Riesgos

| Riesgo | Efecto | Plan |
|---|---|---|
| Kiosapi lento o caído | IA sin contenido nuevo; chat inutilizable | Cola con reintentos, contenido ya guardado, respaldo por reglas; el contrato permite cambiar de proveedor |
| Oracle reclama la instancia por inactividad | Servidor apagado | Mantener uso real; el backup diario permite rehacerla |
| Refresh token de Google revocado | Sin sync | El admin lo ve en la pantalla de pipeline; `frances auth check` diario |
| Disco lleno por audio | Pipeline falla | `frances doctor` avisa al 80 % |

## 12. Lo que solo el dueño puede decidir o hacer

1. Aprobar este spec (o cambiarlo).
2. Tener un dominio o subdominio que apunte a la IP de la instancia; abrir los
   puertos 80 y 443 en la Security List de Oracle y en el firewall de la
   instancia.
3. Crear el refresh token de Google (LIVE-01 v1, pasos 2–5 y 7) y las claves de
   Azure y Kiosapi, y escribirlos en `/srv/frances/.env`.
4. Aprobar las maquetas del rediseño.
5. Aceptar el riesgo de mandar textos del curso a Kiosapi (ADR).

## 13. Orden propuesto de planes

| Plan | Contenido | Depende de |
|---|---|---|
| P08 Servidor | Docker, Caddy, API base, cuentas, migraciones `0002`, worker y cola, backup | — |
| P09 Rediseño | Maquetas, sistema de diseño, 5 secciones conectadas a la API | P08 (API base) |
| P10 IA de estudio | Resúmenes, temas, quizzes, plan, chat con FTS5 | P08 |
| P11 Gestión | Edición de tarjetas, audios, temas, admin del pipeline | P08, P09, P10 |
| P12 Go-live | Despliegue en Oracle, datos reales, checklist de aceptación | Todos |

Las tareas v1 LIVE-02 y LIVE-03 se cancelan; LIVE-01 se reaprovecha en P12.
