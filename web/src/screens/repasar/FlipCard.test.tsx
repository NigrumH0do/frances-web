import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { closeV2DbForTests } from '../../offline/db';
import { setMotion3dPref } from '../../three/motionPref';
import type {
  CardView,
  FsrsCard,
  UserCardStateOut,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { renderScreen } from '../../shell/testing';
import { FlipCard } from './FlipCard';
import { RatingBar } from './RatingBar';
import Repasar from './Repasar';

afterEach(() => {
  setMotion3dPref('auto');
  document.documentElement.className = '';
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const FSRS: FsrsCard = {
  due: '2026-11-05T10:00:00.000000Z',
  stability: 3.1,
  difficulty: 5.2,
  elapsed_days: 0,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: '2026-11-01T10:00:00.000000Z',
};

function state(
  cardId: string,
  overrides: Partial<UserCardStateOut> = {},
): UserCardStateOut {
  return {
    card_id: cardId,
    fsrs: FSRS,
    suspended: false,
    flagged_hard: false,
    updated_at: '2026-11-01T10:00:00.000000Z',
    ...overrides,
  };
}

function card(id: string, overrides: Partial<CardView> = {}): CardView {
  return {
    id,
    kind: 'vocab',
    front_fr: `fr-${id}`,
    back_es: `es-${id}`,
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: [`i-${id}`],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: state(id),
    ...overrides,
  };
}

const CARD = card('a');
const INTERVALS = { 1: '<10 min', 2: '5 d', 3: '4 d', 4: '11 d' } as const;

const VOICES: VoiceOut[] = [
  {
    id: 'voice-a',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
];

const PREFS: UserPrefs = {
  preferred_voice_ids: ['voice-a'],
  daily_new_cards: 10,
  theme: 'system',
};

test('la cara oculta es inert y aria-hidden', () => {
  const { container, rerender } = render(
    <MemoryRouter>
      <FlipCard card={CARD} flipped={false} onFlip={vi.fn()} />
    </MemoryRouter>,
  );

  const front = container.querySelector('.flip-front')!;
  const back = container.querySelector('.flip-back')!;
  expect(back).toHaveAttribute('aria-hidden', 'true');
  expect(back).toHaveAttribute('inert');
  expect(front).toHaveAttribute('aria-hidden', 'false');
  expect(front).not.toHaveAttribute('inert');

  rerender(
    <MemoryRouter>
      <FlipCard card={CARD} flipped onFlip={vi.fn()} />
    </MemoryRouter>,
  );

  expect(front).toHaveAttribute('aria-hidden', 'true');
  expect(front).toHaveAttribute('inert');
  expect(back).toHaveAttribute('aria-hidden', 'false');
  expect(back).not.toHaveAttribute('inert');
});

test('usa la versión personal y muestra tipo, tema, difícil y fuente', () => {
  const personal = {
    front_fr: 'salut',
    back_es: 'buenas',
    example_fr: 'Salut à toi',
    example_es: 'Hola a ti',
    notes: 'Nota personal',
    base_updated_at: '2026-11-01T10:00:00.000000Z',
    updated_at: '2026-11-02T10:00:00.000000Z',
  };
  const { rerender } = render(
    <MemoryRouter>
      <FlipCard
        card={{
          ...CARD,
          kind: 'phrase',
          tags: ['Leçon 7'],
          mine: personal,
          state: state('a', { flagged_hard: true }),
        }}
        flipped={false}
        onFlip={vi.fn()}
      />
    </MemoryRouter>,
  );

  expect(screen.getByText(/Frase/)).toBeVisible();
  expect(screen.getByText('Leçon 7')).toBeVisible();
  expect(screen.getByText('Difícil')).toBeVisible();
  expect(screen.getByText('salut')).toBeVisible();

  rerender(
    <MemoryRouter>
      <FlipCard
        card={{
          ...CARD,
          kind: 'phrase',
          tags: ['Leçon 7'],
          mine: personal,
          state: state('a', { flagged_hard: true }),
        }}
        flipped
        onFlip={vi.fn()}
      />
    </MemoryRouter>,
  );

  expect(screen.getByText('buenas')).toBeVisible();
  expect(screen.getByText('Salut à toi')).toBeVisible();
  expect(screen.getByText('Nota personal')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Fuente: i-a' })).toHaveAttribute(
    'href',
    '/publicaciones/i-a',
  );
});

test('muestra el audio del frente y del ejemplo', async () => {
  const withAudio = card('audio', {
    audio: [
      {
        field: 'front',
        voice_id: 'voice-a',
        url: '/api/audio/front',
        duration_ms: 1000,
      },
      {
        field: 'example',
        voice_id: 'voice-a',
        url: '/api/audio/example',
        duration_ms: 1200,
      },
    ],
  });

  renderScreen(<FlipCard card={withAudio} flipped={false} onFlip={vi.fn()} />, {
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/me/prefs': PREFS,
    },
  });

  // Espera a que CardAudio termine de cargar voces y preferencias para que
  // sus actualizaciones de estado queden dentro del act del test.
  expect(await screen.findAllByLabelText('Voz')).toHaveLength(2);
  expect(
    screen.getAllByRole('button', { name: /Reproducir/, hidden: true }),
  ).toHaveLength(2);
  expect(
    screen.getAllByRole('button', { name: 'Lento', hidden: true }),
  ).toHaveLength(2);
});

test('los atajos 1–4 y Espacio no se disparan dentro de campos de texto ni con la respuesta oculta', async () => {
  const onFlip = vi.fn();
  const onRate = vi.fn();

  function Harness() {
    const [flipped, setFlipped] = useState(false);
    return (
      <>
        <input aria-label="Nota" />
        <FlipCard
          card={CARD}
          flipped={flipped}
          onFlip={() => {
            onFlip();
            setFlipped(true);
          }}
        />
        {flipped ? <RatingBar intervals={INTERVALS} onRate={onRate} /> : null}
      </>
    );
  }

  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  const input = screen.getByRole('textbox', { name: 'Nota' });

  // Dentro de un campo de texto ni Espacio voltea ni 1–4 califican.
  await userEvent.click(input);
  await userEvent.keyboard(' ');
  await userEvent.keyboard('3');
  expect(onFlip).not.toHaveBeenCalled();
  expect(onRate).not.toHaveBeenCalled();

  // Con la respuesta oculta, 3 tampoco califica.
  input.blur();
  await userEvent.keyboard('3');
  expect(onRate).not.toHaveBeenCalled();

  // Fuera de un campo, Espacio muestra la respuesta.
  await userEvent.keyboard(' ');
  expect(onFlip).toHaveBeenCalledTimes(1);

  // Con la respuesta visible, 3 califica.
  await userEvent.keyboard('3');
  expect(onRate).toHaveBeenCalledWith(3);

  // Y dentro de un campo de texto sigue sin calificar.
  await userEvent.click(input);
  await userEvent.keyboard('4');
  expect(onRate).toHaveBeenCalledTimes(1);
});

test('usa source_titles legible en el enlace a la publicación cuando existe', () => {
  render(
    <MemoryRouter>
      <FlipCard
        card={{
          ...CARD,
          source_item_ids: ['i-a'],
          source_titles: { 'i-a': 'Leçon 4 · Les métiers' },
        }}
        flipped
        onFlip={vi.fn()}
      />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole('link', { name: 'Fuente: Leçon 4 · Les métiers' }),
  ).toHaveAttribute('href', '/publicaciones/i-a');
});

test('al voltear muestra recordatorio en francés, IPA, audio y secciones de ejemplo y nota', async () => {
  const fullCard = card('rich', {
    kind: 'phrase',
    front_fr: 'Elle est chinoise.',
    back_es: 'Ella es china.',
    ipa: 'ɛl ɛ ʃinwaz',
    example_fr: 'Il est chinois, mais elle est chinoise.',
    example_es: 'Él es chino, pero ella es china.',
    notes:
      'Concordancia de género: masculino «chinois» (s muda) y femenino «chinoise» (-oise).',
    tags: ['nacionalidades'],
    source_titles: { 'i-rich': 'Leçon 1 · Nationalités' },
    audio: [
      {
        field: 'front',
        voice_id: 'voice-a',
        url: '/api/audio/front-rich',
        duration_ms: 950,
      },
    ],
  });

  renderScreen(<FlipCard card={fullCard} flipped onFlip={vi.fn()} />, {
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/me/prefs': PREFS,
    },
  });

  await screen.findByText('Ella es china.');
  const back = document.querySelector('.flip-back');
  expect(back).not.toBeNull();
  const scoped = within(back as HTMLElement);
  expect(await scoped.findByLabelText('Voz')).toBeVisible();
  expect(back!.querySelector('.flip-recap')).not.toBeNull();
  expect(scoped.getByText('Elle est chinoise.')).toBeVisible();
  expect(scoped.getByText('/ɛl ɛ ʃinwaz/')).toBeVisible();
  expect(scoped.getByText('Ejemplo')).toBeVisible();
  expect(scoped.getByText('Nota')).toBeVisible();
  expect(scoped.getByText(/Concordancia de género: masculino/)).toBeVisible();
});

test('al voltear sin ejemplo ni nota igual muestra el recordatorio en francés en el reverso', () => {
  const minimalCard = card('minimal', {
    kind: 'phrase',
    front_fr: 'Elle est chinoise.',
    back_es: 'Ella es china.',
    ipa: 'ɛl ɛ ʃinwaz',
    example_fr: null,
    example_es: null,
    notes: null,
    source_titles: { 'i-minimal': 'Leçon 1 · Nationalités' },
  });

  const { container } = render(
    <MemoryRouter>
      <FlipCard card={minimalCard} flipped onFlip={vi.fn()} />
    </MemoryRouter>,
  );

  const back = container.querySelector('.flip-back');
  expect(back).not.toBeNull();
  const scoped = within(back as HTMLElement);
  expect(back!.querySelector('.flip-recap')).not.toBeNull();
  expect(scoped.getByText('Elle est chinoise.')).toBeVisible();
  expect(scoped.getByText('/ɛl ɛ ʃinwaz/')).toBeVisible();
  expect(scoped.getByText('Ella es china.')).toBeVisible();
  expect(scoped.queryByText('Ejemplo')).not.toBeInTheDocument();
  expect(scoped.queryByText('Nota')).not.toBeInTheDocument();
});

test('con motion3d off no aplica tilt al mover el puntero', () => {
  const rect = {
    left: 0,
    top: 0,
    width: 200,
    height: 100,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    rect,
  );

  const { container } = render(
    <MemoryRouter>
      <FlipCard card={CARD} flipped={false} onFlip={vi.fn()} />
    </MemoryRouter>,
  );
  const tilt = container.querySelector('.flip-tilt') as HTMLElement;

  setMotion3dPref('off');
  fireEvent.pointerEnter(tilt, { pointerType: 'mouse' });
  fireEvent.pointerMove(tilt, {
    pointerType: 'mouse',
    clientX: 150,
    clientY: 25,
  });
  expect(tilt.style.getPropertyValue('--rx')).toBe('');
  expect(tilt.style.getPropertyValue('--ry')).toBe('');
  expect(tilt.classList.contains('is-tilting')).toBe(false);

  setMotion3dPref('auto');
  fireEvent.pointerEnter(tilt, { pointerType: 'touch' });
  fireEvent.pointerMove(tilt, {
    pointerType: 'touch',
    clientX: 150,
    clientY: 25,
  });
  expect(tilt.style.getPropertyValue('--rx')).toBe('');
  expect(tilt.style.getPropertyValue('--ry')).toBe('');
  expect(tilt.classList.contains('is-tilting')).toBe(false);

  fireEvent.pointerEnter(tilt, { pointerType: 'mouse' });
  expect(tilt.classList.contains('is-tilting')).toBe(true);
  fireEvent.pointerMove(tilt, {
    pointerType: 'mouse',
    clientX: 150,
    clientY: 25,
  });
  expect(tilt.style.getPropertyValue('--rx')).not.toBe('');
  expect(tilt.style.getPropertyValue('--ry')).not.toBe('');

  fireEvent.pointerLeave(tilt);
  expect(tilt.classList.contains('is-tilting')).toBe(false);
  expect(tilt.style.getPropertyValue('--rx')).toBe('0deg');
  expect(tilt.style.getPropertyValue('--ry')).toBe('0deg');
});

test('voltea cuando keydown trae code Space aunque key sea Spacebar', () => {
  const onFlip = vi.fn();
  render(
    <MemoryRouter>
      <FlipCard card={CARD} flipped={false} onFlip={onFlip} />
    </MemoryRouter>,
  );

  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    }),
  );
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Spacebar',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    }),
  );

  expect(onFlip).toHaveBeenCalledTimes(2);
});

