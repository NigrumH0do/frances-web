import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vitest';
import { PdfDocument } from './PdfViewer';

const pdfMock = vi.hoisted(() => ({
  render: vi.fn(() => ({
    promise: Promise.resolve() as Promise<void>,
    cancel: () => undefined,
  })),
}));

function renderOk() {
  return {
    promise: Promise.resolve(),
    cancel: () => undefined,
  };
}

vi.mock('pdfjs-dist', () => {
  const page = {
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => pdfMock.render(),
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

afterEach(() => {
  pdfMock.render.mockReset();
  pdfMock.render.mockImplementation(renderOk);
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

test('page.render rejection shows an alert and does not escape', async () => {
  pdfMock.render.mockImplementation(() => ({
    promise: Promise.reject(new Error('render failed')),
    cancel: () => undefined,
  }));
  const load = async () => new Blob([new Uint8Array([1])]);
  render(<PdfDocument load={load} title="Doc" />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No se pudo mostrar esta página.',
  );
  expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();

  pdfMock.render.mockImplementation(renderOk);
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

test('cambiar de página limpia el error de render', async () => {
  pdfMock.render.mockImplementation(() => ({
    promise: Promise.reject(new Error('render failed')),
    cancel: () => undefined,
  }));
  const load = async () => new Blob([new Uint8Array([1])]);
  render(<PdfDocument load={load} title="Doc" />);
  expect(await screen.findByRole('alert')).toBeInTheDocument();

  pdfMock.render.mockImplementation(renderOk);
  await userEvent.click(
    screen.getByRole('button', { name: 'Página siguiente' }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
});
