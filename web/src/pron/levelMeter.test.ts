import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { createLevelMeter, type LevelMeter } from './levelMeter';

const stream = {} as MediaStream;

type FakeAnalyser = {
  fftSize: number;
  smoothingTimeConstant: number;
  readonly frequencyBinCount: number;
  time: Uint8Array;
  freq: Uint8Array;
  getByteTimeDomainData: ReturnType<typeof vi.fn<(buf: Uint8Array) => void>>;
  getByteFrequencyData: ReturnType<typeof vi.fn<(buf: Uint8Array) => void>>;
};

type FakeContext = {
  resume: ReturnType<typeof vi.fn<() => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  createAnalyser: ReturnType<typeof vi.fn<() => FakeAnalyser>>;
  createMediaStreamSource: ReturnType<
    typeof vi.fn<
      (media: MediaStream) => { connect: () => void; disconnect: () => void }
    >
  >;
};

function makeEnv(options?: { sourceThrows?: boolean }): {
  env: { AudioContext: typeof AudioContext };
  analyser: FakeAnalyser;
  ctx: FakeContext;
  disconnect: ReturnType<typeof vi.fn<() => void>>;
} {
  const disconnect = vi.fn<() => void>();
  const analyser: FakeAnalyser = {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    time: new Uint8Array(256).fill(128),
    freq: new Uint8Array(128),
    get frequencyBinCount() {
      return this.fftSize / 2;
    },
    getByteTimeDomainData: vi.fn<(buf: Uint8Array) => void>((buf) => {
      for (let i = 0; i < buf.length; i += 1) {
        buf[i] = analyser.time[i] ?? 128;
      }
    }),
    getByteFrequencyData: vi.fn<(buf: Uint8Array) => void>((buf) => {
      for (let i = 0; i < buf.length; i += 1) {
        buf[i] = analyser.freq[i] ?? 0;
      }
    }),
  };
  const ctx: FakeContext = {
    resume: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    createAnalyser: vi.fn<() => FakeAnalyser>(() => analyser),
    createMediaStreamSource: vi.fn(() => {
      if (options?.sourceThrows) {
        throw new Error('stream falso');
      }
      return { connect: vi.fn(), disconnect };
    }),
  };
  function FakeAudioContext(this: unknown) {
    return ctx;
  }
  return {
    env: {
      AudioContext: FakeAudioContext as unknown as typeof AudioContext,
    },
    analyser,
    ctx,
    disconnect,
  };
}

const audioNotInitialized = () =>
  new DOMException(
    'AudioDestinationNode is not initialized',
    'InvalidStateError',
  );

async function unhandledDuring(run: () => void): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    run();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    return reasons;
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

function openMeter(): {
  meter: LevelMeter;
  analyser: FakeAnalyser;
  ctx: FakeContext;
  disconnect: ReturnType<typeof vi.fn<() => void>>;
} {
  const built = makeEnv();
  const meter = createLevelMeter(built.env);
  if (meter === null) {
    throw new Error('createLevelMeter devolvió null');
  }
  meter.connect(stream);
  return {
    meter,
    analyser: built.analyser,
    ctx: built.ctx,
    disconnect: built.disconnect,
  };
}

test('el analizador usa fftSize 256 y smoothing 0.7', () => {
  const built = makeEnv();
  const meter = createLevelMeter(built.env);
  expect(meter).not.toBeNull();
  expect(built.ctx.createAnalyser).toHaveBeenCalledOnce();
  expect(built.analyser.fftSize).toBe(256);
  expect(built.analyser.smoothingTimeConstant).toBe(0.7);
});

test('dos lecturas pasan el mismo Uint8Array al analizador', () => {
  const { meter, analyser } = openMeter();
  const first = meter.read(0.016, false);
  const second = meter.read(0.016, false);
  expect(first).toBe(second);
  const time = analyser.getByteTimeDomainData.mock.calls;
  const freq = analyser.getByteFrequencyData.mock.calls;
  expect(time).toHaveLength(2);
  expect(freq).toHaveLength(2);
  expect(time[0]?.[0]).toBeInstanceOf(Uint8Array);
  expect(time[0]?.[0]).toBe(time[1]?.[0]);
  expect(freq[0]?.[0]).toBe(freq[1]?.[0]);
  expect(time[0]?.[0]).toHaveLength(256);
  expect(freq[0]?.[0]).toHaveLength(analyser.frequencyBinCount);
});

test('ataque desde 0 con bytes 255 y dt 0.05', () => {
  const { meter, analyser } = openMeter();
  analyser.time.fill(255);
  const sample = meter.read(0.05, false);
  expect(Math.abs(sample.rms - (1 - Math.exp(-1)))).toBeLessThanOrEqual(1e-6);
});

test('caída desde rms 1 con silencio usa tau 0.18', () => {
  const { meter, analyser } = openMeter();
  analyser.time.fill(255);
  expect(meter.read(1000, false).rms).toBe(1);
  analyser.time.fill(128);
  const fallen = meter.read(0.18, false);
  expect(Math.abs(fallen.rms - Math.exp(-1))).toBeLessThanOrEqual(1e-6);
});