const CARD_RECT = {
  left: 0,
  top: 0,
  width: 200,
  height: 400,
  right: 200,
  bottom: 400,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function mockCardRect(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    CARD_RECT,
  );
}

// jsdom no implementa la captura del puntero (LIVE-A3 BUG-1): el test define
// `setPointerCapture`/`releasePointerCapture` en la propia tarjeta para
// detectar cuándo el componente secuestra el puntero.
function stubPointerCapture(node: HTMLElement): {
  capture: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const capture = vi.fn();
  const release = vi.fn();
  Object.defineProperty(node, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: capture,
  });
  Object.defineProperty(node, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: release,
  });
  return { capture, release };
}

function swipe(
  element: HTMLElement,
  fromX: number,
  toX: number,
  fromY = 80,
  toY = 80,
): void {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: fromX,
    clientY: fromY,
  });
  fireEvent.pointerMove(element, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: toX,
    clientY: toY,
  });
  fireEvent.pointerUp(element, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: toX,
    clientY: toY,
  });
}

test('cada grado lleva un icono distinto y conserva el atajo', () => {
  render(<RatingBar intervals={INTERVALS} onRate={vi.fn()} />);
  const svgs = document.querySelectorAll('.rating svg');
  expect(svgs).toHaveLength(4);
  for (const svg of svgs) {
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  }
  expect(new Set([...svgs].map((svg) => svg.innerHTML)).size).toBe(4);
  for (const key of ['1', '2', '3', '4']) {
    expect(
      document.querySelector(`[aria-keyshortcuts="${key}"]`),
    ).not.toBeNull();
  }
});

