// Física de la ráfaga, sin three y sin asignaciones en el paso.
// El pool nace una vez; stepBurst solo muta campos y hace swap-remove.

export interface Shard {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  rvx: number;
  rvy: number;
  rvz: number;
  life: number;
  drag: number;
  kind: number;
  scale: number;
}

export interface BurstPool {
  items: Shard[];
  active: number;
}

export type BurstVariant = 'grade' | 'complete';

export interface BurstRequest {
  id: number;
  variant: BurstVariant;
}

const GRAVITY = -2.4;

export function createPool(capacity: number): BurstPool {
  const items: Shard[] = [];
  for (let i = 0; i < capacity; i += 1) {
    items.push({
      px: 0,
      py: 0,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      rvx: 0,
      rvy: 0,
      rvz: 0,
      life: 0,
      drag: 0,
      kind: 0,
      scale: 1,
    });
  }
  return { items, active: 0 };
}

/** xorshift32. Semilla 0 se sustituye por 1. Devuelve [0, 1). */
export function createRng(seed: number): () => number {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function spawnBurst(
  pool: BurstPool,
  variant: BurstVariant,
  rand: () => number,
  limit?: number,
): void {
  let paper = variant === 'grade' ? 64 : 32;
  let seals = 8;
  if (limit !== undefined && Number.isFinite(limit)) {
    const cap = Math.max(0, Math.floor(limit));
    if (cap >= 8) {
      seals = 8;
      paper = Math.min(paper, cap - 8);
    } else {
      seals = cap;
      paper = 0;
    }
  }
  const capacity = pool.items.length;
  if (paper + seals > capacity) {
    if (capacity >= 8) {
      seals = Math.min(seals, 8);
      paper = Math.min(paper, capacity - seals);
    } else {
      seals = Math.min(seals, capacity);
      paper = 0;
    }
  }

  const life = variant === 'grade' ? 1.15 : 1.7;
  const speed = variant === 'grade' ? 1.8 : 1.05;
  const count = paper + seals;
  // Cada disparo empieza de cero: no se suman virutas de la ráfaga anterior.
  pool.active = 0;
  for (let i = 0; i < count; i += 1) {
    const shard = pool.items[i];
    const seal = i >= paper;
    const angle = rand() * Math.PI * 2;
    const sp = speed * (0.75 + rand() * 0.5) * (seal ? 0.55 : 1);
    shard.px = 0;
    shard.py = 0;
    shard.pz = 0;
    shard.vx = Math.cos(angle) * sp;
    shard.vy = (seal ? 0.8 : 1.6) + rand() * 0.6;
    shard.vz = (rand() - 0.5) * 0.8;
    shard.rx = rand() * 6;
    shard.ry = rand() * 6;
    shard.rz = rand() * 6;
    shard.rvx = (rand() - 0.5) * 8;
    shard.rvy = (rand() - 0.5) * 8;
    shard.rvz = (rand() - 0.5) * 6;
    shard.life = life;
    shard.drag = seal ? 2.6 : 1.7;
    shard.kind = seal ? 1 : 0;
    shard.scale = seal ? 0.16 : 0.08 + rand() * 0.06;
  }
  pool.active = count;
}

export function stepBurst(pool: BurstPool, dt: number): void {
  const steps = Math.min(3, Math.max(1, Math.ceil(dt / (1 / 60))));
  const h = dt / steps;
  for (let n = 0; n < steps; n += 1) {
    let i = 0;
    while (i < pool.active) {
      const shard = pool.items[i];
      shard.life -= h;
      if (shard.life <= 0) {
        pool.active -= 1;
        copyShard(shard, pool.items[pool.active]);
        continue;
      }
      const damp = Math.exp(-shard.drag * h);
      shard.vy = (shard.vy + GRAVITY * h) * damp;
      shard.vx *= damp;
      shard.vz *= damp;
      shard.px += shard.vx * h;
      shard.py += shard.vy * h;
      shard.pz += shard.vz * h;
      shard.rx += shard.rvx * h;
      shard.ry += shard.rvy * h;
      shard.rz += shard.rvz * h;
      i += 1;
    }
  }
}

function copyShard(to: Shard, from: Shard): void {
  to.px = from.px;
  to.py = from.py;
  to.pz = from.pz;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.rx = from.rx;
  to.ry = from.ry;
  to.rz = from.rz;
  to.rvx = from.rvx;
  to.rvy = from.rvy;
  to.rvz = from.rvz;
  to.life = from.life;
  to.drag = from.drag;
  to.kind = from.kind;
  to.scale = from.scale;
}

export function burstOnRate(args: {
  rating: 1 | 2 | 3 | 4;
  index: number;
  total: number;
}): BurstVariant | null {
  if (args.rating !== 3 && args.rating !== 4) return null;
  if (args.index + 1 >= args.total) return null;
  return 'grade';
}

export function burstOnFinish(args: {
  finished: boolean;
  done: number;
  alreadyEmitted: boolean;
}): BurstVariant | null {
  if (args.finished && args.done > 0 && !args.alreadyEmitted) return 'complete';
  return null;
}
