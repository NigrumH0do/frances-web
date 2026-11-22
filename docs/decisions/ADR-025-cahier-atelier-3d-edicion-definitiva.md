# ADR-025: Cahier Atelier 3D — Edición Definitiva

**Estado:** Aceptado (2026-11-21)
**Tarea:** GOV-01
**Reemplaza en parte:** ADR-018 (paleta, escala tipográfica y quiebres 1100/1200) y ADR-023 (oro único `--c-gold`, reloj de movimiento redeclarado en `motion.css`, y un renderer WebGL nuevo por ruta)
**Plan:** P13, `docs/superpowers/plans/2026-11-21-13-cahier-edicion-definitiva.md`

## Contexto

ADR-018 fijó el cuaderno Seyès y ADR-023 añadió escenas WebGL, pero el árbol quedó con dos identidades (papel frío `#f7f7fb` / pizarra `#121917` frente al metal usado como texto), un botón de grabar oscuro por debajo de AA, tres quiebres que se pisan (900 / 1100 / 1200) y un riel mudo de 88 px, y un reloj de movimiento declarado dos veces. Cada ruta abría su propio `WebGLRenderer`. Esta decisión cierra esa edición: una paleta, tres voces, un quiebre, un reloj y una frontera estricta del 3D. La implementación vive en el plan P13. ADR-018 y ADR-023 siguen aceptados en lo que aquí no se reemplaza (Seyès solo donde hay francés, un oficio por color, texto libre, `three` diferido, `frances.motion3d`).

El hex sRGB es el valor. Los pares de texto de `tokens.test.ts` solo ven literales `#[0-9a-fA-F]{6}`: no resuelven `var()`.

## Decisión

### 1. Paleta «Papel Seyès de taller» y «Pizarra nocturna azul-pizarra»

Claro en `:root` y, con los mismos hex, en `:root.theme-light`. Oscuro, con los mismos hex y el mismo orden, en `:root:not(.theme-light)` dentro de `prefers-color-scheme: dark` y en `:root.theme-dark`.

| Token | Claro | Oscuro |
|---|---|---|
| `--c-bg` | `#f8f6ed` | `#10131a` |
| `--c-surface` | `#efece0` | `#171b23` |
| `--c-card` | `#fefcf8` | `#1e242c` |
| `--c-card-raised` | `#f9f4e7` | `#282f3a` |
| `--c-border` | `#dad7cf` | `#343a42` |
| `--c-border-strong` | `#666875` | `#9e9b90` |
| `--c-overlay` | `rgb(28 31 41 / 46%)` | `rgb(7 9 14 / 64%)` |
| `--c-text` | `#232430` | `#e8e6df` |
| `--c-text-muted` | `#464856` | `#c0beb4` |
| `--c-text-faint` | `#545662` | `#adaba1` |
| `--c-text-placeholder` | `#585a65` | `#a2a098` |
| `--c-accent` | `#2147a3` | `#98b9fa` |
| `--c-accent-strong` | `#15378b` | `#b0c9fb` |
| `--c-accent-soft` | `#e6eeff` | `#212d46` |
| `--c-on-accent` | `#fbfaf7` | `#111c34` |
| `--c-on-accent-soft` | `#1b387b` | `#bfd1f6` |
| `--c-success` | `#006150` | `#86d2c1` |
| `--c-success-soft` | `#def7ef` | `#163029` |
| `--c-warning` | `#7c4607` | `#efaf6f` |
| `--c-warning-soft` | `#fcf1d4` | `#3b2c19` |
| `--c-warning-border` | `#7c4607` | `#efaf6f` |
| `--c-danger` | `#a4283a` | `#f18790` |
| `--c-danger-soft` | `#ffedea` | `#3e2522` |
| `--c-record` | `#a02a26` | `#a63933` |
| `--c-on-record` | `#ffffff` | `#ffffff` |
| `--c-highlight` | `#f7e16b` | `#e2d175` |
| `--c-on-highlight` | `#232430` | `#292010` |
| `--c-gold` | `#714d00` | `#d7d688` |
| `--c-gold-soft` | `#fbf0cf` | `#392d18` |
| `--c-gold-3d` | `#d3ac41` | `#d9b65e` |
| `--c-streak` | `#714d00` | `#d7d688` |
| `--c-streak-soft` | `#fbf0cf` | `#392d18` |
| `--c-rate-again` | `#a4283a` | `#f18790` |
| `--c-rate-hard` | `#7c4607` | `#efaf6f` |
| `--c-rate-good` | `#006150` | `#86d2c1` |
| `--c-rate-easy` | `#2147a3` | `#98b9fa` |
| `--focus-ring` | `3px solid #2147a3` | `3px solid #b0c9fb` |
| `--skeleton-a` | `#e7e3d6` | `#1c2129` |
| `--skeleton-b` | `#f4f0e4` | `#262c36` |

