# ADR-008: Riesgo de enviar textos del curso a un LLM de terceros (OneRouter)

**Estado:** Aceptado
**Fecha:** 2026-11-02 (actualizado 2026-11-08: proveedor OneRouter, ADR-016)
**Tarea:** AI-18 (P10, `human: true`; spec v2 §9 y §12.5). Complementa ADR-006/ADR-015.

## Qué se envía

- Texto de las publicaciones de Classroom y de sus adjuntos extraídos (PDF, OCR).
- Resúmenes y tarjetas generados a partir de ese texto.
- Las preguntas que los usuarios hacen en el chat, junto con los fragmentos del material que el buscador recupera.
- Nunca: emails, nombres, ids de usuario ni datos de cuenta (AI-11).

## A quién

OneRouter (`LLM_BASE_URL = https://llm.onerouter.pro/v1`, modelo `qwen/qwen3.8-27b:free`, ADR-016). Es un servicio de terceros **sin acuerdo de tratamiento de datos** específico para este proyecto ni SLA. El material es de la profesora del curso. El riesgo aceptado originalmente se mantiene para OneRouter; el dueño puede apagarlo con `[llm] mode = "off"`.

## Cuánto

Hasta `llm.max_calls_per_day` llamadas al día (por defecto 300), contadas antes de cada llamada de red (CHG-08). El límite v1 de 30 publicaciones nuevas por día sigue vigente.

## Cómo se apaga

- `[llm] mode = "off"` y `[cards] llm = "off"` en la configuración.
- Sin `LLM_API_KEY` en el entorno, tampoco hay llamadas.

## Qué queda sin LLM

Fichas base, temas por los de Classroom, quizzes por reglas, plan del día sin «por qué» y tarjetas por reglas. El chat no está disponible.

## Decisión

Acepto el riesgo. El go-live (P12) puede desplegar con `mode = "auto"`.

— Dueño del proyecto, 2026-11-02 (aceptado en la sesión de trabajo con el conductor).
