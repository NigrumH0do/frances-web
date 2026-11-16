import { deleteDB, openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { OutboxOp } from './outbox';

// Base IndexedDB de la web v2. La base `frances` de v1 sigue siendo de
// `pron/attempts.ts`, `pron/stats.ts` y `pron/quota.ts` (R-42); aquí no se
// toca. `outbox` guarda las escrituras pendientes con el usuario que las
// creó, y `meta` las preferencias del dispositivo y el último usuario.

export const V2_DB_NAME = 'frances-v2';
export const V2_DB_VERSION = 1;

export interface OutboxRecord {
  id?: number;
  userId: string;
  op: OutboxOp;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface V2Db extends DBSchema {
  outbox: {
    key: number;
    value: OutboxRecord;
    indexes: { userId: string };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<V2Db>> | null = null;

export function openV2Db(): Promise<IDBPDatabase<V2Db>> {
  if (dbPromise === null) {
    dbPromise = openDB<V2Db>(V2_DB_NAME, V2_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('outbox')) {
          const outbox = db.createObjectStore('outbox', {
            keyPath: 'id',
            autoIncrement: true,
          });
          outbox.createIndex('userId', 'userId');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function closeV2DbForTests(): Promise<void> {
  if (dbPromise !== null) {
    const current = dbPromise;
    dbPromise = null;
    try {
      const db = await current;
      db.close();
    } catch {
      // La apertura falló: no hay conexión que cerrar.
    }
  }
  await deleteDB(V2_DB_NAME);
}

export async function getMeta<T = unknown>(
  key: string,
): Promise<T | undefined> {
  const db = await openV2Db();
  const record = await db.get('meta', key);
  return record?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openV2Db();
  await db.put('meta', { key, value });
}

export async function clearV2Stores(): Promise<void> {
  const db = await openV2Db();
  const tx = db.transaction(['outbox', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('outbox').clear(),
    tx.objectStore('meta').clear(),
  ]);
  await tx.done;
}
