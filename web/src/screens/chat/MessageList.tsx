import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, Icon } from '../../components';
import type { UiError } from '../../api/client';
import type { ChatMessageOut, Citation } from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { messageFor } from '../../l10n/errors';
import { CitationPopover, citationHref } from './CitationPopover';
import { Thinking } from './Thinking';
import type { AskPhase } from './useAsk';
import { chatStrings } from './strings';

export interface PendingAsk {
  question: string;
  phase: AskPhase;
  elapsedS: number;
  slow: boolean;
  text: string;
  citations: Citation[];
  status: ChatMessageOut['status'] | null;
  error: UiError | null;
  onCancel: () => void;
}

function isThinking(phase: AskPhase): boolean {
  return (
    phase === 'sending' ||
    phase === 'searching' ||
    phase === 'writing' ||
    phase === 'citing'
  );
}

// Tras cancelar o fallar, Chat recarga el hilo y el servidor ya puede tener
// guardada la pregunta (y una respuesta parcial). Si el último mensaje de
// usuario coincide, se deja de pintar el pendiente para no duplicarlo; solo
// queda el aviso de «Cancelada» o el error.
function withoutSavedPending(
  messages: ChatMessageOut[],
  pending: PendingAsk | null | undefined,
): PendingAsk | null {
  if (pending === null || pending === undefined) return null;
  if (pending.phase !== 'cancelled' && pending.phase !== 'error') {
    return pending;
  }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (
    lastUser === undefined ||
    lastUser.content.trim() !== pending.question.trim()
  ) {
    return pending;
  }
  return { ...pending, question: '', text: '' };
}

// El texto se pinta como texto (React escapa el HTML) y `[n]` o `[n, m]` solo
// se convierten en enlaces si existe una citation para ese número (P09-7). El
// backend renumera el texto guardado (REM-03), pero durante el stream todavía
// llega la numeración original del modelo: `[4]` con una sola cita compactada.
const CITATION_MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

function markerNumbers(group: string): number[] {
  return group.split(',').map((raw) => Number(raw.trim()));
}

/**
 * Número escrito en el texto → índice 1-based de `citations`.
 *
 * Si alguna marca ya apunta dentro de `citations`, se resuelve por índice
 * (`[1]` → `citations[0]`) y las que se salen quedan como texto plano. Si
 * ninguna encaja —el modelo citó `[4]` y solo hay una cita compactada— se
 * asignan los números distintos en orden de primera aparición a 1…n.
 */
function citationIndexes(
  content: string,
  citations: Citation[],
): Map<number, number> {
  const indexes = new Map<number, number>();
  if (citations.length === 0) return indexes;
  const numbers = [...content.matchAll(CITATION_MARKER)].flatMap((match) =>
    markerNumbers(match[1]),
  );
  if (numbers.some((number) => number >= 1 && number <= citations.length)) {
    for (const number of numbers) {
      if (number >= 1 && number <= citations.length) {
        indexes.set(number, number);
      }
    }
    return indexes;
  }
  const distinct: number[] = [];
  for (const number of numbers) {
    if (!distinct.includes(number)) distinct.push(number);
  }
  distinct.forEach((number, position) => {
    if (position < citations.length) indexes.set(number, position + 1);
  });
  return indexes;
}

function renderText(
  content: string,
  citations: Citation[],
  indexes: Map<number, number> = citationIndexes(content, citations),
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const marker = new RegExp(CITATION_MARKER.source, 'g');
  let last = 0;
  let match = marker.exec(content);
  while (match !== null) {
    const group = markerNumbers(match[1]);
    nodes.push(content.slice(last, match.index));
    let linked = 0;
    for (const written of group) {
      const index = indexes.get(written);
      const citation = index === undefined ? undefined : citations[index - 1];
      if (index === undefined || citation === undefined) continue;
      if (linked > 0) nodes.push(' ');
      nodes.push(
        <CitationPopover
          key={`citation-${index}-${match.index}-${linked}`}
          citation={citation}
          number={index}
        />,
      );
      linked += 1;
    }
    if (linked === 0) nodes.push(match[0]);
    last = match.index + match[0].length;
    match = marker.exec(content);
  }
  nodes.push(content.slice(last));
  return nodes;
}

function errorText(error: UiError): string {
  if (error.kind === 'http') {
    if (error.code === 'rate_limited') {
      return error.message || chatStrings.inFlight;
    }
    if (error.code === 'not_found') return chatStrings.threadGone;
    if (error.code === 'stream_truncated') return chatStrings.truncated;
  }
  return messageFor(error);
}

