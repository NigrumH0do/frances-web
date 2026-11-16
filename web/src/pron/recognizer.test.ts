import { afterEach, expect, test, vi } from 'vitest';

// Doble del SDK: cuenta `sdkLoads` en la fábrica del mock, de modo que la
// primera `assess` (que hace `await import(...)`) la dispara. Los resultados
// reconocidos/cancelados/sin-coincidencia se preparan con los helpers.
const H = vi.hoisted(() => {
  const state = {
    sdkLoads: 0,
    recognized: null as { duration: number; json: string } | null,
    cancelErrorCode: null as number | null,
    noMatch: false,
    authFailuresLeft: 0,
  };

  const GradingSystem = { HundredMark: 2 };
  const Granularity = { Phoneme: 1 };
  const ResultReason = { NoMatch: 0, Canceled: 1, RecognizedSpeech: 3 };
  const CancellationErrorCode = {
    NoError: 0,
    AuthenticationFailure: 1,
    TooManyRequests: 3,
  };
  const PropertyId = {
    SpeechServiceResponse_JsonResult: 'json',
    Speech_SegmentationSilenceTimeoutMs: 'segmentation',
  };

  const setProperty = vi.fn();
  const speechConfig: {
    speechRecognitionLanguage?: string;
    setProperty: typeof setProperty;
  } = { setProperty };
  const fromSubscription = vi.fn(() => speechConfig);
  const fromAuthorizationToken = vi.fn(() => speechConfig);
  const audioConfig = {};
  const fromDefaultMicrophoneInput = vi.fn(() => audioConfig);

  const applyTo = vi.fn();
  const close = vi.fn();
  const PronunciationAssessmentConfig = vi.fn(function (this: {
    applyTo: typeof applyTo;
  }) {
    this.applyTo = applyTo;
  });

  const makeResult = () => {
    if (state.authFailuresLeft > 0) {
      state.authFailuresLeft -= 1;
      return {
        reason: ResultReason.Canceled,
        errorCode: CancellationErrorCode.AuthenticationFailure,
        duration: 0,
        properties: { getProperty: () => '' },
      };
    }
    if (state.noMatch) {
      return {
        reason: ResultReason.NoMatch,
        duration: 0,
        properties: { getProperty: () => '' },
      };
    }
    if (state.cancelErrorCode !== null) {
      return {
        reason: ResultReason.Canceled,
        errorCode: state.cancelErrorCode,
        duration: 0,
        properties: { getProperty: () => '' },
      };
    }
    return {
      reason: ResultReason.RecognizedSpeech,
      duration: state.recognized?.duration ?? 0,
      properties: { getProperty: () => state.recognized?.json ?? '{}' },
    };
  };

  const recognizeOnceAsync = vi.fn(
    (cb?: (result: unknown) => void, err?: (error: string) => void) => {
      try {
        cb?.(makeResult());
      } catch (error) {
        err?.(String(error));
      }
    },
  );

  const SpeechRecognizer = vi.fn(function (this: {
    recognizeOnceAsync: typeof recognizeOnceAsync;
    close: typeof close;
  }) {
    this.recognizeOnceAsync = recognizeOnceAsync;
    this.close = close;
  });

  const CancellationDetails = {
    fromResult: vi.fn((result: { errorCode?: number }) => ({
      ErrorCode: result.errorCode,
    })),
  };

  return {
    state,
    GradingSystem,
    Granularity,
    ResultReason,
    CancellationErrorCode,
    PropertyId,
    speechConfig,
    setProperty,
    fromSubscription,
    fromAuthorizationToken,
    fromDefaultMicrophoneInput,
    applyTo,
    close,
    PronunciationAssessmentConfig,
    SpeechRecognizer,
    recognizeOnceAsync,
    CancellationDetails,
  };
});

vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
  H.state.sdkLoads += 1;
  return {
    SpeechConfig: {
      fromSubscription: H.fromSubscription,
      fromAuthorizationToken: H.fromAuthorizationToken,
    },
    AudioConfig: { fromDefaultMicrophoneInput: H.fromDefaultMicrophoneInput },
    SpeechRecognizer: H.SpeechRecognizer,
    PronunciationAssessmentConfig: H.PronunciationAssessmentConfig,
    PronunciationAssessmentGradingSystem: H.GradingSystem,
    PronunciationAssessmentGranularity: H.Granularity,
    ResultReason: H.ResultReason,
    CancellationDetails: H.CancellationDetails,
    CancellationErrorCode: H.CancellationErrorCode,
    PropertyId: H.PropertyId,
  };
});

import { createTokenRecognizer, getTokenRecognizer } from './recognizer';

afterEach(() => {
  H.state.authFailuresLeft = 0;
});

const tokenSource = vi.fn(async () => ({
  token: 'tok',
  region: 'eastus',
  expiresAt: Date.now() + 600_000,
}));