test('el swipe frontal llama onFlip y el reverso informa el grado sin calificar solo', () => {
  mockCardRect();
  const onFlip = vi.fn();
  const onSwipeRate = vi.fn();
  const { container, rerender } = render(
    <MemoryRouter>
      <FlipCard
        card={CARD}
        flipped={false}
        onFlip={onFlip}
        onSwipeRate={onSwipeRate}
      />
    </MemoryRouter>,
  );
  const tilt = container.querySelector('.flip-tilt') as HTMLElement;

  swipe(tilt, 20, 40, 80, 200);
  expect(onFlip).not.toHaveBeenCalled();
  swipe(tilt, 10, 40);
  expect(onFlip).not.toHaveBeenCalled();

  swipe(tilt, 10, 80);
  expect(onFlip).toHaveBeenCalledTimes(1);
  expect(onSwipeRate).not.toHaveBeenCalled();

  rerender(
    <MemoryRouter>
      <FlipCard card={CARD} flipped onFlip={onFlip} onSwipeRate={onSwipeRate} />
    </MemoryRouter>,
  );
  const flippedTilt = container.querySelector('.flip-tilt') as HTMLElement;

  fireEvent.pointerDown(flippedTilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 150,
    clientY: 80,
  });
  fireEvent.pointerMove(flippedTilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 80,
  });
  expect(flippedTilt.style.getPropertyValue('--swipe-x')).toBe('-50px');
  fireEvent.pointerUp(flippedTilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 80,
  });
  expect(flippedTilt.style.getPropertyValue('--swipe-x')).toBe('0px');
  expect(onSwipeRate).not.toHaveBeenCalled();

  swipe(flippedTilt, 100, 120, 40, 180);
  expect(onSwipeRate).not.toHaveBeenCalled();

  swipe(flippedTilt, 160, 40);
  expect(onSwipeRate).toHaveBeenCalledTimes(1);
  expect(onSwipeRate).toHaveBeenCalledWith(1);
  expect(onFlip).toHaveBeenCalledTimes(1);
  expect(flippedTilt.style.getPropertyValue('--swipe-x')).toBe('0px');

  swipe(flippedTilt, 20, 140);
  expect(onSwipeRate).toHaveBeenCalledTimes(2);
  expect(onSwipeRate).toHaveBeenLastCalledWith(4);
});

