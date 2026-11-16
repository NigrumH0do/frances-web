# Set de evaluación del LLM de estudio

Casos para validar las salidas del LLM de la capa de estudio (AI-03). Cada caso fija una
entrada, una salida válida escrita a mano (`expected`) y variantes rotas (`bad`) con el
problema que deben provocar. Los validadores viven en `src/frances/study/quality.py`.

**Todo es sintético.** Las lecciones son textos inventados por el autor de la tarea sobre
saludos, números, familia, rutina y el pasado compuesto. Nada sale de un curso real. Los
casos no contienen correos, enlaces de Classroom ni identificadores con forma de dato real,
y un test lo comprueba.

## Tareas

| Carpeta      | Qué prueba                                                                   |
|--------------|------------------------------------------------------------------------------|
| `cards/`     | Tarjetas: el `front_fr` aparece en el texto; las frases están en francés; `back_es` no está vacío. |
| `sheet/`     | Ficha: resumen de hasta 6 oraciones, 1 a 5 objetivos, ejemplos y frases ancladas. |
| `topics/`    | Temas: ids de publicación válidos y completos, títulos y keys únicos, publicaciones y temas fijos respetados. |
| `quiz/`      | Preguntas `mcq`, `cloze`, `translate` y `order` con sus reglas y `source_block` válido. |
| `plan_why/`  | Motivos del plan: una línea por posición, sin posiciones ajenas y de 30 palabras como máximo. |
| `chat/`      | Respuestas con citas `[n]` dentro de rango. Dos casos no tienen material y responden la frase fija. |

Cada tarea tiene al menos 4 casos. Los de `chat/` incluyen 2 sin material.

## Forma de un caso

```json
{
  "synthetic": true,
  "task": "cards",
  "case_id": "saludos",
  "input": {},
  "expected": {},
  "bad": [{"output": {}, "problem": "subcadena del problema esperado"}]
}
```

Las variantes `bad` son válidas por esquema. Así, la falla que reporta el validador es de
calidad y no de forma.

## Regenerar

Los casos se escriben desde `build_eval.py`. Nunca se editan a mano.

```bash
uv run python tests/fixtures/llm_eval/build_eval.py
```

La salida es determinista. Si después de regenerar `git status` muestra cambios, alguien
editó un caso a mano o cambió el generador sin regenerar. Los tests
`tests/study/test_llm_eval_cases.py` fallan en ese caso.

## Pruebas

```bash
uv run pytest tests/study/test_quality.py tests/study/test_llm_eval_cases.py
```

Las pruebas con un LLM real no están aquí. Pertenecen a AI-17.
