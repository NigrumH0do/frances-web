# Manual para subagentes de Frances Classroom v2

Fecha: 2026-11-06. Lo mantiene el conductor (la sesión que reparte tareas).

Este manual existe para que un subagente pueda tomar **un ticket** y terminarlo
solo, sin preguntarle nada al conductor, y sin repetir los errores que ya
cometieron otros subagentes. Léelo **entero** antes de empezar. Es largo a
propósito.

Orden de lectura obligatorio para cualquier ticket:

1. Este manual, secciones 1 a 9 (reglas, flujo, errores conocidos, decisiones).
2. `AGENTS.md` (raíz del repo).
3. `docs/superpowers/specs/2026-11-02-frances-v2-servidor-design.md` (spec v2 aprobado).
4. `docs/superpowers/plans/2026-11-02-00-v2-master-plan.md` (contratos, Global Constraints v2, reglas R-xx).
5. La sección `### Task <ID>` de tu plan (la ficha de la sección 12 te dice el archivo y la línea).
6. El código que tu tarea **consume** (lo nombra el bloque **Interfaces → Consumes** de tu tarea). Ábrelo y léelo; no adivines firmas.

Si algo de este manual choca con el plan de tu tarea, **gana el plan**, salvo
las decisiones de la sección 7, que ganan sobre el plan porque las tomó el
conductor después de escribirlo.

---

## 1. Dónde está todo (datos fijos)

| Cosa | Valor |
|---|---|
| Repo principal (NO TOCAR) | `/home/nigrumhodo/Escritorio/FrancesApp/Muy-bien-trabajo-MAIS-TOUT-VA-MAL` (rama `main`) |
| Rama de integración v2 | `v2/main` |
| Worktree de integración (solo el conductor fusiona aquí) | `/home/nigrumhodo/Escritorio/FrancesApp/wt-v2-main` |
| Worktree de tu tarea | `/home/nigrumhodo/Escritorio/FrancesApp/wt-<ID>` (ej. `wt-SRV-09`) |
| Rama de tu tarea | `task/<ID>-<slug>` creada desde `v2/main` |
| Planes | `docs/superpowers/plans/2026-11-02-08-servidor.md` (P08), `...-09-rediseno.md` (P09), `...-10-ia-estudio.md` (P10) |
| Grafo de tareas | `docs/superpowers/plans/tasks.yaml`, validador `scripts/tasks_check.py` |
| Maquetas aprobadas (ADR-009) | `docs/design/v2/` (`index.html`, `components.html`, `tokens.css`, `app.css`, `screens/*.png`) |
| ADR vigentes | `docs/decisions/ADR-006-llm.md`, `ADR-007-server-stack.md`, `ADR-008-llm-datos-curso.md`, `ADR-009-maquetas-v2.md` |
| Identidad git | `git -c user.name=NigrumH0do -c user.email=109390550+NigrumH0do@users.noreply.github.com commit ...` |
| Push | **Prohibido.** No hay credenciales. Nunca hagas `git push`. |
| Python | `uv` (versión local 0.12.17), Python 3.12 |
| Web | Node 22, `npm`, Vite, React 19, vitest, testing-library |

El conductor crea el worktree **antes** de lanzarte. Si tu worktree no existe,
**detente** y dilo (no lo crees en otro lugar, no trabajes en otro worktree).

---

## 2. Flujo paso a paso de un implementador

Sigue estos pasos en orden. No te saltes ninguno.

1. **Comprueba el worktree.** `cd /home/nigrumhodo/Escritorio/FrancesApp/wt-<ID> && git status -sb && git log --oneline -1`. Debe estar limpio y en tu rama.
2. **Lee** todo el «Orden de lectura obligatorio» del inicio de este manual. Anota en tu cabeza: rutas `owns`/`Create`/`Touches`, firmas del bloque **Interfaces**, mensaje de commit, **Review Focus**, **Definition of Done**.
3. **Mira lo que ya existe.** Busca con grep los módulos que consumes. Si una función que el plan dice que existe no existe, o tiene otra firma: **detente** (sección 4).
4. **Escribe primero el test** (Step 1 del plan). Copia los nombres de test del plan. Si el plan deja un test como `...`, escríbelo completo.
5. **Corre el test y míralo fallar** (Step 2). Debe fallar por la razón esperada (módulo inexistente, aserción), no por un error de sintaxis tuyo.
6. **Implementa** (Step 3) lo mínimo para cumplir el bloque **Produces**.
7. **Corre tus tests** (Step 4) hasta que pasen.
8. **Corre la verificación completa** (sección 3). Todo en verde.
9. **Repasa la lista de errores conocidos** (sección 6) contra tu diff. Arregla lo que aplique.
10. **Revisa que no tocaste nada fuera de tus rutas**: `git status -s` y `git diff --stat`. Si aparece `.coverage`, `web/dist/`, `node_modules/`, `.venv/` o un archivo que no es tuyo, sácalo del stage.
11. **Commit** con el mensaje exacto del plan y la identidad de la sección 1. Agrega solo tus archivos por nombre (`git add <rutas>`), nunca `git add -A`.
12. **Informe final** con el formato de la sección 9.

---

## 3. Comandos de verificación (cópialos tal cual)

### Python (toda tarea que toque `src/` o `tests/`)

```bash
uv sync --all-groups
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest
```

- `pytest` exige cobertura total ≥ 85 %. Si corres **un subconjunto** (`uv run pytest tests/api`), agrega `--no-cov` o falla por cobertura aunque los tests pasen.
- `pytest` modifica `.coverage`. Está en `.gitignore`; no lo agregues. Si sale como modificado: `git checkout -- .coverage`.
- Para repetir un test muchas veces: `for i in $(seq 20); do uv run pytest tests/x.py -q --no-cov || echo FALLO; done`. **No existe** `--count`.
- Si `ruff format --check` falla, corre `uv run ruff format <archivos tuyos>` y vuelve a verificar.

### Web (toda tarea que toque `web/`)

```bash
npm --prefix web ci
cd web && npx eslint . && npm run typecheck && npm test
```

- ESLint se corre **dentro de `web/`**. `npx --prefix web eslint web` desde la raíz **no funciona**.
- `npm run lint` (eslint + `prettier --check .`) puede fallar solo porque existe `web/dist/`. Si es solo eso, dilo en tu informe; no lo arregles (no es de tu tarea).
- Para formatear tus archivos: `npx prettier --write <archivos tuyos>` dentro de `web/`.
- `npm test -- src/screens/hoy` corre solo una carpeta.

### Contratos (solo tareas CHG que tocan `src/frances/models/`)

```bash
uv run frances schema export contracts/
npm --prefix web run gen:types
git diff --stat contracts/ web/src/contracts/
```

Después de regenerar, vuelve a correr las dos verificaciones de arriba.

---

## 4. Cuándo detenerte (y qué hacer)

Detente **sin hacer commit** y reporta con opciones (formato de la sección 9) si:

1. El plan contradice un test que ya existe en el repo y arreglarlo exige tocar un archivo fuera de tus rutas.
2. El plan contradice el plan maestro, otra tarea ya fusionada, o una decisión de la sección 7.
3. Una función, tabla, columna o tipo que el plan dice que existe no existe o tiene otra firma.
4. Necesitas una dependencia nueva que no está en el plan.
5. Tu worktree no existe, no está limpio al empezar, o está en otra rama.
6. Un comando de verificación falla por algo que no es tu código (y no es el caso `web/dist` de la sección 3).

**No** te detengas por cosas menores que el plan no fija (un texto, un orden, un nombre privado). Decide tú, hazlo bien y anótalo como desviación.

Al reportar un choque, da siempre **2 o 3 opciones concretas** y di cuál recomiendas y por qué. Si dejas trabajo sin commit, dilo y di en qué archivos está.

---

## 5. Reglas duras (romper una = rechazo seguro)

### Alcance
- Solo tocas las rutas de `owns`, `Create` y `Touches` de tu tarea. Puedes **leer** todo.
- Excepción: un `__init__.py` vacío que falte en un paquete o carpeta de tests nuevos (R-02). Anótalo.
- Las tareas CHG pueden cambiar contratos, pero solo los archivos de su **Touches**. Si un test viejo compara una lista exacta que tu CHG cambia, ese test es "consumidor afectado" (R-31) y puedes actualizarlo **sin debilitar** ninguna aserción. Anótalo como desviación.
- No refactorices ni "mejores" código que no es de tu tarea.

### TDD
- Primero el test, verlo fallar, implementar, verlo pasar. Cubre cada ítem del **Review Focus** con un test cuyo nombre lo diga.
- El nombre de un test debe decir lo que prueba. Un test llamado "X no aparece" que afirma que X aparece es un rechazo.
- Nada de esperas reales largas. El reloj se **inyecta** (`now: Callable[[], datetime]`). Para hilos usa `threading.Event`/`Barrier` con `wait(timeout)` corto, no bucles que cuentan iteraciones.

