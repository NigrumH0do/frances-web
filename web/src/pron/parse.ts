// Parser del JSON de Azure Pronunciation Assessment → `PronResult` (PRN-01).
//
// `parseAzureResult` es pura salvo `crypto.randomUUID()`: no toca red, ni
// IndexedDB, ni el SDK. Los consumidores (PRN-02) le pasan el JSON crudo de
// `PropertyId.SpeechServiceResponse_JsonResult`, el texto de referencia, la
// tarjeta, el reloj y la duración. `normTs` es contrato (R-27): otros módulos
// lo importan de aquí.

import type {
  ErrorType,
  PhonemeScore,
  PronResult,
  WordScore,
} from '../contracts/generated';
import { normalizePhoneme } from './phonemeLabels';

export interface AzurePhoneme {
  Phoneme?: string;
  PronunciationAssessment?: { AccuracyScore?: number };
}

export interface AzureSyllable {
  Grapheme?: string;
  PronunciationAssessment?: { AccuracyScore?: number };
}

export interface AzureWord {
  Word?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
  Phonemes?: AzurePhoneme[];
  Syllables?: AzureSyllable[];
}

export interface AzurePronunciationAssessment {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
}

export interface AzureNBest {
  PronunciationAssessment?: AzurePronunciationAssessment;
  Words?: AzureWord[];
}

export interface AzureJson {
  DisplayText?: string;
  NBest?: AzureNBest[];
}

export class PronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PronParseError';
  }
}

// `YYYY-MM-DDTHH:MM:SS.ffffffZ`: extiende los 3 decimales de `toISOString()` a 6.
export function normTs(at: Date): string {
  return at.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

function sound(label: string, accuracy: number | undefined): PhonemeScore {
  return { phoneme: normalizePhoneme(label.trim()), accuracy: accuracy ?? 0 };
}

// Azure a veces manda `Phoneme` vacío (el «?» de la pantalla) y deja las
// letras en `Syllables[].Grapheme`. Si hay fonemas con símbolo, se usan; si
// no, se muestran las sílabas. Un chip vacío no se guarda.
function soundsOf(word: AzureWord): PhonemeScore[] {
  const phonemes = (word.Phonemes ?? [])
    .map((item) =>
      sound(item.Phoneme ?? '', item.PronunciationAssessment?.AccuracyScore),
    )
    .filter((item) => item.phoneme !== '');
  if (phonemes.length > 0) {
    return phonemes;
  }
  return (word.Syllables ?? [])
    .map((item) =>
      sound(item.Grapheme ?? '', item.PronunciationAssessment?.AccuracyScore),
    )
    .filter((item) => item.phoneme !== '');
}

export function parseAzureResult(
  json: unknown,
  referenceText: string,
  cardId: string | null,
  at: Date,
  durationMs: number,
): PronResult {
  const raw = json as AzureJson;
  const best = raw?.NBest?.[0];
  if (!best) {
    throw new PronParseError('JSON de Azure sin NBest');
  }

  const pa = best.PronunciationAssessment ?? {};
  const words: WordScore[] = (best.Words ?? []).map((w) => {
    const wpa = w.PronunciationAssessment ?? {};
    const phonemes = soundsOf(w);
    return {
      word: w.Word ?? '',
      accuracy: wpa.AccuracyScore ?? 0,
      error_type: (wpa.ErrorType as ErrorType | undefined) ?? 'None',
      phonemes,
    };
  });

  return {
    id: crypto.randomUUID(),
    at: normTs(at),
    card_id: cardId,
    duration_ms: durationMs,
    recognized_text: raw.DisplayText ?? '',
    reference_text: referenceText,
    scores: {
      pron: pa.PronScore ?? 0,
      accuracy: pa.AccuracyScore ?? 0,
      fluency: pa.FluencyScore ?? 0,
      completeness: pa.CompletenessScore ?? 0,
    },
    words,
  };
}
