// Textos de la pantalla «Texto libre» (PRACTICE-01). Los comunes viven en
// `l10n/es.ts`.

export const textoStrings = {
  title: 'Texto libre',
  subtitle: 'Escribe en francés, escúchalo y pronúncialo',

  editorLabel: 'Tu texto en francés',
  placeholder: 'Écris ta phrase ici…',
  counter: '{n}/{max}',
  clear: 'Borrar texto',
  keysLabel: 'Letras francesas',
  keyInsert: 'Escribir {char}',

  voiceLabel: 'Voz del modelo',

  listenTitle: 'Escúchalo',
  generating: 'Generando el audio…',
  generate: 'Generar audio',
  autoHint: 'El audio se genera solo cuando dejas de escribir.',
  emptyHint: 'Escribe una frase y aquí aparece su audio.',
  needsLetters: 'Escribe al menos una palabra en francés.',
  browserVoice: 'Escuchar con la voz del navegador',
  browserNotice:
    'El servidor no pudo generar el audio. Puedes oírlo con la voz francesa de tu navegador.',
  offline:
    'Sin conexión no se genera audio nuevo. Puedes usar la voz del navegador.',
  offlineNoBrowser: 'Sin conexión no se genera audio nuevo.',
  rateLimited:
    'Llegaste al límite de audios nuevos por hora. Vuelve a intentarlo en un rato.',
  unavailable: 'No se pudo generar el audio ahora.',
  retry: 'Reintentar',

  speakTitle: 'Pronúncialo',
  speakHint: 'Lee el texto de corrido. Una pausa larga termina la grabación.',
  record: 'Grabar y evaluar',
  recordOnly: 'Grabarme',
  stop: 'Detener',
  recording: 'Grabando… habla ahora',
  recordOnlyNotice:
    'La evaluación no está disponible ahora. Igual puedes grabarte y compararte con el modelo.',
  listenMine: 'Escucharme',
  listenModel: 'Escuchar el modelo',
  stopMine: 'Detener mi grabación',
  tryAgain: 'Repetir',
  wordsToRepeat: 'Palabras para repetir',
  wordHint: 'Toca una palabra para oírla sola.',
  hearWord: 'Oír «{word}»',
  allGood: 'Ninguna palabra quedó por debajo de 70. ¡Bien hecho!',
  micError: 'No se pudo usar el micrófono.',

  starters: 'Para empezar',
  history: 'Tus textos recientes',
  useText: 'Usar «{text}»',
  removeText: 'Quitar «{text}» de la lista',
} as const;

// Frases de arranque de nivel A2: situaciones de la vida diaria.
export const STARTER_PHRASES: readonly string[] = [
  "Je voudrais un café, s'il vous plaît.",
  'Où se trouve la gare la plus proche ?',
  "Je m'appelle Léa et j'habite à Lyon.",
  "Qu'est-ce que tu as fait ce week-end ?",
];

// Letras que no están en un teclado español.
export const FRENCH_KEYS: readonly string[] = [
  'é',
  'è',
  'ê',
  'ë',
  'à',
  'â',
  'ç',
  'î',
  'ï',
  'ô',
  'û',
  'ù',
  'œ',
  '«',
  '»',
  '’',
];
