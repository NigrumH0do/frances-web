import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vitest';
import { PdfDocument } from './PdfViewer';

const pdfMock = vi.hoisted(() => ({
  // Tamaño natural de la página en puntos PDF. `getViewport` lo multiplica por
  // la escala pedida, como pdf.js de verdad.
  pageSize: { width: 100, height: 100 },
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
    getViewport: ({ scale }: { scale: number }) => ({
      width: pdfMock.pageSize.width * scale,
      height: pdfMock.pageSize.height * scale,
    }),
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
  pdfMock.pageSize = { width: 100, height: 100 };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// B5 (LIVE-A2 H-A): la página se pinta al ancho del contenedor, no al tamaño
// natural del PDF. `Element.clientWidth` es 0 en jsdom, así que solo el host
// `.pdf-page` simula un contenedor real de 320 px (móvil).
function mockHostWidth(read: () => number): void {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: Element) {
      return this.classList.contains('pdf-page') ? read() : 0;
    },
  );
}

function canvasOf(): HTMLCanvasElement {
  const canvas = screen.getByRole('img', { name: /Página 1 de 3/ });
  expect(canvas.tagName).toBe('CANVAS');
  return canvas as HTMLCanvasElement;
}

test('el canvas se reajusta cuando el contenedor cambia de tamaño (ResizeObserver)', async () => {
  pdfMock.pageSize = { width: 935, height: 1280 };
  let hostWidth = 320;
  mockHostWidth(() => hostWidth);
  const resized: (() => void)[] = [];
  class FakeResizeObserver {
    constructor(callback: () => void) {
      resized.push(callback);
    }
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);

  const load = async () => new Blob([new Uint8Array([1])]);
  render(<PdfDocument load={load} title="Doc" />);
  await screen.findByText('Página 1 de 3');
  const canvas = canvasOf();
  await waitFor(() => expect(canvas.width).toBe(320));
  expect(resized.length).toBeGreaterThan(0);

  hostWidth = 160;
  act(() => {
    for (const notify of resized) notify();
  });

  await waitFor(() => expect(canvas.width).toBe(160));
});

test('el canvas del PDF se ajusta al ancho del contenedor y el zoom permite paneo', async () => {
  pdfMock.pageSize = { width: 935, height: 1280 };
  mockHostWidth(() => 320);
  const load = async () => new Blob([new Uint8Array([1])]);
  render(<PdfDocument load={load} title="Doc" />);

  await screen.findByText('Página 1 de 3');
  const canvas = canvasOf();
  await waitFor(() => expect(canvas.width).toBe(320));
  expect(canvas.height).toBe(Math.floor((1280 * 320) / 935));
  expect(canvas).toHaveClass('pdf-canvas');
  // A escala <= 1 el CSS recorta cualquier sobrante: cero desborde.
  expect(canvas).toHaveClass('is-fit');
  expect(canvas.closest('.pdf-page')).not.toBeNull();
  expect(canvas.closest('figure')).toHaveClass('pdf-figure');

  await userEvent.click(screen.getByRole('button', { name: 'Acercar' }));

  // Con zoom la página crece dentro de `.pdf-page`, que hace scroll horizontal
  // en su columna en vez de solaparse con la ficha sticky.
  await waitFor(() => expect(canvas.width).toBe(400));
  expect(canvas).not.toHaveClass('is-fit');
  expect(canvas.closest('.pdf-page')).not.toBeNull();
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
