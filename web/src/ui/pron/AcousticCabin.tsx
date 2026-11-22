// Cabina compartida de pronunciación y texto libre: orbe, botón de grabar
// y háptica. El nivel del micrófono vive en `meterRef` (sin estado por frame).

import { useId } from 'react';
import type { JSX, RefObject } from 'react';
import { Icon } from '../../components';
import type { LevelMeter } from '../../pron/levelMeter';
import { SafeVoiceOrbScene } from '../../three/LazyScenes';
import { getMotion3dPref, prefersReducedMotion } from '../../three/motionPref';
import './pron.css';

export const CABIN_LABELS = {
  record: 'Grabar',
  stop: 'Detener',
} as const;

function armRecordHaptic(): void {
  if (
    'vibrate' in navigator &&
    !prefersReducedMotion() &&
    getMotion3dPref() !== 'off'
  ) {
    navigator.vibrate?.(15);
  }
}

export function AcousticCabin({
  active,
  score,
  meterRef,
  onToggle,
  disabled = false,
  recordLabel = CABIN_LABELS.record,
  stopLabel = CABIN_LABELS.stop,
  showButton = true,
  describedBy,
}: {
  active: boolean;
  score?: number;
  meterRef?: RefObject<LevelMeter | null>;
  onToggle?: () => void;
  disabled?: boolean;
  recordLabel?: string;
  stopLabel?: string;
  showButton?: boolean;
  describedBy?: string;
}): JSX.Element {
  const labelId = useId();
  const label = active ? stopLabel : recordLabel;

  function onClick(): void {
    if (disabled) return;
    if (!active) armRecordHaptic();
    onToggle?.();
  }

  return (
    <div className="acoustic-cabin">
      <div className="acoustic-slot orb-wrap">
        <SafeVoiceOrbScene active={active} score={score} meterRef={meterRef} />
      </div>
      {showButton ? (
        <button
          type="button"
          className="record-orb"
          aria-pressed={active}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon name={active ? 'stop' : 'mic'} />
          <span id={labelId} className="record-orb-label">
            {label}
          </span>
        </button>
      ) : null}
    </div>
  );
}

export default AcousticCabin;
