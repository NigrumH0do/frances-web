# ADR-009: Aprobación de las maquetas v2

**Estado:** Aceptado
**Fecha:** 2026-11-02
**Tarea:** UI-01 (P09, `human: true`; spec v2 §8 y §12.4)

## Qué se aprueba

- Maquetas estáticas en `docs/design/v2/index.html`: Hoy, Temas (y detalle de tema), Repasar, Chat, Más y el catálogo de componentes.
- Las 14 capturas de `docs/design/v2/screens/`, en modo claro y oscuro.
- El sistema de diseño de `docs/design/v2/tokens.css` y `app.css`, y las decisiones de `docs/design/v2/README.md`:
  1. Paleta tomada del `theme.css` del dueño (azul `#1d4ed8`), con paleta oscura propia; texto AA (≥ 4,5:1) y bordes de control ≥ 3:1.
  2. Serif (Georgia) solo para el francés de estudio; la interfaz usa la fuente del sistema.
  3. Hoy es una lista de tareas con tiempo estimado, próxima entrega y racha; el «por qué» del LLM es una línea opcional marcada como IA.
  4. El color nunca va solo: la calificación FSRS lleva texto e intervalo; la pronunciación usa número, subrayado y etiqueta accesible.
  5. El chat muestra la espera de hasta 30 s (cronómetro, pasos y cancelar) y cada respuesta cita publicación y página o dice que el material no lo cubre.
  6. Las herramientas de admin van al final de «Más», bajo «Administración».

## Lo que P09 no construye aunque aparezca en las maquetas

- Minutos de estudio y recordatorio diario.
- «Sincronizado hace 2 h».
- «Crear tarjeta» desde el chat y «Editar» tarjeta (son de P11).
- Pantallas de administración (P09 solo deja el hueco en «Más»; las construye P11).

## Decisión

Apruebo. Sin cambios.

— Dueño del proyecto, 2026-11-02 (aprobado en la sesión de trabajo con el conductor).
