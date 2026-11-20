# ADR-018: Sistema visual «Cahier» y práctica de texto libre

**Estado:** Aceptado (aprobado por el dueño, 2026-11-19)
**Tarea:** PRACTICE-01 (texto libre) y rediseño del front v2
**Reemplaza en parte:** ADR-009 (paleta y tipografía de las maquetas v2)

## Decisión

### Identidad visual

- La app se presenta como el cuaderno de francés del alumno. El modo claro es
  papel de cuaderno Seyès (fondo `#f7f7fb`, pauta lavanda, margen rojo); el
  modo oscuro es pizarra (`#121917`).
- Colores con un solo papel cada uno: tinta azul `#2b37b8` para actuar,
  boli rojo `#c22636` solo para lo que hay que repetir (grabar, «Otra vez»),
  subrayador `#ffe45c` para lo que pide atención (cuenta de Repasar).
- La pauta Seyès (`.paper`) solo aparece donde se lee o escribe francés: la
  cara de la tarjeta de repaso, el editor de texto libre y el acceso desde Hoy.
- Tipografía autoalojada con `@fontsource` (OFL-1.1, sin red): Spectral
  (Production Type, París) para el francés y los títulos; Lexend para la
  interfaz en español. Escala 1,25 sobre 16 px.
- Desde 1200 px el riel de navegación pasa a barra lateral con nombre; Hoy y
  Texto libre usan dos columnas desde 1100 px.
- El foco programático de `RouteFocus` no dibuja anillo sobre el `h1`
  (`tabindex=-1`); el foco de teclado (`:focus-visible`) sigue igual.

Contraste: todos los pares de texto ≥ 4,5:1 en ambas paletas (lo comprueba
`web/src/design/tokens.test.ts`); bordes de control ≥ 3:1.

### Texto libre (`/repasar/texto`)

- `POST /api/practice/tts {text, voice_id}` → `PracticeTtsOut`. El texto se
  normaliza (NFC, espacios colapsados), hasta 400 caracteres, con al menos una
  letra. La clave sale de `audio_request`, la misma de las tarjetas.
- La síntesis corre **dentro de la petición** con `run_audio_keys` (Edge, y
  Azure como respaldo si está configurado). Una clave ya hecha se devuelve sin
  red ni cupo. Tope: 120 clips nuevos por usuario y hora.
- El navegador pide el audio solo cuando el usuario deja de escribir 900 ms y
  guarda en memoria lo ya oído. Sin conexión, en el demo o si el servidor
  falla, ofrece la voz francesa del navegador (Web Speech API).
- «Pronúncialo» usa el recognizer con token de Azure (R-42). La voz grabada se
  guarda solo en memoria (`MediaRecorder` → `Blob`) para «Escucharme»; nunca
  va a disco, a IndexedDB ni a la red. Si la evaluación no está disponible, el
  usuario igual puede grabarse y comparar con el modelo.
- Los textos con audio se guardan en `localStorage` por usuario (8 últimos).

## Motivo

- La práctica oral estaba atada a las tarjetas generadas del curso. El alumno
  necesita practicar lo que quiera decir (una presentación, una pregunta para
  clase) sin esperar a la siguiente corrida del pipeline.
- La cola del worker atiende el pipeline diario; esperar ahí haría la práctica
  lenta. Edge tarda ~1,5 s por frase y la caché devuelve en ~15 ms.
- Las maquetas v2 usaban azul de sistema y la pila tipográfica del SO: la app
  se veía igual que cualquier formulario. El cuaderno da una identidad propia
  ligada al tema (aprender francés en clase) sin decorar las pantallas de
  gestión.

## Consecuencias

- Nuevo módulo de rutas `frances.api.routes.practice` (16 en
  `ROUTER_MODULES`) y modelos `PracticeTtsIn`/`PracticeTtsOut` en
  `contracts/api.schema.json`.
- El proceso de la API necesita red hacia Edge TTS para el texto libre; sin
  red responde `503 tts_unavailable` y la web usa la voz del navegador.
- Los clips de texto libre viven en la misma tabla `audio` y en
  `audio/{key}.mp3`; `prune` no los distingue de los de tarjetas.
- Dos dependencias web nuevas, con versión exacta: `@fontsource/spectral`
  5.3.0 y `@fontsource-variable/lexend` 5.3.0. Su licencia es OFL-1.1, que no
  está en la lista de Global Constraints (MIT/BSD/Apache-2.0/ISC/MPL-2.0). Son
  archivos de fuente, no código importado, pero la excepción la aprueba el
  dueño; si no se aprueba, se quitan los dos `@import` de `design/index.css` y
  la app vuelve a la pila del sistema sin otros cambios.
