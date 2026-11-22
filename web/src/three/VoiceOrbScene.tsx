import { useEffect, useRef, type RefObject } from 'react';
import {
  Color,
  IcosahedronGeometry,
  Mesh,
  ShaderMaterial,
  type Scene,
} from 'three';
import type { LevelMeter, LevelSample } from '../pron/levelMeter';
import { scoreBand, type ScoreBand } from '../ui/pron/score';
import { dampMix, mountSceneHost, type Palette } from './createSceneHost';
import { addStudioLights } from './lights';
import { ORB_FRAGMENT_SHADER, ORB_VERTEX_SHADER } from './orbShader';
import { stepSpring } from './spring';
import { getSessionTier } from './tier';

export interface VoiceOrbSceneProps {
  active?: boolean;
  score?: number;
  meterRef?: RefObject<LevelMeter | null>;
  /** Se acepta por compatibilidad con G4. v2 lee `meterRef`. */
  level?: number;
  className?: string;
}

export interface OrbDrive {
  active: boolean;
  score?: number;
  read(dt: number, active: boolean): LevelSample;
}

export interface OrbRig {
  mesh: Mesh;
  material: ShaderMaterial;
  onFrame: (
    dt: number,
    elapsed: number,
    pointerX: number,
    pointerY: number,
  ) => void;
  needsFrame: () => boolean;
  onTheme: (palette: Palette) => void;
  onTier: (tier: 'lite') => void;
  dispose: () => void;
}

const SILENT_SAMPLE: LevelSample = {
  rms: 0,
  low: 0,
  mid: 0,
  high: 0,
  source: 'silent',
};

const COLOR_LAMBDA = 8;
const SPEAKING_TAU = 0.2;
const SPRING_OMEGA = 9;
const SPRING_ZETA = 0.86;
const SETTLED = 1e-3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function orbDetail(tier: 'full' | 'lite'): number {
  return tier === 'lite' ? 3 : 4;
}

export function orbColors(
  palette: Palette,
  state: { active?: boolean; score?: number },
): { body: Color; rim: Color } {
  if (state.score !== undefined) {
    const band = scoreBand(state.score);
    const body: Record<ScoreBand, Color> = {
      excelente: palette.scoreExcelente,
      bien: palette.scoreBien,
      mejorable: palette.scoreMejorable,
      repetir: palette.scoreRepetir,
    };
    return { body: body[band], rim: palette.paper };
  }
  if (state.active) {
    return {
      body: palette.accent,
      rim: palette.accent.clone().lerp(palette.paper, 0.35),
    };
  }
  return { body: palette.accent, rim: palette.paper };
}

