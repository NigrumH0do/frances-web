import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { WordScore } from '../../contracts/generated';
import { WordList } from './WordList';

const word: WordScore = {
  word: 'chat',
  accuracy: 40,
  error_type: 'Mispronunciation',
  phonemes: [{ phoneme: 'ʃ', accuracy: 40 }],
};

test('un fonema a repetir dice repetir y la palabra mal pronunciada conserva su etiqueta', async () => {
  const user = userEvent.setup();
  render(<WordList words={[word]} />);
  expect(screen.getByText('mal pronunciada')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'chat' }));
  const phonemes = screen.getByRole('list', { name: 'Fonemas de chat' });
  expect(phonemes).toHaveTextContent('repetir');
  expect(phonemes).toHaveTextContent('ʃ');
  expect(screen.getByText('repetir')).toBeInTheDocument();
});

test('el fonema usa la mono recta', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'pron.css'),
    'utf8',
  );
  const rule = css.match(/\.pron-phoneme\s*\{[^}]*\}/)?.[0] ?? '';
  expect(rule).toMatch(/font-family:\s*var\(--font-mono\)/);
  expect(rule).toMatch(/font-style:\s*normal/);
});
