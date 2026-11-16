import type { SpeechToken } from '../contracts/generated';
import type { SpeechTokenSource } from '../pron/recognizer';

// Los tokens de Azure Speech viven solo en memoria del navegador. La clave de
// suscripción nunca llega aquí: el servidor la cambia por un token de 10 min.
const EXPIRY_MARGIN_MS = 60_000;

type SpeechTokenValue = Awaited<ReturnType<SpeechTokenSource>>;

function expiryOf(token: SpeechToken): number {
  const parsed = Date.parse(token.expires_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function speechTokenSource(api: {
  speechToken: () => Promise<SpeechToken>;
}): SpeechTokenSource {
  let cached: SpeechTokenValue | null = null;
  let pending: Promise<SpeechTokenValue> | null = null;

  return async () => {
    if (cached !== null && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return cached;
    }
    if (pending === null) {
      pending = api
        .speechToken()
        .then((token) => {
          const value: SpeechTokenValue = {
            token: token.token,
            region: token.region,
            expiresAt: expiryOf(token),
          };
          cached = value;
          return value;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}
