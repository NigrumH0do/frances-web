// Reproductor de audio de tarjeta (Task WEB-10).
//
// Elige la voz por `voiceId` → primera preferida disponible → primera
// disponible. Pide el blob solo al pulsar «Reproducir» y revoca la URL de
// objeto al cambiar de voz, al terminar y al desmontar. Si la tarjeta no
// tiene clip para el campo, muestra «Audio pendiente: voz» o «Todavía sin
// audio». «Más lento» reproduce a 0,75× (ADR-018).
//
// `ClipPlayer` (Task CHG-13) recibe los clips con su `load`; la web v1 usaba
// un envoltorio con el contenido descifrado, retirado en CHG-16.

import type { JSX } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import type { VoiceOut } from '../contracts/generated';
import { t } from '../i18n/es';

export const SLOW_RATE = 0.75;

function ageLabel(voice: VoiceOut): string {
  if (voice.age === 'teen') {
    return t('age.teen');
  }
  if (voice.age === 'child') {
    return t(voice.gender === 'female' ? 'age.child.female' : 'age.child.male');
  }
  return t(voice.gender === 'female' ? 'age.adult.female' : 'age.adult.male');
}

// Partes legibles de una voz: nombre («Denise») y detalle («Francia,
// adulta»). La etiqueta del registro ya puede traer el acento y la edad
// («Denise · Francia · adulta»); aquí no se repiten. Un acento `standard` no
// se muestra.
export function voiceParts(voice: VoiceOut): { name: string; details: string } {
  const age = ageLabel(voice);
  const parts = voice.label
    .split('·')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const head = parts
    .filter(
      (part, index) =>
        index === 0 ||
        (part !== voice.accent && part.toLocaleLowerCase('es') !== age),
    )
    .join(' ');
  const name = head === '' ? voice.id : head;
  const details: string[] = [];
  if (voice.accent !== '' && voice.accent !== 'standard') {
    details.push(voice.accent);
  }
  if (!name.toLocaleLowerCase('es').includes(age)) {
    details.push(age);
  }
  return { name, details: details.join(', ') };
}

// Nombre completo para listas y menús: «Denise (Francia, adulta)».
export function voiceLabel(voice: VoiceOut): string {
  const { name, details } = voiceParts(voice);
  return details === '' ? name : `${name} (${details})`;
}

// Voz a usar: `voiceId` si está disponible, si no la primera preferida
// disponible, si no la primera disponible.
export function pickVoice(
  available: string[],
  preferred: string[],
  voiceId: string | undefined,
): string | null {
  if (available.length === 0) {
    return null;
  }
  if (voiceId !== undefined && available.includes(voiceId)) {
    return voiceId;
  }
  const preferredMatch = preferred.find((id) => available.includes(id));
  return preferredMatch ?? available[0] ?? null;
}

export interface PlayableClip {
  voice_id: string;
  load: (signal: AbortSignal) => Promise<Blob>;
}

export function ClipPlayer({
  clips,
  pendingVoiceIds,
  voices,
  preferred,
  voiceId,
  slowLabel,
}: {
  clips: PlayableClip[];
  pendingVoiceIds: string[];
  voices: VoiceOut[];
  // `null`: las preferencias aún se cargan; el selector de voz no se muestra.
  preferred: string[] | null;
  voiceId?: string;
  // La tarjeta de repaso pide «Lento»; el resto conserva «Más lento».
  slowLabel?: string;
}): JSX.Element {
  const selectId = useId();
  const [override, setOverride] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const availableIds = useMemo(
    () => clips.map((clip) => clip.voice_id),
    [clips],
  );
  const preferredIds = preferred ?? [];
  const selected = override ?? pickVoice(availableIds, preferredIds, voiceId);

  const voiceById = useMemo(() => {
    const map = new Map<string, VoiceOut>();
    for (const voice of voices) {
      map.set(voice.id, voice);
    }
    return map;
  }, [voices]);

  function labelFor(id: string): string {
    const voice = voiceById.get(id);
    return voice !== undefined ? voiceLabel(voice) : id;
  }

  function releaseUrl(): void {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      releaseUrl();
    };
  }, []);

  function stop(): void {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const element = audioRef.current;
    if (element !== null) {
      element.pause();
      element.removeAttribute('src');
    }
    releaseUrl();
    setPlaying(false);
  }

  async function play(id: string): Promise<void> {
    const clip = clips.find((c) => c.voice_id === id);
    if (clip === undefined) {
      return;
    }
    releaseUrl();
    const controller = new AbortController();
    controllerRef.current = controller;
    const blob = await clip.load(controller.signal);
    if (controller.signal.aborted) {
      return;
    }
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const element = audioRef.current;
    if (element !== null) {
      element.src = url;
      element.playbackRate = slow ? SLOW_RATE : 1;
    }
    setPlaying(true);
    if (element !== null) {
      void element.play().catch(() => undefined);
    }
  }

  function onToggle(): void {
    if (playing) {
      stop();
      return;
    }
    const id = selected ?? pickVoice(availableIds, preferredIds, voiceId);
    if (id !== null) {
      void play(id);
    }
  }

  function onSelect(id: string): void {
    if (playing) {
      stop();
    }
    setOverride(id);
  }

  function onSlow(): void {
    const next = !slow;
    setSlow(next);
    const element = audioRef.current;
    if (element !== null) {
      element.playbackRate = next ? SLOW_RATE : 1;
    }
  }

  function onEnded(): void {
    releaseUrl();
    setPlaying(false);
  }

  if (clips.length === 0) {
    const pendingId =
      voiceId !== undefined && pendingVoiceIds.includes(voiceId)
        ? voiceId
        : (pendingVoiceIds[0] ?? null);
    if (pendingId !== null) {
      return (
        <p className="audio-empty">
          {t('audio.pending', { voice: labelFor(pendingId) })}
        </p>
      );
    }
    return <p className="audio-empty">{t('audio.none')}</p>;
  }

  return (
    <div className="audio-player">
      <button
        type="button"
        className="audio-play"
        onClick={onToggle}
        aria-label={playing ? t('audio.stop') : t('audio.play')}
      >
        <Icon name={playing ? 'stop' : 'play'} size="sm" />
      </button>
      {preferred !== null && (
        <span className="audio-voice">
          <label htmlFor={selectId} className="sr-only">
            {t('audio.voice')}
          </label>
          <select
            id={selectId}
            className="select select-pill"
            value={selected ?? ''}
            onChange={(event) => onSelect(event.target.value)}
          >
            {clips.map((clip) => (
              <option key={clip.voice_id} value={clip.voice_id}>
                {labelFor(clip.voice_id)}
              </option>
            ))}
          </select>
        </span>
      )}
      <button
        type="button"
        className="audio-slow"
        aria-pressed={slow}
        onClick={onSlow}
      >
        {slowLabel ?? t('audio.slow')}
      </button>
      <audio ref={audioRef} hidden onEnded={onEnded}>
        <track kind="captions" />
      </audio>
    </div>
  );
}
