// Nivel del micrófono que ya abrió el grabador (GL-03).
// Un AnalyserNode sobre ese MediaStream: sin otra captura y sin Three.js.

export interface LevelSample {
  rms: number;
  low: number;
  mid: number;
  high: number;
  source: 'live' | 'silent';
}

export interface LevelMeter {
  resumeFromGesture(): void;
  connect(stream: MediaStream): void;
  read(dt: number, speaking: boolean): LevelSample;
  close(): void;
  readonly silentEpisodes: number;
}

export interface LevelMeterEnv {
  AudioContext?: typeof AudioContext;
}

function rmsOf(time: Uint8Array): number {
  let sum = 0;
  const n = time.length;
  for (let i = 0; i < n; i += 1) {
    const centered = ((time[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  const mean = n === 0 ? 0 : sum / n;
  return Math.min(1, Math.sqrt(mean) * 3.2);
}

function bandMean(freq: Uint8Array, start: number, end: number): number {
  const last = end < freq.length ? end : freq.length;
  if (last <= start) {
    return 0;
  }
  let sum = 0;
  for (let i = start; i < last; i += 1) {
    sum += freq[i] ?? 0;
  }
  return sum / (last - start) / 255;
}

export function createLevelMeter(env?: LevelMeterEnv): LevelMeter | null {
  const webkitAudioContext = (
    globalThis as { webkitAudioContext?: typeof AudioContext }
  ).webkitAudioContext;
  const Ctor =
    env?.AudioContext ?? globalThis.AudioContext ?? webkitAudioContext;
  if (typeof Ctor !== 'function') {
    return null;
  }

  const ctx = new Ctor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  const timeBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  const freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  const sample: LevelSample = {
    rms: 0,
    low: 0,
    mid: 0,
    high: 0,
    source: 'live',
  };
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let closed = false;
  let connectFailed = false;
  let silentFor = 0;
  let episodeOpen = false;
  let episodes = 0;

  return {
    get silentEpisodes() {
      return episodes;
    },

    resumeFromGesture() {
      void ctx.resume();
    },

    connect(stream) {
      if (closed) {
        return;
      }
      try {
        const node = ctx.createMediaStreamSource(stream);
        node.connect(analyser);
        sourceNode = node;
        connectFailed = false;
      } catch {
        sourceNode = null;
        connectFailed = true;
        sample.source = 'silent';
      }
    },

    read(dt, speaking) {
      let rawRms = 0;
      let rawLow = 0;
      let rawMid = 0;
      let rawHigh = 0;
      if (!closed && sourceNode !== null) {
        analyser.getByteTimeDomainData(timeBuf);
        analyser.getByteFrequencyData(freqBuf);
        rawRms = rmsOf(timeBuf);
        rawLow = bandMean(freqBuf, 1, 3);
        rawMid = bandMean(freqBuf, 3, 13);
        rawHigh = bandMean(freqBuf, 13, 41);
      }
      const tau = rawRms > sample.rms ? 0.05 : 0.18;
      const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
      sample.rms += (rawRms - sample.rms) * k;
      sample.low += (rawLow - sample.low) * k;
      sample.mid += (rawMid - sample.mid) * k;
      sample.high += (rawHigh - sample.high) * k;

      if (!speaking) {
        silentFor = 0;
        episodeOpen = false;
        sample.source = 'live';
      } else if (sample.rms < 0.01) {
        silentFor += dt;
        if (silentFor > 0.4) {
          sample.source = 'silent';
          if (!episodeOpen) {
            episodeOpen = true;
            episodes += 1;
          }
        }
      } else {
        silentFor = 0;
        episodeOpen = false;
        sample.source = 'live';
      }
      if (connectFailed) {
        sample.source = 'silent';
      }
      return sample;
    },

    close() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        sourceNode?.disconnect();
      } catch {
        // El nodo ya no está conectado.
      }
      sourceNode = null;
      try {
        void ctx.close();
      } catch {
        // El contexto ya estaba cerrado.
      }
    },
  };
}
