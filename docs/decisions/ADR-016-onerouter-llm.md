# ADR-016: Proveedor LLM OneRouter (Qwen 3.8 27B free)

**Estado:** Aceptado (decisión del dueño, 2026-11-08)
**Reemplaza a:** ADR-015 (Groq / `qwen/qwen3.8-27b`)
**Complementa:** ADR-008 (riesgo de enviar textos del curso a un tercero)

## Decisión

- **Proveedor:** OneRouter — `LLM_BASE_URL = https://llm.onerouter.pro/v1`
- **Modelo:** `LLM_MODEL = qwen/qwen3.8-27b:free`
- **Auth:** `Authorization: Bearer <LLM_API_KEY>`.
- **Cliente:** el mismo `LlmGenerator` de CRD-04/CHG-08; no cambia código.
- **Formato estructurado:** acepta `response_format` con `json_schema` estricto.

## Evidencia (2026-11-08)

- `chat` simple: HTTP 200 en ~0,7 s.
- JSON schema simple: HTTP 200 en ~0,65 s.
- AI-17 `cards`: 2/4 aprobados, p50 26,8 s, p95 63,1 s.
- AI-17 `sheet`: 3/4 aprobados, p50 17,4 s, p95 19,1 s.
- `quiz`, `topics`, `plan_why` y `chat`: 1/1 en el primer caso de cada uno.
- No se observó el límite de 8000 tokens/min de Groq; la latencia es mayor.
- El modelo sigue fallando parte de `cards` y `sheet`; el pipeline debe descartar
  tarjetas no ancladas y caer a reglas cuando no queden suficientes.

## Consecuencias

- El entorno de producción usa:
  `LLM_BASE_URL=https://llm.onerouter.pro/v1`,
  `LLM_MODEL=qwen/qwen3.8-27b:free` y la clave de OneRouter solo en
  `/srv/frances/.env`.
- `infra/env.example`, `infra/README.md` y el paso 4 de GOL-02 se actualizan a
  OneRouter.
- Si el LLM falla o se agota la cuota, se mantiene la degradación prevista:
  tarjetas por reglas, fichas base, temas de Classroom, quizzes por reglas y
  plan sin «por qué»; el chat no está disponible.
- La clave nunca se escribe en el repo, en un ADR, en un fixture ni en un log.