const mockRecognized = (result: { duration: number; json: string }) => {
  H.state.recognized = result;
  H.state.cancelErrorCode = null;
  H.state.noMatch = false;
};
const mockCanceled = (status: number) => {
  H.state.cancelErrorCode =
    status === 401
      ? H.CancellationErrorCode.AuthenticationFailure
      : H.CancellationErrorCode.TooManyRequests;
  H.state.recognized = null;
  H.state.noMatch = false;
};
const mockNoMatch = () => {
  H.state.noMatch = true;
  H.state.recognized = null;
  H.state.cancelErrorCode = null;
};

test('loads speech sdk lazily', async () => {
  const rec = createTokenRecognizer(tokenSource);
  expect(H.state.sdkLoads).toBe(0);
  mockRecognized({ duration: 0, json: '{}' });
  await rec.assess('Bonjour');
  expect(H.state.sdkLoads).toBe(1);
});

test('configures fr-FR hundred mark phoneme miscue and converts ticks', async () => {
  mockRecognized({ duration: 18_400_000, json: '{}' });
  const out = await createTokenRecognizer(tokenSource).assess('Bonjour');
  expect(out.durationMs).toBe(1840);
  expect(H.fromAuthorizationToken).toHaveBeenCalledWith('tok', 'eastus');
  expect(H.speechConfig.speechRecognitionLanguage).toBe('fr-FR');
  expect(H.PronunciationAssessmentConfig).toHaveBeenCalledWith(
    'Bonjour',
    H.GradingSystem.HundredMark,
    H.Granularity.Phoneme,
    true,
  );
  expect(H.setProperty).toHaveBeenCalledWith(
    H.PropertyId.Speech_SegmentationSilenceTimeoutMs,
    '800',
  );
});

test('canceled and no match map to error codes', async () => {
  const cases: [() => void, string][] = [
    [() => mockCanceled(401), 'unauthorized'],
    [() => mockCanceled(429), 'quota'],
    [mockNoMatch, 'no_match'],
  ];
  for (const [mock, code] of cases) {
    mock();
    await expect(
      createTokenRecognizer(tokenSource).assess('x'),
    ).rejects.toMatchObject({ code });
  }
});

test('abort rejects a pending recognition with canceled and closes', async () => {
  H.recognizeOnceAsync.mockImplementationOnce(() => undefined);
  H.close.mockClear();
  const controller = new AbortController();
  const pending = createTokenRecognizer(tokenSource).assess(
    'x',
    controller.signal,
  );
  await vi.waitFor(() => expect(H.recognizeOnceAsync).toHaveBeenCalled());
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'canceled' });
  expect(H.close).toHaveBeenCalled();
});

test('getTokenRecognizer usa el fake e2e y null sin token', () => {
  const fake = { assess: vi.fn() };
  Object.assign(window, { __francesFakeRecognizer: fake });
  vi.stubEnv('VITE_E2E', '1');
  expect(getTokenRecognizer(null)).toBe(fake);
  vi.stubEnv('VITE_E2E', '0');
  expect(getTokenRecognizer(null)).toBeNull();
  vi.unstubAllEnvs();
  delete (window as unknown as Record<string, unknown>).__francesFakeRecognizer;
});

test('createTokenRecognizer usa el token y la región con fr-FR', async () => {
  mockRecognized({ duration: 0, json: '{}' });
  const getToken = vi.fn(async () => ({
    token: 'tok',
    region: 'westeurope',
    expiresAt: Date.now() + 600_000,
  }));
  await createTokenRecognizer(getToken).assess('Bonjour');
  expect(H.fromAuthorizationToken).toHaveBeenCalledWith('tok', 'westeurope');
  expect(H.fromSubscription).not.toHaveBeenCalled();
  expect(H.speechConfig.speechRecognitionLanguage).toBe('fr-FR');
});

test('createTokenRecognizer pide un token nuevo y reintenta una vez', async () => {
  mockRecognized({ duration: 0, json: '{}' });
  H.state.authFailuresLeft = 1;
  let n = 0;
  const getToken = vi.fn(async () => ({
    token: `t${++n}`,
    region: 'eastus',
    expiresAt: Date.now() + 600_000,
  }));
  await createTokenRecognizer(getToken).assess('Bonjour');
  expect(getToken).toHaveBeenCalledTimes(2);
  expect(H.fromAuthorizationToken).toHaveBeenLastCalledWith('t2', 'eastus');
});

test('createTokenRecognizer no reintenta más de una vez', async () => {
  mockRecognized({ duration: 0, json: '{}' });
  H.state.authFailuresLeft = 5;
  const getToken = vi.fn(async () => ({
    token: 't',
    region: 'eastus',
    expiresAt: Date.now() + 600_000,
  }));
  await expect(
    createTokenRecognizer(getToken).assess('Bonjour'),
  ).rejects.toMatchObject({ code: 'unauthorized' });
  expect(getToken).toHaveBeenCalledTimes(2);
});
