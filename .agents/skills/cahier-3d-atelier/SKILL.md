---
name: cahier-3d-atelier
description: Sistema de diseño y animación WebGL "Cahier Atelier 3D" para Frances Classroom. Úsalo al diseñar pantallas, micro-interacciones, escenas Three.js y estilos CSS en web/src.
---

# Cahier Atelier 3D — Sistema de Diseño y Movimiento

## Identidad visual

- **Estética editorial («Cahier»):** cuaderno francés luminoso de papel cálido (`#F8F4EC`) sobre superficie elevada (`#FFFFFF`), o tinta nocturna profunda (`#13161F`) sobre slate (`#1B202C`).
- **Acentos:** azul cobalto (`#2346B8` / `#7EA3FF`), arcilla cálida (`#B93822`), latón dorado (`#C9A227`) y verde acierto (`#167A52`).
- **Tipografía:** `@fontsource/spectral` (lectura y títulos editoriales), `@fontsource-variable/lexend` (interfaz legible UI) y `ui-monospace` (fonemas IPA, métricas y teclados). Cero CDN externas: todas las fuentes viven embebidas localmente bajo `font-src 'self'`.

## Reglas de escenas Three.js (`web/src/three/`)

1. **Geometría procedimental ligera:** sin modelos `.glb` ni texturas remotas; usar mallas ligeras (`<= 4000` vértices), luces hemisféricas/direccionales suaves y paleta sincronizada con las variables CSS del tema activo.
2. **Carga diferida obligatoria:** importar cualquier escena a través de `web/src/three/LazyScenes.tsx` con `React.lazy` + `<Suspense fallback={null}>` + error boundary, para aislar el chunk `three` del arranque principal.
3. **Ciclo de vida estricto (`createSceneHost.ts`):**
   - Límite `devicePixelRatio <= 2`, `powerPreference: 'low-power'`, `alpha: true`.
   - Pausar loop `requestAnimationFrame` automáticamente con `IntersectionObserver` cuando sale de viewport y con `document.visibilitychange`.
   - Liberar **siempre** geometrías, materiales, texturas y `renderer.dispose()` al desmontar.
4. **Accesibilidad y preferencia del usuario (`motionPref.ts`):**
   - Si `prefers-reduced-motion: reduce`, preferencia local `'off'` (`frances.motion3d`) o ausencia de contexto WebGL (incluyendo `jsdom`), devolver `null` y mostrar el equivalente editorial en CSS puro sin errores de consola.

## Motion CSS (`web/src/design/motion.css`)

- Animaciones compuestas exclusivamente con `transform` y `opacity`.
- Curvas suaves de taller (`cubic-bezier(0.22, 1, 0.36, 1)`) para entrada de ruta, elevación de tarjetas, giro 3D de `FlipCard` e indicadores SVG `.score-ring`.
- Todo efecto queda neutralizado bajo `@media (prefers-reduced-motion: reduce)`.
- Respetar contraste WCAG AA (>= 4.5:1) y área táctil mínima `--tap: 44px` en controles móviles.
