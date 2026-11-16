import { beforeEach, expect, test, vi } from 'vitest';

// Entrada única v2 (Task CHG-16): la antigua rama v1 con VITE_UI ya no existe.
const state = vi.hoisted(() => ({
  bootV2: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('./shell/boot', () => ({ bootV2: state.bootV2 }));

async function loadStart(): Promise<typeof import('./main').start> {
  const mod = await import('./main');
  return mod.start;
}

beforeEach(() => {
  vi.resetModules();
  state.bootV2.mockClear();
});

test('arranca siempre la web v2', async () => {
  const start = await loadStart();

  expect(await start(document.createElement('div'))).toBe('v2');
  expect(state.bootV2).toHaveBeenCalledTimes(1);
});