### Seguridad y datos
- **Ningún módulo nuevo lee `os.environ`.** El entorno se obtiene con `frances.config.process_env()` y las funciones de `frances.config` (`resolve_data_dir`, `resolve_state_db`, `public_origin`, `Settings.optional_secret`...).
- Nunca se loguea ni se devuelve: contraseñas, tokens, claves (Azure, LLM, R2, backup), cookies, emails completos, texto del curso, respuestas del LLM. Usa `frances.log.redact()` para todo texto de error que se guarda o loguea.
- Las respuestas de error de la API usan `ApiError` y nunca llevan traza, mensaje de excepción ni el cuerpo que mandó el cliente.
- Toda ruta `/api/*` exige sesión salvo las que el plan dice. Toda ruta no-GET exige CSRF (`X-CSRF-Token`) salvo login e invite/accept, que exigen `Origin`.
- Comparaciones de secretos/tokens/Origin: `hmac.compare_digest`.
- Rutas de archivo: nunca con texto del usuario. Solo `DataPaths.blob_path(sha)` con un sha que salió de la base.
- SQL siempre con parámetros `?`. Para FTS5 (`MATCH`), escapa la consulta del usuario (comillas dobles alrededor de cada término) para que operadores como `NEAR`, `*`, `"`, `(` no rompan ni inyecten.
- Ninguna transacción de escritura envuelve una llamada de red.
- Un usuario nunca ve datos de otro usuario (tarjetas propias, intentos, plan, chat).

### Fixtures y red
- Datos de prueba **sintéticos**. Nunca un nombre, texto o archivo real del Classroom.
- Tests sin red: Python con `--disable-socket` (ya activo) y `httpx` mockeado; web con `fetch` siempre mockeado.
- Las pruebas contra el LLM real llevan `@pytest.mark.heavy` (no corren en CI).

### Dependencias
- No agregues dependencias salvo que el plan lo diga. Si el plan lo dice: versión exacta (`uv add pkg==X.Y.Z` / `npm install --save-exact`), licencia MIT/BSD/Apache-2.0/ISC/MPL-2.0, wheel aarch64 (`uv run python scripts/check_aarch64_wheels.py` debe salir 0).

### Web
- Textos en español. Cada pantalla tiene su `strings.ts`; los comunes van en `web/src/l10n/`. No toques `web/src/i18n/es.ts` (es de v1).
- Estilos solo con clases y variables de `web/src/design/` (UI-02). Nada de colores fijos ni CSS suelto en `components/` o `screens/`.
- Accesibilidad: objetivos táctiles ≥ 44 px, foco visible, nombres accesibles, el color nunca va solo (siempre texto o icono), `aria-live`/`role="alert"` para avisos que cambian, `prefers-reduced-motion`.
- Cada pantalla tiene estados de **carga, vacío y error** (con «Reintentar»).
- La web v1 (`web/src/routes/`, `web/src/ui/`, `web/src/data/`) debe seguir pasando sus tests. No la modifiques salvo que tu tarea sea CHG-13/CHG-16.

---

## 6. Errores que ya cometieron otros subagentes (revisa tu diff contra esta lista)

Cada uno causó un `REQUEST_CHANGES`. Si tu tarea se parece, evítalo desde el principio.

| # | Error real | Tarea | Cómo evitarlo |
|---|---|---|---|
| 1 | `dump_sql` perdía el DDL de tablas virtuales FTS5 y sus triggers; tras restaurar, el buscador no existía | CHG-01 | Si tocas dump/restore, prueba un ida y vuelta real con FTS de contenido externo y un INSERT después |
| 2 | Un test agregaba a mano el DDL que debía venir de la migración, y así ocultaba el fallo | CHG-01 | Los tests usan las migraciones reales (`Store.open`), no copias |
| 3 | Un fragmento SQL final roto se descartaba sin error | CHG-01 | Todo lo que no se puede procesar lanza un error claro |
| 4 | Un test exigía `schema_version == [(1,)]` y se rompía con cada migración nueva | CHG-02 | Compara contra `range(1, LATEST_SCHEMA + 1)` |
| 5 | Tests insertaban en `cards`/`sheets` sin nombrar columnas y se rompieron al agregar columnas | CHG-04 | Siempre `INSERT INTO t (col1, col2...) VALUES (...)` |
| 6 | `accept_invite` decía «email ya registrado»: cualquiera con un enlace podía averiguar qué correos tienen cuenta | SRV-03 | Errores de cuentas idénticos para "no existe" y "ya existe" |
| 7 | Un `ValueError` en la CLI mostraba un traceback | SRV-03 | Errores de entrada como subclase de `FrancesError` para que `exit_with` los maneje |
| 8 | `touch_session` extendía sesiones vencidas | SRV-03 | Toda consulta de sesión filtra `revoked_at IS NULL AND expires_at > ?` |
| 9 | `app.py` leía `os.environ` | SRV-02 | Usa `frances.config.process_env()` |
| 10 | `/api/health` respondía 500 con una base dañada; solo capturaba `OperationalError` | SRV-02 | Captura `sqlite3.DatabaseError`; prueba con un archivo basura de 5000 bytes |
| 11 | El test de "no hay secretos en la respuesta" solo miraba la respuesta sana | SRV-02 | Prueba también las respuestas de error (503, 500, degradadas) |
| 12 | El heartbeat solo se escribía entre trabajos; uno largo marcaba el worker como muerto | SRV-06 | Piensa en trabajos de horas (el pipeline v1 llega a 400 min) |
| 13 | El hilo de heartbeat seguía latiendo si el trabajo se colgaba, y se apagaba en una parada ordenada | SRV-06 | Para con `done` o con `max_job_s`; **no** con el stop del worker |
| 14 | Tests con bucles de 1 ms que podían fallar al azar | SRV-06 | Usa `threading.Event` que activa la función observada |
| 15 | `LoginLimiter` guardaba cada clave para siempre: cualquiera llenaba la memoria | SRV-04 | Todo diccionario en memoria con clave del usuario necesita purga y tope duro |
| 16 | `allows()` → verificar (lento) → `hit()`: 20 peticiones en paralelo pasaban todas | SRV-04 | Reserva el cupo **antes** del trabajo lento, con una operación atómica bajo `threading.Lock` |
| 17 | Cambiar la contraseña no tenía límite de intentos | SRV-04 | Toda verificación de contraseña lleva límite |
| 18 | `grade_attempt` devolvía la respuesta correcta de **todas** las preguntas aunque se respondiera una | AI-09 | `expected` solo para preguntas respondidas en ese intento |
| 19 | No había test con respuestas maliciosas (300 000 caracteres, emoji, control, listas de 10 000) | AI-09 | Toda entrada del usuario: prueba tamaños enormes y caracteres raros |
| 20 | Una respuesta 2xx distinta de 200 pasaba como buena; un stream cortado parecía completo | AI-16 | Comprueba `status === 200`; stream sin `done` → error `stream_truncated` |
| 21 | El SW no se registraba sin red y el aviso de versión nueva se perdía | CHG-15 | Hooks siempre llamados, pase lo que pase con `online` |
| 22 | El SW cacheaba rutas de login del demo | CHG-15 | Las rutas `auth`, `admin`, `chat`, `speech`, `search`, `health` nunca se cachean |
| 23 | `Segmented` usaba `aria-checked` pero el CSS solo pintaba `aria-pressed` | UI-03 | Si usas un atributo ARIA de estado, comprueba que `design/components.css` lo estiliza |
| 24 | `Field` pisaba `aria-describedby` del control hijo | UI-03 | Combina ids, no reemplaces |
| 25 | El subtítulo dentro del `<h1>` cambiaba el nombre accesible | UI-03 | Solo el título va en el encabezado |
| 26 | `PracticeCard` sin audio rompía v1; luego audio con tipo equivocado (v1 usa archivo, v2 usa URL) | CHG-13 | Mira los dos tipos reales: `AudioRef` (v1, `file`) y `AudioClip` (v2, `url`) |
| 27 | `play()` no abortaba la carga anterior: podía sonar la voz no elegida | CHG-13 (v1) | Al cambiar de clip, aborta el `AbortController` anterior |
| 28 | Un subagente arrancó sin worktree y trabajó en otro lado | AI-04 | Si el worktree no existe, detente |
| 29 | Un subagente puso un enlace de commit inventado en su informe | AI-09 | No inventes URLs. Da solo el hash |

---

## 7. Decisiones del conductor (obligatorias, ganan sobre el plan)

| Tema | Decisión |
|---|---|
| Modelo de subagentes | `claude-haiku-5.5` para todo. No pidas otro |
| `journal_mode` | WAL (CHG-01). Los tests piden `("wal",)` |
| Respuestas del quiz | Solo `AnswerIn` y `AnswerResult` pueden tener `answer`/`expected`. `expected` solo para preguntas respondidas en ese intento |
| Revelar respuestas | El quiz es de práctica: está bien que mandar basura revele `expected`. No hace falta límite de intentos de quiz |
| `invite/accept` | 400 `bad_request` igual si el email existe o el token es inválido |
| Contraseña débil / actual incorrecta | 400 `bad_request` |
| Límite de usuarios (`max_users`) | 409 `conflict` |
| Límite de intentos | Reservar antes de verificar. Al llenarse el tope, se descarta la clave menos usada recientemente |
| IP detrás de Caddy | uvicorn con `proxy_headers` y `forwarded_allow_ips` de la red interna de compose (SRV-13) |
| `PracticeSession` | `PracticeCard = {id, front_fr, back_es, audio?: AudioRef[], audio_pending?}` + slot `audio?: ReactNode`; sin slot usa `AudioPlayer` v1 |
| `Job` | Tiene `finished_at: str | None = None` al final; `to_out(job)` no expone `payload`, `result`, `locked_by`, `dedupe_key` |
| Heartbeat | Hilo con su propia conexión. Para con `done` o tras `max_job_s` (28 800 s). **No** para con el stop del worker |
| Nombre de esquema LLM | `complete_json(..., schema_name="generation_output")` por defecto (el de v1) |
| `process_env()` | Única lectura nueva de `os.environ`, en `frances.config` |
| Caché del SW | Historial de intentos y `/api/me/*` se cachean; se purgan en logout/cambio de usuario (UI-07) |
| Temas de la IA | Se llaman `study_topics`/`StudyTopic`; los de Classroom van en `/api/courses/{id}/classroom-topics` |
| CHG sin `owns` | Las CHG tienen `owns: []` y declaran sus archivos en **Touches** |
| Fixtures de AI-04 | Construidas dentro del test (no existen en `make_fixtures.py`); hay un seguimiento abierto |
| Tema web del dueño | `29cdddf` (theme.css) no entra; las maquetas ya usan su paleta |
| Riesgo LLM (OneRouter) | Aceptado (ADR-008/ADR-016). Se despliega con LLM activo |
| Maquetas | Aprobadas sin cambios (ADR-009). No se construyen: minutos de estudio, recordatorio, «sincronizado hace», crear/editar tarjeta (P11) |