Pauta Seyès, igual en ambos bloques claros; en oscuro sustituye la pauta anterior. `--rule-step: 8px` en los dos modos.

| Token | Claro | Oscuro |
|---|---|---|
| `--rule-line` | `rgb(120 104 196 / 20%)` | `rgb(232 230 223 / 8%)` |
| `--rule-line-strong` | `rgb(120 104 196 / 38%)` | `rgb(232 230 223 / 16%)` |
| `--rule-grid` | `rgb(120 104 196 / 10%)` | `rgb(232 230 223 / 5%)` |
| `--rule-margin` | `rgb(164 40 58 / 58%)` | `rgb(241 135 144 / 55%)` |

Oficio de cada color:

- `--c-gold` (`#714d00` / `#d7d688`) es solo texto y chips de racha, con contraste AA. Prohibido como luz WebGL.
- `--c-gold-3d` (`#d3ac41` / `#d9b65e`) es solo WebGL (campo `gold3d` de la paleta de escena) e iconos de al menos 32 px. Prohibido en la propiedad `color:`.
- `--c-streak` y `--c-streak-soft` repiten el hex de `--c-gold` y `--c-gold-soft`. No se escriben como `var(...)`: `tokens.test.ts` exige el literal.
- `--c-rate-again`, `--c-rate-hard`, `--c-rate-good` y `--c-rate-easy` llevan el hex literal de danger, warning, success y accent, en los dos modos, por la misma razón.
- `--c-ok` es `var(--c-success)`. Prohibido en `motion.css` (el anillo lee `--c-success` o `--c-score-*`).
- `--c-info` es `var(--c-accent)` y `--c-info-soft` es `var(--c-accent-soft)`.
- `--c-score-excelente`, `--c-score-bien`, `--c-score-mejorable` y `--c-score-repetir` son `var(--c-success)`, `var(--c-accent)`, `var(--c-warning)` y `var(--c-danger)`.
- El botón de grabar usa `--c-record` / `--c-on-record`. El blanco sobre `#a02a26` y sobre `#a63933` queda por encima de 4.5:1.

`theme-color` del documento sigue al tema efectivo: `#2147a3` en claro y `#10131a` en oscuro.

### 2. Tres voces tipográficas

- **Spectral** (`@fontsource/spectral`, ya en el repo) para el francés, los títulos editoriales y la cifra de display. El corte `latin-700.css` se carga solo para los displays `--fs-2xl` y `--fs-3xl` (`font-weight: 700` en esas piezas). No es un paquete nuevo.
- **Lexend Variable** para la interfaz en español. `--fw-bold: 650`. Los títulos de UI que ya fijan `--fw-semibold` siguen en 600. No se asigna 650 a Spectral.
- **`ui-monospace`**, con `font-style: normal`, para IPA, teclas y cifras tabulares (`font-variant-numeric: tabular-nums`). El IPA deja de ir en Spectral italic.

Escala (anclas 360 y 1200; `--fs-xs` fijo): `--fs-xs: 0.8125rem`, `--fs-sm: clamp(0.875rem, 0.848rem + 0.119vw, 0.9375rem)`, `--fs-md: clamp(1rem, 0.946rem + 0.238vw, 1.125rem)`, `--fs-lg: clamp(1.25rem, 1.143rem + 0.476vw, 1.5rem)`, `--fs-xl: clamp(1.5625rem, 1.375rem + 0.833vw, 2rem)`, `--fs-2xl: clamp(1.9375rem, 1.697rem + 1.071vw, 2.5rem)`, `--fs-3xl: clamp(2.4375rem, 1.982rem + 2.024vw, 3.5rem)`. Medidas: `--measure-ui: 66ch`, `--measure-fr: 42ch`, `--measure-read: 64ch`, `--measure-chat: 68ch`.

