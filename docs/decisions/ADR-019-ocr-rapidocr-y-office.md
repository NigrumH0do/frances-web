# ADR-019: RapidOCR como OCR principal y lectura de PowerPoint y Word

**Estado:** Aceptado (aprobado por el dueño, 2026-11-19)
**Tareas:** EXT-05 (motores OCR), EXT-06 (Office), EXT-07 (cobertura)
**Cambia:** EXT-02 (OCR solo con Tesseract)

## Contexto

- El OCR usaba solo Tesseract `fra+spa`. En la máquina local faltaba el idioma
  `fra`. Tesseract no fallaba: seguía con el modelo español y perdía las tildes
  francesas («Le médecin et l'infirmière à l'hôpital» salía «Le madecinet
  infirmiare aihapital»). Las imágenes extraídas tenían 0 letras francesas
  acentuadas.
- 30 archivos de Office (`.pptx`, `.ppsx`, `.docx`, `.ppt`) no tenían extractor.
  Seis adjuntos sin `mime_type` en `attachments` también se saltaban.
- Banco de pruebas (2026-11-15, fuera del repo), Tesseract con `fra` vs.
  RapidOCR 3.10 (PP-OCRv6, `fr`):

| Conjunto | Tesseract + fra | RapidOCR |
|---|---|---|
| Frases sintéticas tipo foto (error de letras) | 37,0 % | 0,2 % |
| 20 páginas reales con capa de texto (palabras acertadas) | 81 % (89 % con `psm 3`) | 96 % |
| Tildes acertadas en esas páginas | 65 % | 93 % |
| Segundos por página (CPU) | 2,3 | 4,8 |

## Decisión

- `frances.extract.ocr` prueba motores en orden: **RapidOCR** (modelos que trae
  el paquete; sin red) y luego **Tesseract** `fra+spa` con `--psm 3`. Un motor
  que no lee nada o falla cede el turno al siguiente.
- Tesseract **no se usa sin `fra`**: lanza `OcrUnavailable`. Si no queda ningún
  motor, la página falla y la etapa queda `partial` (antes leía mal en silencio).
- Las cajas de RapidOCR se ordenan en líneas y párrafos (`lines_from_boxes`).
  Los párrafos cortos de diapositivas y OCR se unen hasta ~120 letras
  (`merge_short_paragraphs`, tope 900) para que cada bloque tenga contexto.
- `frances.extract.office`: `.pptx`/`.ppsx`/`.pptm` (texto, tablas, grupos y
  notas; OCR de las imágenes si la diapositiva casi no tiene texto) y `.docx`
  (párrafos y tablas; OCR de imágenes si es un escaneo pegado). `.ppt`/`.doc`
  se convierten a PDF con LibreOffice si está instalado.
- `ExtractMethod` suma `office_text` y `office_ocr`. Sin mime se usa el del
  blob y, si es genérico, se detecta por contenido (`%PDF`, zip de Office,
  imagen).
- `EXTRACTOR_VERSION` pasa a `"2"`: todo se vuelve a extraer y, por el hash de
  entrada, las tarjetas se regeneran en la siguiente corrida (los ids se
  conservan; las copias del usuario no se pisan).
- `frances coverage --data DIR [--json] [--all]` dice qué adjunto tiene texto y
  por qué otro no. `frances doctor` muestra los motores de OCR disponibles.
- `pypdfium2` pasa de dependencia de desarrollo a dependencia de la app: la
  imagen Docker (`--no-dev`) no podía leer PDF.

## Licencias

RapidOCR (código y modelos PP-OCR) Apache-2.0; `onnxruntime` MIT;
`opencv-python-headless` Apache-2.0; `python-pptx` y `python-docx` MIT; `lxml`,
`shapely`, `xlsxwriter`, `omegaconf`, `protobuf` BSD; `pyclipper`, `colorlog`
MIT; `tqdm` MPL-2.0/MIT. LibreOffice solo como binario externo.
`scripts/check_aarch64_wheels.py` pasa.

## Resultado en local-data (2026-11-15)

- 136 de 136 archivos descargados con formato de texto tienen texto. 0 errores.
- Palabras extraídas: de ~43 000 a ~64 000 (+18 000 de Office).
- Bloques del chat: de 883 a 1491; los de idioma desconocido bajan del 13 % al 3 %.
- Sin texto por naturaleza: 5 audios y 5 videos. Sin descargar: 7 archivos de más
  de 50 MB y 2 carpetas de Drive (su contenido no se sincroniza).

## Consecuencias

- La etapa extract tarda más: ~4–5 s por página escaneada en CPU (una sola vez
  por archivo).
- La imagen Docker crece ~150 MB (onnxruntime, opencv, modelos). No se probó el
  build de la imagen en esta tarea.
- Sin LibreOffice en la imagen, los `.ppt`/`.doc` antiguos quedan `sin_soporte`.
