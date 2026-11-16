import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import type { Me } from '../contracts/generated';
import { API_DATA_CACHE, API_MEDIA_CACHE, DEMO_CACHE } from '../sw/pwaConfig';
import { closeV2DbForTests } from './db';
import { enqueue, pendingCount, type OutboxOp } from './outbox';
import { lastMe, purgeUserData, rememberUser } from './purge';

const LAST_ME_KEY = 'fc-last-me';

function me(id: string): Me {
  return {
    csrf_token: `csrf-${id}`,
    user: {
      id,
      email: `${id}@example.test`,
      display_name: `Usuario ${id}`,
      role: 'user',
      created_at: '2026-11-01T00:00:00.000Z',
      last_login_at: null,
      disabled: false,
    },
  };
}

const reviewOp = (cardId: string): OutboxOp => ({
  kind: 'review',
  body: {
    card_id: cardId,
    rating: 3,
    reviewed_at: '2026-11-06T10:00:00.000Z',
  } as never,
});

function fakeCaches(): CacheStorage {
  const names = new Set<string>();
  const emptyCache = {
    async match() {
      return undefined;
    },
    async matchAll() {
      return [];
    },
    async add() {},
    async addAll() {},
    async put() {},
    async delete() {
      return false;
    },
    async keys() {
      return [];
    },
  };
  return {
    async open(name: string) {
      names.add(name);
      return emptyCache as unknown as Cache;
    },
    async has(name: string) {
      return names.has(name);
    },
    async delete(name: string) {
      return names.delete(name);
    },
    async keys() {
      return [...names];
    },
    async match() {
      return undefined;
    },
    async matchAll() {
      return [];
    },
    async add() {},
    async addAll() {},
    async put() {},
  } as unknown as CacheStorage;
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  globalThis.caches = fakeCaches();
});

test('purge clears api caches outbox and last me', async () => {
  await caches.open(API_DATA_CACHE);
  await caches.open(API_MEDIA_CACHE);
  await caches.open(DEMO_CACHE);
  await caches.open('frances-bins');
  await enqueue('u1', reviewOp('c1'));
  localStorage.setItem(LAST_ME_KEY, JSON.stringify(me('u1').user));

  await purgeUserData();

  expect(await caches.has(API_DATA_CACHE)).toBe(false);
  expect(await caches.has(API_MEDIA_CACHE)).toBe(false);
  expect(await caches.has(DEMO_CACHE)).toBe(false);
  expect(await caches.has('frances-bins')).toBe(true);
  expect(await pendingCount('u1')).toBe(0);
  expect(localStorage.getItem(LAST_ME_KEY)).toBeNull();
});

test('different user on login purges previous user data', async () => {
  await rememberUser(me('u1'));
  await enqueue('u1', reviewOp('c1'));

  expect(await rememberUser(me('u2'))).toBe('switched');
  expect(await pendingCount('u1')).toBe(0);
  expect(lastMe()?.id).toBe('u2');
});

test('rememberUser guarda solo UserOut y distingue first y same', async () => {
  expect(await rememberUser(me('u1'))).toBe('first');
  expect(await rememberUser(me('u1'))).toBe('same');

  expect(lastMe()).toEqual(me('u1').user);
  const stored = JSON.parse(localStorage.getItem(LAST_ME_KEY)!) as Record<
    string,
    unknown
  >;
  expect(stored).not.toHaveProperty('csrf_token');
});

test('purge no toca la base IndexedDB de v1', async () => {
  const v1 = await openDB('frances', 1, {
    upgrade(db) {
      db.createObjectStore('keys');
    },
  });
  await v1.put('keys', 'dato-sintetico', 'k');
  v1.close();

  await purgeUserData();

  const reopened = await openDB('frances', 1);
  expect(await reopened.get('keys', 'k')).toBe('dato-sintetico');
  reopened.close();
});
