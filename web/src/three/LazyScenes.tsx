import {
  cloneElement,
  Component,
  isValidElement,
  lazy,
  Suspense,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import type { LevelMeter } from '../pron/levelMeter';
import type { BurstRequest } from './burstPhysics';
import { CompassFallback, NotebookFallback, OrbFallback } from './fallbacks';
import { useShouldRender3d } from './motionPref';
import {
  getSceneAvailability,
  setSceneAvailability,
  subscribeSceneAvailability,
} from './sceneGate';
import { probeTier } from './tier';
import './fallbacks.css';

export type { BurstRequest };
export { CompassFallback, NotebookFallback, OrbFallback };

function lazyScene<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
) {
  return lazy(() =>
    loader().catch(() => {
      setSceneAvailability('css');
      return { default: (() => null) as ComponentType<P> };
    }),
  );
}

const LazyAuthNotebook = lazyScene(() => import('./AuthNotebookScene'));
const LazyStreakCompass = lazyScene(() => import('./StreakCompassScene'));
const LazyVoiceOrb = lazyScene(() => import('./VoiceOrbScene'));
const LazyCardBurst = lazyScene(() => import('./CardBurstScene'));

export class SceneBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Red de seguridad secundaria: un fallo de WebGL ya se convirtió en el
    // fallback editorial con getDerivedStateFromError; no se re-lanza ni se
    // desmonta la pantalla que contiene la escena.
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

type SceneKind = 'css' | 'lost' | 'webgl';

function useSceneKind(): SceneKind {
  const should3d = useShouldRender3d();
  const availability = useSyncExternalStore(
    subscribeSceneAvailability,
    getSceneAvailability,
    getSceneAvailability,
  );
  if (!should3d || probeTier() === 'css' || availability === 'css') {
    return 'css';
  }
  if (availability === 'lost') return 'lost';
  return 'webgl';
}

function resolveFallback(
  fallback: ReactNode | undefined,
  editorial: () => ReactNode,
): () => ReactNode {
  if (fallback === undefined) return editorial;
  return () => (isValidElement(fallback) ? cloneElement(fallback) : fallback);
}

function renderWebGL(
  kind: 'lost' | 'webgl',
  draw: () => ReactNode,
  scene: ReactNode,
): ReactNode {
  return (
    <div className="scene-stage">
      <SceneBoundary fallback={draw()}>
        <Suspense fallback={kind === 'lost' ? null : draw()}>{scene}</Suspense>
      </SceneBoundary>
      {kind === 'lost' ? (
        <div className="scene-fallback-overlay">{draw()}</div>
      ) : null}
    </div>
  );
}

export function SafeAuthNotebookScene({ fallback }: { fallback?: ReactNode }) {
  const kind = useSceneKind();
  const draw = resolveFallback(fallback, () => <NotebookFallback />);
  if (kind === 'css') return draw();
  return renderWebGL(kind, draw, <LazyAuthNotebook />);
}

export function SafeStreakCompassScene({
  streak,
  fallback,
}: {
  streak: number;
  fallback?: ReactNode;
}) {
  const kind = useSceneKind();
  const draw = resolveFallback(fallback, () => (
    <CompassFallback streak={streak} />
  ));
  if (kind === 'css') return draw();
  return renderWebGL(kind, draw, <LazyStreakCompass streak={streak} />);
}

export function SafeVoiceOrbScene({
  active,
  score,
  meterRef,
  level,
  fallback,
}: {
  active?: boolean;
  score?: number;
  meterRef?: RefObject<LevelMeter | null>;
  level?: number;
  fallback?: ReactNode;
}) {
  const kind = useSceneKind();
  const draw = resolveFallback(fallback, () => (
    <OrbFallback active={active} score={score} />
  ));
  if (kind === 'css') return draw();
  return renderWebGL(
    kind,
    draw,
    <LazyVoiceOrb
      active={active}
      score={score}
      meterRef={meterRef}
      level={level}
    />,
  );
}

export function SafeCardBurstScene({
  request,
  trigger,
}: {
  request?: BurstRequest | null;
  trigger?: number;
}) {
  const kind = useSceneKind();
  // `trigger` sigue hasta que SCR-05 deje solo `request` en Repasar.
  const idle =
    request === null || (request === undefined && (!trigger || trigger <= 0));
  if (idle || kind === 'css') return null;
  return renderWebGL(
    kind,
    () => null,
    <LazyCardBurst request={request} trigger={trigger} />,
  );
}