test('los controles internos de la tarjeta no secuestran el puntero y reciben el clic', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

  const onFlip = vi.fn();
  const controlCard = card('controls', {
    audio: [
      {
        field: 'front',
        voice_id: 'voice-a',
        url: '/api/audio/controls',
        duration_ms: 1000,
      },
    ],
    source_titles: { 'i-controls': 'Leçon 2 · Les contrôles' },
  });

  const { transport } = renderScreen(
    <FlipCard card={controlCard} flipped onFlip={onFlip} />,
    {
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'GET /api/audio/controls': () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'Content-Type': 'audio/mpeg' },
          }),
      },
    },
  );

  const tilt = document.querySelector('.flip-tilt') as HTMLElement;
  const back = document.querySelector('.flip-back') as HTMLElement;
  const scoped = within(back);
  const { capture, release } = stubPointerCapture(tilt);

  const play = await scoped.findByRole('button', { name: 'Reproducir' });
  const slow = scoped.getByRole('button', { name: 'Lento' });
  const voice = scoped.getByLabelText('Voz');
  const source = scoped.getByRole('link', {
    name: 'Fuente: Leçon 2 · Les contrôles',
  });

  // El icono del botón es un SVG: `event.target` no es un HTMLElement.
  const iconPath = play.querySelector('svg path');
  expect(iconPath).not.toBeNull();
  expect(iconPath).not.toBeInstanceOf(HTMLElement);

  for (const target of [iconPath as Element, play, slow, voice, source]) {
    fireEvent.pointerDown(target, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 40,
      clientY: 40,
    });
    fireEvent.pointerUp(target, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 40,
      clientY: 40,
    });
  }
  expect(capture).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  expect(onFlip).not.toHaveBeenCalled();

  // Tampoco se guarda el gesto: un desplazamiento posterior no voltea.
  fireEvent.pointerDown(play, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 40,
    clientY: 40,
  });
  fireEvent.pointerUp(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 200,
    clientY: 40,
  });
  expect(capture).not.toHaveBeenCalled();
  expect(onFlip).not.toHaveBeenCalled();

  // Y los clics sí ejecutan su acción.
  await userEvent.click(slow);
  expect(slow).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(play);
  await waitFor(() =>
    expect(
      transport.calls.filter((call) => call.url === '/api/audio/controls'),
    ).toHaveLength(1),
  );
});

