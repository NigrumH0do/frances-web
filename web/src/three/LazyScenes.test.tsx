import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type RefObject } from 'react';
import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { LevelMeter } from '../pron/levelMeter';
import {
  SafeAuthNotebookScene,
  SafeCardBurstScene,
  SafeStreakCompassScene,
  SafeVoiceOrbScene,
  SceneBoundary,
} from './LazyScenes';
import { __resetSceneGateForTests, setSceneAvailability } from './sceneGate';
import { __resetTierForTests, __setProbeResultForTests } from './tier';

const gate = vi.hoisted(() => ({ should3d: false }));
const loads = vi.hoisted(() => ({
  notebook: 0,
  compass: 0,
  orb: 0,
  burst: 0,
}));

vi.mock('./motionPref', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./motionPref')>();
  return {
    ...actual,
    useShouldRender3d: () => gate.should3d,
  };
});

vi.mock('./AuthNotebookScene', () => {
  loads.notebook += 1;
  return {
    default: function AuthNotebookSceneMock() {
      return createElement('div', { 'data-testid': 'notebook-scene' });
    },
  };
});

vi.mock('./StreakCompassScene', () => {
  loads.compass += 1;
  return {
    default: function StreakCompassSceneMock(props: { streak?: number }) {
      return createElement('div', {
        'data-testid': 'streak-scene',
        'data-streak': String(props.streak ?? ''),
      });
    },
  };
});

vi.mock('./VoiceOrbScene', () => {
  loads.orb += 1;
  return {
    default: function VoiceOrbSceneMock(props: {
      active?: boolean;
      score?: number;
      meterRef?: RefObject<LevelMeter | null>;
      level?: number;
    }) {
      return createElement('div', {
        'data-testid': 'orb-scene',
        'data-active': String(Boolean(props.active)),
        'data-score': props.score === undefined ? '' : String(props.score),
        'data-level': props.level === undefined ? '' : String(props.level),
        'data-meter': props.meterRef ? 'yes' : 'no',
      });
    },
  };
});

vi.mock('./CardBurstScene', () => {
  loads.burst += 1;
  return {
    default: function CardBurstSceneMock(props: {
      request?: { id: number; variant: string } | null;
      trigger?: number;
    }) {
      return createElement('div', {
        'data-testid': 'burst-scene',
        'data-request': props.request ? String(props.request.id) : '',
        'data-variant': props.request?.variant ?? '',
        'data-trigger':
          props.trigger === undefined ? '' : String(props.trigger),
      });
    },
  };
});

afterEach(() => {
  gate.should3d = false;
  __resetTierForTests();
  __resetSceneGateForTests();
});

function BrokenScene(): never {
  throw new Error('fallo de WebGL en runtime');
}

test('SceneBoundary contiene el fallo de una escena y muestra el fallback', () => {
  // React informa de los errores capturados por su cuenta; el test comprueba
  // que la UI no se desmonta y que la red de seguridad del boundary actúa.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  render(
    <SceneBoundary fallback={<p>fallback editorial</p>}>
      <BrokenScene />
    </SceneBoundary>,
  );

  expect(screen.getByText('fallback editorial')).toBeVisible();
  expect(consoleError).toHaveBeenCalled();
  consoleError.mockRestore();
});

test('en jsdom SafeStreakCompassScene con streak 7 no monta la escena lazy', () => {
  const before = loads.compass;
  const { container } = render(<SafeStreakCompassScene streak={7} />);
  const marks = container.querySelectorAll('[data-part="milestone"]');
  expect(marks).toHaveLength(3);
  expect(marks[0]).toHaveAttribute('stroke-opacity', '1');
  expect(marks[1]).toHaveAttribute('stroke-opacity', '1');
  expect(marks[2]).toHaveAttribute('stroke-opacity', '0');
  expect(screen.queryByTestId('streak-scene')).not.toBeInTheDocument();
  expect(loads.compass).toBe(before);
});

test('SafeAuthNotebookScene sin prop muestra el cuaderno y no el sello Fr', () => {
  const before = loads.notebook;
  render(<SafeAuthNotebookScene />);
  expect(document.querySelector('.notebook-fallback')).toBeInTheDocument();
  expect(screen.queryByText('Fr')).not.toBeInTheDocument();
  expect(loads.notebook).toBe(before);
});

test('SafeVoiceOrbScene con score 76 muestra orb-band-bien', () => {
  const before = loads.orb;
  render(<SafeVoiceOrbScene score={76} />);
  expect(document.querySelector('.orb-fallback')).toHaveClass('orb-band-bien');
  expect(screen.queryByTestId('orb-scene')).not.toBeInTheDocument();
  expect(loads.orb).toBe(before);
});