---

## 8. Protocolo del revisor

Un revisor **nunca** modifica archivos ni hace commits. Pasos:

1. `cd` al worktree de la tarea. El cambio es `git diff v2/main...HEAD` (**tres** puntos; dos puntos muestra cosas de `v2/main` que no son del PR).
2. Lee `AGENTS.md` (Revisión), el plan maestro, la sección de la tarea y el informe del implementador (el conductor te da la ruta del `result.txt`).
3. Corre la verificación completa (sección 3).
4. Responde las 5 preguntas de `AGENTS.md`:
   1. ¿Hace exactamente los pasos y nada fuera de sus rutas?
   2. ¿Nombres y tipos coinciden con **Interfaces** y el plan maestro?
   3. ¿Cumple las Global Constraints (sección 5)?
   4. ¿Existe el test del **Review Focus** y prueba de verdad lo que dice? (Lee el test; no te fíes del nombre.)
   5. ¿Está completa la **Definition of Done**?
5. Recorre la sección 6 contra el diff.
6. Juzga cada desviación declarada: aceptable o no, con una razón.
7. Para cambios de seguridad o concurrencia, **pruébalo**: escribe un script en `$KIROCREW_SCRATCH` que reproduzca el ataque o la carrera. Para tests que usan hilos, córrelos 20 veces con `--no-cov`.
8. Bloquea **solo** por fallos reales de corrección, seguridad, pérdida de datos, accesibilidad o contrato. Lo demás va como "no bloqueante".
9. No reabras decisiones de la sección 7 ni desviaciones ya aceptadas en revisiones anteriores, salvo que causen un fallo real.

Formato de salida del revisor (primera línea exacta):

```
APPROVE
```
o
```
REQUEST_CHANGES
1. ruta/archivo.py:123 — qué falla — cómo arreglarlo — qué test lo debe probar.
2. ...
No bloqueantes:
- ...
```

---

## 9. Formato del informe final (implementador)

Tu último mensaje, en este orden:

1. **Estado:** `COMMIT <hash>` o `DETENIDO SIN COMMIT`.
2. **Archivos:** lista de archivos creados y modificados.
3. **Pruebas:** salida resumida de cada comando de la sección 3 (número de tests que pasan, cobertura).
4. **Review Focus:** nombre del test que cubre cada ítem.
5. **Desviaciones:** numeradas, cada una con su razón. Si no hay, escribe "Ninguna".
6. **Si te detuviste:** el choque, archivo y línea, 2-3 opciones y tu recomendación.

No incluyas diffs enteros (el conductor los ve con `git show`). No inventes enlaces.

---

## 10. Plantillas que usa el conductor

### Implementar

```
Implementa la tarea <ID> de Frances Classroom v2. Worktree: /home/nigrumhodo/Escritorio/FrancesApp/wt-<ID> (rama task/<ID>-<slug>).
Lee ENTERO docs/superpowers/plans/2026-11-06-manual-subagentes.md y sigue su sección 2 al pie de la letra.
Tu ficha está en la sección 12 del manual. <notas extra del conductor, si hay>
```

### Corregir tras revisión

```
Corrige la tarea <ID>. Worktree: /home/nigrumhodo/Escritorio/FrancesApp/wt-<ID> (HEAD <hash>).
Lee docs/superpowers/plans/2026-11-06-manual-subagentes.md (secciones 2-7).
Cambios pedidos (TDD, primero el test que falla): <lista del revisor>.
Commit: "fix(<área>): <qué> [<ID>]". Informe con la sección 9.
```

### Revisar

```
Eres revisor fresco. Worktree: /home/nigrumhodo/Escritorio/FrancesApp/wt-<ID> (HEAD <hash>).
Sigue la sección 8 de docs/superpowers/plans/2026-11-06-manual-subagentes.md.
Informe del implementador: <ruta result.txt>. <foco extra>
```

Reglas del conductor para no gastar de más:
- Crear el worktree **antes** de lanzar al subagente (error 28).
- Dos rechazos seguidos → la tarea vuelve a la cola con un implementador nuevo y las notas de los dos revisores.
- Fusionar en `v2/main` con `--no-ff`, y correr la verificación completa después de cada tanda.

---

## 11. Tickets que todavía no tienen plan, y seguimientos abiertos

### 11.1 Planes por escribir (los escribe un planificador, no un implementador)

| Ticket | Qué falta | Entregable | Depende de |
|---|---|---|---|
| PLAN-P11 | Plan del subsistema P11 «Gestión» (spec v2 §7): editar/borrar/crear tarjetas (admin y usuario), regenerar y cambiar voces de audio, renombrar/unir/dividir/mover temas, pantallas de admin (pipeline, trabajos fallidos, usuarios e invitaciones). Rutas ya reservadas en `ROUTER_MODULES`: `frances.api.routes.manage_cards`, `manage_audio`. El hueco de la web está en `web/src/admin/AdminRoutes.tsx` y `AdminSection.tsx` (P09). | `docs/superpowers/plans/2026-11-02-11-gestion.md` + tareas `MGT-xx` (y `CHG-xx` desde el número libre siguiente) en `tasks.yaml` | Planes P08, P09, P10 |
| PLAN-P12 | Plan del go-live (spec v2 §12 y §13): crear la instancia Oracle ARM, abrir puertos 80/443, dominio, `/srv/frances/.env` y `caddy.env`, construir imágenes en la instancia, primer backfill, checklist de aceptación (adaptar LIVE-03 v1), borrar FRB1 en una CHG conservando `tests/fixtures/demo_state.sql` y `demo_audio/`. Reaprovecha LIVE-01 (refresh token de Google). | `docs/superpowers/plans/2026-11-02-12-golive.md` + tareas `GOL-xx` (las del dueño con `human: true`) | Todos |

Reglas para el planificador: mismo formato y rigor que `2026-11-02-08-servidor.md` (Deps, Files/owns, Interfaces, pasos TDD, DoD, Review Focus por tarea); no contradigas el plan maestro (si hace falta un contrato nuevo, es una tarea CHG con su lista de consumidores); `uv run python scripts/tasks_check.py --waves` y `uv run pytest tests/agents --no-cov` deben pasar; no implementes código.

### 11.2 Seguimientos abiertos (pequeños; cada uno puede ser un ticket CHG o FIX)

| Ticket | Qué | Dónde | Tipo |
|---|---|---|---|
| FIX-01 | Límite de largo en `AnswerIn.answer` (p. ej. 2000 caracteres) y regenerar contratos | `src/frances/models/study.py:~158` | CHG (contrato) |
| FIX-02 | `grade_question` con una pregunta `mcq` sin `answers` lanza `IndexError`; devolver incorrecta o validar en el modelo | `src/frances/study/grading.py:~54,155` | FIX |
| FIX-03 | El cliente LLM manda la clave en `Authorization: Bearer` **y** en `api-key`; dejar solo Bearer (ADR-006 lo verificó) | `src/frances/cards/llm.py:~343` | CHG (contrato del cliente) |
| FIX-04 | Mover los datos de prueba de AI-04 (`item_with_pdf`, `item_cw1`, `cw_1`) a `tests/fixtures/make_fixtures.py` | `tests/study/test_index.py` | FIX (owner FND-05) |
| FIX-05 | `AudioPlayer.play()` v1 no aborta la carga anterior | `web/src/ui/AudioPlayer.tsx:~128-137` | FIX |
| FIX-06 | Agregar `dist` a `web/.prettierignore` | `web/.prettierignore` | FIX |
| FIX-07 | El plan maestro dice `status` en el `done` del chat; el contrato usa `code`. Corregir el texto del plan | plan maestro, párrafo «SSE del chat» | DOC |
| FIX-08 | El mensaje de `Store.connect` dice «corre frances migrate», pero el comando no existe | `src/frances/db/store.py` | FIX |
| FIX-09 | Módulos v1 que leen `os.environ`: `stage.py`, `log.py`, `ops/r2.py`, `sync/auth.py:~59` | varios | FIX (pasar a `frances.config.process_env`) |
| FIX-10 | `health()` abre `Store.connect` sin `try/finally` para cerrar | `src/frances/api/routes/health.py` | FIX |
| FIX-11 | FKs de `sessions`/`invites` a `users` son `NO ACTION`: no se puede borrar un usuario con sesiones. Decidir `ON DELETE CASCADE` | migración nueva | CHG (DDL) |
| FIX-12 | `bogota_day` con datetime sin zona usaría la zona local | `src/frances/db/usage.py` | FIX |
| FIX-13 | `StudyStatus.pending` se genera en TS como `{[k: string]: number}`; un alias `Record<StudyJobKind, number>` | `web/scripts/gen-types.mjs` | CHG |
| FIX-14 | Ciclo de importación `frances.db` → `usage` → `frances.stage` | `src/frances/db/usage.py` | FIX |
| FIX-15 | Subir las ramas a GitHub y abrir los PR (falta `gh auth login` del dueño) | — | HUMANA |