test('el silencio sostenido cuenta un episodio y speaking false lo suelta', () => {
  const { meter, analyser } = openMeter();
  analyser.time.fill(128);
  for (let i = 0; i < 4; i += 1) {
    expect(meter.read(0.1, true).source).toBe('live');
  }
  expect(meter.silentEpisodes).toBe(0);
  expect(meter.read(0.011, true).source).toBe('silent');
  expect(meter.silentEpisodes).toBe(1);
  expect(meter.read(0.1, true).source).toBe('silent');
  expect(meter.silentEpisodes).toBe(1);
  expect(meter.read(0.016, false).source).toBe('live');
});

test('solo el bin 20 alimenta la banda alta', () => {
  const { meter, analyser } = openMeter();
  analyser.time.fill(128);
  analyser.freq.fill(0);
  analyser.freq[20] = 255;
  const sample = meter.read(0.05, false);
  expect(sample.high).toBeGreaterThan(0);
  expect(sample.low).toBe(0);
  expect(sample.mid).toBe(0);
});

test('resumeFromGesture llama a resume en el mismo turno', () => {
  const built = makeEnv();
  const meter = createLevelMeter(built.env);
  if (meter === null) {
    throw new Error('createLevelMeter devolvió null');
  }
  const order: string[] = [];
  built.ctx.resume.mockImplementation(() => {
    order.push('resume');
    return Promise.resolve();
  });
  const returned = meter.resumeFromGesture();
  order.push('returned');
  expect(returned).toBeUndefined();
  expect(order).toEqual(['resume', 'returned']);
  expect(built.ctx.resume).toHaveBeenCalledOnce();
});

test('connect que lanza no propaga y la lectura queda en silencio', () => {
  const built = makeEnv({ sourceThrows: true });
  const meter = createLevelMeter(built.env);
  if (meter === null) {
    throw new Error('createLevelMeter devolvió null');
  }
  expect(() => meter.connect(stream)).not.toThrow();
  expect(meter.read(0.016, true).source).toBe('silent');
  expect(meter.read(0.016, false).source).toBe('silent');
});

test('close desconecta la fuente y luego cierra el contexto', () => {
  const { meter, ctx, disconnect } = openMeter();
  const order: string[] = [];
  disconnect.mockImplementation(() => {
    order.push('disconnect');
  });
  ctx.close.mockImplementation(() => {
    order.push('close');
    return Promise.resolve();
  });
  meter.close();
  meter.close();
  expect(order).toEqual(['disconnect', 'close']);
});

test('el fuente no abre micrófono ni importa three', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'levelMeter.ts'),
    'utf8',
  );
  expect(source).not.toContain('getUserMedia');
  expect(source).not.toContain("from 'three'");
  expect(source).not.toContain('from "three"');
});

test('sin constructor de audio devuelve null', () => {
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('webkitAudioContext', undefined);
  expect(createLevelMeter()).toBeNull();
  expect(createLevelMeter({})).toBeNull();
  vi.unstubAllGlobals();
});

function analyserNode() {
  return {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    get frequencyBinCount() {
      return this.fftSize / 2;
    },
    getByteTimeDomainData() {},
    getByteFrequencyData() {},
  };
}

test('resumeFromGesture llama a resume en el mismo turno aunque la promesa rechace', async () => {
  const order: string[] = [];
  let resumeCalls = 0;
  function FakeAudioContext(this: unknown) {
    return {
      resume() {
        resumeCalls += 1;
        order.push('resume');
        return Promise.reject(audioNotInitialized());
      },
      close() {
        return Promise.resolve();
      },
      createAnalyser: analyserNode,
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      },
    };
  }
  const meter = createLevelMeter({
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
  });
  if (meter === null) {
    throw new Error('createLevelMeter devolvió null');
  }
  const reasons = await unhandledDuring(() => {
    meter.resumeFromGesture();
    order.push('returned');
    expect(order).toEqual(['resume', 'returned']);
    expect(resumeCalls).toBe(1);
  });
  expect(reasons).toEqual([]);
});

test('close no deja un rechazo asíncrono del contexto sin manejar', async () => {
  let closeCalls = 0;
  function FakeAudioContext(this: unknown) {
    return {
      resume() {
        return Promise.resolve();
      },
      close() {
        closeCalls += 1;
        return Promise.reject(audioNotInitialized());
      },
      createAnalyser: analyserNode,
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      },
    };
  }
  const meter = createLevelMeter({
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
  });
  if (meter === null) {
    throw new Error('createLevelMeter devolvió null');
  }
  const reasons = await unhandledDuring(() => {
    expect(() => meter.close()).not.toThrow();
    expect(closeCalls).toBe(1);
  });
  expect(reasons).toEqual([]);
});

test('un constructor de AudioContext que lanza devuelve null', () => {
  function BrokenAudioContext(this: unknown) {
    throw audioNotInitialized();
  }
  const env = {
    AudioContext: BrokenAudioContext as unknown as typeof AudioContext,
  };
  expect(() => {
    expect(createLevelMeter(env)).toBeNull();
  }).not.toThrow();
});

test('createAnalyser que lanza devuelve null y cierra el contexto sin rechazos sueltos', async () => {
  let closeCalls = 0;
  function FakeAudioContext(this: unknown) {
    return {
      close() {
        closeCalls += 1;
        return Promise.reject(audioNotInitialized());
      },
      createAnalyser() {
        throw audioNotInitialized();
      },
    };
  }
  const env = {
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
  };
  const reasons = await unhandledDuring(() => {
    expect(() => {
      expect(createLevelMeter(env)).toBeNull();
    }).not.toThrow();
    expect(closeCalls).toBe(1);
  });
  expect(reasons).toEqual([]);
});
