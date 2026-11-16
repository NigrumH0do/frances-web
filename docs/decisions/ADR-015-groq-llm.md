# ADR-015: Proveedor LLM Groq (Qwen 3.8 27B)

**Estado:** Reemplazado por ADR-016 (OneRouter / `qwen/qwen3.8-27b:free`, 2026-11-08)
**Reemplaza a:** ADR-006 (Kiosapi / `glm-5.3-flash-free`)
**Complementa:** ADR-008 (riesgo de enviar textos del curso a un tercero)

## Decisión

- **Proveedor:** Groq — `LLM_BASE_URL = https://api.groq.com/openai/v1`
- **Modelo:** `LLM_MODEL = qwen/qwen3.8-27b`
- **Auth:** `Authorization: Bearer <LLM_API_KEY>`.
- **Cliente:** el mismo `LlmGenerator` de CRD-04/CHG-08; no cambia código.
- **Formato estructurado:** Groq acepta `response_format` con `json_schema`
  estricto para `qwen/qwen3.8-27b`. `allam-2-7b` lo rechaza con HTTP 400.

## Evidencia (2026-11-08)

Catálogo de la key (modelos de chat): `openai/gpt-oss-120b`,
`openai/gpt-oss-20b`, `qwen/qwen3.8-27b` y `allam-2-7b` (además de audio y
guardas).

| Modelo | Chat simple | JSON schema | Cards (AI-17) | Sheet / Topics / Plan / Chat |
|---|---:|---:|---|---|
| `qwen/qwen3.8-27b` | ~0,3 s | 0,24 s OK | 2/4 | 1/1 en cada uno; quiz 0/1 |
| `openai/gpt-oss-120b` | 0,37 s | 0,50 s OK | 1/3 medido; el resto 429 | sheet no medido por 429 |
| `openai/gpt-oss-20b` | 0,26 s | 0,44 s OK | HTTP 400 con el schema grande | HTTP 400 |
| `allam-2-7b` | 0,34 s | HTTP 400: no soporta `json_schema` | — | — |

- `qwen/qwen3.8-27b` pasa los casos de `cards` `familia` y `numeros`; falla
  `pasado` por anclaje de tarjetas y recibió un 503 en `saludos` en una
  corrida. El pipeline descarta las tarjetas no ancladas (CHG-10) y cae a
  reglas cuando no quedan suficientes.
- El quiz por LLM falla los validadores de AI-03 con más frecuencia que el
  resto; el respaldo por reglas de AI-08 sigue siendo el camino seguro.
- El free tier de Groq limita a **1000 peticiones/día y 8000 tokens/minuto**.
  Una ráfaga de casos grandes produce `429`; una llamada de `cards` puede
  consumir buena parte del minuto. El cliente no reintenta `429`: el trabajo
  queda para el backoff de la cola.
- `gpt-oss-120b` es una alternativa de más calidad, pero más lenta y con el
  mismo límite de tokens.

## Consecuencias

- El entorno de producción usa:
  `LLM_BASE_URL=https://api.groq.com/openai/v1`,
  `LLM_MODEL=qwen/qwen3.8-27b` y la clave de Groq solo en
  `/srv/frances/.env`.
- `infra/env.example`, `infra/README.md` y el paso 4 de GOL-02 se actualizan
  a Groq.
- Si el LLM falla o se agota la cuota, se mantiene la degradación prevista:
  tarjetas por reglas, fichas base, temas de Classroom, quizzes por reglas y
  plan sin «por qué»; el chat no está disponible.
- La clave nunca se escribe en el repo, en un ADR, en un fixture ni en un log.
