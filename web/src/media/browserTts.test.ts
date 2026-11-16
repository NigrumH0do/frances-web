import { afterEach, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  browserTtsAvailable,
  frenchBrowserVoice,
  speakWithBrowser,
  useBrowserFrenchVoice,
} from './browserTts';

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

function installSynth(voices: { lang: string; name: string }[]) {
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  const engine = {
    getVoices: () => voices,
    addEventListener: (_name: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_name: string, fn: () => void) =>
      listeners.delete(fn),
    fire: () => listeners.forEach((fn) => fn()),
    cancel: vi.fn(),
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance);
      queueMicrotask(() => utterance.onend?.());
    }),
  };
  vi.stubGlobal('speechSynthesis', engine);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return { engine, spoken };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('prefiere fr-FR y si no, cualquier francés', () => {
  installSynth([
    { lang: 'es-ES', name: 'Lucía' },
    { lang: 'fr-CA', name: 'Amélie' },
    { lang: 'fr-FR', name: 'Thomas' },
  ]);
  expect(frenchBrowserVoice()?.name).toBe('Thomas');
  installSynth([{ lang: 'fr-CA', name: 'Amélie' }]);
  expect(frenchBrowserVoice()?.name).toBe('Amélie');
});

test('sin voz francesa el respaldo no está disponible', async () => {
  installSynth([{ lang: 'es-ES', name: 'Lucía' }]);
  expect(browserTtsAvailable()).toBe(false);
  await expect(speakWithBrowser('Bonjour')).rejects.toThrow();
});

test('lee el texto con la voz francesa y la velocidad pedida', async () => {
  const { engine, spoken } = installSynth([{ lang: 'fr-FR', name: 'Thomas' }]);
  expect(browserTtsAvailable()).toBe(true);
  await speakWithBrowser('Bonjour à tous', { rate: 0.75 });
  expect(engine.cancel).toHaveBeenCalled();
  expect(spoken[0]?.text).toBe('Bonjour à tous');
  expect(spoken[0]?.rate).toBe(0.75);
  expect(spoken[0]?.lang).toBe('fr-FR');
});

test('las voces llegan tarde: el hook se entera con voiceschanged', () => {
  const voices: { lang: string; name: string }[] = [];
  const { engine } = installSynth(voices);
  const { result } = renderHook(() => useBrowserFrenchVoice());
  expect(result.current).toBe(false);
  voices.push({ lang: 'fr-FR', name: 'Thomas' });
  act(() => engine.fire());
  expect(result.current).toBe(true);
});
