import { afterEach, expect, test, vi } from 'vitest';
import { startTake } from './take';

// MediaRecorder falso: `start` y `stop` disparan los eventos como el real.
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(['voz'], { type: this.mimeType }),
      });
      this.onstop?.();
    });
  }
}

const stream = {} as MediaStream;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMediaRecorder.instances = [];
});

test('sin MediaRecorder no hay toma', () => {
  vi.stubGlobal('MediaRecorder', undefined);
  expect(startTake(stream)).toBeNull();
});

test('stop devuelve el audio grabado con su tipo', async () => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  const take = startTake(stream);
  expect(take).not.toBeNull();
  expect(FakeMediaRecorder.instances[0]?.state).toBe('recording');
  const blob = await take!.stop();
  expect(blob).toBeInstanceOf(Blob);
  expect(blob?.type).toBe('audio/webm');
  expect(blob?.size).toBeGreaterThan(0);
});

test('cancel detiene la toma y stop después devuelve null', async () => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  const take = startTake(stream)!;
  take.cancel();
  expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
  await expect(take.stop()).resolves.toBeNull();
});

test('un MediaRecorder que no arranca no rompe la grabación', () => {
  vi.stubGlobal(
    'MediaRecorder',
    class {
      constructor() {
        throw new DOMException('no', 'NotSupportedError');
      }
    },
  );
  expect(startTake(stream)).toBeNull();
});