---

## 12. Fichas de las tareas que faltan

Cada ficha resume la tarea; **el detalle completo está en el plan, en la línea indicada**. Lee esa sección entera: tiene los tests del Step 1 escritos, las firmas exactas de **Interfaces** y la **Definition of Done**. Las **Notas del conductor** son errores probables o decisiones ya tomadas para esa tarea.

La **Ola** es el orden: una tarea solo puede empezar cuando todas sus deps están fusionadas en `v2/main`. Las tareas de la misma ola pueden correr en paralelo.

### Resumen por ola (solo tareas que faltan)

| Ola | Tareas |
|---|---|
| 1 | AI-05, AI-07, AI-11, CHG-10, SRV-08, SRV-10, SRV-11, SRV-13, UI-07, UI-11, UI-21 |
| 2 | AI-06, AI-08, AI-12, SRV-09, SRV-14, UI-08, UI-10 |
| 3 | AI-13, AI-14, AI-15, AI-17, UI-05, UI-09 |
| 4 | CHG-14, UI-06, UI-12, UI-14, UI-15, UI-17, UI-18, UI-19 |
| 5 | UI-13, UI-16, UI-20 |
| 6 | UI-22 |
| 7 | CHG-16 |

### Fichas de P08 (`docs/superpowers/plans/2026-11-02-08-servidor.md`)

#### SRV-08: Lectura: cursos, temas de Classroom, publicaciones, adjuntos con streaming

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** SRV-04
- **owns:** `src/frances/api/routes/content.py`, `src/frances/api/content_repo.py`, `src/frances/api/streaming.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-08-servidor.md`, línea 918
  - Create: `src/frances/api/routes/content.py`, `src/frances/api/content_repo.py`, `src/frances/api/streaming.py`
  - Test: `tests/api/test_content.py`, `tests/api/test_streaming.py`
- **Commit:** `feat(api): lectura de cursos, publicaciones y adjuntos con Range [SRV-08]`
- **Review Focus:** ítem 6 del plan maestro v2; la ruta del archivo se arma solo con `DataPaths.blob_path(sha)` y un sha que salió de la base.
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/api -v` → Expected: PASS.
- **Notas del conductor:** Range: valida el encabezado (416 si es inválido) y nunca leas fuera del archivo. Ruta del archivo solo con `DataPaths.blob_path(sha)`. Toda ruta exige sesión.

#### SRV-10: Token de Azure Speech para el navegador

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** SRV-04
- **owns:** `src/frances/api/routes/speech.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-08-servidor.md`, línea 1039
  - Create: `src/frances/api/routes/speech.py`
  - Test: `tests/api/test_speech.py`
- **Commit:** `feat(api): token de Azure Speech de corta vida para el navegador [SRV-10]`
- **Review Focus:** la clave de Azure nunca sale del servidor (R-42).
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/api/test_speech.py -v` → Expected: PASS (4 passed).
- **Notas del conductor:** La clave de Azure nunca sale del servidor ni va a logs. Cachea el token unos minutos. Exige sesión y CSRF. httpx mockeado.

#### SRV-11: Admin del pipeline: estado, lanzar, trabajos fallidos, reintentar, uso

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** SRV-04, SRV-07
- **owns:** `src/frances/api/routes/admin_pipeline.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-08-servidor.md`, línea 1089
  - Create: `src/frances/api/routes/admin_pipeline.py`
  - Test: `tests/api/test_admin_pipeline.py`
- **Commit:** `feat(api): admin del pipeline con estado, ejecución manual y reintentos [SRV-11]`
- **Review Focus:** `runs.stats.errors` (puede tener texto del curso) nunca sale por la API.
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/api/test_admin_pipeline.py -v` → Expected: PASS (5 passed).
- **Notas del conductor:** Solo admin (usuario normal → 403). Lanzar a mano usa `dedupe_key` para no duplicar un pipeline en curso. Vistas con `to_out`.

#### SRV-13: Dockerfile multi-arch, compose y Caddyfile

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** SRV-02, SRV-06, SRV-12
- **owns:** `infra/`, `.dockerignore`
- **Plan:** `docs/superpowers/plans/2026-11-02-08-servidor.md`, línea 1214
  - Create: `infra/Dockerfile`, `infra/compose.yaml`, `infra/Caddyfile`, `infra/env.example`, `infra/caddy.env.example`, `infra/README.md`, `.dockerignore`
  - Test: `tests/infra/test_compose.py`, `tests/infra/test_dockerfile.py`, `tests/infra/test_caddyfile.py`, `tests/infra/test_image_build.py` (`@pytest.mark.heavy`)
- **Commit:** `feat(infra): imagen multi-arch, compose de 4 servicios y Caddy con HTTPS [SRV-13]`
- **Review Focus:** ítem 11 del subsistema; `caddy` no monta `/srv/frances/data` ni recibe `/srv/frances/.env`.
- **Definition of Done:** DoD v2; `docker compose -f infra/compose.yaml config -q` sin errores; en una máquina con Docker, `docker buildx build --platform linux/arm64,linux/amd64 -f infra/Dockerfile --target app .` termina.
- **Verificación del plan:** `uv run pytest tests/infra -v` → Expected: PASS (8 passed, 1 deselected heavy). Opcional local: `uv run pytest -m heavy tests/infra/test_image_build.py`.
- **Notas del conductor:** uvicorn con `proxy_headers` y `forwarded_allow_ips` de la red de compose (no `*`). Usuario 10001, `read_only`, `tmpfs /tmp`. Nunca copies `.env`, `data/`, `.venv`, `node_modules` a la imagen. `docker compose -f infra/compose.yaml config` debe validar.

#### SRV-09: Lectura: tarjetas, fichas, voces, taladros y audio con Range

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** SRV-08 (falta), CHG-04, CHG-06, AUD-01, CRD-07
- **owns:** `src/frances/api/routes/cards.py`, `src/frances/api/cards_repo.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-08-servidor.md`, línea 980
  - Create: `src/frances/api/routes/cards.py`, `src/frances/api/cards_repo.py`
  - Test: `tests/api/test_cards.py`, `tests/api/test_audio_route.py`
- **Commit:** `feat(api): lectura de tarjetas, fichas, voces y audio con Range [SRV-09]`
- **Review Focus:** una tarjeta propia de otro usuario nunca aparece en una lista, una búsqueda ni por id.
- **Definition of Done:** DoD v2; `GET /api/cards?limit=200` < 300 ms con 5 000 tarjetas sintéticas.
- **Verificación del plan:** `uv run pytest tests/api -v` → Expected: PASS.
- **Notas del conductor:** Una tarjeta propia de otro usuario (`owner_user_id`) nunca aparece: filtra en SQL, no en Python. Audio con Range igual que SRV-08 (reusa `streaming.py`). `card_overrides` del usuario reemplaza la tarjeta compartida solo para él. Filas con `removed_at` no se listan.

#### SRV-14: CI: build arm64/amd64 con QEMU y chequeo de wheels

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** SRV-13 (falta), SRV-01
- **owns:** `.github/workflows/docker.yml`
- **Plan:** `docs/superpowers/plans/2026-11-02-08-servidor.md`, línea 1291
  - Create: `.github/workflows/docker.yml`
  - Test: `tests/infra/test_docker_workflow.py`
- **Commit:** `ci: build multi-arch con QEMU y chequeo de wheels aarch64 [SRV-14]`
- **Review Focus:** el workflow no publica imágenes ni usa secretos (R-45).
- **Definition of Done:** DoD v2; el run del PR muestra los jobs `wheels` y `docker` verdes.
- **Verificación del plan:** `uv run pytest tests/infra/test_docker_workflow.py -v` → Expected: PASS (4 passed). En el PR, el job `docker` queda verde.
- **Notas del conductor:** Build arm64 con QEMU en CI (`docker/setup-qemu-action` y `buildx`, acciones fijadas por SHA). Sin secretos ni push de imágenes (no hay registro). Permisos `contents: read`.


### Fichas de P10 (`docs/superpowers/plans/2026-11-02-10-ia-estudio.md`)

#### AI-05: Búsqueda BM25 y GET /api/search

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** AI-04, SRV-04
- **owns:** `src/frances/study/search.py`, `src/frances/api/routes/search.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 642
  - Create: `src/frances/study/search.py`, `src/frances/api/routes/search.py`
  - Test: `tests/study/test_search.py`, `tests/api/test_search_route.py`
- **Commit:** `feat(study): búsqueda BM25 sobre FTS5 y /api/search [AI-05]`
- **Review Focus:** la consulta FTS se arma solo con tokens `\w+` entre comillas.
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/study tests/api -v` → Expected: PASS (incluido `test_every_route_requires_auth_except_public_routes`).
- **Notas del conductor:** Escapa la consulta para `MATCH` (cada término entre comillas dobles, duplicando las comillas internas). Prueba con `"`, `*`, `NEAR`, `(`, `AND`. Límite de largo de consulta y de resultados. `ecole` encuentra `école`.

