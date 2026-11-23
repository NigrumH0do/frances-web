import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { toUiError, type UiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import { AppBar, Button, Icon, IconButton, StateView } from '../../components';
import type { ChatThreadOut } from '../../contracts/generated';
import { common } from '../../l10n/es';
import { messageFor } from '../../l10n/errors';
import type { CardEditorValues } from '../../manage/CardEditor';
import { NewCardDialog } from '../../manage/NewCardDialog';
import { useOffline } from '../../offline/OfflineContext';
import { Composer } from './Composer';
import { MessageList, type PendingAsk } from './MessageList';
import { ThreadList } from './ThreadList';
import { useAsk, type AskPhase } from './useAsk';
import { readStarterContext, starterPrompts } from './starters';
import { chatStrings } from './strings';
import './chat.css';

function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;

  function read(): boolean {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return false;
    }
    return window.matchMedia(query).matches;
  }

  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);

  return matches;
}

function StarterChips({
  prompts,
  onPick,
}: {
  prompts: readonly string[];
  onPick: (prompt: string) => void;
}): JSX.Element {
  return (
    <div className="stack" aria-label={chatStrings.startersTitle}>
      <p className="xs muted">{chatStrings.startersTitle}</p>
      <div className="starter-chips">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="starter-chip"
            onClick={() => onPick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

// Claves de navegación cuya primera pregunta ya se envió: el modo estricto de
// React monta dos veces y la pregunta no debe salir dos veces.
const SENT_FIRST_QUESTIONS = new Set<string>();

function byUpdatedDesc(a: ChatThreadOut, b: ChatThreadOut): number {
  return b.updated_at.localeCompare(a.updated_at);
}

/**
 * Pantalla de chat (P09-7): hilos por usuario, SSE por POST, «pensando» con
 * cronómetro de hasta 30 s, cancelar y respuestas con citas a publicación y
 * página. En estrecho, sin `threadId` solo la lista; con `threadId` solo la
 * conversación. Desde 960 px, lista y conversación juntas.
 */
export default function Chat(): JSX.Element {
  const api = useApi();
  const online = useOffline().online;
  const navigate = useNavigate();
  const location = useLocation();
  const { threadId } = useParams<{ threadId?: string }>();
  const wide = useMinWidth(960);

  const threads = useResource(online ? 'chat-threads' : null, (signal) =>
    api.threads({ signal }),
  );
  const threadData = threads.status === 'ready' ? threads.data : null;
  const sortedThreads = useMemo(
    () => (threadData === null ? [] : [...threadData].sort(byUpdatedDesc)),
    [threadData],
  );

  const showList = wide || threadId === undefined;
  const showThread = wide || threadId !== undefined;
  const activeId = threadId ?? (wide ? (sortedThreads[0]?.id ?? null) : null);
  const detail = useResource(
    online && showThread && activeId !== null
      ? `chat-thread:${activeId}`
      : null,
    (signal) => api.thread(activeId as string, { signal }),
  );

  const ask = useAsk(activeId ?? '');
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [actionError, setActionError] = useState<UiError | null>(null);
  const [creating, setCreating] = useState(false);
  const [cardDraft, setCardDraft] = useState<Partial<CardEditorValues> | null>(
    null,
  );

  const openCardFromMessage = useCallback((content: string) => {
    const cleaned = content
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
    setCardDraft({
      kind: 'phrase',
      front_fr: '',
      back_es: firstSentence.slice(0, 200),
      notes: cleaned.slice(0, 1500),
    });
  }, []);

  const reloadThread = useRef(detail.reload);
  reloadThread.current = detail.reload;
  const settled = useRef<AskPhase | null>(null);

  // Al terminar (bien, mal o cancelada) se recarga el hilo para mostrar lo
  // que el servidor guardó.
  useEffect(() => {
    if (ask.phase === 'sending') {
      settled.current = null;
      return;
    }
    if (
      (ask.phase === 'done' ||
        ask.phase === 'error' ||
        ask.phase === 'cancelled') &&
      settled.current !== ask.phase
    ) {
      settled.current = ask.phase;
      reloadThread.current();
    }
  }, [ask.phase]);

  // Primera pregunta sin hilo: se crea la conversación y la pregunta viaja en
  // el estado de la navegación; la pantalla del hilo nuevo la envía una vez
  // (useAsk va atado al hilo y la ruta nueva puede volver a montar Chat).
  const handleSend = useCallback(
    async (nextQuestion: string): Promise<void> => {
      if (activeId === null) {
        setCreating(true);
        setActionError(null);
        try {
          const created = await api.createThread();
          threads.reload();
          navigate(`/chat/${encodeURIComponent(created.id)}`, {
            state: { firstQuestion: nextQuestion },
          });
        } catch (error) {
          setActionError(toUiError(error));
        } finally {
          setCreating(false);
        }
        return;
      }
      setQuestion(nextQuestion);
      await ask.ask(nextQuestion);
    },
    [activeId, api, ask.ask, navigate, threads.reload],
  );

  const firstQuestion = (location.state as { firstQuestion?: unknown } | null)
    ?.firstQuestion;
  useEffect(() => {
    if (typeof firstQuestion !== 'string' || threadId === undefined) return;
    if (SENT_FIRST_QUESTIONS.has(location.key)) return;
    SENT_FIRST_QUESTIONS.add(location.key);
    navigate(location.pathname, { replace: true, state: null });
    setQuestion(firstQuestion);
    void ask.ask(firstQuestion);
  }, [
    ask.ask,
    firstQuestion,
    location.key,
    location.pathname,
    navigate,
    threadId,
  ]);

  const newThread = useCallback(async (): Promise<void> => {
    setCreating(true);
    setActionError(null);
    try {
      const created = await api.createThread();
      threads.reload();
      navigate(`/chat/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setActionError(toUiError(error));
    } finally {
      setCreating(false);
    }
  }, [api, navigate, threads.reload]);

  const removeThread = useCallback(
    async (id: string): Promise<void> => {
      setActionError(null);
      try {
        await api.deleteThread(id);
        threads.reload();
        if (threadId === id) navigate('/chat');
      } catch (error) {
        setActionError(toUiError(error));
        throw error;
      }
    },
    [api, navigate, threadId, threads.reload],
  );

  const asking =
    ask.phase === 'sending' ||
    ask.phase === 'searching' ||
    ask.phase === 'writing' ||
    ask.phase === 'citing';
  const canAsk =
    online &&
    !asking &&
    !creating &&
    (activeId === null
      ? threads.status === 'ready'
      : detail.status !== 'error');

  let reason: string | undefined;
  if (!online) reason = common.offline;
  else if (activeId !== null && detail.status === 'error')
    reason = chatStrings.threadGone;
  else if (asking) reason = chatStrings.wait;

  const pending = useMemo<PendingAsk | null>(() => {
    if (ask.phase === 'idle' || ask.phase === 'done') return null;
    return {
      question,
      phase: ask.phase,
      elapsedS: ask.elapsedS,
      slow: ask.slow,
      text: ask.text,
      citations: ask.citations,
      status: ask.status,
      error: ask.error,
      onCancel: ask.cancel,
    };
  }, [
    ask.cancel,
    ask.citations,
    ask.elapsedS,
    ask.error,
    ask.phase,
    ask.slow,
    ask.status,
    ask.text,
    question,
  ]);

  const showStarters =
    online &&
    !asking &&
    !creating &&
    ((threadId === undefined &&
      threads.status === 'ready' &&
      threads.data.length === 0) ||
      (activeId !== null &&
        detail.status === 'ready' &&
        detail.data.messages.length === 0 &&
        pending === null));

  const listPane = online && showList;
  const threadPane = showThread;
  const split = wide && listPane && threadPane;
  const prompts = starterPrompts(readStarterContext(location.state));

  function pickStarter(prompt: string): void {
    setDraft(prompt);
    composerRef.current?.focus();
  }

  const starters = showStarters ? (
    <StarterChips prompts={prompts} onPick={pickStarter} />
  ) : null;
  const composer = (
    <Composer
      disabled={!canAsk}
      reason={reason}
      onSend={handleSend}
      draft={draft}
      onDraftChange={setDraft}
      inputRef={composerRef}
    />
  );

  return (
    <div className="stack">
      <AppBar
        title={chatStrings.title}
        subtitle={chatStrings.subtitle}
        back={
          threadId === undefined
            ? undefined
            : { to: '/chat', label: chatStrings.conversations }
        }
        actions={
          threadId === undefined ? undefined : (
            <IconButton
              label={chatStrings.newThread}
              icon="chat"
              variant="ghost"
              disabled={creating}
              onClick={() => void newThread()}
            />
          )
        }
      />

      {!online ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small">{chatStrings.offline}</p>
        </div>
      ) : null}

      {actionError !== null ? (
        <div className="callout error" role="alert">
          <Icon name="alert" size="sm" />
          <p className="small">{messageFor(actionError)}</p>
        </div>
      ) : null}

      <div className={split ? 'chat-split' : 'stack'}>
        {listPane ? (
          <StateView
            state={threads}
            empty={(data) => data.length === 0}
            emptyText={chatStrings.emptyThreads}
            emptyAction={
              <Button
                variant="secondary"
                icon="chat"
                disabled={creating}
                onClick={() => void newThread()}
              >
                {chatStrings.newThread}
              </Button>
            }
            onRetry={threads.reload}
          >
            {(data) => (
              <ThreadList
                threads={data}
                activeId={activeId ?? undefined}
                busy={creating}
                onNew={() => void newThread()}
                onDelete={removeThread}
              />
            )}
          </StateView>
        ) : null}

        {threadPane ? (
          <div className="stack chat-pane">
            {online && activeId !== null ? (
              <StateView
                state={detail}
                emptyText={chatStrings.emptyThread}
                onRetry={detail.reload}
              >
                {(data) => (
                  <MessageList
                    messages={data.messages}
                    pending={pending}
                    onCreateCard={openCardFromMessage}
                  />
                )}
              </StateView>
            ) : null}
            {starters}
            {composer}
          </div>
        ) : (
          <>
            {starters}
            {composer}
          </>
        )}
      </div>

      <NewCardDialog
        open={cardDraft !== null}
        initial={cardDraft ?? undefined}
        onClose={() => setCardDraft(null)}
      />
    </div>
  );
}
