# Maquetas v2 — Frances Classroom

> **Histórico de diseño.** Estas maquetas se aprobaron en ADR-009 y fijaron la
> estructura de las pantallas, que sigue igual. La paleta (azul `#1d4ed8`) y las
> fuentes (Georgia y la del sistema) de abajo las reemplazó ADR-018 con el sistema
> «Cahier»: papel Seyès en claro, pizarra en oscuro, tinta `#2b37b8`, rojo de
> corrección `#c22636`, Spectral para el francés y Lexend para la interfaz. Los
> tokens vigentes están en `web/src/design/tokens.css`.

Maquetas HTML estáticas de fidelidad media para el rediseño de la spec v2
(`docs/superpowers/specs/2026-11-02-frances-v2-servidor-design.md`, §6–§8).
Todos los datos son sintéticos. Sin build ni dependencias: abre `index.html`.

| Archivo | Contenido |
|---|---|
| `tokens.css` | Variables: color claro/oscuro, tipografía, espaciado, radios, sombras, movimiento |
| `app.css` | Componentes construidos sólo con los tokens |
| `components.html` | Catálogo: botones, chips, tarjeta con volteo, reproductor, listas, estados, quiz (5 tipos), pronunciación, chat |
| `hoy.html`, `temas.html`, `tema-detalle.html`, `repasar.html`, `chat.html`, `mas.html` | Pantallas en marco 390×844 |
| `screens/*.png` | Capturas claro/oscuro (Chromium headless, 390×844) |

Parámetros: `?theme=dark|light` fuerza el tema (si no, sigue al sistema;
el botón «Tema» lo alterna y se recuerda); `repasar.html?flip=1` abre la
tarjeta por el reverso.

## Decisiones

1. **Paleta del dueño, ampliada.** Se conservan el azul `#1d4ed8`, los grises
   y la serif para francés de `web/src/ui/theme.css`; se añade una paleta
   oscura propia (no invertida) con acentos aclarados. Todos los pares de texto
   pasan AA (≥ 4.5:1, verificado con script; cifras en la cabecera de
   `tokens.css`) y los bordes de control ≥ 3:1.
2. **Serif = francés de estudio.** Georgia sólo en el contenido que se lee o
   pronuncia (tarjetas, frases, quiz, palabras con puntaje); los títulos y
   metadatos en francés usan la fuente de la UI para no mezclar estilos.
3. **Hoy es un plan, no un panel.** Una lista corta de tareas con tiempo
   estimado, la próxima entrega de Classroom y la racha; el «por qué» del LLM
   es una línea opcional marcada como IA.
4. **El color nunca va solo.** Calificación FSRS con texto e intervalo; bandas
   de pronunciación (las de `ui/pron/score.ts`) con subrayado, número y
   etiqueta accesible; pestaña activa con píldora y negrita.
5. **La espera del LLM se explica.** El chat muestra «pensando» con
   cronómetro, pasos (buscar → redactar → citar), aviso de hasta 30 s y
   cancelar; cada respuesta lista sus fuentes (publicación + página) o dice que
   el material no lo cubre.
6. **Admin dentro de «Más».** Pipeline, trabajos fallidos, usuarios e
   invitaciones y edición de tarjeta viven al final de Más, separados por una
   cabecera «Administración»; el usuario normal no los ve.
7. **Accesibilidad.** Objetivos ≥ 44 px (chips de 36 px amplían su zona con un
   pseudoelemento), foco visible, `prefers-reduced-motion` anula volteo,
   esqueletos y spinners.