test('setSceneAvailability css desmonta la escena sin console.error', async () => {
  gate.should3d = true;
  __setProbeResultForTests('full');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  render(<SafeStreakCompassScene streak={7} />);
  const scene = await screen.findByTestId('streak-scene');
  expect(scene).toHaveAttribute('data-streak', '7');

  act(() => {
    setSceneAvailability('css');
  });

  expect(screen.queryByTestId('streak-scene')).not.toBeInTheDocument();
  expect(
    document.querySelector('.scene-fallback-overlay'),
  ).not.toBeInTheDocument();
  const marks = document.querySelectorAll('[data-part="milestone"]');
  expect(marks[1]).toHaveAttribute('stroke-opacity', '1');
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

test('SafeCardBurstScene no monta con request null ni con probe css', async () => {
  gate.should3d = true;
  __setProbeResultForTests('full');
  const before = loads.burst;
  const { unmount } = render(<SafeCardBurstScene request={null} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId('burst-scene')).not.toBeInTheDocument();
  expect(loads.burst).toBe(before);
  unmount();

  __setProbeResultForTests('css');
  render(<SafeCardBurstScene request={{ id: 1, variant: 'grade' }} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId('burst-scene')).not.toBeInTheDocument();
  expect(loads.burst).toBe(before);
});

test('sceneGate lost mantiene el hijo 3D y superpone el fallback', async () => {
  gate.should3d = true;
  __setProbeResultForTests('full');
  render(<SafeStreakCompassScene streak={3} />);
  expect(await screen.findByTestId('streak-scene')).toBeInTheDocument();

  act(() => {
    setSceneAvailability('lost');
  });

  const overlay = document.querySelector('.scene-fallback-overlay');
  expect(screen.getByTestId('streak-scene')).toBeInTheDocument();
  expect(overlay).not.toBeNull();
  expect(overlay?.querySelector('[data-testid="streak-scene"]')).toBeNull();
  expect(overlay?.querySelectorAll('[data-part="milestone"]')).toHaveLength(3);
  expect(overlay?.querySelector('[data-part="milestone"]')).toHaveAttribute(
    'stroke-opacity',
    '1',
  );
});

test('fallback null no pinta y el fallback custom conserva el sello', () => {
  const { container, unmount } = render(
    <SafeAuthNotebookScene fallback={null} />,
  );
  expect(container.querySelector('.notebook-fallback')).toBeNull();
  expect(screen.queryByTestId('notebook-scene')).not.toBeInTheDocument();
  unmount();

  render(
    <SafeAuthNotebookScene
      fallback={
        <div className="auth-fallback-badge" aria-hidden="true">
          Fr
        </div>
      }
    />,
  );
  expect(screen.getByText('Fr')).toBeInTheDocument();
  expect(document.querySelector('.notebook-fallback')).not.toBeInTheDocument();
});

test('SafeCardBurstScene sigue aceptando trigger hasta SCR-05', async () => {
  gate.should3d = true;
  __setProbeResultForTests('full');
  const { unmount } = render(<SafeCardBurstScene trigger={0} />);
  expect(screen.queryByTestId('burst-scene')).not.toBeInTheDocument();
  unmount();

  render(<SafeCardBurstScene trigger={2} />);
  const scene = await screen.findByTestId('burst-scene');
  expect(scene).toHaveAttribute('data-trigger', '2');
  expect(scene).toHaveAttribute('data-request', '');
});

test('SafeVoiceOrbScene reenvía active, score, meterRef y level', async () => {
  gate.should3d = true;
  __setProbeResultForTests('full');
  const meterRef: RefObject<LevelMeter | null> = { current: null };
  render(
    <SafeVoiceOrbScene active score={76} meterRef={meterRef} level={0.4} />,
  );
  const scene = await screen.findByTestId('orb-scene');
  expect(scene).toHaveAttribute('data-active', 'true');
  expect(scene).toHaveAttribute('data-score', '76');
  expect(scene).toHaveAttribute('data-level', '0.4');
  expect(scene).toHaveAttribute('data-meter', 'yes');
});

test('LazyScenes no importa three y carga la hoja de fallbacks', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'LazyScenes.tsx'),
    'utf8',
  );
  expect(source).not.toMatch(/from\s+['"]three['"]/);
  expect(source).not.toMatch(/import\(\s*['"]three['"]\s*\)/);
  expect(source).toContain("import './fallbacks.css'");
  expect(source).toContain('useShouldRender3d');
  expect(source).toContain('probeTier');
  expect(source).toContain('useSyncExternalStore');
  expect(source).toContain('subscribeSceneAvailability');
  expect(source).toContain('getSceneAvailability');
  expect(source).toContain('componentDidCatch');
  expect(source).toContain("import('./AuthNotebookScene')");
  expect(source).toContain("import('./StreakCompassScene')");
  expect(source).toContain("import('./VoiceOrbScene')");
  expect(source).toContain("import('./CardBurstScene')");
});

test('un import dinámico rechazado degrada a css y muestra el fallback sin console.error', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  // vi.mock cachea el módulo resuelto; hay que desmontarlo para que este
  // import() rechace aunque una prueba anterior ya haya cargado la escena.
  vi.doUnmock('./StreakCompassScene');
  vi.doMock('./StreakCompassScene', () =>
    Promise.reject(new Error('chunk three no disponible offline')),
  );
  vi.resetModules();
  try {
    gate.should3d = true;
    const { SafeStreakCompassScene: Scene } = await import('./LazyScenes');
    const { getSceneAvailability } = await import('./sceneGate');
    const { __setProbeResultForTests: setProbe } = await import('./tier');
    setProbe('full');

    render(<Scene streak={7} />);

    await waitFor(() => {
      expect(getSceneAvailability()).toBe('css');
    });
    expect(document.querySelector('.scene-stage')).toBeNull();
    expect(document.querySelectorAll('[data-part="milestone"]')).toHaveLength(
      3,
    );
    expect(screen.queryByTestId('streak-scene')).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
    vi.doUnmock('./StreakCompassScene');
    vi.doMock('./StreakCompassScene', () => {
      loads.compass += 1;
      return {
        default: function StreakCompassSceneMock(props: { streak?: number }) {
          return createElement('div', {
            'data-testid': 'streak-scene',
            'data-streak': String(props.streak ?? ''),
          });
        },
      };
    });
    vi.resetModules();
  }
});
