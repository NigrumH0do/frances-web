import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { VoiceOut } from '../contracts/generated';
import { ClipPlayer } from './AudioPlayer';

afterEach(() => {
  vi.restoreAllMocks();
});

const VOICES: VoiceOut[] = [
  {
    id: 'fr-FR-DeniseNeural',
    label: 'Denise',
    age: 'adult',
    gender: 'female',
    accent: 'standard',
  },
  {
    id: 'fr-FR-HenriNeural',
    label: 'Henri',
    age: 'adult',
    gender: 'male',
    accent: 'standard',
  },
  {
    id: 'fr-FR-EloiseNeural',
    label: 'Eloise',
    age: 'child',
    gender: 'female',
    accent: 'standard',
  },
];

const load = async (): Promise<Blob> => new Blob([]);

test('ClipPlayer elige la preferida disponible sin IndexedDB', () => {
  render(
    <ClipPlayer
      clips={[
        { voice_id: 'fr-FR-DeniseNeural', load },
        { voice_id: 'fr-FR-HenriNeural', load },
      ]}
      pendingVoiceIds={[]}
      voices={VOICES}
      preferred={['fr-FR-HenriNeural']}
    />,
  );
  const select = screen.getByLabelText('Voz') as HTMLSelectElement;
  expect(select.value).toBe('fr-FR-HenriNeural');
});

test('ClipPlayer muestra la pendiente cuando no hay clips', () => {
  render(
    <ClipPlayer
      clips={[]}
      pendingVoiceIds={['fr-FR-EloiseNeural']}
      voices={VOICES}
      preferred={[]}
      voiceId="fr-FR-EloiseNeural"
    />,
  );
  expect(screen.getByText('Audio pendiente: Eloise (niña)')).toBeTruthy();
});

test('voiceLabel no repite el acento ni la edad que ya trae la etiqueta', async () => {
  const { voiceLabel } = await import('./AudioPlayer');
  expect(
    voiceLabel({
      id: 'fr-FR-DeniseNeural',
      label: 'Denise · Francia · adulta',
      age: 'adult',
      gender: 'female',
      accent: 'Francia',
    }),
  ).toBe('Denise (Francia, adulta)');
  expect(
    voiceLabel({
      id: 'teen-f',
      label: 'Adolescente · chica',
      age: 'teen',
      gender: 'female',
      accent: 'Francia',
    }),
  ).toBe('Adolescente chica (Francia)');
  expect(
    voiceLabel({
      id: 'child-f',
      label: 'Niña',
      age: 'child',
      gender: 'female',
      accent: 'Francia',
    }),
  ).toBe('Niña (Francia)');
});

test('«Más lento» se puede activar y desactivar', async () => {
  render(
    <ClipPlayer
      clips={[{ voice_id: 'fr-FR-DeniseNeural', load }]}
      pendingVoiceIds={[]}
      voices={VOICES}
      preferred={[]}
    />,
  );
  const slow = screen.getByRole('button', { name: 'Más lento' });
  expect(slow).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(slow);
  expect(slow).toHaveAttribute('aria-pressed', 'true');
});

test('ClipPlayer revoca la object URL al desmontar', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const { unmount } = render(
    <ClipPlayer
      clips={[{ voice_id: 'fr-FR-DeniseNeural', load }]}
      pendingVoiceIds={[]}
      voices={VOICES}
      preferred={[]}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
  expect(await screen.findByRole('button', { name: 'Detener' })).toBeTruthy();
  unmount();
  expect(create).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith('blob:x');
});
