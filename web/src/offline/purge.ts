import type { Me, UserOut } from '../contracts/generated';
import { API_CACHE_NAMES, DEMO_CACHE } from '../sw/pwaConfig';
import { clearV2Stores, getMeta, setMeta } from './db';

// Purga de datos del usuario en el dispositivo. Borra las cachés de la API y
// del demo, vacía la base v2 (outbox y meta) y olvida el último `UserOut`.
// Nunca toca la base `frances` de v1 (R-42).

const LAST_ME_KEY = 'fc-last-me';
const LAST_USER_ID_KEY = 'last_user_id';

function isUserOut(value: unknown): value is UserOut {
  if (typeof value !== 'object' || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user['id'] === 'string' &&
    typeof user['email'] === 'string' &&
    typeof user['display_name'] === 'string' &&
    (user['role'] === 'admin' || user['role'] === 'user') &&
    typeof user['created_at'] === 'string' &&
    (user['last_login_at'] === null ||
      typeof user['last_login_at'] === 'string') &&
    typeof user['disabled'] === 'boolean'
  );
}

function writeLastMe(user: UserOut): void {
  try {
    localStorage.setItem(LAST_ME_KEY, JSON.stringify(user));
  } catch {
    // Almacenamiento no disponible (modo privado): queda sin recuerdo local.
  }
}

export async function purgeUserData(): Promise<void> {
  if (typeof globalThis.caches !== 'undefined') {
    const names = [...API_CACHE_NAMES, DEMO_CACHE];
    await Promise.all(
      names.map((name) => globalThis.caches.delete(name).catch(() => false)),
    );
  }

  await clearV2Stores();

  try {
    localStorage.removeItem(LAST_ME_KEY);
  } catch {
    // Almacenamiento no disponible: no hay nada que borrar.
  }
}

export async function rememberUser(
  me: Me,
): Promise<'same' | 'switched' | 'first'> {
  const previous = await getMeta<string>(LAST_USER_ID_KEY);
  if (previous !== undefined && previous !== me.user.id) {
    await purgeUserData();
    await setMeta(LAST_USER_ID_KEY, me.user.id);
    writeLastMe(me.user);
    return 'switched';
  }

  await setMeta(LAST_USER_ID_KEY, me.user.id);
  writeLastMe(me.user);
  return previous === undefined ? 'first' : 'same';
}

export function lastMe(): UserOut | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LAST_ME_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isUserOut(parsed)) return null;

  // Se reconstruye solo `UserOut`: nunca se devuelve un CSRF que hubiera
  // quedado en el almacenamiento por una versión anterior.
  return {
    id: parsed.id,
    email: parsed.email,
    display_name: parsed.display_name,
    role: parsed.role,
    created_at: parsed.created_at,
    last_login_at: parsed.last_login_at,
    disabled: parsed.disabled,
  };
}
