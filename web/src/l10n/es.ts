// Textos comunes de la v2 en español. Los textos de pantallas van en sus propios módulos.
export const common = {
  loading: 'Cargando…',
  retry: 'Reintentar',
  empty: 'Todavía no hay nada aquí',
  offline: 'Sin conexión',
  offlineStale:
    'Sin conexión: datos guardados. Mostramos lo último que se guardó.',
  back: 'Volver',
  cancel: 'Cancelar',
  save: 'Guardar',
  close: 'Cerrar',
  unknownError: 'Algo salió mal',
} as const;

// Sustituye {nombre} por su valor. Los marcadores sin valor se dejan tal cual.
export function tr(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (marker, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : marker,
  );
}
