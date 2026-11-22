import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  burstOnFinish,
  burstOnRate,
  createPool,
  createRng,
  spawnBurst,
  stepBurst,
  type BurstPool,
} from './burstPhysics';

const FRAME = 1 / 60;

describe('burstPhysics', () => {
  test('gravedad -2.4 integra con la velocidad ya amortiguada', () => {
    const pool = createPool(4);
    const shard = pool.items[0];
    shard.drag = 0;
    shard.vx = 0;
    shard.vy = 0;
    shard.vz = 0;
    shard.px = 0;
    shard.py = 0;
    shard.pz = 0;
    shard.life = 1;
    pool.active = 1;

    stepBurst(pool, FRAME);

    expect(Math.abs(shard.vy - -2.4 / 60)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(shard.py - -2.4 / 60 / 60)).toBeLessThanOrEqual(1e-12);
    expect(pool.active).toBe(1);
  });

  test('swap-remove copia campos y no reasigna referencias', () => {
    const pool = createPool(8);
    const items = pool.items;
    const first = items[0];
    const second = items[1];
    pool.active = 2;
    first.life = 0.001;
    first.px = 1;
    first.kind = 0;
    second.life = 2;
    second.px = 9;
    second.vx = 0;
    second.vy = 0;
    second.vz = 0;
    second.drag = 0;
    second.kind = 1;

    stepBurst(pool, FRAME);

    expect(pool.active).toBe(1);
    expect(pool.items).toBe(items);
    expect(pool.items.length).toBe(8);
    expect(pool.items[0]).toBe(first);
    expect(pool.items[1]).toBe(second);
    expect(first.px).toBe(9);
    expect(first.kind).toBe(1);
    expect(first.life).toBeLessThan(2);
  });

  test('grade activa 72 y complete 40, sin acumular', () => {
    const pool = createPool(80);
    const items = pool.items;
    expect(items).toHaveLength(80);
    expect(pool.active).toBe(0);

    spawnBurst(pool, 'grade', createRng(1));
    expect(pool.active).toBe(72);
    expect(pool.items).toBe(items);
    for (let i = 0; i < 64; i += 1) {
      expect(pool.items[i].kind).toBe(0);
      expect(pool.items[i].drag).toBe(1.7);
      expect(pool.items[i].life).toBe(1.15);
    }
    for (let i = 64; i < 72; i += 1) {
      expect(pool.items[i].kind).toBe(1);
      expect(pool.items[i].drag).toBe(2.6);
      expect(pool.items[i].life).toBe(1.15);
    }

    spawnBurst(pool, 'complete', createRng(1));
    expect(pool.active).toBe(40);
    expect(pool.items).toBe(items);
    expect(pool.items).toHaveLength(80);
    for (let i = 0; i < 40; i += 1) {
      expect(pool.items[i].life).toBe(1.7);
    }
    expect(pool.items[31].kind).toBe(0);
    expect(pool.items[32].kind).toBe(1);
    expect(pool.items[39].drag).toBe(2.6);
  });

  test('la misma semilla reproduce el estado y otra mueve el shard 0', () => {
    const run = (seed: number): BurstPool => {
      const pool = createPool(80);
      spawnBurst(pool, 'grade', createRng(seed));
      for (let i = 0; i < 70; i += 1) stepBurst(pool, FRAME);
      return pool;
    };

    const left = run(1);
    const right = run(1);
    const other = run(2);
    expect(left.active).toBe(right.active);
    expect(left.items[0].px).toBe(right.items[0].px);
    expect(left.items[0].py).toBe(right.items[0].py);
    expect(left.items[0].pz).toBe(right.items[0].pz);
    expect(left.items[0].vx).toBe(right.items[0].vx);
    expect(left.items[0].vy).toBe(right.items[0].vy);
    expect(other.items[0].px).not.toBe(left.items[0].px);
    expect(createRng(0)()).toBe(createRng(1)());
    const sample = createRng(99)();
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(sample).toBeLessThan(1);
  });

  test('un grade muere tras 1.15 s y el paso siguiente no reasigna items', () => {
    const pool = createPool(80);
    const items = pool.items;
    const first = items[0];
    spawnBurst(pool, 'grade', createRng(1));
    const horizon = 1.15 + FRAME;
    let elapsed = 0;
    while (elapsed < horizon - 1e-9) {
      stepBurst(pool, FRAME);
      elapsed += FRAME;
    }
    expect(pool.active).toBe(0);
    const active = pool.active;
    stepBurst(pool, FRAME);
    expect(pool.active).toBe(active);
    expect(pool.items).toBe(items);
    expect(pool.items[0]).toBe(first);
  });

  test('el límite 36 recorta el papel y conserva los sellos', () => {
    const pool = createPool(80);
    spawnBurst(pool, 'grade', createRng(4), 36);
    expect(pool.active).toBe(36);
    for (let i = 0; i < 28; i += 1) {
      expect(pool.items[i].kind).toBe(0);
      expect(pool.items[i].drag).toBe(1.7);
    }
    const seals = pool.items
      .slice(0, pool.active)
      .filter((shard) => shard.kind === 1);
    expect(seals).toHaveLength(8);
    for (const seal of seals) expect(seal.drag).toBe(2.6);
  });

  test('burstOnRate celebra 3 y 4 salvo en la última tarjeta', () => {
    expect(burstOnRate({ rating: 4, index: 0, total: 5 })).toBe('grade');
    expect(burstOnRate({ rating: 3, index: 1, total: 4 })).toBe('grade');
    expect(burstOnRate({ rating: 4, index: 4, total: 5 })).toBeNull();
    expect(burstOnRate({ rating: 3, index: 2, total: 3 })).toBeNull();
    expect(burstOnRate({ rating: 1, index: 4, total: 5 })).toBeNull();
    expect(burstOnRate({ rating: 2, index: 0, total: 3 })).toBeNull();
  });

  test('burstOnFinish emite complete una sola vez y solo con trabajo hecho', () => {
    expect(
      burstOnFinish({ finished: true, done: 3, alreadyEmitted: false }),
    ).toBe('complete');
    expect(
      burstOnFinish({ finished: true, done: 3, alreadyEmitted: true }),
    ).toBeNull();
    expect(
      burstOnFinish({ finished: true, done: 0, alreadyEmitted: false }),
    ).toBeNull();
    expect(
      burstOnFinish({ finished: false, done: 3, alreadyEmitted: false }),
    ).toBeNull();
  });

  test('el fuente no importa three', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'burstPhysics.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]three['"]/);
    expect(source).not.toContain('import * as THREE');
  });
});
