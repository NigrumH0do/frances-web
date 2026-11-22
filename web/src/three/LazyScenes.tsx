import { Component, Suspense, lazy, type ReactNode } from 'react';
import { useShouldRender3d } from './motionPref';

const LazyAuthNotebook = lazy(() => import('./AuthNotebookScene'));
const LazyStreakCompass = lazy(() => import('./StreakCompassScene'));
const LazyVoiceOrb = lazy(() => import('./VoiceOrbScene'));
const LazyCardBurst = lazy(() => import('./CardBurstScene'));

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

export function SafeAuthNotebookScene({
  fallback = null,
}: {
  fallback?: ReactNode;
}) {
  const can3d = useShouldRender3d();
  if (!can3d) return <>{fallback}</>;
  return (
    <SceneBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LazyAuthNotebook />
      </Suspense>
    </SceneBoundary>
  );
}

export function SafeStreakCompassScene({
  streak,
  fallback = null,
}: {
  streak: number;
  fallback?: ReactNode;
}) {
  const can3d = useShouldRender3d();
  if (!can3d) return <>{fallback}</>;
  return (
    <SceneBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LazyStreakCompass streak={streak} />
      </Suspense>
    </SceneBoundary>
  );
}

export function SafeVoiceOrbScene({
  active,
  level,
  score,
  fallback = null,
}: {
  active?: boolean;
  level?: number;
  score?: number;
  fallback?: ReactNode;
}) {
  const can3d = useShouldRender3d();
  if (!can3d) return <>{fallback}</>;
  return (
    <SceneBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LazyVoiceOrb active={active} level={level} score={score} />
      </Suspense>
    </SceneBoundary>
  );
}

export function SafeCardBurstScene({ trigger }: { trigger: number }) {
  const can3d = useShouldRender3d();
  if (!can3d || trigger === 0) return null;
  return (
    <SceneBoundary fallback={null}>
      <Suspense fallback={null}>
        <LazyCardBurst trigger={trigger} />
      </Suspense>
    </SceneBoundary>
  );
}
