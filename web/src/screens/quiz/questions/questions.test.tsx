import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../../../api/ApiContext';
import { createApiClient } from '../../../api/client';
import { fakeTransport } from '../../../api/testing';
import type { Question1 } from '../../../contracts/generated';
import { Cloze } from './Cloze';
import { Dictation } from './Dictation';
import { Mcq } from './Mcq';
import { Order } from './Order';
import { Translate } from './Translate';

const Q_MCQ: Question1 = {
  id: 'q_1',
  kind: 'mcq',
  prompt_es: '¿Cuál es la forma correcta?',
  prompt_fr: null,
  options: ['suis', 'est', 'sommes', 'sont'],
  audio: null,
  source_item_id: 'i_1',
};

const Q_CLOZE: Question1 = {
  id: 'q_2',
  kind: 'cloze',
  prompt_es: 'Completa la frase.',
  prompt_fr: 'Hier, elle est ___ à huit heures.',
  options: [],
  audio: null,
  source_item_id: 'i_1',
};

const Q_TRANSLATE: Question1 = {
  id: 'q_3',
  kind: 'translate',
  prompt_es: 'Traduce al francés: «Comimos una crepa».',
  prompt_fr: null,
  options: [],
  audio: null,
  source_item_id: 'i_1',
};

const Q_ORDER: Question1 = {
  id: 'q_4',
  kind: 'order',
  prompt_es: 'Ordena las palabras.',
  prompt_fr: null,
  options: ['suis', 'Je', 'allé'],
  audio: null,
  source_item_id: 'i_1',
};

const Q_DICTATION: Question1 = {
  id: 'q_5',
  kind: 'dictation',
  prompt_es: 'Escucha y escribe lo que oyes.',
  prompt_fr: 'bonjour',
  options: [],
  audio: {
    field: 'front',
    voice_id: 'voice-a',
    url: '/api/audio/k1',
    duration_ms: 1200,
  },
  source_item_id: 'i_1',
};

function renderQuestion(
  ui: ReactElement,
  routes: Record<string, unknown> = {},
) {
  const transport = fakeTransport(routes);
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  return {
    transport,
    ...render(<ApiProvider client={client}>{ui}</ApiProvider>),
  };
}

function ClozeHarness() {
  const [value, setValue] = useState('');
  return <Cloze q={Q_CLOZE} value={value} onChange={setValue} />;
}

function TranslateHarness() {
  const [value, setValue] = useState('');
  return <Translate q={Q_TRANSLATE} value={value} onChange={setValue} />;
}

function OrderHarness() {
  const [value, setValue] = useState<string[]>([]);
  return <Order q={Q_ORDER} value={value} onChange={setValue} />;
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('Mcq es un radiogroup que marca la opción elegida', async () => {
  const onChange = vi.fn();
  renderQuestion(<Mcq q={Q_MCQ} value="suis" onChange={onChange} />);

  expect(
    screen.getByRole('radiogroup', { name: '¿Cuál es la forma correcta?' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'suis' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(screen.getByRole('radio', { name: 'est' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await userEvent.click(screen.getByRole('radio', { name: 'est' }));
  expect(onChange).toHaveBeenCalledWith('est');
});

test('Cloze sustituye el hueco por un campo Respuesta', async () => {
  renderQuestion(<ClozeHarness />);

  const input = screen.getByRole('textbox', { name: 'Respuesta' });
  expect(input).toHaveClass('gap');
  await userEvent.type(input, 'est');
  expect(input).toHaveValue('est');
});

test('Translate usa una textarea etiquetada', async () => {
  renderQuestion(<TranslateHarness />);

  const area = screen.getByRole('textbox', { name: /Traducción/ });
  expect(area.tagName).toBe('TEXTAREA');
  await userEvent.type(area, 'Nous avons mangé');
  expect(area).toHaveValue('Nous avons mangé');
});

test('Order mueve las fichas al tocarlas y ofrece Subir y Bajar', async () => {
  renderQuestion(<OrderHarness />);

  await userEvent.click(screen.getByRole('button', { name: 'suis' }));
  await userEvent.click(screen.getByRole('button', { name: 'Je' }));

  const phrase = screen.getByRole('group', { name: 'Frase' });
  function tiles() {
    return within(phrase)
      .getAllByRole('button')
      .filter((button) => button.classList.contains('tile'))
      .map((button) => button.textContent);
  }
  expect(tiles()).toEqual(['suis', 'Je']);

  await userEvent.click(screen.getByRole('button', { name: 'Subir Je' }));
  expect(tiles()).toEqual(['Je', 'suis']);
  expect(screen.getByRole('button', { name: 'Bajar suis' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Subir Je' })).toBeDisabled();
});

test('Dictation reproduce el audio de la pregunta sin revelar su texto', async () => {
  const { transport } = renderQuestion(
    <Dictation q={Q_DICTATION} value="" onChange={vi.fn()} />,
    {
      'GET /api/audio/k1': () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'audio/mpeg' },
        }),
    },
  );

  expect(
    screen.getByRole('textbox', { name: /Lo que oyes/ }),
  ).toBeInTheDocument();
  expect(screen.queryByText('bonjour')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
  await waitFor(() =>
    expect(transport.calls.some((call) => call.url === '/api/audio/k1')).toBe(
      true,
    ),
  );
});

test('cada tipo de pregunta va en un fieldset con su leyenda', () => {
  const { container } = renderQuestion(
    <>
      <Mcq q={Q_MCQ} value="" onChange={vi.fn()} />
      <Cloze q={Q_CLOZE} value="" onChange={vi.fn()} />
      <Translate q={Q_TRANSLATE} value="" onChange={vi.fn()} />
      <Order q={Q_ORDER} value={[]} onChange={vi.fn()} />
      <Dictation q={Q_DICTATION} value="" onChange={vi.fn()} />
    </>,
  );

  const fieldsets = container.querySelectorAll('fieldset');
  expect(fieldsets).toHaveLength(5);
  expect(
    Array.from(fieldsets).map(
      (fieldset) => fieldset.querySelector('legend')?.textContent,
    ),
  ).toEqual([
    '¿Cuál es la forma correcta?',
    'Completa la frase.',
    'Traduce al francés: «Comimos una crepa».',
    'Ordena las palabras.',
    'Escucha y escribe lo que oyes.',
  ]);
});
