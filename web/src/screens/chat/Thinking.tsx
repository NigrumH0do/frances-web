import { useEffect, useState, type JSX } from 'react';
import { Button, Icon } from '../../components';
import { tr } from '../../l10n/es';
import type { AskPhase } from './useAsk';
import { chatStrings } from './strings';

function motionOff(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('motion-off')
  );
}

function prefersReducedMotion(): boolean {
  return (
    motionOff() ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

function livePhase(phase: AskPhase): string {
  if (phase === 'writing') return chatStrings.stepWrite;
  if (phase === 'citing') return chatStrings.stepCite;
  if (phase === 'searching' || phase === 'sending')
    return chatStrings.stepSearch;
  return '';
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(prefersReducedMotion());
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return reduced;
}

type StepState = 'done' | 'now' | 'todo';

const PHASE_STEP: Partial<Record<AskPhase, number>> = {
  sending: 0,
  searching: 0,
  writing: 1,
  citing: 2,
};

function stepState(phase: AskPhase, index: number): StepState {
  if (phase === 'done') return 'done';
  const current = PHASE_STEP[phase];
  if (current === undefined) return 'todo';
  if (index < current) return 'done';
  if (index === current) return 'now';
  return 'todo';
}

const STATE_TEXT: Record<StepState, string> = {
  done: chatStrings.stepDone,
  now: chatStrings.stepNow,
  todo: chatStrings.stepTodo,
};

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="check done" aria-hidden="true">
        <Icon name="check" size="sm" />
      </span>
    );
  }
  if (state === 'now') {
    return <span className="spinner" aria-hidden="true" />;
  }
  return <span className="check" aria-hidden="true" />;
}

/**
 * Panel «Pensando» del chat. Muestra el cronómetro, los pasos con su estado en
 * texto (el color nunca va solo), el aviso de 30 s y el botón Cancelar.
 */
export function Thinking({
  phase,
  elapsedS,
  slow,
  onCancel,
}: {
  phase: AskPhase;
  elapsedS: number;
  slow: boolean;
  onCancel: () => void;
}): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const steps: readonly { label: string }[] = [
    { label: chatStrings.stepSearch },
    { label: chatStrings.stepWrite },
    { label: chatStrings.stepCite },
  ];

  return (
    <div className="thinking" role="status">
      <p className="sr-only" aria-live="polite">
        {livePhase(phase)}
      </p>
      <div className="row-between">
        <span className="row">
          {reduced ? null : (
            <span className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
          <b>{chatStrings.thinking}</b>
        </span>{' '}
        <span className="small muted">
          {tr(chatStrings.seconds, { s: elapsedS })}
        </span>
      </div>

      <ul className="steps">
        {steps.map((step, index) => {
          const state = stepState(phase, index);
          return (
            <li key={step.label} className={state}>
              <StepIcon state={state} />
              <span className="grow">{step.label}</span>
              <span className="xs muted">{STATE_TEXT[state]}</span>
            </li>
          );
        })}
      </ul>

      <p className="xs muted">{chatStrings.slowHint}</p>
      {slow ? (
        <p className="small">
          <strong>{chatStrings.slow}</strong>
        </p>
      ) : null}

      <Button
        variant="secondary"
        icon="stop"
        onClick={onCancel}
        className="btn-sm-text"
      >
        {chatStrings.cancel}
      </Button>
    </div>
  );
}
