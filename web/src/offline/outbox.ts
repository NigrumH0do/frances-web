import { HttpError, OfflineError } from '../api/client';
import type { endpoints } from '../api/endpoints';
import type { CardFlagsIn, ReviewIn } from '../contracts/generated';
import { openV2Db } from './db';

// Cola de escrituras sin conexión. Cada operación guarda el `userId` que la
// creó; `flush` solo lee y envía las de ese usuario, de una en una y por id.
// Un candado en memoria serializa los flush concurrentes.

export type OutboxOp =
  | { kind: 'review'; body: ReviewIn }
  | { kind: 'flags'; cardId: string; body: CardFlagsIn }
  | { kind: 'plan_done' | 'plan_undone'; day: string; position: number };

export type FlushResult = {
  sent: number;
  dropped: number;
  conflicts: number;
  stoppedBy: 'offline' | 'unauthenticated' | null;
};

function isReviewDuplicate(op: OutboxOp, existing: OutboxOp): boolean {
  return (
    op.kind === 'review' &&
    existing.kind === 'review' &&
    op.body.card_id === existing.body.card_id &&
    op.body.reviewed_at === existing.body.reviewed_at
  );
}

export async function enqueue(userId: string, op: OutboxOp): Promise<void> {
  const db = await openV2Db();

  if (op.kind === 'review') {
    // CHG-12: la misma reseña (mismo `reviewed_at`) no se encola dos veces.
    const tx = db.transaction('outbox', 'readwrite');
    const rows = await tx.store.index('userId').getAll(userId);
    const duplicate = rows.some((row) => isReviewDuplicate(op, row.op));
    if (!duplicate) {
      await tx.store.add({ userId, op });
    }
    await tx.done;
    return;
  }

  await db.add('outbox', { userId, op });
}

export async function pendingCount(userId: string): Promise<number> {
  const db = await openV2Db();
  return db.countFromIndex('outbox', 'userId', userId);
}

async function send(
  api: ReturnType<typeof endpoints>,
  op: OutboxOp,
): Promise<void> {
  switch (op.kind) {
    case 'review':
      await api.review(op.body);
      return;
    case 'flags':
      await api.cardFlags(op.cardId, op.body);
      return;
    case 'plan_done':
      await api.planDone(op.day, op.position);
      return;
    case 'plan_undone':
      await api.planUndone(op.day, op.position);
      return;
    default:
      return assertNever(op);
  }
}

function assertNever(value: never): never {
  throw new Error(`operación de cola desconocida: ${String(value)}`);
}

async function remove(rowId: number): Promise<void> {
  const db = await openV2Db();
  await db.delete('outbox', rowId);
}

async function flushOnce(
  api: ReturnType<typeof endpoints>,
  userId: string,
): Promise<FlushResult> {
  const db = await openV2Db();
  const rows = await db.getAllFromIndex('outbox', 'userId', userId);
  rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  let sent = 0;
  let dropped = 0;
  let conflicts = 0;

  for (const row of rows) {
    const rowId = row.id;
    if (rowId === undefined) continue;

    try {
      await send(api, row.op);
      await remove(rowId);
      sent += 1;
    } catch (error) {
      if (error instanceof OfflineError) {
        return { sent, dropped, conflicts, stoppedBy: 'offline' };
      }
      if (error instanceof HttpError) {
        if (error.status === 401) {
          return { sent, dropped, conflicts, stoppedBy: 'unauthenticated' };
        }
        if (error.status === 409) {
          await remove(rowId);
          conflicts += 1;
          continue;
        }
        if (error.status === 400 || error.status === 404) {
          await remove(rowId);
          dropped += 1;
          continue;
        }
      }
      // Cualquier otro fallo (5xx incluido) para sin borrar: la operación se
      // reintenta en el próximo flush.
      return { sent, dropped, conflicts, stoppedBy: null };
    }
  }

  return { sent, dropped, conflicts, stoppedBy: null };
}

let lock: Promise<unknown> = Promise.resolve();

export function flush(
  api: ReturnType<typeof endpoints>,
  userId: string,
): Promise<FlushResult> {
  const run = lock.then(
    () => flushOnce(api, userId),
    () => flushOnce(api, userId),
  );
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
