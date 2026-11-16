import type {
  AcceptInviteRequest,
  CardFlagsIn,
  CardOverrideIn,
  CardPage,
  CardView,
  CourseOut,
  ChangePasswordRequest,
  ChatThreadDetail,
  ChatThreadOut,
  CreateInviteRequest,
  DefaultVoicesIn,
  DrillDeck,
  Health,
  InviteCheckRequest,
  InviteCreated,
  InviteOut,
  InviteStatus,
  ItemDetail,
  ItemPage,
  ItemSummary,
  JobOut,
  LoginRequest,
  Me,
  OwnCardIn,
  PipelineRunRequest,
  PipelineStatus,
  PlanEntry,
  PracticeTtsIn,
  PracticeTtsOut,
  Quiz,
  QuizAttemptIn,
  QuizAttemptOut,
  QuizAttemptResult,
  ReviewIn,
  SearchHit,
  SpeechToken,
  StudyPlanDay,
  StudyStatus,
  StudySheet,
  StudyTopic,
  TopicItemsIn,
  TopicOut,
  TopicProgress,
  TopicSplitIn,
  TopicUpdateIn,
  TopicsMergeIn,
  UsageLineOut,
  UserCardStateOut,
  UserOut,
  UserPrefs,
  UserStats,
  VoiceOut,
} from '../contracts/generated';
import type { ApiClient, RequestOpts } from './client';

// Lista cerrada de rutas que usa la web v2. Cada función devuelve el tipo
// del contrato y arma la ruta con `encodeURIComponent` en los ids.
// `ItemPage`, `CardPage` y `ItemDetail` vienen de CHG-05/06/12.

const enc = encodeURIComponent;

// El generador de tipos no exporta alias con nombre para estos dos unions;
// se derivan de `JobOut` para no tocar `web/src/contracts/generated.ts`.
type JobState = JobOut['state'];
type JobKind = JobOut['kind'];