### 3. Un quiebre, un riel, tres anchos

El único quiebre es el literal `960px`. El token `--bp-rail: 960px` es el contrato que leen los tests. Una `@media` no acepta `var(--bp-rail)`: todas las queries escriben `960px`. Si el número cambia, cambian el token y las queries en el mismo cambio.

- Desde 960 px el riel es `position: sticky`, `width: var(--rail-w)` con `--rail-w: 232px`, `height: 100dvh`, marca y etiquetas visibles.
- Bajo 960 px la barra es fija al fondo, ancho completo, `z-index: 30`, altura `calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 8px)`. El `padding-bottom` de `<main>` usa exactamente esa expresión. Desde 960 px el `padding-bottom` vuelve a `var(--sp-10)`.
- Anchos de columna: `.content` `720px`, `.content.content-repasar` `840px` (solo `pathname === '/repasar'`), `.content.content-split` `1120px` (`/`, `/repasar/texto`, `/publicacion…`, `/chat`, `/mas/admin`, `/admin`).

Se retiran los quiebres 900, 1100 y 1200, el riel de 88 px, el tope de 760 px y la clase `content-wide`.

### 4. Un reloj, en `tokens.css`

| Token | Valor |
|---|---|
| `--dur-fast` | `140ms` |
| `--dur-base` | `220ms` |
| `--dur-med` | `320ms` |
| `--dur-flip` | `420ms` |
| `--dur-slow` | `520ms` |
| `--ease` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--ease-atelier` | `var(--ease)` |

`prefers-reduced-motion: reduce` y `html.motion-off` ponen las cinco duraciones a `0ms`. `motion.css` no declara `--dur-*`. Las únicas propiedades animables en una transición son `transform`, `opacity` y `stroke-dashoffset`.

### 5. Frontera del 3D, Seyès y `SceneHost v2`

La pauta Seyès (`.paper`) solo aparece donde se lee o escribe francés.

El 3D ocupa exactamente cuatro escenas:

| Escena | Ruta |
|---|---|
| Cuaderno | `/entrar` |
| Brújula | `/` |
| Orbe | `/repasar/pronunciacion`, `/repasar/texto` |
| Ráfaga | `/repasar` |

Chat, Quiz, Temas, Publicación, Admin, Ajustes y el volteo de `FlipCard` se quedan en DOM y CSS. El volteo no monta una escena.

`SceneHost v2` mantiene un único `WebGLRenderer` por pestaña (`NeutralToneMapping`, `toneMappingExposure = 1`, `SRGBColorSpace`). Al salir de una ruta hace `park()` (lienzo a 1×1, sin perder el contexto en cada navegación). `createLevelMeter` engancha un `AnalyserNode` al `MediaStream` que ya abrió el grabador: no hay una tercera captura de micrófono. El anillo de puntaje (`ScoreRing`) es un arco proporcional continuo, con icono y palabra de banda, y la cifra en `--c-text`; no comparte círculo con un `strokeDasharray` discontinuo ni usa `var(--c-ok)`.

El chunk `three` no entra en el precache de la PWA. Su presupuesto es ≤ 160 KiB gzip. No se añade `react-three-fiber`, `drei`, `three/addons` ni modelos `.glb`.

### 6. Invariantes

- `POST /api/speech/usage` no cambia: sin rate-limit nuevo, sin cambio de cuerpo, sin test nuevo de abuso de cuota.
- Los contratos quedan intactos: `src/frances/models/`, `src/frances/db/migrations/`, `contracts/` y `web/src/contracts/`. Cero migración, cero `frances schema export` con diff, cero `gen:types` con diff.
- Cero dependencias nuevas en `pyproject.toml` y en `web/package.json`.

## Consecuencias

- La skill `.agents/skills/cahier-3d-atelier/SKILL.md` describe esta edición y deja de citar la paleta fría, el oro único y los quiebres 900/1100/1200 como valores vigentes.
- Quien implemente una pantalla o una escena lee este ADR y el plan P13. No reinterpreta el hex, el quiebre ni el campo `gold3d`.
- Un rollback del tren de diseño no revierte el cierre de conexiones de `BUG-01` ni los arreglos ya fusionados de F1–F4: van en ramas distintas, como fija el plan P13.