#### AI-07: Temas del curso: reagrupado completo que respeta las ediciones del admin

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** AI-01, AI-03, CHG-04
- **owns:** `src/frances/study/topics.py`, `src/frances/study/topics_repo.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 764
  - Create: `src/frances/study/topics.py`, `src/frances/study/topics_repo.py`
  - Test: `tests/study/test_topics.py`, `tests/study/test_topics_repo.py`
- **Commit:** `feat(study): temas del curso con reagrupado que respeta al admin [AI-07]`
- **Review Focus:** ítem P10-5; los ids de tema no cambian si el agrupamiento no cambia (las URLs de P09 y los quizzes por tema dependen de eso).
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/study -v` → Expected: PASS (los tres tests con `...` quedan escritos completos).
- **Notas del conductor:** Tablas `study_topics`/`study_topic_items`, no `topics` (v1). Temas con `edited_by_human` no se renombran, unen ni dividen. Respaldo con los temas de Classroom si el LLM falla o está apagado.

#### AI-11: «Por qué» del plan, redactado por el LLM (opcional)

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** AI-10, AI-01, AI-03
- **owns:** `src/frances/study/plan_why.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 1056
  - Create: `src/frances/study/plan_why.py`
  - Test: `tests/study/test_plan_why.py`
- **Commit:** `feat(study): «por qué» opcional del plan con el LLM [AI-11]`
- **Review Focus:** ningún dato del usuario va al LLM; el «por qué» nunca bloquea el plan.
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/study -v` → Expected: PASS.
- **Notas del conductor:** No mandes identidad del usuario al LLM. Sáltalo si quedan menos de 60 llamadas del día. Si falla, el plan sale sin «por qué».

#### CHG-10: El merge de tarjetas respeta ediciones humanas y descarta tarjetas LLM sin fragmento

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** CHG-04, CHG-08, AI-03
- **owns:** (vacío: tarea CHG, sus archivos están en Touches)
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 214
  - **Touches** (R-31; archivos de CRD-05): `src/frances/cards/merge.py`, `src/frances/cards/repo.py`, `src/frances/cards/run.py`. Tests: `tests/cards/test_merge_v2.py`.
- **Commit:** `feat(cards): el merge respeta ediciones humanas y filtra tarjetas sin fragmento [CHG-10]`
- **Review Focus:** la protección está en SQL (`WHERE … edited_by_human = 0`), no solo en Python.
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/cards tests/bundle -v` → Expected: PASS.
- **Notas del conductor:** Una fila con `edited_by_human = 1` nunca se sobrescribe; usa `edited_input_hash` para marcar «la publicación cambió». Tarjetas del LLM sin fragmento real (validadores de AI-03) se descartan. tests/cards v1 en verde.

#### AI-06: Resumen por clase (StudySheet ampliada)

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** AI-01, AI-03, CHG-10 (falta)
- **owns:** `src/frances/study/sheet.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 695
  - Create: `src/frances/study/sheet.py`
  - Test: `tests/study/test_sheet.py`
- **Commit:** `feat(study): ficha de estudio ampliada por publicación [AI-06]`
- **Review Focus:** una ficha editada por el admin nunca se reescribe; sin LLM la ficha base sigue visible.
- **Definition of Done:** DoD v2; `GET /api/sheets/{item_id}` (SRV-09) devuelve la ficha ampliada sin cambios en SRV-09.
- **Verificación del plan:** `uv run pytest tests/study -v` → Expected: PASS.
- **Notas del conductor:** La ficha ampliada se guarda en `sheets` con `generator='study'`; si el LLM falla, queda la ficha base de CRD-05. Respeta `edited_by_human` de `sheets`.

#### AI-08: Generación de quizzes por tema y publicación (LLM, reglas y dictado)

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** AI-01, AI-03, AI-04, AI-07 (falta)
- **owns:** `src/frances/study/quiz.py`, `src/frances/study/quiz_rules.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 841
  - Create: `src/frances/study/quiz.py`, `src/frances/study/quiz_rules.py`
  - Test: `tests/study/test_quiz.py`, `tests/study/test_quiz_rules.py`
- **Commit:** `feat(study): quizzes por tema y publicación con respaldo por reglas [AI-08]`
- **Review Focus:** un quiz nunca se reescribe con el mismo id (los intentos guardados siguen apuntando a sus preguntas).
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/study -v` → Expected: PASS.
- **Notas del conductor:** Los 5 tipos: mcq, completar (cloze), traducir, ordenar frase, dictado. El dictado reusa el audio `front` de tarjetas `phrase` con audio `done`; si no hay, la pregunta se oculta. Ids de quizzes por reglas con prefijo `rules\x1f`. Nunca se reescribe un quiz con el mismo id. `Question` nunca lleva respuestas.

#### AI-12: Chat con el material: recuperación, prompt, citas y persistencia

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** AI-05 (falta), AI-01, AI-03, CHG-09
- **owns:** `src/frances/study/chat.py`, `src/frances/study/chat_repo.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 1101
  - Create: `src/frances/study/chat.py`, `src/frances/study/chat_repo.py`
  - Test: `tests/study/test_chat.py`, `tests/study/test_chat_repo.py`
- **Commit:** `feat(study): chat con recuperación FTS5 y citas obligatorias [AI-12]`
- **Review Focus:** ítem P10-7; el orden de eventos cumple «SSE del chat» del plan maestro (con las aclaraciones de CHG-11).
- **Definition of Done:** DoD v2.
- **Verificación del plan:** `uv run pytest tests/study -v` → Expected: PASS (los tests con `...` quedan escritos completos).
- **Notas del conductor:** Recuperación con AI-05. Cada respuesta cita al menos un fragmento `[n]`; sin fragmentos → `done.code = no_material`; sin marcas válidas → `partial` con los 3 mejores fragmentos como citas. Una pregunta en vuelo por usuario (429). El stream abre su propia conexión a la base. Nada del texto en logs.

#### AI-13: Handlers de los trabajos de estudio, encadenados tras el pipeline

- **Estado:** PENDIENTE · **Ola:** 3
- **Deps:** AI-04, AI-06 (falta), AI-07 (falta), AI-08 (falta), AI-10, AI-11 (falta), SRV-07
- **owns:** `src/frances/study/jobs.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 1182
  - Create: `src/frances/study/jobs.py`
  - Test: `tests/study/test_jobs.py`
- **Commit:** `feat(study): handlers de trabajos de estudio con reintentos y respaldo [AI-13]`
- **Review Focus:** con el LLM caído o en `off`, después de un pipeline hay fichas base, temas, quizzes por reglas y plan: ninguna pantalla vacía.
- **Definition of Done:** DoD v2; `frances jobs enqueue llm.topics --data <tmp>` seguido de `frances worker --once` deja temas por reglas sin entorno LLM.
- **Verificación del plan:** `uv run pytest tests/study tests/jobs -v` → Expected: PASS (los tests con `...` quedan escritos completos).
- **Notas del conductor:** Los handlers de estudio se encolan después del pipeline (SRV-07) con `dedupe_key`. Un fallo del LLM reintenta con backoff; tras 5, respaldo por reglas. AuthError → PermanentJobError.

#### AI-14: API de estudio: temas, quizzes, intentos, plan y estado

- **Estado:** PENDIENTE · **Ola:** 3
- **Deps:** AI-07 (falta), AI-08 (falta), AI-09, AI-10, CHG-11, SRV-09 (falta), SRV-05
- **owns:** `src/frances/api/routes/study.py`, `src/frances/api/study_repo.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 1247
  - Create: `src/frances/api/routes/study.py`, `src/frances/api/study_repo.py`
  - Test: `tests/api/test_study_routes.py`, `tests/api/test_quiz_routes.py`, `tests/api/test_plan_routes.py`
- **Commit:** `feat(api): temas, quizzes, intentos, plan y estado de estudio [AI-14]`
- **Review Focus:** ítem P10-6; el usuario solo ve sus intentos y su plan.
- **Definition of Done:** DoD v2; cada ruta aparece en la tabla «Estudio IA (P10)» del plan maestro (CHG-11) con el mismo método, auth y modelos.
- **Verificación del plan:** `uv run pytest tests/api -v` → Expected: PASS (incluido `test_every_route_requires_auth_except_public_routes`; los tests con `...` quedan escritos completos).
- **Notas del conductor:** Ninguna vista previa a responder expone `answer`/`answer_json`/`expected`. `POST /api/quizzes/{id}/attempts` exige CSRF. Un usuario nunca ve intentos ni plan de otro. `GET /api/plan/today` construye el plan por reglas si falta.

#### AI-15: API del chat: hilos y respuesta en SSE por POST

- **Estado:** PENDIENTE · **Ola:** 3
- **Deps:** AI-12 (falta), SRV-04
- **owns:** `src/frances/api/routes/chat.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 1312
  - Create: `src/frances/api/routes/chat.py`
  - Test: `tests/api/test_chat_routes.py`
