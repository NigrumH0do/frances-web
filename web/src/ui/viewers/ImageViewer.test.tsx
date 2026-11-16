import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BlobImage } from './ImageViewer';

afterEach(() => {
  vi.restoreAllMocks();
});

test('BlobImage carga desde load sin ContentProvider y revoca al desmontar', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:img');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const load = vi.fn(async () => new Blob([new Uint8Array([1])]));
  const { unmount } = render(<BlobImage load={load} alt="Tableau" />);
  expect(await screen.findByRole('img', { name: 'Tableau' })).toHaveAttribute(
    'src',
    'blob:img',
  );
  expect(load).toHaveBeenCalledOnce();
  unmount();
  expect(revoke).toHaveBeenCalledWith('blob:img');
});
