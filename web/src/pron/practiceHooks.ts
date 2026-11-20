// Hooks compartidos por las pantallas de práctica oral (UI-16 y texto libre):
// cuota de Azure Speech del dispositivo y recognizer con token del servidor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { HttpError, OfflineError } from '../api/client';
import { speechTokenSource } from '../media/speech';
import { pronunciacionStrings as s } from '../screens/pronunciacion/strings';
import { getUsage, monthOf, quotaState } from './quota';
import {
  getTokenRecognizer,
  RecognizerError,
  type Recognizer,
} from './recognizer';

export type QuotaLevel = 'ok' | 'warn' | 'exceeded';

// Traduce los fallos de `POST /api/speech/token` (UI-11) a los textos de la
// pantalla. Cualquier otro error conserva el mensaje genérico del grabador.
export function speechErrorMessage(error: unknown): string | null {
  if (error instanceof OfflineError) {
    return s.offline;
  }
  if (error instanceof RecognizerError && error.code === 'unauthorized') {
    return s.unavailable;
  }
  if (error instanceof HttpError) {
    if (error.status === 429 || error.code === 'rate_limited') {
      return s.rateLimited;
    }
    if (error.status === 503 || error.code === 'speech_unavailable') {
      return s.unavailable;
    }
  }
  return null;
}

// Cuota mensual de este dispositivo (v1 `pron/quota.ts`). Es solo un aviso:
// la cuota real es de la cuenta y el servidor limita los tokens por hora.
export function useDeviceQuota(): {
  seconds: number;
  quota: QuotaLevel;
  refresh: () => void;
} {
  const [seconds, setSeconds] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getUsage(monthOf(new Date()))
      .then((used) => {
        if (!cancelled) {
          setSeconds(used);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { seconds, quota: quotaState(seconds), refresh };
}

// Recognizer con token del servidor (CHG-13 + UI-11). El token se pide al
// grabar y `speechTokenSource` lo guarda solo en memoria hasta 60 s antes de
// vencer. Aquí no se lee ni se guarda ninguna clave de Azure (R-42).
export function usePracticeRecognizer(): {
  recognizer: Recognizer | null;
  speechError: string | null;
  clearSpeechError: () => void;
} {
  const api = useApi();
  const [speechError, setSpeechError] = useState<string | null>(null);
  const lastAccountId = useRef<string | null>(null);
  const tokenSource = useMemo(
    () =>
      speechTokenSource(api, (tok) => {
        lastAccountId.current = tok.account_id ?? null;
      }),
    [api],
  );
  const base = useMemo(() => getTokenRecognizer(tokenSource), [tokenSource]);

  const recognizer = useMemo<Recognizer | null>(() => {
    if (base === null) {
      return null;
    }
    return {
      async assess(referenceText, signal) {
        setSpeechError(null);
        try {
          const out = await base.assess(referenceText, signal);
          const accId = lastAccountId.current;
          if (accId !== null && typeof api.speechUsage === 'function') {
            const seconds = Math.max(
              1,
              Math.min(600, Math.ceil((out.durationMs || 1000) / 1000)),
            );
            void api
              .speechUsage({ account_id: accId, seconds })
              .catch(() => undefined);
          }
          return out;
        } catch (error) {
          const message = speechErrorMessage(error);
          if (message === null) {
            throw error;
          }
          setSpeechError(message);
          // El grabador muestra el mensaje genérico; el aviso con el motivo
          // exacto vive en el `role="alert"` de la pantalla.
          throw new RecognizerError('canceled');
        }
      },
    };
  }, [base]);

  const clearSpeechError = useCallback(() => setSpeechError(null), []);
  return { recognizer, speechError, clearSpeechError };
}
