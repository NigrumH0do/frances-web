// Textos de la web v2 que aún vienen del catálogo v1 (visores, audio y PWA).
// CHG-16 retiró las claves de las pantallas v1; cada pantalla v2 tiene su
// propio `strings.ts`.

export const es = {
  'app.loading': 'Cargando…',
  'app.error': 'Algo salió mal.',
  'app.reload': 'Recargar',
  'audio.play': 'Reproducir',
  'audio.stop': 'Detener',
  'audio.voice': 'Voz',
  'audio.pending': 'Audio pendiente: {voice}',
  'audio.none': 'Todavía sin audio',
  'audio.slow': 'Más lento',
  'age.adult.female': 'adulta',
  'age.adult.male': 'adulto',
  'age.teen': 'adolescente',
  'age.child.female': 'niña',
  'age.child.male': 'niño',
  'att.unavailable': 'No se pudo descargar: ábrelo en Classroom',
  'pdf.prev': 'Página anterior',
  'pdf.next': 'Página siguiente',
  'pdf.page': 'Página {n} de {total}',
  'pdf.zoomIn': 'Acercar',
  'pdf.zoomOut': 'Alejar',
  'pwa.update': 'Hay una versión nueva',
  'pwa.reload': 'Actualizar',
} as const;

export type EsKey = keyof typeof es;

export function t(key: EsKey, vars?: Record<string, string | number>): string {
  let out: string = es[key];
  if (vars !== undefined) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replace(`{${name}}`, String(value));
    }
  }
  return out;
}
