import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, Icon } from '../../components';
import type { UiError } from '../../api/client';
import type { ChatMessageOut, Citation } from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { messageFor } from '../../l10n/errors';
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

function citationHref(citation: Citation): string {
  const params = new URLSearchParams();
  if (citation.page !== null && citation.page !== undefined) {
    params.set('pagina', String(citation.page));
  }
  params.set('adjunto', citation.source);
  const query = params.toString();
  return `/publicaciones/${encodeURIComponent(citation.item_id)}${
    query === '' ? '' : `?${query}`
  }`;
}

// El texto se pinta como texto (React escapa el HTML) y `[n]` solo se
// convierte en enlace si existe una citation con ese número (P09-7).
function renderText(content: string, citations: Citation[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  const marker = /\[(\d+)\]/g;
  let last = 0;
  let match = marker.exec(content);
  while (match !== null) {
    const number = Number(match[1]);
    const citation = citations[number - 1];
    nodes.push(content.slice(last, match.index));
    if (citation !== undefined) {
      nodes.push(
        <Link
          key={`citation-${number}-${match.index}`}
          to={citationHref(citation)}
          className="cite"
          aria-label={tr(chatStrings.citation, { n: number })}
        >
          {number}
        </Link>,
      );
    } else {
      nodes.push(match[0]);
    }
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
      {citations.map((citation, index) => (
        <Link
          key={`${citation.item_id}-${citation.block_id}-${index}`}
          to={citationHref(citation)}
          className="source"
        >
          <span className="cite">{index + 1}</span>
          <span className="grow">{citation.snippet}</span>
          {citation.page !== null && citation.page !== undefined ? (
            <span className="muted">
              {tr(chatStrings.page, { page: citation.page })}
            </span>
          ) : null}
        </Link>
      ))}
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
}: {
  content: string;
  citations: Citation[];
  status: ChatMessageOut['status'] | null;
}) {
  const paragraphs = content.split(/\n{2,}/).filter((part) => part !== '');

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
        <p key={`paragraph-${index}`}>{renderText(paragraph, citations)}</p>
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
        <div className="row">
          <CopyButton text={content} />
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
}: {
  messages: ChatMessageOut[];
  pending?: PendingAsk | null;
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
