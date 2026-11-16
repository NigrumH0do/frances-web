import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import { createApiClient } from '../api/client';
import { fakeTransport } from '../api/testing';
import type { AttachmentView as AttachmentViewData } from '../contracts/generated';
import { AttachmentBlock } from './AttachmentView';

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

const PDF_FILE = {
  url: '/api/files/url-pdf',
  size: 10,
  mime: 'application/pdf',
  sha256: 'f'.repeat(64),
};

const IMAGE_FILE = {
  url: '/api/files/url-image',
  size: 20,
  mime: 'image/png',
  sha256: 'i'.repeat(64),
};

const PDF_ATT: AttachmentViewData = {
  id: 'att-pdf',
  kind: 'drive_file',
  title: 'Leçon 7',
  url: null,
  mime_type: 'application/pdf',
  status: 'downloaded',
  file: PDF_FILE,
  view_pdf: null,
};

const IMAGE_ATT: AttachmentViewData = {
  id: 'att-image',
  kind: 'drive_file',
  title: 'Photo',
  url: null,
  mime_type: 'image/png',
  status: 'downloaded',
  file: IMAGE_FILE,
  view_pdf: null,
};

const LINK_ATT: AttachmentViewData = {
  id: 'att-link',
  kind: 'youtube',
  title: 'Vidéo',
  url: 'https://youtu.be/abc',
  mime_type: null,
  status: 'reference',
  file: null,
  view_pdf: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function renderBlock(att: AttachmentViewData, initialPage?: number) {
  const routes: Record<string, unknown> = {};
  const fileUrl = att.view_pdf?.url ?? att.file?.url;
  if (fileUrl !== undefined) {
    routes[`GET ${fileUrl}`] = () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': att.file?.mime ?? 'application/pdf' },
      });
  }
  const transport = fakeTransport(routes);
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  const result = render(
    <ApiProvider client={client}>
      <AttachmentBlock att={att} initialPage={initialPage} />
    </ApiProvider>,
  );
  return { transport, ...result };
}

test('AttachmentBlock elige visor por mime y muestra enlaces externos seguros', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  const pdf = renderBlock(PDF_ATT, 2);
  expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
  expect(pdf.transport.calls.some((call) => call.url === PDF_FILE.url)).toBe(
    true,
  );
  pdf.unmount();

  const image = renderBlock(IMAGE_ATT);
  expect(await screen.findByRole('img', { name: 'Photo' })).toHaveAttribute(
    'src',
    'blob:image',
  );
  expect(
    image.transport.calls.some((call) => call.url === IMAGE_FILE.url),
  ).toBe(true);
  image.unmount();

  renderBlock(LINK_ATT);
  const link = await screen.findByRole('link', { name: /Abrir en YouTube/ });
  expect(link).toHaveAttribute('href', 'https://youtu.be/abc');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('AttachmentBlock usa FileLink.url y nunca concatena sha256', async () => {
  const att: AttachmentViewData = {
    ...PDF_ATT,
    file: { ...PDF_FILE, url: '/api/files/url-real', sha256: 'no-usar' },
  };
  const { transport } = renderBlock(att);
  expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument();

  const urls = transport.calls.map((call) => call.url);
  expect(urls).toContain('/api/files/url-real');
  expect(urls).not.toContain('/api/files/no-usar');
});

test('AttachmentBlock muestra «No disponible» con el motivo traducido', () => {
  renderBlock({
    ...PDF_ATT,
    status: 'forbidden',
    file: null,
    view_pdf: null,
    url: null,
  });
  expect(
    screen.getByText('No disponible: Sin permiso para descargarlo'),
  ).toBeInTheDocument();
});
