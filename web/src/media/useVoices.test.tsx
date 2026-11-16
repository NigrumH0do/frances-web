import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import { createApiClient } from '../api/client';
import { fakeTransport, jsonResponse } from '../api/testing';
import type { FakeRequest } from '../api/testing';
import type { UserPrefs, VoiceOut } from '../contracts/generated';
import { useVoices } from './useVoices';

const VOICES: VoiceOut[] = [
  {
    id: 'voice-a',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
  {
    id: 'voice-b',
    label: 'Henri',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'male',
  },
];

const PREFS: UserPrefs = {
  preferred_voice_ids: ['voice-a'],
  daily_new_cards: 7,
  theme: 'dark',
};

function setup() {
  const transport = fakeTransport({
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    'PUT /api/me/prefs': (req: FakeRequest) => jsonResponse(req.body),
  });
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider client={client}>{children}</ApiProvider>;
  }
  return { transport, wrapper };
}

test('useVoices carga las voces y la preferencia guardada', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useVoices(), { wrapper });
  await waitFor(() => expect(result.current.voices).toHaveLength(2));
  expect(result.current.preferred).toEqual(['voice-a']);
});

test('setPreferred guarda las voces sin perder el resto de preferencias', async () => {
  const { transport, wrapper } = setup();
  const { result } = renderHook(() => useVoices(), { wrapper });
  await waitFor(() => expect(result.current.preferred).toEqual(['voice-a']));

  await act(async () => {
    await result.current.setPreferred(['voice-b']);
  });

  const put = transport.calls.find((call) => call.method === 'PUT');
  expect(put?.url).toBe('/api/me/prefs');
  expect(put?.body).toEqual({
    preferred_voice_ids: ['voice-b'],
    daily_new_cards: 7,
    theme: 'dark',
  });
  expect(result.current.preferred).toEqual(['voice-b']);
});
