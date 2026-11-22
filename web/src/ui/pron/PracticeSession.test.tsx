import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { JSX, ReactElement } from 'react';
import bonjour from '../../../../tests/fixtures/azure/bonjour.json';
import { closeFrancesDbForTests } from '../../db/idb';
import { listAttempts } from '../../pron/attempts';
import type { LevelMeter } from '../../pron/levelMeter';
import { getUsage } from '../../pron/quota';
import type { Recognizer } from '../../pron/recognizer';
import { RecognizerError } from '../../pron/recognizer';
import * as recorderModule from '../../pron/recorder';
import { loadStats } from '../../pron/stats';
import { setMotion3dPref } from '../../three/motionPref';
import { PracticeSession, type PracticeCard } from './PracticeSession';

function makeCard(partial: Partial<PracticeCard> = {}): PracticeCard {
  return {
    id: 'c1',
    front_fr: 'Bonjour',
    back_es: 'Hola',
    audio: [],
    audio_pending: [],
    ...partial,
  };
}

// JSON «allez» de PRN-01 (PronScore 94; fonemas a/l/e 98/95/62) más una
// palabra omitida, todo sintético.
const allez = {
  DisplayText: 'Allez.',
  NBest: [
    {
      PronunciationAssessment: {
        AccuracyScore: 92,
        FluencyScore: 97,
        CompletenessScore: 100,
        PronScore: 94,
      },
      Words: [
        {
          Word: 'allez',
          PronunciationAssessment: { AccuracyScore: 81, ErrorType: 'None' },
          Phonemes: [
            { Phoneme: 'a', PronunciationAssessment: { AccuracyScore: 98 } },
            { Phoneme: 'l', PronunciationAssessment: { AccuracyScore: 95 } },
            { Phoneme: 'e', PronunciationAssessment: { AccuracyScore: 62 } },
          ],
        },
        {
          Word: 'vite',
          PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' },
          Phonemes: [],
        },
      ],
    },
  ],
};

const card = makeCard({
  id: 'c_0123456789abcdef',
  front_fr: 'Allez vite !',
  back_es: '¡Vamos rápido!',
});

const stop = vi.fn();

function fakeRecognizer(json: unknown, durationMs = 1840) {
  return {
    assess: vi.fn<Recognizer['assess']>(async () => ({ json, durationMs })),
  };
}

let fakeRec = fakeRecognizer(allez);

function renderSession(ui: ReactElement): void {
  render(ui);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T21:04:57Z'));
  await closeFrancesDbForTests();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
      ),
    },
  });
  fakeRec = fakeRecognizer(allez);
});

afterEach(() => {
  vi.useRealTimers();
});

test('renders scores words and phoneme chips from result', async () => {
  const user = userEvent.setup();
  renderSession(<PracticeSession card={card} recognizer={fakeRec} />);
  expect(screen.getByText('Allez vite !')).toHaveAttribute('lang', 'fr');
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  const total = await screen.findByRole('region', { name: 'Puntaje global' });
  expect(within(total).getByText('94')).toBeInTheDocument();
  expect(within(total).getByText('Excelente')).toBeInTheDocument();
  for (const text of [
    'Exactitud 92',
    'Fluidez 97',
    'Completitud 100',
    'omitida',
  ]) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  const word = screen.getByRole('button', { name: 'allez' });
  expect(word).toHaveAttribute('lang', 'fr');
  await user.click(word);
  const chips = within(
    screen.getByRole('list', { name: 'Fonemas de allez' }),
  ).getAllByRole('listitem');
  expect(chips.map((c) => c.textContent)).toEqual(['a 98', 'l 95', 'e 62']);
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Repetir' })).toBeInTheDocument();
  expect(stop).toHaveBeenCalled();
});

test('finishing saves attempt stats and seconds', async () => {
  const user = userEvent.setup();
  const onFinished = vi.fn();
  renderSession(
    <PracticeSession
      card={card}
      recognizer={fakeRec}
      onFinished={onFinished}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  const attempts = await listAttempts();
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    card_id: 'c_0123456789abcdef',
    at: '2026-10-14T21:04:57.000000Z',
    reference_text: 'Allez vite !',
  });
  expect(await loadStats()).toContainEqual(
    expect.objectContaining({ phoneme: 'e', ema: 62, n: 1 }),
  );
  expect(await getUsage('2026-10')).toBe(2);
  expect(onFinished.mock.calls[0][0]).toMatchObject({ id: attempts[0].id });
});

test('space bar starts recording', async () => {
  const user = userEvent.setup();
  renderSession(<PracticeSession card={card} recognizer={fakeRec} />);
  await user.keyboard(' ');
  expect(fakeRec.assess).toHaveBeenCalledOnce();
  expect(fakeRec.assess.mock.calls[0][0]).toBe('Allez vite !');
  await screen.findByRole('region', { name: 'Puntaje global' });
});

