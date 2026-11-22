---
name: cahier-3d-atelier
description: Sistema de diseño y animación WebGL "Cahier Atelier 3D — Edición Definitiva" (ADR-025) para Frances Classroom. Úsalo al diseñar pantallas, micro-interacciones, escenas Three.js y estilos CSS en web/src.
---

# Cahier Atelier 3D — Edición Definitiva (ADR-025)

Fuente normativa: `docs/decisions/ADR-025-cahier-atelier-3d-edicion-definitiva.md` y el plan P13 `docs/superpowers/plans/2026-11-21-13-cahier-edicion-definitiva.md`. El hex de abajo es el valor vigente. No reintroduzcas la paleta fría, el oro único ni los quiebres retirados.

## Identidad visual

Papel Seyès de taller en claro y pizarra nocturna azul-pizarra en oscuro. Tokens vivos de `web/src/design/tokens.css`.

| Token | Claro | Oscuro | Oficio |
|---|---|---|---|
| `--c-bg` | `#f8f6ed` | `#10131a` | Lienzo |
| `--c-surface` | `#efece0` | `#171b23` | Pozo y bandas |
| `--c-card` | `#fefcf8` | `#1e242c` | Hoja. La escena la lee como `paper` |
| `--c-accent` | `#2147a3` | `#98b9fa` | Tinta. `--c-info` es `var(--c-accent)` |
| `--c-record` / `--c-on-record` | `#a02a26` / `#ffffff` | `#a63933` / `#ffffff` | Botón de grabar, AA |
| `--c-success` | `#006150` | `#86d2c1` | Acierto. La escena lo lee como `ok` |
| `--c-gold` | `#714d00` | `#d7d688` | Solo texto y chips de racha, AA |
| `--c-gold-3d` | `#d3ac41` | `#d9b65e` | Solo WebGL (`gold3d`) e iconos ≥ 32 px |

- `--c-gold` no es luz de escena. `--c-gold-3d` no va en `color:` ni en texto de 16 px.
- `--c-streak` / `--c-streak-soft` y `--c-rate-again|hard|good|easy` se escriben con hex literal (los mismos que oro, danger, warning, success y accent). `tokens.test.ts` no resuelve `var()`.
- `--c-ok` es `var(--c-success)` y vive solo en `tokens.css`. Prohibido en `motion.css`. El anillo usa `--c-success` o `var(--c-score-${band})`.
- `--c-score-excelente|bien|mejorable|repetir` = success, accent, warning, danger.
- Seyès (`.paper`) solo donde hay francés. Chat, Quiz, Temas, Publicación, Admin y Ajustes no ganan `.paper`.

## Tipografía

Tres voces, autoalojadas, `font-src 'self'`, sin CDN:

- **Spectral**, más `@fontsource/spectral/latin-700.css`, para francés, títulos editoriales y displays `--fs-2xl` / `--fs-3xl` (`font-weight: 700`).
- **Lexend Variable** para la UI en español. `--fw-bold: 650`. No apliques 650 a Spectral.
- **`ui-monospace` recto** (`font-style: normal`, `font-weight: 450`) para IPA, teclas y cifras tabulares (`tabular-nums`). El IPA no vuelve a Spectral italic.

## Quiebre único `960px`

- Token `--bp-rail: 960px`. Las `@media` escriben el literal `960px`, nunca `var(--bp-rail)`.
- Desde 960 px: riel `--rail-w: 232px`, `height: 100dvh`, marca y etiquetas visibles.
- Bajo 960 px: barra fija al fondo. `<main>` reserva exactamente `calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 8px)` en `padding-bottom`.
- Anchos: `.content` 720 px, `.content.content-repasar` 840 px (solo la ruta `/repasar`), `.content.content-split` 1120 px.
- Retirados y prohibidos de nuevo: quiebres 900 / 1100 / 1200, riel de 88 px, tope de 760 px y la clase `content-wide`.

## Reloj único y movimiento

Solo `tokens.css` declara el reloj: `--dur-fast: 140ms`, `--dur-base: 220ms`, `--dur-med: 320ms`, `--dur-flip: 420ms`, `--dur-slow: 520ms`, `--ease: cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-atelier: var(--ease)`.

`@media (prefers-reduced-motion: reduce)` y `html.motion-off` ponen las cinco duraciones a `0ms`. `motion.css` no declara `--dur-*`. La clase que apaga el 3D en el DOM es `html.motion-off` (la escribe `motionPref.ts`); no inventes otro selector.

En `transition` solo entran `transform`, `opacity` y `stroke-dashoffset`. Sin `box-shadow`, `width`, `background` ni `background-position` animados. El tilt de `FlipCard` solo corre si `pointerType === 'mouse'`.

## Frontera 3D y `SceneHost v2`

3D solo en cuatro escenas: Cuaderno (`/entrar`), Brújula (`/`), Orbe (`/repasar/pronunciacion` y `/repasar/texto`) y Ráfaga (`/repasar`). El volteo de la tarjeta sigue en CSS.

- Un solo `WebGLRenderer` por pestaña (`SceneHost v2`): `NeutralToneMapping`, `toneMappingExposure = 1`, `SRGBColorSpace`, `antialias: false`, `powerPreference: 'low-power'`. Al cambiar de ruta, `park()` (lienzo 1×1, sin `forceContextLoss` en cada desmontaje).
- La paleta de escena lee `--c-gold-3d` en `gold3d` (`#d3ac41` / `#d9b65e`). No leas `--c-gold` ni `--c-ok` desde WebGL.
- `createLevelMeter` reutiliza el `MediaStream` del grabador. Cero `getUserMedia` dentro del medidor y cero tercera captura. `resumeFromGesture()` es síncrono, antes del primer `await`.
- `ScoreRing`: arco continuo con `var(--c-score-${band})`, icono y palabra, cifra en `--c-text`. Sin trazo discontinuo sobre el mismo círculo.
- Imports con nombre (`import { ... } from 'three'`). Sin `import * as THREE`, `three/addons`, `react-three-fiber`, `drei` ni `.glb`.
- El chunk `three` no entra en el precache de la PWA. Presupuesto ≤ 160 KiB gzip.
- Puntero en `window` y tilt: ignorar todo `pointerType !== 'mouse'`.

## Invariantes

`POST /api/speech/usage` no se toca. Tampoco `src/frances/models/`, `src/frances/db/migrations/`, `contracts/` ni `web/src/contracts/`. Cero dependencias nuevas.