- **Commit:** `feat(api): chat con SSE por POST y hilos por usuario [AI-15]`
- **Review Focus:** ítem P10-8; el lock de «una pregunta en curso» se libera aunque el cliente corte la conexión.
- **Definition of Done:** DoD v2; con Caddy (`flush_interval -1`, SRV-13) los `token` llegan sin buffer (smoke `@pytest.mark.heavy` en AI-17).
- **Verificación del plan:** `uv run pytest tests/api -v` → Expected: PASS (los tests con `...` quedan escritos completos).
- **Notas del conductor:** SSE por POST leído con fetch (no EventSource). CSRF por `X-CSRF-Token`. Una pregunta en vuelo por usuario. Cancela el LLM si el cliente cierra. Evento `done` con `code`.

#### AI-17: Evaluación con el LLM real (heavy)

- **Estado:** PENDIENTE · **Ola:** 3
- **Deps:** AI-06 (falta), AI-07 (falta), AI-08 (falta), AI-11 (falta), AI-12 (falta), CHG-10 (falta)
- **owns:** `scripts/llm_eval.py`, `tests/study/test_llm_eval_heavy.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-10-ia-estudio.md`, línea 1433
  - Create: `scripts/llm_eval.py`, `tests/study/test_llm_eval_heavy.py`
  - Test: los mismos (`tests/study/test_llm_eval_heavy.py`, todo `@pytest.mark.heavy`)
- **Commit:** `test(study): evaluación de calidad con el LLM real [AI-17]`
- **Review Focus:** ningún reporte guarda texto generado; sin entorno el script no hace red.
- **Definition of Done:** DoD v2; el PR adjunta el resumen de una corrida real (aprobados y latencias por tarea, sin contenido).
- **Verificación del plan:** `uv run pytest tests/study/test_llm_eval_heavy.py -v` (sin `-m heavy`: solo corre `test_missing_env_exits_2`) → Expected: PASS. Con credenciales de prueba en una máquina con red: `uv run pytest -m heavy tests/study/test_llm_eval_heavy.py` → PASS o informe de qué tarea no llega al umbral (eso abre un
- **Notas del conductor:** Todo con `@pytest.mark.heavy`. Lee `LLM_*` con `frances.config`. No guarda salidas reales en el repo (solo métricas agregadas sin texto).


### Fichas de P09 (`docs/superpowers/plans/2026-11-02-09-rediseno.md`)

#### UI-07: Sin conexión: base IndexedDB v2, cola de escrituras, purga y precarga

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** UI-04, CHG-15
- **owns:** `web/src/offline/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 549
  - Create: `web/src/offline/db.ts`, `web/src/offline/outbox.ts`, `web/src/offline/purge.ts`, `web/src/offline/prefetch.ts`, `web/src/offline/OfflineContext.tsx`, `web/src/offline/useOnline.ts`, `web/src/offline/settings.ts`
  - Test: `web/src/offline/outbox.test.ts`, `web/src/offline/purge.test.ts`, `web/src/offline/prefetch.test.ts`, `web/src/offline/OfflineContext.test.tsx`
- **Commit:** `feat(web): cola sin conexión, purga por usuario y precarga [UI-07]`
- **Review Focus:** ítems P09-4 y P09-9; la cola guarda `userId` y nunca envía una operación de otro usuario.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/offline` → Expected: PASS.
- **Notas del conductor:** `purgeUserData` borra IndexedDB v2 y las cachés `API_DATA_CACHE`/`API_MEDIA_CACHE` de `web/src/sw/pwaConfig.ts`. La cola respeta CHG-12 (reseña repetida no duplica; 409 se descarta). No toca la base IndexedDB de v1.

#### UI-11: Medios v2: reproductor de clips, visor PDF/imagen y token de Speech

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** UI-03, UI-04, CHG-13
- **owns:** `web/src/media/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 865
  - Create: `web/src/media/CardAudio.tsx`, `web/src/media/AttachmentView.tsx`, `web/src/media/useVoices.ts`, `web/src/media/speech.ts`
  - Test: `web/src/media/CardAudio.test.tsx`, `web/src/media/AttachmentView.test.tsx`, `web/src/media/speech.test.ts`
- **Commit:** `feat(web): audio, visores y token de Azure Speech sobre la API [UI-11]`
- **Review Focus:** las URLs de archivos y audio salen solo de `FileLink.url`/`AudioClip.url` (SRV-08/09), nunca de concatenar campos.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/media` → Expected: PASS.
- **Notas del conductor:** Al cambiar de clip, aborta la carga anterior (error 27). La clave de Azure nunca está en el navegador: token de `POST /api/speech/token`.

#### UI-21: Modo demo: transporte simulado sobre la instantánea

- **Estado:** EN CURSO (ola del 2026-11-06) · **Ola:** 1
- **Deps:** UI-04
- **owns:** `web/src/demo/`, `web/scripts/check-no-demo.mjs`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1293
  - Create: `web/src/demo/transport.ts`, `web/src/demo/snapshot.ts`, `web/src/demo/overlay.ts`, `web/src/demo/grade.ts`, `web/src/demo/sse.ts`, `web/scripts/check-no-demo.mjs`
  - Test: `web/src/demo/transport.test.ts`, `web/src/demo/overlay.test.ts`, `web/src/demo/grade.test.ts`
- **Commit:** `feat(web): modo demo con API simulada sobre la instantánea [UI-21]`
- **Review Focus:** ítem P09-6; el demo imita los códigos del servidor (401, 403 csrf, 404, 409) para que los e2e prueben el manejo real de errores.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/demo && npm --prefix web run build && node web/scripts/check-no-demo.mjs web/dist` → Expected: PASS y el guardián sale 0 sobre el build real.
- **Notas del conductor:** El demo se elige con `import.meta.env.MODE === 'demo'` (Rollup lo quita del build real). Sin MSW. `check-no-demo.mjs` falla si el build real contiene código demo.

#### UI-08: Sesión: login, aceptar invitación, cerrar sesión y contraseña

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** UI-03, UI-04, UI-07 (falta)
- **owns:** `web/src/auth/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 609
  - Create: `web/src/auth/AuthContext.tsx`, `web/src/auth/RequireSession.tsx`, `web/src/auth/Login.tsx`, `web/src/auth/Invitacion.tsx`, `web/src/auth/LogoutButton.tsx`, `web/src/auth/ChangePassword.tsx`, `web/src/auth/password.ts`, `web/src/auth/next.ts`, `web/src/auth/strings.ts`
  - Test: `web/src/auth/AuthContext.test.tsx`, `web/src/auth/Login.test.tsx`, `web/src/auth/Invitacion.test.tsx`, `web/src/auth/LogoutButton.test.tsx`, `web/src/auth/password.test.ts`, `web/src/auth/next.test.ts`
- **Commit:** `feat(web): login, invitación, cierre de sesión y cambio de contraseña [UI-08]`
- **Review Focus:** ítems P09-2 y P09-4; la contraseña nunca se guarda fuera del estado del formulario.
- **Definition of Done:** DoD v2 (lado web); ningún token de invitación queda en `location`, `localStorage` ni en un log.
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/auth` → Expected: PASS.
- **Notas del conductor:** Login/invitación/contraseña con los códigos de la sección 7: 400 para invitación inválida o email existente (mismo texto), 400 contraseña débil o actual incorrecta, 429 con «espera un minuto». No muestres si un email existe. Logout llama a `purgeUserData` (UI-07).

#### UI-10: Repaso FSRS sobre la API: adaptador ts-fsrs, sesión e intervalos

- **Estado:** PENDIENTE · **Ola:** 2
- **Deps:** UI-04, UI-07 (falta), WEB-08
- **owns:** `web/src/review/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 814
  - Create: `web/src/review/fsrs.ts`, `web/src/review/session.ts`, `web/src/review/useReviewSession.ts`, `web/src/review/intervals.ts`
  - Test: `web/src/review/fsrs.test.ts`, `web/src/review/session.test.ts`, `web/src/review/useReviewSession.test.tsx`, `web/src/review/intervals.test.ts`
- **Commit:** `feat(web): repaso FSRS calculado en el cliente y guardado en el servidor [UI-10]`
- **Review Focus:** ítem P09-3 (lado cliente: lo que manda pasa la validación R-38 del servidor; test compartido de valores con UI-05 vía los mismos números de ejemplo).
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/review` → Expected: PASS.
- **Notas del conductor:** FSRS en el cliente con ts-fsrs; el servidor valida (CHG-12). Reseña repetida con el mismo `reviewed_at` no duplica; 409 se descarta en silencio y recarga el estado.

#### UI-05: API de repaso: cola, reseñas FSRS y banderas

- **Estado:** PENDIENTE · **Ola:** 3
- **Deps:** SRV-09 (falta), CHG-04, CHG-12
- **owns:** `src/frances/api/routes/review.py`, `src/frances/api/review_repo.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 373
  - Create: `src/frances/api/routes/review.py`, `src/frances/api/review_repo.py`
  - Test: `tests/api/test_review_routes.py`, `tests/api/test_review_repo.py`
- **Commit:** `feat(api): cola de repaso, reseñas FSRS y banderas por usuario [UI-05]`
- **Review Focus:** ítems P09-3 y P09-10; ninguna transacción abierta entre la lectura del estado previo y la escritura queda fuera de `BEGIN IMMEDIATE`.
- **Definition of Done:** DoD v2; las tres rutas coinciden con «Progreso del usuario (P09)» (CHG-12).
- **Verificación del plan:** `uv run pytest tests/api -v` → Expected: PASS (incluido `test_every_route_requires_auth_except_public_routes`; los tests con `...` quedan escritos completos).
- **Notas del conductor:** Es backend (Python), aunque esté en P09. La reseña se valida y guarda dentro de `BEGIN IMMEDIATE` (lectura del estado previo + escritura). Reglas de CHG-12: misma `reviewed_at` → no duplica (responde el estado guardado); más vieja que la última → 409. Un usuario solo ve su propio `user_card_state`. Exige sesión y CSRF.

#### UI-09: Shell v2: rutas, barra inferior, banner sin conexión y foco

- **Estado:** PENDIENTE · **Ola:** 3
- **Deps:** UI-08 (falta)
- **owns:** `web/src/shell/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 681
  - Create: `web/src/shell/AppV2.tsx`, `web/src/shell/routes.tsx`, `web/src/shell/Layout.tsx`, `web/src/shell/TabBar.tsx`, `web/src/shell/OfflineBanner.tsx`, `web/src/shell/RouteFocus.tsx`, `web/src/shell/NotFound.tsx`, `web/src/shell/Placeholder.tsx`, `web/src/shell/boot.ts`, `web/src/shell/strings.ts`, `web/src/shell/testing.tsx`
  - Test: `web/src/shell/routes.test.tsx`, `web/src/shell/TabBar.test.tsx`, `web/src/shell/OfflineBanner.test.tsx`, `web/src/shell/RouteFocus.test.tsx`
- **Commit:** `feat(web): shell v2 con barra inferior, rutas perezosas y banner sin conexión [UI-09]`
- **Review Focus:** el glob excluye tests; la ruta de admin exige `role === 'admin'` además de existir el módulo.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test` → Expected: PASS (v1 incluida).
- **Notas del conductor:** Barra inferior Hoy/Temas/Repasar/Chat/Más con objetivos de 44 px y `aria-current`. Banner sin conexión con `role="status"`. Rutas de admin solo si el usuario es admin y el módulo existe.

#### CHG-14: Entrada dual v1/v2 (main.tsx por VITE_UI; e2e y Pages v1 con VITE_UI=v1)

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta), WEB-13, OPS-06
- **owns:** (vacío: tarea CHG, sus archivos están en Touches)
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 737
  - **Touches** (R-31): `web/src/main.tsx` (WEB-01), `web/src/App.test.tsx` (WEB-01, solo si importa `main`), `web/playwright.config.ts` (WEB-13), `.github/workflows/pages.yml` (OPS-06). Tests: `web/src/main.test.ts`.