test('solo un arrastre horizontal captura el puntero y sigue volteando y calificando', () => {
  mockCardRect();
  const onFlip = vi.fn();
  const onSwipeRate = vi.fn();
  const { container, rerender } = render(
    <MemoryRouter>
      <FlipCard
        card={CARD}
        flipped={false}
        onFlip={onFlip}
        onSwipeRate={onSwipeRate}
      />
    </MemoryRouter>,
  );
  const tilt = container.querySelector('.flip-tilt') as HTMLElement;
  const { capture, release } = stubPointerCapture(tilt);

  // Un toque sin arrastre no captura el puntero.
  fireEvent.pointerDown(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerUp(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
  });
  expect(capture).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  expect(onFlip).not.toHaveBeenCalled();

  // Un arrastre menor que el umbral (8 px) tampoco captura ni voltea.
  fireEvent.pointerDown(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerMove(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 106,
    clientY: 101,
  });
  expect(capture).not.toHaveBeenCalled();
  fireEvent.pointerUp(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 106,
    clientY: 101,
  });
  expect(capture).not.toHaveBeenCalled();
  expect(onFlip).not.toHaveBeenCalled();

  // Un arrastre vertical no captura ni voltea.
  fireEvent.pointerDown(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerMove(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 104,
    clientY: 160,
  });
  expect(capture).not.toHaveBeenCalled();
  fireEvent.pointerUp(tilt, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 104,
    clientY: 160,
  });
  expect(onFlip).not.toHaveBeenCalled();

  // Un arrastre horizontal real captura una sola vez y sigue volteando.
  swipe(tilt, 10, 80);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledWith(1);
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith(1);
  expect(onFlip).toHaveBeenCalledTimes(1);

  rerender(
    <MemoryRouter>
      <FlipCard card={CARD} flipped onFlip={onFlip} onSwipeRate={onSwipeRate} />
    </MemoryRouter>,
  );
  const flippedTilt = container.querySelector('.flip-tilt') as HTMLElement;
  const flippedStub = stubPointerCapture(flippedTilt);

  swipe(flippedTilt, 160, 40);
  expect(flippedStub.capture).toHaveBeenCalledTimes(1);
  expect(flippedStub.release).toHaveBeenCalledTimes(1);
  expect(onSwipeRate).toHaveBeenCalledWith(1);
  expect(onFlip).toHaveBeenCalledTimes(1);
});