export function endpoints(c: ApiClient) {
  return {
    health: (o?: RequestOpts) => c.get<Health>('/api/health', undefined, o),
    me: (o?: RequestOpts) => c.get<Me>('/api/auth/me', undefined, o),
    login: (body: LoginRequest) => c.send<Me>('POST', '/api/auth/login', body),
    logout: () => c.send<void>('POST', '/api/auth/logout'),
    changePassword: (body: ChangePasswordRequest) =>
      c.send<void>('POST', '/api/auth/password', body),
    inviteCheck: (body: InviteCheckRequest) =>
      c.send<InviteStatus>('POST', '/api/auth/invite/check', body),
    inviteAccept: (body: AcceptInviteRequest) =>
      c.send<Me>('POST', '/api/auth/invite/accept', body),

    courses: (o?: RequestOpts) =>
      c.get<CourseOut[]>('/api/courses', undefined, o),
    classroomTopics: (courseId: string, o?: RequestOpts) =>
      c.get<TopicOut[]>(
        `/api/courses/${enc(courseId)}/classroom-topics`,
        undefined,
        o,
      ),
    items: (
      q: {
        course_id?: string;
        topic_id?: string;
        kind?: string;
        cursor?: string;
        limit?: number;
      },
      o?: RequestOpts,
    ) => c.get<ItemPage>('/api/items', q, o),
    item: (itemId: string, o?: RequestOpts) =>
      c.get<ItemDetail>(`/api/items/${enc(itemId)}`, undefined, o),
    cards: (
      q: {
        item_id?: string;
        kind?: string;
        q?: string;
        include_stale?: boolean;
        cursor?: string;
        limit?: number;
      },
      o?: RequestOpts,
    ) => c.get<CardPage>('/api/cards', q, o),
    card: (cardId: string, o?: RequestOpts) =>
      c.get<CardView>(`/api/cards/${enc(cardId)}`, undefined, o),
    sheet: (itemId: string, o?: RequestOpts) =>
      c.get<StudySheet>(`/api/sheets/${enc(itemId)}`, undefined, o),
    voices: (o?: RequestOpts) => c.get<VoiceOut[]>('/api/voices', undefined, o),
    drills: (o?: RequestOpts) =>
      c.get<DrillDeck[]>('/api/drills', undefined, o),
    speechToken: () => c.send<SpeechToken>('POST', '/api/speech/token'),
    practiceTts: (body: PracticeTtsIn, o?: RequestOpts) =>
      c.send<PracticeTtsOut>('POST', '/api/practice/tts', body, o),

    reviewQueue: (limit?: number, o?: RequestOpts) =>
      c.get<CardView[]>('/api/review/queue', { limit }, o),
    review: (body: ReviewIn) =>
      c.send<UserCardStateOut>('POST', '/api/reviews', body),
    cardFlags: (cardId: string, body: CardFlagsIn) =>
      c.send<UserCardStateOut>(
        'PATCH',
        `/api/cards/${enc(cardId)}/flags`,
        body,
      ),

    prefs: (o?: RequestOpts) => c.get<UserPrefs>('/api/me/prefs', undefined, o),
    savePrefs: (body: UserPrefs) =>
      c.send<UserPrefs>('PUT', '/api/me/prefs', body),
    stats: (o?: RequestOpts) => c.get<UserStats>('/api/me/stats', undefined, o),
    topicProgress: (courseId?: string, o?: RequestOpts) =>
      c.get<TopicProgress[]>(
        '/api/me/topic-progress',
        { course_id: courseId },
        o,
      ),
    upcoming: (limit?: number, o?: RequestOpts) =>
      c.get<ItemSummary[]>('/api/me/upcoming', { limit }, o),

    topics: (courseId?: string, o?: RequestOpts) =>
      c.get<StudyTopic[]>('/api/topics', { course_id: courseId }, o),
    topic: (topicId: string, o?: RequestOpts) =>
      c.get<StudyTopic>(`/api/topics/${enc(topicId)}`, undefined, o),
    topicCards: (
      topicId: string,
      q?: { cursor?: string; limit?: number },
      o?: RequestOpts,
    ) => c.get<CardPage>(`/api/topics/${enc(topicId)}/cards`, q, o),
    quizzes: (scopeKind: string, scopeId: string, o?: RequestOpts) =>
      c.get<Quiz[]>(
        '/api/quizzes',
        { scope_kind: scopeKind, scope_id: scopeId },
        o,
      ),
    quiz: (quizId: string, o?: RequestOpts) =>
      c.get<Quiz>(`/api/quizzes/${enc(quizId)}`, undefined, o),
    submitAttempt: (quizId: string, body: QuizAttemptIn) =>
      c.send<QuizAttemptResult>(
        'POST',
        `/api/quizzes/${enc(quizId)}/attempts`,
        body,
      ),
    attempts: (quizId: string, o?: RequestOpts) =>
      c.get<QuizAttemptOut[]>(
        `/api/quizzes/${enc(quizId)}/attempts`,
        undefined,
        o,
      ),

    planToday: (o?: RequestOpts) =>
      c.get<StudyPlanDay>('/api/plan/today', undefined, o),
    planWeek: (o?: RequestOpts) =>
      c.get<StudyPlanDay[]>('/api/plan/week', undefined, o),
    planDone: (day: string, position: number) =>
      c.send<PlanEntry>('POST', `/api/plan/${enc(day)}/${position}/done`),
    planUndone: (day: string, position: number) =>
      c.send<PlanEntry>('DELETE', `/api/plan/${enc(day)}/${position}/done`),
    studyStatus: (o?: RequestOpts) =>
      c.get<StudyStatus>('/api/study/status', undefined, o),
    search: (q: string, limit?: number, o?: RequestOpts) =>
      c.get<SearchHit[]>('/api/search', { q, limit }, o),

    threads: (o?: RequestOpts) =>
      c.get<ChatThreadOut[]>('/api/chat/threads', undefined, o),
    createThread: () => c.send<ChatThreadOut>('POST', '/api/chat/threads'),
    thread: (threadId: string, o?: RequestOpts) =>
      c.get<ChatThreadDetail>(
        `/api/chat/threads/${enc(threadId)}`,
        undefined,
        o,
      ),
    deleteThread: (threadId: string) =>
      c.send<void>('DELETE', `/api/chat/threads/${enc(threadId)}`),

    // Gestión (P11): admin, tarjetas, audio y temas.
    adminUsers: (o?: RequestOpts) =>
      c.get<UserOut[]>('/api/admin/users', undefined, o),
    disableUser: (userId: string) =>
      c.send<UserOut>('POST', `/api/admin/users/${enc(userId)}/disable`),
    enableUser: (userId: string) =>
      c.send<UserOut>('POST', `/api/admin/users/${enc(userId)}/enable`),
    adminInvites: (o?: RequestOpts) =>
      c.get<InviteOut[]>('/api/admin/invites', undefined, o),
    createInvite: (body: CreateInviteRequest) =>
      c.send<InviteCreated>('POST', '/api/admin/invites', body),
    revokeInvite: (inviteId: string) =>
      c.send<void>('DELETE', `/api/admin/invites/${enc(inviteId)}`),
    adminPipeline: (o?: RequestOpts) =>
      c.get<PipelineStatus>('/api/admin/pipeline', undefined, o),
    runPipeline: (body: PipelineRunRequest) =>
      c.send<JobOut>('POST', '/api/admin/pipeline/run', body),
    adminJobs: (
      q: { state?: JobState; kind?: JobKind; limit?: number },
      o?: RequestOpts,
    ) =>
      c.get<JobOut[]>(
        '/api/admin/jobs',
        { state: q.state, kind: q.kind, limit: q.limit },
        o,
      ),
    retryJob: (jobId: number) =>
      c.send<JobOut>('POST', `/api/admin/jobs/${enc(String(jobId))}/retry`),
    adminUsage: (o?: RequestOpts) =>
      c.get<UsageLineOut[]>('/api/admin/usage', undefined, o),
    audioQueue: (o?: RequestOpts) =>
      c.get<JobOut[]>('/api/admin/audio/queue', undefined, o),
    regenerateAudio: (cacheKey: string) =>
      c.send<JobOut>('POST', `/api/admin/audio/${enc(cacheKey)}/regenerate`),
    setDefaultVoices: (body: DefaultVoicesIn) =>
      c.send<VoiceOut[]>('PUT', '/api/admin/voices/default', body),
    regenerateItem: (itemId: string) =>
      c.send<JobOut>('POST', `/api/admin/items/${enc(itemId)}/regenerate`),
    createCard: (body: OwnCardIn) =>
      c.send<CardView>('POST', '/api/cards', body),
    saveMyCard: (cardId: string, body: CardOverrideIn) =>
      c.send<CardView>('PUT', `/api/cards/${enc(cardId)}/mine`, body),
    deleteMyCard: (cardId: string) =>
      c.send<CardView>('DELETE', `/api/cards/${enc(cardId)}/mine`),
    deleteCard: (cardId: string) =>
      c.send<void>('DELETE', `/api/cards/${enc(cardId)}`),
    adminUpdateCard: (cardId: string, body: CardOverrideIn) =>
      c.send<CardView>('PATCH', `/api/admin/cards/${enc(cardId)}`, body),
    adminDeleteCard: (cardId: string) =>
      c.send<void>('DELETE', `/api/admin/cards/${enc(cardId)}`),
    updateTopic: (topicId: string, body: TopicUpdateIn) =>
      c.send<StudyTopic>('PATCH', `/api/admin/topics/${enc(topicId)}`, body),
    mergeTopics: (body: TopicsMergeIn) =>
      c.send<StudyTopic>('POST', '/api/admin/topics/merge', body),
    splitTopic: (topicId: string, body: TopicSplitIn) =>
      c.send<StudyTopic[]>(
        'POST',
        `/api/admin/topics/${enc(topicId)}/split`,
        body,
      ),
    moveTopicItems: (topicId: string, body: TopicItemsIn) =>
      c.send<StudyTopic>(
        'POST',
        `/api/admin/topics/${enc(topicId)}/items`,
        body,
      ),

    /** Solo arma rutas relativas; la URL real viene en `FileLink.url` o `AudioClip.url`. */
    fileUrl: (sha256: string) => `/api/files/${enc(sha256)}`,
    audioUrl: (cacheKey: string) => `/api/audio/${enc(cacheKey)}`,
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