test('recording shows analyzing immediately', async () => {
  const user = userEvent.setup();
  const pending: Recognizer = {
    assess: () => new Promise(() => undefined),
  };
  renderSession(<PracticeSession card={card} recognizer={pending} />);
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Analizando audio…',
  );
});

test('stop button aborts while recording', async () => {
  const user = userEvent.setup();
  const pending: Recognizer = {
    assess: (_text, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(new RecognizerError('canceled')),
        );
      }),
  };
  renderSession(<PracticeSession card={card} recognizer={pending} />);
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  await user.click(await screen.findByRole('button', { name: 'Detener' }));
  expect(
    await screen.findByRole('button', { name: 'Grabar' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Puntaje global' })).toBeNull();
  expect(await listAttempts()).toHaveLength(0);
});

// Depende del arreglo de PRN-02: `start()` acepta `idle | done | error`.
test('recognizer error is shown as alert and recording can be retried', async () => {
  const user = userEvent.setup();
  const failing = {
    assess: vi
      .fn()
      .mockRejectedValueOnce(new RecognizerError('no_match'))
      .mockResolvedValueOnce({ json: allez, durationMs: 1840 }),
  };
  renderSession(<PracticeSession card={card} recognizer={failing} />);
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No se escuchó nada, intenta de nuevo',
  );
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  expect(
    await screen.findByRole('region', { name: 'Puntaje global' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

// Depende del arreglo de PRN-02: `start()` acepta `idle | done | error`.
test('repeat starts a new attempt and next calls onNext', async () => {
  const user = userEvent.setup();
  const onNext = vi.fn();
  renderSession(
    <PracticeSession card={card} recognizer={fakeRec} onNext={onNext} />,
  );
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  await user.click(await screen.findByRole('button', { name: 'Repetir' }));
  // «Repetir» vuelve a llamar a `start()` en el mismo Recorder.
  await waitFor(() => expect(fakeRec.assess).toHaveBeenCalledTimes(2));
  await user.click(await screen.findByRole('button', { name: 'Siguiente' }));
  expect(onNext).toHaveBeenCalledOnce();
  expect(fakeRec.assess).toHaveBeenCalledTimes(2);
  expect(await listAttempts()).toHaveLength(2);
});

test('azure fixture with unlabeled phonemes renders and keeps stats clean', async () => {
  const user = userEvent.setup();
  const onFinished = vi.fn();
  renderSession(
    <PracticeSession
      card={makeCard({
        id: 'c_bonjour',
        front_fr: 'Bonjour, comment allez-vous ?',
      })}
      recognizer={fakeRecognizer(bonjour, 1750)}
      onFinished={onFinished}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  const total = await screen.findByRole('region', { name: 'Puntaje global' });
  expect(within(total).getByText('94')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Bonjour' }));
  const chips = within(
    screen.getByRole('list', { name: 'Fonemas de Bonjour' }),
  ).getAllByRole('listitem');
  expect(chips.map((c) => c.textContent)).toEqual(['bon 100', 'jour 88']);
  await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  expect(await loadStats()).toEqual([]);
});

test('acepta una PracticeCard y usa el slot de audio sin ContentProvider', () => {
  render(
    <PracticeSession
      card={{ id: 'c_v2', front_fr: 'Bonjour', back_es: null }}
      recognizer={null}
      audio={<p>Clip v2</p>}
    />,
  );
  expect(screen.getByText('Clip v2')).toBeInTheDocument();
  expect(screen.getByText('Bonjour')).toHaveAttribute('lang', 'fr');
});

test('without recognizer shows unavailable message and no record button', () => {
  renderSession(<PracticeSession card={card} recognizer={null} />);
  expect(
    screen.getByText(
      'La evaluación de pronunciación no está disponible en este bundle',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Grabar' })).toBeNull();
});

test('score summary muestra anillo SVG y WordList reproduce palabra con voz francesa del navegador', async () => {
  const speak = vi.fn();
  const cancel = vi.fn();
  const origSpeech = window.speechSynthesis;
  const origUtterance = globalThis.SpeechSynthesisUtterance;

  class FakeUtterance {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: {
      getVoices: () => [{ lang: 'fr-FR', name: 'Amélie' }],
      speak: (u: { onend?: (() => void) | null }) => {
        speak(u);
        u.onend?.();
      },
      cancel,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  try {
    const user = userEvent.setup();
    renderSession(<PracticeSession card={card} recognizer={fakeRec} />);
    await user.click(screen.getByRole('button', { name: 'Grabar' }));

    const total = await screen.findByRole('region', { name: 'Puntaje global' });
    expect(total.querySelector('svg.score-ring')).not.toBeNull();

    const speakBtn = await screen.findByRole('button', {
      name: 'Escuchar allez',
    });
    await user.click(speakBtn);
    expect(cancel).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledOnce();
  } finally {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      writable: true,
      value: origSpeech,
    });
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      writable: true,
      value: origUtterance,
    });
  }
});

const pronCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'pron.css'),
  'utf8',
);

function matchMediaReducing(reduce: boolean) {
  return (query: string) =>
    ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

test('la cabina usa record-orb, aria-pressed y la raíz no es papel', async () => {
  const user = userEvent.setup();
  const pending: Recognizer = {
    assess: () => new Promise(() => undefined),
  };
  renderSession(<PracticeSession card={card} recognizer={pending} />);
  const root = document.querySelector('.practice-session');
  expect(root).not.toBeNull();
  expect(root).not.toHaveClass('paper');
  expect(screen.getByText('Allez vite !')).toHaveClass('paper');
  const record = screen.getByRole('button', { name: 'Grabar' });
  expect(record).toHaveClass('record-orb');
  expect(record).toHaveAttribute('aria-pressed', 'false');
  await user.click(record);
  const stopButton = await screen.findByRole('button', { name: 'Detener' });
  expect(stopButton).toHaveClass('record-orb');
  expect(stopButton).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.acoustic-slot')).not.toBeNull();
});

test('con motion-off el hueco acústico muestra el orbe de respaldo', () => {
  setMotion3dPref('off');
  try {
    renderSession(<PracticeSession card={card} recognizer={null} />);
    const slot = document.querySelector('.acoustic-slot');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('.orb-fallback')).not.toBeNull();
  } finally {
    setMotion3dPref('auto');
  }
});

test('navigator.vibrate no se llama con reduced-motion', async () => {
  const vibrate = vi.fn();
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vibrate,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaReducing(true),
  });
  setMotion3dPref('auto');
  try {
    const user = userEvent.setup();
    const pending: Recognizer = {
      assess: () => new Promise(() => undefined),
    };
    renderSession(<PracticeSession card={card} recognizer={pending} />);
    await user.click(screen.getByRole('button', { name: 'Grabar' }));
    expect(vibrate).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    setMotion3dPref('auto');
  }
});

test('al iniciar la grabación vibra 15 ms si el movimiento está permitido', async () => {
  const vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vibrate,
  });
  setMotion3dPref('auto');
  const user = userEvent.setup();
  const pending: Recognizer = {
    assess: () => new Promise(() => undefined),
  };
  renderSession(<PracticeSession card={card} recognizer={pending} />);
  await user.click(screen.getByRole('button', { name: 'Grabar' }));
  expect(vibrate).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledWith(15);
});

test('leer el medidor diez veces no re-renderiza PracticeSession', async () => {
  const spy = vi.spyOn(recorderModule, 'createRecorder');
  let probeRenders = 0;
  function Probe(): JSX.Element {
    probeRenders += 1;
    return <span data-testid="render-probe" />;
  }
  try {
    renderSession(
      <PracticeSession card={card} recognizer={fakeRec} audio={<Probe />} />,
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const options = spy.mock.calls[0]?.[3] as
      { meterRef?: { current: LevelMeter | null } } | undefined;
    const meterRef = options?.meterRef;
    expect(meterRef).toBeDefined();
    const read = vi.fn(() => ({
      rms: 0.4,
      low: 0,
      mid: 0,
      high: 0,
      source: 'live' as const,
    }));
    meterRef!.current = {
      resumeFromGesture() {},
      connect() {},
      close() {},
      read,
      get silentEpisodes() {
        return 0;
      },
    };
    const baseline = probeRenders;
    for (let i = 0; i < 10; i += 1) {
      meterRef!.current!.read(1 / 60, true);
    }
    expect(read).toHaveBeenCalledTimes(10);
    expect(probeRenders).toBe(baseline);
  } finally {
    spy.mockRestore();
  }
});

test('pron.css dibuja la cabina a 160 y el botón a 72 sin oro de escena', () => {
  expect(pronCss).toMatch(/\.orb-wrap\s*\{[^}]*width:\s*160px/);
  expect(pronCss).toMatch(/\.orb-wrap\s*\{[^}]*height:\s*160px/);
  expect(pronCss).toMatch(/\.acoustic-slot[\s\S]*?width:\s*160px/);
  const orb = pronCss.match(/\.record-orb\s*\{[^}]*\}/)?.[0] ?? '';
  expect(orb).toMatch(/width:\s*72px/);
  expect(orb).toMatch(/height:\s*72px/);
  expect(orb).toContain('var(--c-record)');
  expect(orb).toContain('var(--c-on-record)');
  expect(pronCss).not.toMatch(/color:\s*var\(--c-gold-3d\)/);
  const total = pronCss.match(/\.pron-score-total\s*\{[^}]*\}/)?.[0] ?? '';
  expect(total).toMatch(/color:\s*var\(--c-text\)/);
  expect(total).toMatch(/font-variant-numeric:\s*tabular-nums/);
});
