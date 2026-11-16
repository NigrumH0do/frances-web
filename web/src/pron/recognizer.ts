// Recognizer de Azure Pronunciation Assessment (Task PRN-02).
//
// El SDK (`microsoft-cognitiveservices-speech-sdk`) se carga de forma perezosa:
// solo se importa dinámicamente dentro de `assess`, nunca de forma estática.
// El audio solo va a Azure Speech; aquí no se escribe a disco ni a IndexedDB.
//
// `createTokenRecognizer` (Task CHG-13) usa un token de corta vida que pide un
// `SpeechTokenSource`; la clave de suscripción nunca entra en el navegador
// (CHG-16 retiró el recognizer con clave de la web v1).

export interface Recognizer {
  assess(
    referenceText: string,
    signal?: AbortSignal,
  ): Promise<{ json: unknown; durationMs: number }>;
}

export type RecognizerErrorCode =
  'no_match' | 'unauthorized' | 'quota' | 'canceled';

export class RecognizerError extends Error {
  readonly code: RecognizerErrorCode;

  constructor(code: RecognizerErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'RecognizerError';
    this.code = code;
  }
}

// Fuente de tokens de Azure Speech: el llamador decide cómo obtenerlos (p. ej.
// desde el servidor). `expiresAt` es epoch en milisegundos.
export type SpeechTokenSource = () => Promise<{
  token: string;
  region: string;
  expiresAt: number;
}>;

// Tipo del módulo del SDK derivado con `typeof import(...)`: es un tipo, no un
// import estático, así el runtime del SDK sigue fuera del bundle inicial.
type SdkModule = typeof import('microsoft-cognitiveservices-speech-sdk');
type SpeechResult = InstanceType<SdkModule['SpeechRecognitionResult']>;
type SpeechConfigInstance =
  import('microsoft-cognitiveservices-speech-sdk').SpeechConfig;

let sdkPromise: Promise<SdkModule> | null = null;

function loadSdk(): Promise<SdkModule> {
  if (sdkPromise === null) {
    sdkPromise = import('microsoft-cognitiveservices-speech-sdk');
  }
  return sdkPromise;
}

function interpret(
  sdk: SdkModule,
  result: SpeechResult,
): { json: unknown; durationMs: number } {
  if (result.reason === sdk.ResultReason.NoMatch) {
    throw new RecognizerError('no_match');
  }
  if (result.reason === sdk.ResultReason.Canceled) {
    const details = sdk.CancellationDetails.fromResult(result);
    if (details.ErrorCode === sdk.CancellationErrorCode.AuthenticationFailure) {
      throw new RecognizerError('unauthorized');
    }
    if (details.ErrorCode === sdk.CancellationErrorCode.TooManyRequests) {
      throw new RecognizerError('quota');
    }
    throw new RecognizerError('canceled');
  }
  const raw = result.properties.getProperty(
    sdk.PropertyId.SpeechServiceResponse_JsonResult,
  );
  return {
    json: JSON.parse(raw) as unknown,
    durationMs: Math.round(result.duration / 10000),
  };
}

// Una sola reconocida con evaluación de pronunciación; no comprueba `signal`
// antes de empezar.
async function assessWith(
  sdk: SdkModule,
  speechConfig: SpeechConfigInstance,
  referenceText: string,
  signal: AbortSignal | undefined,
): Promise<{ json: unknown; durationMs: number }> {
  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  const assessment = new sdk.PronunciationAssessmentConfig(
    referenceText,
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    true,
  );
  assessment.applyTo(recognizer);

  let onAbort: () => void = () => undefined;
  try {
    const result = await new Promise<SpeechResult>((resolve, reject) => {
      // Una sola resolución: lo primero que llegue (callback del SDK o
      // abort) gana; lo demás se ignora.
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      onAbort = () => {
        settle(() => reject(new RecognizerError('canceled')));
        try {
          recognizer.close();
        } catch {
          // `close()` durante una cancelación no debe romper la máquina de estados.
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      recognizer.recognizeOnceAsync(
        (r) => settle(() => resolve(r)),
        (errorMessage) =>
          settle(() => reject(new RecognizerError('canceled', errorMessage))),
      );
    });
    return interpret(sdk, result);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      recognizer.close();
    } catch {
      // idem: cerrar un recognizer ya cerrado es inocuo.
    }
  }
}

// Recognizer con token (Task CHG-13). Si Azure responde `AuthenticationFailure`
// pide un token nuevo y reintenta una sola vez; el segundo fallo sale como
// `unauthorized`.
export function createTokenRecognizer(getToken: SpeechTokenSource): Recognizer {
  return {
    async assess(referenceText, signal) {
      const sdk = await loadSdk();
      if (signal?.aborted) {
        throw new RecognizerError('canceled');
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { token, region } = await getToken();
        const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(
          token,
          region,
        );
        speechConfig.speechRecognitionLanguage = 'fr-FR';
        // El silencio por defecto ronda los 2 s y la pantalla parecía trabada.
        // 800 ms basta para cerrar la frase sin cortar la última sílaba.
        speechConfig.setProperty(
          sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
          '800',
        );
        try {
          return await assessWith(sdk, speechConfig, referenceText, signal);
        } catch (error) {
          const retryable =
            attempt === 0 &&
            error instanceof RecognizerError &&
            error.code === 'unauthorized';
          if (!retryable) {
            throw error;
          }
        }
      }
      throw new RecognizerError('unauthorized');
    },
  };
}

// Recognizer del navegador: atajo e2e (`VITE_E2E === '1'`) y, sin fake, un
// recognizer con token o `null` si no hay fuente de tokens.
export function getTokenRecognizer(
  getToken: SpeechTokenSource | null,
): Recognizer | null {
  if (import.meta.env.VITE_E2E === '1') {
    const fake = (window as unknown as { __francesFakeRecognizer?: Recognizer })
      .__francesFakeRecognizer;
    if (fake) {
      return fake;
    }
  }
  if (getToken === null) {
    return null;
  }
  return createTokenRecognizer(getToken);
}