export function buildOrb(
  scene: Scene,
  palette: Palette,
  tier: 'full' | 'lite',
  drive: OrbDrive,
): OrbRig {
  let paletteRef = palette;
  const initial = orbColors(paletteRef, {
    active: drive.active,
    score: drive.score,
  });
  const colorA = new Color().copy(initial.body);
  const colorB = new Color().copy(initial.rim);
  const targetBody = colorA.clone();
  const targetRim = colorB.clone();
  const fromBody = colorA.clone();
  const fromRim = colorB.clone();
  let mix = 1;
  let seenActive = drive.active;
  let seenScore = drive.score;
  let seenRevision = paletteRef.revision;
  let audio = 0;
  let speaking = 0;
  let yaw = 0;
  let yawVel = 0;
  let pitch = 0;
  let pitchVel = 0;
  let pointerX = 0;
  let pointerY = 0;
  let replacedLite = tier === 'lite';

  const uniforms = {
    uTime: { value: 0 },
    uAudio: { value: 0 },
    uSpeaking: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uColorA: { value: colorA },
    uColorB: { value: colorB },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: ORB_VERTEX_SHADER,
    fragmentShader: ORB_FRAGMENT_SHADER,
    toneMapped: true,
    transparent: false,
    depthWrite: true,
    precision: 'mediump',
  });
  const mesh = new Mesh(new IcosahedronGeometry(1, orbDetail(tier)), material);
  scene.add(mesh);

  function refreshColor(dt: number): void {
    const changed =
      drive.active !== seenActive ||
      drive.score !== seenScore ||
      paletteRef.revision !== seenRevision;
    if (changed) {
      const next = orbColors(paletteRef, {
        active: drive.active,
        score: drive.score,
      });
      if (!targetBody.equals(next.body) || !targetRim.equals(next.rim)) {
        fromBody.copy(colorA);
        fromRim.copy(colorB);
        targetBody.copy(next.body);
        targetRim.copy(next.rim);
        const already = colorA.equals(targetBody) && colorB.equals(targetRim);
        mix = already ? 1 : 0;
      }
      seenActive = drive.active;
      seenScore = drive.score;
      seenRevision = paletteRef.revision;
    }
    if (mix === 1) return;
    mix = dampMix(mix, dt, COLOR_LAMBDA);
    if (mix === 1) {
      colorA.copy(targetBody);
      colorB.copy(targetRim);
      return;
    }
    colorA.copy(fromBody).lerp(targetBody, mix);
    colorB.copy(fromRim).lerp(targetRim, mix);
  }

  function pointerSettled(): boolean {
    const yawTarget = clamp(pointerX * 0.22, -0.22, 0.22);
    const pitchTarget = clamp(pointerY * 0.18, -0.18, 0.18);
    return (
      Math.abs(yaw - yawTarget) < SETTLED &&
      Math.abs(yawVel) < SETTLED &&
      Math.abs(pitch - pitchTarget) < SETTLED &&
      Math.abs(pitchVel) < SETTLED
    );
  }

  return {
    mesh,
    material,
    onFrame(dt, elapsed, nextX, nextY) {
      pointerX = nextX;
      pointerY = nextY;
      refreshColor(dt);
      const sample = drive.read(dt, drive.active);
      const targetAudio =
        sample.source === 'silent' && drive.active ? 0.12 : sample.rms;
      audio = targetAudio;
      const speakTarget = drive.active ? 1 : 0;
      const gain = dt > 0 ? 1 - Math.exp(-dt / SPEAKING_TAU) : 0;
      speaking += (speakTarget - speaking) * gain;
      uniforms.uTime.value = elapsed;
      uniforms.uAudio.value = audio;
      uniforms.uSpeaking.value = speaking;
      uniforms.uMid.value = sample.mid;
      uniforms.uHigh.value = sample.high;
      const yawTarget = clamp(pointerX * 0.22, -0.22, 0.22);
      const pitchTarget = clamp(pointerY * 0.18, -0.18, 0.18);
      [yaw, yawVel] = stepSpring(
        yaw,
        yawVel,
        yawTarget,
        dt,
        SPRING_OMEGA,
        SPRING_ZETA,
      );
      [pitch, pitchVel] = stepSpring(
        pitch,
        pitchVel,
        pitchTarget,
        dt,
        SPRING_OMEGA,
        SPRING_ZETA,
      );
      mesh.rotation.y = yaw;
      mesh.rotation.x = pitch;
    },
    needsFrame() {
      if (drive.active) return true;
      if (audio > 0.01) return true;
      if (speaking > 0.01) return true;
      if (mix < 1) return true;
      return !pointerSettled();
    },
    onTheme(next) {
      paletteRef = next;
      refreshColor(0);
    },
    onTier(next) {
      if (next !== 'lite' || replacedLite) return;
      replacedLite = true;
      const previous = mesh.geometry;
      mesh.geometry = new IcosahedronGeometry(1, orbDetail('lite'));
      previous.dispose();
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

function wakeHost(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  window.dispatchEvent(
    new PointerEvent('pointermove', {
      pointerType: 'mouse',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
    }),
  );
}

export default function VoiceOrbScene({
  active = false,
  score,
  meterRef,
  className = 'three-host orb-three',
}: VoiceOrbSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ active, score, meterRef });
  propsRef.current = { active, score, meterRef };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const sessionTier = getSessionTier();
    const drive: OrbDrive = {
      get active() {
        return propsRef.current.active;
      },
      get score() {
        return propsRef.current.score;
      },
      read(dt, speaking) {
        return (
          propsRef.current.meterRef?.current?.read(dt, speaking) ??
          SILENT_SAMPLE
        );
      },
    };
    return mountSceneHost(
      el,
      sessionTier,
      (scene, camera, palette) => {
        camera.position.set(0, 0, 4.4);
        const lights = addStudioLights(scene, palette);
        const rig = buildOrb(
          scene,
          palette,
          sessionTier === 'lite' ? 'lite' : 'full',
          drive,
        );
        return {
          onFrame: (dt, elapsed, pointerX, pointerY) => {
            rig.onFrame(dt, elapsed, pointerX, pointerY);
          },
          needsFrame: () => rig.needsFrame(),
          onTheme: (next) => {
            lights.sync(next);
            rig.onTheme(next);
          },
          onTier: (next) => {
            rig.onTier(next);
          },
          dispose: () => {
            lights.dispose();
          },
        };
      },
      { fov: 36, cameraZ: 4.4, orientation: 'rest' },
    );
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    // El host solo reanuda el rAF con un pointermove. Grabar o un puntaje
    // nuevo tienen que despertar el orbe que ya se durmió en reposo.
    wakeHost(el);
  }, [active, score]);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
