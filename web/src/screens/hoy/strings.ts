// Textos de la pantalla Hoy. Los comunes viven en `l10n/es.ts` (UI-03).
export const hoyStrings = {
  morning: 'Buenos días',
  afternoon: 'Buenas tardes',
  evening: 'Buenas noches',
  frMorning: 'Bonjour',
  frAfternoon: 'Bon après-midi',
  frEvening: 'Bonsoir',

  speakTitle: 'Practica un texto tuyo',
  speakBody: 'Écris-le, écoute-le, dis-le.',

  streak: 'racha · {n} días',
  streakOne: 'racha · {n} día',

  planTitle: 'Tu plan de hoy',
  planProgress: '{done} de {total} hecho',
  planEmpty: 'No hay tareas para hoy.',
  done: 'Hecho',
  ai: 'IA',
  generating: 'Generando tu material…',

  upcomingTitle: 'Próxima entrega',
  due: 'Vence {date} · {relative}',
  dueToday: 'hoy',
  dueTomorrow: 'en 1 día',
  dueInDays: 'en {n} días',
  untitled: 'Publicación sin título',

  weekTitle: 'Esta semana',
  weekSummary: 'Actividad de la semana: {days}',
  daySummary: '{day}: {reviews} y {quizzes}',
  reviewOne: '{n} repaso',
  reviewMany: '{n} repasos',
  quizOne: '{n} quiz',
  quizMany: '{n} quizzes',
  todayIs: 'Hoy es {day}.',
  weekEmpty: 'Todavía no hay repasos esta semana. Cada sesión suma una barra.',

  offlineSaved: 'Sin conexión: datos guardados.',
  saveError: 'No se pudo guardar el cambio.',
} as const;
