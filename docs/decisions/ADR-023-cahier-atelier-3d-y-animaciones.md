# ADR-023: Sistema visual «Cahier Atelier 3D» y animaciones WebGL

Aceptado. El oro único `--c-gold`, el reloj duplicado en `motion.css` y el renderer por ruta quedan reemplazados por ADR-025.

**Estado:** Aceptado (2026-11-19)
**Tarea:** CHG-25

## Contexto

La interfaz «Cahier» (ADR-018) estableció una base editorial clara y accesible, pero carecía de profundidad visual, transiciones fluidas entre pantallas y retroalimentación espacial en los momentos clave de estudio (portada de acceso, racha diaria, estudio con tarjetas 3D, práctica de pronunciación y paneles administrativos). Se requiere una evolución con nivel de detalle senior manteniendo tiempos rápidos de arranque, accesibilidad estricta y funcionamiento sin errores en navegadores sin WebGL o bajo `prefers-reduced-motion`.

## Decisión

1. **Motor 3D ligero con aislamiento estricto de bundle (`three@0.187.0`):**
   - Se fijan las versiones exactas `three@0.187.0` y `@types/three@0.187.0` (licencia MIT).
   - Toda escena (`AuthNotebookScene`, `StreakCompassScene`, `VoiceOrbScene`, `CardBurstScene`) se importa exclusivamente vía `web/src/three/LazyScenes.tsx` mediante `React.lazy`, `<Suspense fallback={null}>` y un límite de error que degrada al equivalente CSS sin lanzar errores en consola.
   - El código usa geometría procedimental ligera sin modelos `.glb`, texturas externas ni llamadas de red.

2. **Ciclo de vida y presupuesto gráfico (`web/src/three/createSceneHost.ts`):**
   - `devicePixelRatio` limitado a `<= 2`, `powerPreference: 'low-power'` y `alpha: true` con colores acoplados a los tokens CSS del tema activo (`light` / `dark`).
   - Pausa automática de `requestAnimationFrame` cuando la pestaña se oculta (`visibilitychange`) o el lienzo sale del viewport (`IntersectionObserver`).
   - Liberación explícita de geometrías, materiales y `renderer.dispose()` al desmontar.

3. **Accesibilidad y control del usuario (`web/src/three/motionPref.ts`):**
   - Se respeta `prefers-reduced-motion: reduce` del sistema y la preferencia local `frances.motion3d` (`'auto' | 'off'`), configurable desde `Ajustes` (`/mas`).
   - En entornos sin soporte WebGL (p. ej. `jsdom` en pruebas o hardware restringido), `shouldRender3d()` devuelve `false` y las pantallas muestran su versión editorial en CSS puro.

4. **Capa de movimiento CSS y tipografía autoalojada (`web/src/design/motion.css`):**
   - Micro-interacciones compuestas únicamente con `transform` y `opacity` (`--ease-atelier`), perspectiva suave al puntero en `FlipCard`, anillo SVG `.score-ring` en `ScoreSummary` y diseño en dos columnas `.pub-split` para lectura + ficha en escritorio.
   - Tipografía autoalojada con `@fontsource/spectral`, `@fontsource-variable/lexend` y `ui-monospace`, cumpliendo `font-src 'self'` en Caddy sin CDN externas.

## Consecuencias

- El paquete inicial de la aplicación no incluye `three`; el chunk WebGL se descarga bajo demanda solo cuando el navegador soporta WebGL y el usuario mantiene activadas las animaciones 3D.
- Todos los controles nuevos conservan el tamaño táctil mínimo `--tap: 44px`, contraste WCAG AA y compatibilidad completa con navegación por teclado y lectores de pantalla.