function SourceList({ citations }: { citations: Citation[] }) {
  return (
    <div className="sources">
      <p className="xs muted">{chatStrings.sources}</p>
      {citations.map((citation, index) => {
        const title = citation.item_title;
        const showTitle =
          title !== undefined &&
          title !== null &&
          title !== '' &&
          !citation.snippet.startsWith(title);
        return (
          <Link
            key={`${citation.item_id}-${citation.block_id}-${index}`}
            to={citationHref(citation)}
            className="source"
          >
            <span className="cite">{index + 1}</span>
            <span className="grow">
              {showTitle ? <strong>{title} — </strong> : null}
              {citation.snippet}
            </span>
            {citation.page !== null && citation.page !== undefined ? (
              <span className="muted">
                {tr(chatStrings.page, { page: citation.page })}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles no se cambia el estado del botón.
    }
  }

  return (
    <Button variant="ghost" icon="copy" onClick={() => void copy()}>
      {copied ? chatStrings.copied : chatStrings.copy}
    </Button>
  );
}

function AssistantBubble({
  content,
  citations,
  status,
  onCreateCard,
}: {
  content: string;
  citations: Citation[];
  status: ChatMessageOut['status'] | null;
  onCreateCard?: (content: string) => void;
}) {
  const paragraphs = content.split(/\n{2,}/).filter((part) => part !== '');
  // Un solo mapa para todo el mensaje: un grupo `[4]` del primer párrafo y un
  // `[6]` del segundo tienen que alinearse con las mismas citas (REM-03).
  const indexes = citationIndexes(content, citations);

  if (status === 'error') {
    return (
      <div className="bubble bot">
        <div className="callout error" role="alert">
          <Icon name="alert" size="sm" />
          <p className="small">
            {content !== '' ? content : chatStrings.savedError}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bubble bot">
      {paragraphs.map((paragraph, index) => (
        <p key={`paragraph-${index}`}>
          {renderText(paragraph, citations, indexes)}
        </p>
      ))}

      {status === 'no_material' ? (
        <div className="callout" role="status">
          <Icon name="alert" size="sm" />
          <div className="grow">
            <p className="small">{chatStrings.noMaterial}</p>
            {content === '' ? (
              <p className="small muted">{chatStrings.noMaterialHint}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {status === 'partial' ? (
        <div className="callout info" role="status">
          <Icon name="alert" size="sm" />
          <p className="small">{chatStrings.partial}</p>
        </div>
      ) : null}

      {citations.length > 0 ? <SourceList citations={citations} /> : null}
      {content !== '' ? (
        <div className="row wrap">
          <CopyButton text={content} />
          {onCreateCard !== undefined ? (
            <Button variant="ghost" onClick={() => onCreateCard(content)}>
              {chatStrings.createCard}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lista de mensajes guardados y, si hay una pregunta en curso, sus eventos
 * SSE. Las citas viven aquí; el texto siempre se pinta como texto.
 */
export function MessageList({
  messages,
  pending,
  onCreateCard,
}: {
  messages: ChatMessageOut[];
  pending?: PendingAsk | null;
  onCreateCard?: (content: string) => void;
}): JSX.Element {
  const visiblePending = withoutSavedPending(messages, pending);

  return (
    <div className="chat" role="log" aria-live="polite">
      {messages.map((message) =>
        message.role === 'user' ? (
          <div key={message.id} className="bubble me">
            {message.content}
          </div>
        ) : (
          <AssistantBubble
            key={message.id}
            content={message.content}
            citations={message.citations}
            status={message.status}
            onCreateCard={onCreateCard}
          />
        ),
      )}

      {visiblePending ? (
        <>
          {visiblePending.question !== '' ? (
            <div className="bubble me">{visiblePending.question}</div>
          ) : null}
          {isThinking(visiblePending.phase) ? (
            <Thinking
              phase={visiblePending.phase}
              elapsedS={visiblePending.elapsedS}
              slow={visiblePending.slow}
              onCancel={visiblePending.onCancel}
            />
          ) : null}
          {visiblePending.text !== '' ? (
            <AssistantBubble
              content={visiblePending.text}
              citations={visiblePending.citations}
              status={visiblePending.status}
            />
          ) : null}
          {visiblePending.phase === 'cancelled' ? (
            <div className="bubble bot">
              <p className="small muted">{chatStrings.cancelled}</p>
            </div>
          ) : null}
          {visiblePending.phase === 'error' && visiblePending.error !== null ? (
            <div className="callout error" role="alert">
              <Icon name="alert" size="sm" />
              <p className="small">{errorText(visiblePending.error)}</p>
            </div>
          ) : null}
        </>
      ) : null}

      {messages.length === 0 && !visiblePending ? (
        <div className="state">
          <p>{chatStrings.emptyThread}</p>
        </div>
      ) : null}
    </div>
  );
}