test('con motion3d off el swipe no voltea ni califica', () => {
  mockCardRect();
  const onFlip = vi.fn();
  const onSwipeRate = vi.fn();
  setMotion3dPref('off');
  const { container, rerender } = render(
    <MemoryRouter>
      <FlipCard
        card={CARD}
        flipped={false}
        onFlip={onFlip}
        onSwipeRate={onSwipeRate}
      />
    </MemoryRouter>,
  );
  const tilt = container.querySelector('.flip-tilt') as HTMLElement;
  swipe(tilt, 10, 160);
  expect(onFlip).not.toHaveBeenCalled();

  rerender(
    <MemoryRouter>
      <FlipCard card={CARD} flipped onFlip={onFlip} onSwipeRate={onSwipeRate} />
    </MemoryRouter>,
  );
  swipe(container.querySelector('.flip-tilt') as HTMLElement, 160, 20);
  expect(onSwipeRate).not.toHaveBeenCalled();
});

function renderSingleCard() {
  return renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD],
      'POST /api/reviews': state('a'),
      'GET /api/plan/today': {
        day: '2026-11-06',
        entries: [],
        generated_at: '2026-11-06T05:45:00.000000Z',
      },
    },
  });
}

async function revealAndSwipe(
  user: ReturnType<typeof userEvent.setup>,
  fromX: number,
  toX: number,
): Promise<void> {
  mockCardRect();
  expect(await screen.findByText('fr-a')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
  const tilt = document.querySelector('.flip-tilt') as HTMLElement;
  swipe(tilt, fromX, toX);
}

test('el swipe del reverso espera 5 s y Deshacer cancela la calificación', async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({
    advanceTimers: vi.advanceTimersByTimeAsync,
  });
  const { transport } = renderSingleCard();

  await revealAndSwipe(user, 180, 20);
  expect(await screen.findByRole('button', { name: 'Deshacer' })).toBeVisible();
  expect(screen.getByText(/se aplicará en breve/)).toBeVisible();
  expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
    false,
  );

  await user.click(screen.getByRole('button', { name: 'Deshacer' }));
  expect(
    screen.queryByRole('button', { name: 'Deshacer' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
    false,
  );
  expect(screen.getByText('es-a')).toBeVisible();
  expect(screen.queryByText('Sesión terminada')).not.toBeInTheDocument();
});

test('al vencer el temporizador del swipe se califica con el grado arrastrado', async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({
    advanceTimers: vi.advanceTimersByTimeAsync,
  });
  const { transport } = renderSingleCard();

  await revealAndSwipe(user, 20, 180);
  expect(await screen.findByText(/se aplicará en breve/)).toBeVisible();
  expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
    false,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await waitFor(() =>
    expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
      true,
    ),
  );
  const body = transport.calls.find((call) => call.url === '/api/reviews')!
    .body as { rating: number };
  expect(body.rating).toBe(4);
  expect(await screen.findByText('Sesión terminada')).toBeVisible();
});