- **Commit:** `build(web): entrada v2 por defecto y v1 con VITE_UI=v1 [CHG-14]`
- **Review Focus:** el arranque v2 no carga `ui/theme.css` ni `data/` (pueden quedar como chunks perezosos sin uso hasta CHG-16, porque `VITE_UI` no está definida en el build real; revisar la pestaña Network del PR).
- **Definition of Done:** DoD v2 (lado web); el workflow `pages` construye igual que antes.
- **Verificación del plan:** `npm --prefix web test && cd web && npx playwright test` → Expected: PASS (e2e v1 sobre `VITE_UI=v1`).
- **Notas del conductor:** La v2 pasa a ser la web por defecto; v1 queda con `VITE_UI=v1`. Todos los tests v1 siguen en verde.

#### UI-06: API de preferencias, estadísticas, progreso por tema y entregas próximas

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** SRV-08 (falta), SRV-09 (falta), CHG-04, CHG-12, UI-05 (falta)
- **owns:** `src/frances/api/routes/prefs.py`, `src/frances/api/prefs_repo.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 452
  - Create: `src/frances/api/routes/prefs.py`, `src/frances/api/prefs_repo.py`
  - Test: `tests/api/test_prefs_routes.py`, `tests/api/test_stats.py`
- **Commit:** `feat(api): preferencias, estadísticas, progreso por tema y entregas próximas [UI-06]`
- **Review Focus:** ítem P09-10; `/api/me/upcoming` no expone publicaciones borradas ni de cursos no incluidos.
- **Definition of Done:** DoD v2; cada ruta < 300 ms con 5 000 reseñas sintéticas (test `..._under_300ms`).
- **Verificación del plan:** `uv run pytest tests/api -v` → Expected: PASS.
- **Notas del conductor:** Es backend (Python), aunque esté en P09. Todo filtrado por el usuario de la sesión. Días y rachas en `America/Bogota`. Entregas próximas desde los `due` de Classroom, sin datos de otros usuarios. Preferencias validadas con el modelo de CHG-12 (`extra="forbid"`).

#### UI-12: Pantalla Hoy

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta)
- **owns:** `web/src/screens/hoy/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 909
  - Create: `web/src/screens/hoy/Hoy.tsx`, `web/src/screens/hoy/PlanList.tsx`, `web/src/screens/hoy/WeekStrip.tsx`, `web/src/screens/hoy/UpcomingCard.tsx`, `web/src/screens/hoy/strings.ts`
  - Test: `web/src/screens/hoy/Hoy.test.tsx`, `web/src/screens/hoy/PlanList.test.tsx`
- **Commit:** `feat(web): pantalla Hoy con plan, entregas y semana [UI-12]`
- **Review Focus:** la casilla «Hecho» y el enlace son dos objetivos separados de ≥ 44 px; el estado se anuncia por texto, no solo por color.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/hoy` → Expected: PASS.
- **Notas del conductor:** La casilla «Hecho» y el enlace son dos objetivos separados de ≥ 44 px. Sin red → cola (UI-07) con cambio optimista. «IA» marca el `why_llm_es`.

#### UI-14: Publicación: texto, adjuntos, ficha, tarjetas y quiz

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta), UI-11 (falta)
- **owns:** `web/src/screens/publicacion/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 986
  - Create: `web/src/screens/publicacion/Publicacion.tsx`, `web/src/screens/publicacion/SheetView.tsx`, `web/src/screens/publicacion/strings.ts`
  - Test: `web/src/screens/publicacion/Publicacion.test.tsx`, `web/src/screens/publicacion/SheetView.test.tsx`
- **Commit:** `feat(web): detalle de publicación con visor, ficha y tarjetas [UI-14]`
- **Review Focus:** `alternate_link` solo se renderiza si es `https://classroom.google.com/…`; cualquier otro esquema se omite.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/publicacion` → Expected: PASS.

#### UI-15: Repasar: sesión de tarjetas

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta), UI-10 (falta), UI-11 (falta)
- **owns:** `web/src/screens/repasar/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1019
  - Create: `web/src/screens/repasar/Repasar.tsx`, `web/src/screens/repasar/FlipCard.tsx`, `web/src/screens/repasar/RatingBar.tsx`, `web/src/screens/repasar/ReviewTabs.tsx`, `web/src/screens/repasar/strings.ts`
  - Test: `web/src/screens/repasar/Repasar.test.tsx`, `web/src/screens/repasar/FlipCard.test.tsx`
- **Commit:** `feat(web): sesión de repaso con volteo, calificación e intervalos [UI-15]`
- **Review Focus:** los atajos 1–4 y Espacio no se disparan dentro de campos de texto ni con la respuesta oculta.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/repasar` → Expected: PASS.

#### UI-17: Quiz con los 5 tipos

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta), UI-11 (falta)
- **owns:** `web/src/screens/quiz/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1097
  - Create: `web/src/screens/quiz/Quiz.tsx`, `web/src/screens/quiz/questions/Mcq.tsx`, `Cloze.tsx`, `Translate.tsx`, `Order.tsx`, `Dictation.tsx`, `web/src/screens/quiz/QuizResults.tsx`, `web/src/screens/quiz/draft.ts`, `web/src/screens/quiz/strings.ts`
  - Test: `web/src/screens/quiz/Quiz.test.tsx`, `web/src/screens/quiz/questions/questions.test.tsx`, `web/src/screens/quiz/draft.test.ts`
- **Commit:** `feat(web): quiz con opción múltiple, completar, traducir, ordenar y dictado [UI-17]`
- **Review Focus:** el feedback correcto/incorrecto se da con texto e icono además del color; `Order` no depende de arrastrar.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/quiz` → Expected: PASS.
- **Notas del conductor:** Los 5 tipos de quiz; las respuestas correctas solo se muestran tras enviar, y solo de las respondidas (sección 7).

#### UI-18: Chat con SSE, pensando de hasta 30 s y cancelar

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta), AI-16
- **owns:** `web/src/screens/chat/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1145
  - Create: `web/src/screens/chat/Chat.tsx`, `web/src/screens/chat/ThreadList.tsx`, `web/src/screens/chat/MessageList.tsx`, `web/src/screens/chat/Composer.tsx`, `web/src/screens/chat/Thinking.tsx`, `web/src/screens/chat/useAsk.ts`, `web/src/screens/chat/strings.ts`
  - Test: `web/src/screens/chat/Chat.test.tsx`, `web/src/screens/chat/useAsk.test.ts`, `web/src/screens/chat/Thinking.test.tsx`
