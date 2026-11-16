import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { PdfDocument } from './PdfViewer';

vi.mock('pdfjs-dist', () => {
  const page = {
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: () => Promise.resolve(page),
      }),
    }),
  };
});

test('pdf viewer pages through document', async () => {
  const load = async () => new Blob([new Uint8Array([1])]);
  render(<PdfDocument load={load} title="Doc" />);
  expect(await screen.findByText('Página 1 de 3')).toBeTruthy();
  await userEvent.click(
    screen.getByRole('button', { name: 'Página siguiente' }),
  );
  expect(screen.getByText('Página 2 de 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Página anterior' })).toBeTruthy();
});

test('PdfDocument carga desde load sin ContentProvider', async () => {
  const load = vi.fn(async () => new Blob([new Uint8Array([1])]));
  render(<PdfDocument load={load} title="Leçon" />);
  expect(await screen.findByText('Página 1 de 3')).toBeTruthy();
  expect(load).toHaveBeenCalledOnce();
});

test('PdfDocument abre en initialPage y fuera de rango vuelve a 1', async () => {
  const load = async () => new Blob([new Uint8Array([1])]);
  const { unmount } = render(
    <PdfDocument load={load} title="Doc" initialPage={2} />,
  );
  expect(await screen.findByText('Página 2 de 3')).toBeTruthy();
  unmount();
  render(<PdfDocument load={load} title="Doc" initialPage={9} />);
  expect(await screen.findByText('Página 1 de 3')).toBeTruthy();
});
