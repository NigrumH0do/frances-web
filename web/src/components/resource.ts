// Tipos de estado de recursos. useResource (UI-04) los produce; StateView los consume.
export type UiError =
  | { kind: 'offline' }
  | { kind: 'http'; status: number; code: string; message: string };

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; stale: boolean }
  | { status: 'error'; error: UiError };