- **Commit:** `feat(web): chat con SSE, pensando con cronómetro, cancelar y citas [UI-18]`
- **Review Focus:** ítem P09-7; el texto de la respuesta se pinta como texto (sin `dangerouslySetInnerHTML`); los `[n]` se convierten en enlaces solo si hay una `citation` con ese número.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/chat` → Expected: PASS.
- **Notas del conductor:** Chat con `askChat` (AI-16). «Pensando» con cronómetro hasta 30 s y botón Cancelar que aborta el fetch. Respuestas citan publicación y página; `no_material` muestra «el material no lo cubre».

#### UI-19: Más: perfil, progreso, ajustes, voces, sesión y hueco de admin

- **Estado:** PENDIENTE · **Ola:** 4
- **Deps:** UI-09 (falta), UI-11 (falta)
- **owns:** `web/src/screens/mas/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1197
  - Create: `web/src/screens/mas/Mas.tsx`, `web/src/screens/mas/ProgressSection.tsx`, `web/src/screens/mas/SettingsSection.tsx`, `web/src/screens/mas/VoicesSection.tsx`, `web/src/screens/mas/AccountSection.tsx`, `web/src/screens/mas/AdminSlot.tsx`, `web/src/screens/mas/strings.ts`
  - Test: `web/src/screens/mas/Mas.test.tsx`, `web/src/screens/mas/SettingsSection.test.tsx`, `web/src/screens/mas/AdminSlot.test.tsx`
- **Commit:** `feat(web): pantalla Más con progreso, ajustes, voces, cuenta y hueco de admin [UI-19]`
- **Review Focus:** la sección de admin depende del rol del servidor (`Me.user.role`), no de un dato local editable.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/mas` → Expected: PASS.
- **Notas del conductor:** Solo el hueco de admin (P11): carga `AdminSection` si existe y el usuario es admin.

#### UI-13: Temas y detalle de tema

- **Estado:** PENDIENTE · **Ola:** 5
- **Deps:** UI-09 (falta), UI-11 (falta), UI-14 (falta)
- **owns:** `web/src/screens/temas/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 946
  - Create: `web/src/screens/temas/Temas.tsx`, `web/src/screens/temas/TemaDetalle.tsx`, `web/src/screens/temas/TopicSummary.tsx`, `web/src/screens/temas/TopicItems.tsx`, `web/src/screens/temas/TopicCards.tsx`, `web/src/screens/temas/TopicQuizzes.tsx`, `web/src/screens/temas/useCourse.ts`, `web/src/screens/temas/strings.ts`
  - Test: `web/src/screens/temas/Temas.test.tsx`, `web/src/screens/temas/TemaDetalle.test.tsx`
- **Commit:** `feat(web): temas del curso y detalle con resumen, clases, tarjetas y quiz [UI-13]`
- **Review Focus:** «Clases» no lanza más de 4 peticiones a la vez; el filtro no oculta el tema activo sin decirlo («{n} temas ocultos por el filtro»).
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/temas` → Expected: PASS.

#### UI-16: Pronunciación con token del servidor

- **Estado:** PENDIENTE · **Ola:** 5
- **Deps:** UI-09 (falta), UI-11 (falta), UI-15 (falta), CHG-13
- **owns:** `web/src/screens/pronunciacion/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1061
  - Create: `web/src/screens/pronunciacion/Pronunciacion.tsx`, `web/src/screens/pronunciacion/usePracticeDeck.ts`, `web/src/screens/pronunciacion/strings.ts`
  - Test: `web/src/screens/pronunciacion/Pronunciacion.test.tsx`, `web/src/screens/pronunciacion/usePracticeDeck.test.ts`
- **Commit:** `feat(web): práctica de pronunciación con token de Azure del servidor [UI-16]`
- **Review Focus:** R-42: no hay clave de Azure en ningún camino; el token solo vive en memoria.
- **Definition of Done:** DoD v2 (lado web).
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test -- src/screens/pronunciacion` → Expected: PASS.
- **Notas del conductor:** Pronunciación con `createTokenRecognizer` (CHG-13): un reintento en `unauthorized`. El color de la nota va con número y texto.

#### UI-20: Instantánea del demo generada con la API real

- **Estado:** PENDIENTE · **Ola:** 5
- **Deps:** UI-05 (falta), UI-06 (falta), AI-05 (falta), AI-13 (falta), AI-14 (falta), AI-15 (falta), SRV-10 (falta), BND-04
- **owns:** `scripts/demo_api_snapshot.py`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1237
  - Create: `scripts/demo_api_snapshot.py`
  - Test: `tests/demo/test_demo_api_snapshot.py`
- **Commit:** `feat(demo): instantánea de la API real sobre fixtures sintéticos [UI-20]`
- **Review Focus:** ítem P09-6 (lado servidor): `quiz_keys` solo existe en la instantánea del demo; el script no abre sockets (`TestClient` en proceso).
- **Definition of Done:** DoD v2; la instantánea completa pesa < 15 MB.
- **Verificación del plan:** `uv run pytest tests/demo -v` → Expected: PASS.
- **Notas del conductor:** La instantánea del demo sale de la API real sobre fixtures sintéticos. Riesgo: el dictado necesita tarjetas `phrase` con audio `done`; si los fixtures no las traen, detente y dilo.

#### UI-22: E2E v2 sobre el build demo (Playwright + axe)

- **Estado:** PENDIENTE · **Ola:** 6
- **Deps:** UI-12 (falta), UI-13 (falta), UI-14 (falta), UI-15 (falta), UI-16 (falta), UI-17 (falta), UI-18 (falta), UI-19 (falta), UI-20 (falta), UI-21 (falta), CHG-14 (falta), CHG-15
- **owns:** `web/playwright.v2.config.ts`, `web/e2e-v2/`
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1351
  - Create: `web/playwright.v2.config.ts`, `web/e2e-v2/helpers.ts`, `web/e2e-v2/auth.e2e.ts`, `nav.e2e.ts`, `hoy.e2e.ts`, `temas.e2e.ts`, `repasar.e2e.ts`, `pronunciacion.e2e.ts`, `quiz.e2e.ts`, `chat.e2e.ts`, `mas.e2e.ts`, `offline.e2e.ts`, `a11y.e2e.ts`
  - Modify (R-01, solo agregar): `web/package.json`, `web/package-lock.json` (`npm install --save-dev --save-exact @axe-core/playwright@4.14.0`; MPL-2.0, permitida por Global Constraints v1)
  - Test: los mismos `*.e2e.ts`
- **Commit:** `test(web): e2e v2 sobre el demo con axe, 44 px y modo sin conexión [UI-22]`
- **Review Focus:** ítem P09-8 (parte de navegador) e ítem P09-4 (`offline.e2e.ts`).
- **Definition of Done:** DoD v2; el PR adjunta el resumen de Playwright de los dos proyectos.
- **Verificación del plan:** `npx --prefix web playwright install --with-deps chromium webkit && cd web && npx playwright test -c playwright.v2.config.ts` → Expected: PASS en `mobile-chromium` y `mobile-webkit`.
- **Notas del conductor:** Playwright + `@axe-core/playwright` 4.14.0 (dev, MPL-2.0). El `webServer` tarda; usa los timeouts del plan. Corre `cd web && npx playwright test`.

#### CHG-16: Retiro de la web v1, demo v2 en Pages y e2e v2 en CI

- **Estado:** PENDIENTE · **Ola:** 7
- **Deps:** UI-22 (falta), OPS-01, OPS-06, CHG-14 (falta), CHG-15
- **owns:** (vacío: tarea CHG, sus archivos están en Touches)
- **Plan:** `docs/superpowers/plans/2026-11-02-09-rediseno.md`, línea 1409
  - **Touches** (R-31): borra `web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/routes/` (v1 completo), `web/src/crypto/`, `web/src/data/`, `web/src/progress/`, `web/src/srs/store.ts` y `store.test.ts` (queda `scheduler.ts`/`types.ts`), `web/src/ui/layout/RequireUnlocked.tsx`, `lockStatus.ts`, `Placeholder.tsx`, `Layout.tsx`, `web/src/ui/theme.css`, `web/src/ui/layout/theme.test.ts` (su verificación de contraste vive ya en UI-02), `web/e2e/`, `web/playwright.config.ts`; edita `web/src/main.tsx` (solo v2), `web/src/ui/viewers/*`, `web/src/ui/AudioPlayer.tsx` y `web/src/ui/pron/PracticeSession.tsx` (quita los envoltorios con `useContent`), `web/src/pron/recognizer.ts` (quita `createAzureRecognizer`/`getRecognizer` con clave), `web/src/sw/pwaConfig.ts` (quita las reglas `d/*.bin` y `bundle.json` y `globIgnores` de `data/`), `web/src/sw/PwaStatus.tsx` (queda solo `UpdatePrompt`), `web/src/i18n/es.ts` (quita claves sin uso), `.github/workflows/e2e.yml`, `.github/workflows/pages.yml`, `docs/superpowers/plans/2026-11-02-00-v2-master-plan.md` («Tareas v1 canceladas y lo que queda solo para el demo»). Tests: los que quedan en verde tras el borrado.
- **Commit:** `chore(web): retira la web v1 y publica el demo v2 en Pages [CHG-16]`
- **Review Focus:** ítem P09-6 en CI; ningún archivo de `tasks.yaml` v1 cambia (las tareas WEB/PRN siguen en el grafo como historia, igual que LIVE-02/03).
- **Definition of Done:** DoD v2; el workflow `pages` publica el demo v2 y el `e2e` corre `e2e-v2` y el guardián.
- **Verificación del plan:** `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test && cd web && npx playwright test -c playwright.v2.config.ts && npm run build && node scripts/check-no-demo.mjs dist && cd .. && uv run pytest tests/agents -v` → Expected: PASS.
- **Notas del conductor:** Retira la web v1 solo cuando UI-22 está en verde. Conserva `tests/fixtures/demo_state.sql` y `demo_audio/` (los usa UI-20).

