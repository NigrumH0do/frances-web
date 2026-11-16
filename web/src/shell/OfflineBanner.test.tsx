import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { FlushResult } from '../offline/outbox';

const offline = vi.hoisted(() => ({
  online: true,
  pending: 0,
  lastFlush: null as FlushResult | null,
}));

vi.mock('../offline/OfflineContext', () => ({
  useOffline: () => ({
    online: offline.online,
    pending: offline.pending,
    lastFlush: offline.lastFlush,
    enqueue: vi.fn(),
    flushNow: vi.fn(),
  }),
}));

import { OfflineBanner } from './OfflineBanner';

beforeEach(() => {
  offline.online = true;
  offline.pending = 0;
  offline.lastFlush = null;
});

test('banner sin conexión con cambios esperando', () => {
  offline.online = false;
  offline.pending = 2;
  render(<OfflineBanner />);

  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Sin conexión');
  expect(status).toHaveTextContent('2 cambios esperando');
});

test('con red y cambios pendientes muestra que está sincronizando', () => {
  offline.online = true;
  offline.pending = 3;
  render(<OfflineBanner />);

  expect(screen.getByRole('status')).toHaveTextContent('Sincronizando…');
});

test('tras un flush con descartes avisa y se puede descartar', async () => {
  offline.lastFlush = {
    sent: 1,
    dropped: 1,
    conflicts: 2,
    stoppedBy: null,
  };
  render(<OfflineBanner />);

  expect(screen.getByRole('alert')).toHaveTextContent(
    '3 cambios no se pudieron guardar',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('con red, sin pendientes y sin fallos no muestra nada', () => {
  const { container } = render(<OfflineBanner />);
  expect(container.innerHTML).toBe('');
});
