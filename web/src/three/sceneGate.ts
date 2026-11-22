export type SceneAvailability = 'ok' | 'lost' | 'css';

let current: SceneAvailability = 'ok';
const listeners = new Set<() => void>();

export function getSceneAvailability(): SceneAvailability {
  return current;
}

export function setSceneAvailability(next: SceneAvailability): void {
  if (next === current) return;
  current = next;
  for (const cb of [...listeners]) cb();
}

export function subscribeSceneAvailability(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function __resetSceneGateForTests(): void {
  current = 'ok';
  listeners.clear();
}
