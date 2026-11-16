/* GENERADO — no editar. Fuente: contracts/*.schema.json (npm run gen:types) */

export type Id = string;
export type Mime = string;
export type Sha256 = string;
export type Size = number;
export type Id1 = string;
export type ItemId = string;
export type Kind = 'drive_file' | 'link' | 'youtube' | 'form';
export type MimeType = string | null;
export type Status =
  | 'pending'
  | 'downloaded'
  | 'reference'
  | 'skipped_too_large'
  | 'forbidden'
  | 'not_found'
  | 'error';
export type Title = string | null;
export type Url = string | null;
export type Attachments = AttachmentOut[];
export type Field = 'front' | 'example';
export type VoiceId = string;
export type Audio = AudioRef[];
export type Field1 = 'front' | 'example';
export type VoiceId1 = string;
export type AudioPending = AudioPending1[];
export type BackEs = string;
export type ExampleEs = string | null;
export type ExampleFr = string | null;
export type FrontFr = string;
export type Id2 = string;
export type Ipa = string | null;
export type Kind1 = 'vocab' | 'phrase' | 'grammar' | 'conjugation' | 'drill';
export type Notes = string | null;
export type Phonemes = string[];
export type SourceItemIds = string[];
export type Stale = boolean;
export type Tags = string[];
export type Cards = CardOut[];
export type Id3 = string;
export type Name = string;
export type Section = string | null;
export type Courses = CourseOut[];
export type CardIds = string[];
export type Curated = boolean;
export type Id4 = string;
export type Phoneme = string;
export type TitleEs = string;
export type Drills = DrillDeck[];
export type GeneratedAt = string;
export type AlternateLink = string | null;
export type AttachmentIds = string[];
export type CardIds1 = string[];
export type CourseId = string;
export type CreatedAt = string;
export type DueAt = string | null;
export type FirstSeenAt = string;
export type HasSheet = boolean;
export type Id5 = string;
export type Kind2 = 'coursework' | 'material' | 'announcement';
export type Text = string;
export type TextLang = 'fr' | 'es' | 'en' | 'mixed' | 'unknown';
export type Title1 = string | null;
export type TopicId = string | null;
export type UpdatedAt = string;
export type Items = ItemOut[];
export type SchemaVersion = 1;
export type RightFr = string;
export type WhyEs = string;
export type WrongFr = string;
export type CommonMistakes = CommonMistake[];
export type Es = string;
export type Fr = string;
export type Examples = Example[];
export type ExplanationEs = string;
export type Title2 = string;
export type Grammar = GrammarPoint[];
export type ItemId1 = string;
export type KeyPhrases = Example[];
export type ObjectivesEs = string[];
export type PromptVersion = string | null;
export type SummaryEs = string;
export type VocabCardIds = string[];
export type Sheets = StudySheet[];
export type Key = string;
export type Locale = 'fr-FR';
export type Region = string;
export type CourseId1 = string;
export type Id6 = string;
export type Name1 = string;
export type Topics = TopicOut[];
export type Accent = string;
export type Age = 'adult' | 'teen' | 'child';
export type Gender = 'female' | 'male';
export type Id7 = string;
export type Label = string;
export type Voices = VoiceOut[];
export type Check = string;
export type CreatedAt1 = string;
export type Format = 'FRB1';
export type Hash = 'SHA-256';
export type Iterations = number;
export type Name2 = 'PBKDF2';
export type Salt = string;
export type At = string;
export type CardId = string | null;
export type DurationMs = number;
export type Id8 = string;
export type RecognizedText = string;
export type ReferenceText = string;
export type Accuracy = number;
export type Completeness = number;
export type Fluency = number;
export type Pron = number;
export type Accuracy1 = number;
export type ErrorType =
  | 'None'
  | 'Omission'
  | 'Insertion'
  | 'Mispronunciation'
  | 'UnexpectedBreak'
  | 'MissingBreak'
  | 'Monotone';
export type Accuracy2 = number;
export type Phoneme1 = string;
export type Phonemes1 = PhonemeScore[];
export type Word = string;
export type Words = WordScore[];
export type DisplayName = string;
export type Email = string;
export type Password = string;
export type Token = string;
export type Answer = string | string[];
export type QuestionId = string;
export type Correct = boolean;
export type Expected = string | string[];
export type ExplanationEs1 = string | null;
export type QuestionId1 = string;
export type Code = string;
export type MessageEs = string;
export type Mime1 = string;
export type Sha2561 = string;
export type Size1 = number;
export type Url1 = string;
export type Id9 = string;
export type Kind3 = 'drive_file' | 'link' | 'youtube' | 'form';
export type MimeType1 = string | null;
export type Status1 =
  | 'pending'
  | 'downloaded'
  | 'reference'
  | 'skipped_too_large'
  | 'forbidden'
  | 'not_found'
  | 'error';
export type Title3 = string | null;
export type Url2 = string | null;
export type DurationMs1 = number | null;
export type Field2 = 'front' | 'example';
export type Url3 = string;
export type VoiceId2 = string;
export type FlaggedHard = boolean | null;
export type Suspended = boolean | null;
export type BackEs1 = string;
export type BaseUpdatedAt = string;
export type ExampleEs1 = string | null;
export type ExampleFr1 = string | null;
export type FrontFr1 = string;
export type Notes1 = string | null;
export type UpdatedAt1 = string;
export type BackEs2 = string;
export type ExampleEs2 = string | null;
export type ExampleFr2 = string | null;
export type FrontFr2 = string;
export type Notes2 = string | null;
export type Audio1 = AudioClip[];
export type AudioPending2 = AudioPending1[];
export type BackEs3 = string;
export type EditedByHuman = boolean;
export type ExampleEs3 = string | null;
export type ExampleFr3 = string | null;
export type FrontFr3 = string;
export type Id10 = string;
export type Ipa1 = string | null;
export type Kind4 = 'vocab' | 'phrase' | 'grammar' | 'conjugation' | 'drill';
export type Notes3 = string | null;
export type Owner = 'shared' | 'mine';
export type Phonemes2 = string[];
export type SourceChanged = boolean;
export type SourceItemIds1 = string[];
export type Stale1 = boolean;
export type CardId1 = string;
export type FlaggedHard1 = boolean;
export type Difficulty = number;
export type Due = string;
export type ElapsedDays = number;
export type Lapses = number;
export type LastReview = string | null;
export type LearningSteps = number;
export type Reps = number;
export type ScheduledDays = number;
export type Stability = number;
export type State = 0 | 1 | 2 | 3;
export type Suspended1 = boolean;
export type UpdatedAt2 = string;
export type Tags1 = string[];
export type Cards1 = CardView[];
export type NextCursor = string | null;
export type CurrentPassword = string;
export type NewPassword = string;
export type Question = string;
export type BlockId = number;
export type ItemId2 = string;
export type Page = number | null;
export type Snippet = string;
export type Source = string;
export type Code1 = string | null;
export type Kind5 = 'meta' | 'token' | 'citation' | 'done' | 'error';
export type MessageId = number | null;
export type Text1 = string | null;
export type Citations = Citation[];
export type Content = string;
export type CreatedAt2 = string;
export type Id11 = number;
export type Role = 'user' | 'assistant';
export type Status2 = 'ok' | 'no_material' | 'error' | 'partial';
export type Messages = ChatMessageOut[];
export type CreatedAt3 = string;
export type Id12 = string;
export type Title4 = string;
export type UpdatedAt3 = string;
export type Note = string | null;
export type Role1 = 'admin' | 'user';
export type TtlHours = number | null;
export type Day = string;
export type QuizAttempts = number;
export type Reviews = number;
/**
 * @minItems 1
 * @maxItems 64
 */
export type VoiceIds = [string, ...string[]];
export type DbOk = boolean;
export type SchemaVersion1 = number;
export type Status3 = 'ok' | 'degraded';
export type Version = string;
export type WorkerSeenAt = string | null;
export type Token1 = string;
export type CreatedAt4 = string;
export type ExpiresAt = string;
export type Id13 = string;
export type Note1 = string | null;
export type RevokedAt = string | null;
export type Role2 = 'admin' | 'user';
export type UsedAt = string | null;
export type Url4 = string;
export type ExpiresAt1 = string | null;
export type Valid = boolean;
export type AlternateLink1 = string | null;
export type Attachments1 = AttachmentView[];
export type CardIds2 = string[];
export type CourseId2 = string;
export type CreatedAt5 = string;
export type DueAt1 = string | null;
export type FirstSeenAt1 = string;
export type HasSheet1 = boolean;
export type Id14 = string;
export type Kind6 = 'coursework' | 'material' | 'announcement';
export type NAttachments = number;
export type NCards = number;
export type TextLang1 = 'fr' | 'es' | 'en' | 'mixed' | 'unknown';
export type Title5 = string | null;
export type TopicId1 = string | null;
export type UpdatedAt4 = string;
export type Text2 = string;
export type Items1 = ItemSummary[];
export type NextCursor1 = string | null;
export type Attempts = number;
export type CreatedAt6 = string;
export type FinishedAt = string | null;
export type Id15 = number;
export type Kind7 =
  | 'pipeline.daily'
  | 'pipeline.reconcile'
  | 'auth.check'
  | 'index.text_blocks'
  | 'llm.sheet'
  | 'llm.topics'
  | 'llm.quiz'
  | 'plan.daily'
  | 'cards.regenerate_item'
  | 'audio.regenerate';
export type LastError = string | null;
export type MaxAttempts = number;
export type RunAfter = string;
export type State1 = 'queued' | 'running' | 'done' | 'failed';
export type UpdatedAt5 = string;
export type Email1 = string;
export type Password1 = string;
export type CsrfToken = string;
export type CreatedAt7 = string;
export type Disabled = boolean;
export type DisplayName1 = string;
export type Email2 = string;
export type Id16 = string;
export type LastLoginAt = string | null;
export type Role3 = 'admin' | 'user';
export type BackEs4 = string;
export type ExampleEs4 = string | null;
export type ExampleFr4 = string | null;
export type FrontFr4 = string;
export type Kind8 = 'vocab' | 'phrase' | 'grammar' | 'conjugation';
export type Notes4 = string | null;
export type Kind9 = 'pipeline.daily' | 'pipeline.reconcile';
export type FinishedAt1 = string | null;
export type Id17 = number;
export type Stage = string;
export type StartedAt = string;
export type Status4 = string | null;
export type LastRuns = RunOut[];
export type NextDailyAt = string;
export type NextReconcileAt = string;
export type RecentFailed = JobOut[];
export type WorkerSeenAt1 = string | null;
export type Done = boolean;
export type Kind10 = 'review' | 'quiz' | 'read' | 'drill';
export type Position = number;
export type ReasonEs = string;
export type RefId = string | null;
export type TitleEs1 = string;
export type WhyLlmEs = string | null;
export type Text3 = string;
export type VoiceId3 = string;
export type CacheKey = string;
export type DurationMs2 = number | null;
export type Status5 = 'done';
export type Text4 = string;
export type Url5 = string;
export type VoiceId4 = string;
export type Id18 = string;
export type Kind11 = 'mcq' | 'cloze' | 'translate' | 'order' | 'dictation';
export type Options = string[];
export type PromptEs = string;
export type PromptFr = string | null;
export type SourceItemId = string | null;
export type Id19 = string;
export type Questions = Question1[];
export type ScopeId = string;
export type ScopeKind = 'topic' | 'item';
export type Stale2 = boolean;
export type TitleEs2 = string;
/**
 * @minItems 1
 * @maxItems 100
 */
export type Answers = [AnswerIn, ...AnswerIn[]];
export type StartedAt1 = string;
export type AttemptId = number;
export type FinishedAt2 = string;
export type QuizId = string;
export type Score = number;
export type StartedAt2 = string;
export type AttemptId1 = number;
export type Results = AnswerResult[];
export type Score1 = number;
export type Attempts1 = number;
export type BestScore = number;
export type LastAt = string;
export type QuizId1 = string;
export type TitleEs3 = string;
export type CardId2 = string;
export type Rating = 1 | 2 | 3 | 4;
export type ReviewedAt = string;
export type BlockId1 = number;
export type ItemId3 = string;
export type Page1 = number | null;
export type Score2 = number;
export type Snippet1 = string;
export type Source1 = string;
export type ExpiresAt2 = string;
export type Locale1 = 'fr-FR';
export type Region1 = string;
export type Token2 = string;
export type Day1 = string;
export type Entries = PlanEntry[];
export type GeneratedAt1 = string;
export type Kind12 =
  'index.text_blocks' | 'llm.sheet' | 'llm.topics' | 'llm.quiz' | 'plan.daily';
export type ScopeId1 = string | null;
export type ScopeKind1 = ('topic' | 'item') | null;
export type LastPlanAt = string | null;
export type LastTopicsAt = string | null;
export type LlmCallsCap = number;
export type LlmCallsToday = number;
export type LlmEnabled = boolean;
export type CardCount = number;
export type Cefr = ('A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2') | null;
export type CourseId3 = string;
export type DescriptionEs = string;
export type EditedByHuman1 = boolean;
export type Id20 = string;
export type ItemIds = string[];
export type Position1 = number;
export type SourceChanged1 = boolean;
export type Title6 = string;
/**
 * @minItems 1
 * @maxItems 200
 */
export type ItemIds1 = [string, ...string[]];
export type CardsLearned = number;
export type CardsTotal = number;
export type LastQuizScore = number | null;
export type TopicId2 = string;
/**
 * @minItems 1
 * @maxItems 200
 */
export type ItemIds2 = [string, ...string[]];
export type Title7 = string;
export type DescriptionEs1 = string | null;
export type Title8 = string | null;
export type Title9 = string;
/**
 * @minItems 2
 * @maxItems 20
 */
export type TopicIds =
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string]
  | [string, string, string, string, string, string, string, string, string]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  | [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
export type Cap = number | null;
export type Meter = string;
export type Period = 'day' | 'month';
export type Used = number;
export type DailyNewCards = number;
export type PreferredVoiceIds = string[];
export type Theme = 'system' | 'light' | 'dark';
export type CardsLearned1 = number;
export type DueNow = number;
/**
 * @maxItems 5
 */
export type QuizBest1 =
  | []
  | [QuizBest]
  | [QuizBest, QuizBest]
  | [QuizBest, QuizBest, QuizBest]
  | [QuizBest, QuizBest, QuizBest, QuizBest]
  | [QuizBest, QuizBest, QuizBest, QuizBest, QuizBest];
export type Retention30D = number | null;
export type ReviewsToday = number;
export type StreakDays = number;
/**
 * @minItems 7
 * @maxItems 7
 */
export type Week = [
  DayCount,
  DayCount,
  DayCount,
  DayCount,
  DayCount,
  DayCount,
  DayCount,
];

export interface FrancesContracts {
  content_index?: ContentIndex;
  bundle_manifest?: BundleManifest;
  pron_result?: PronResult;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ContentIndex".
 */
export interface ContentIndex {
  attachments: Attachments;
  cards: Cards;
  courses: Courses;
  drills: Drills;
  generated_at: GeneratedAt;
  items: Items;
  schema_version: SchemaVersion;
  sheets: Sheets;
  speech: SpeechCredentials | null;
  topics: Topics;
  voices: Voices;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AttachmentOut".
 */
export interface AttachmentOut {
  file: FileRef | null;
  id: Id1;
  item_id: ItemId;
  kind: Kind;
  mime_type: MimeType;
  status: Status;
  title: Title;
  url: Url;
  view_pdf: FileRef | null;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "FileRef".
 */
export interface FileRef {
  id: Id;
  mime: Mime;
  sha256: Sha256;
  size: Size;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CardOut".
 */
export interface CardOut {
  audio: Audio;
  audio_pending: AudioPending;
  back_es: BackEs;
  example_es: ExampleEs;
  example_fr: ExampleFr;
  front_fr: FrontFr;
  id: Id2;
  ipa: Ipa;
  kind: Kind1;
  notes: Notes;
  phonemes: Phonemes;
  source_item_ids: SourceItemIds;
  stale: Stale;
  tags: Tags;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AudioRef".
 */
export interface AudioRef {
  field: Field;
  file: FileRef;
  voice_id: VoiceId;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AudioPending".
 */
export interface AudioPending1 {
  field: Field1;
  voice_id: VoiceId1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CourseOut".
 */
export interface CourseOut {
  id: Id3;
  name: Name;
  section: Section;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "DrillDeck".
 */
export interface DrillDeck {
  card_ids: CardIds;
  curated: Curated;
  id: Id4;
  phoneme: Phoneme;
  title_es: TitleEs;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ItemOut".
 */
export interface ItemOut {
  alternate_link: AlternateLink;
  attachment_ids: AttachmentIds;
  card_ids: CardIds1;
  course_id: CourseId;
  created_at: CreatedAt;
  due_at: DueAt;
  first_seen_at: FirstSeenAt;
  has_sheet: HasSheet;
  id: Id5;
  kind: Kind2;
  text: Text;
  text_lang: TextLang;
  title: Title1;
  topic_id: TopicId;
  updated_at: UpdatedAt;
}
/**
 * Ficha de estudio. Los campos v2 (CHG-06) tienen default: las fichas v1 validan.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "StudySheet".
 */
export interface StudySheet {
  common_mistakes?: CommonMistakes;
  grammar: Grammar;
  item_id: ItemId1;
  key_phrases: KeyPhrases;
  objectives_es?: ObjectivesEs;
  prompt_version?: PromptVersion;
  summary_es: SummaryEs;
  vocab_card_ids: VocabCardIds;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CommonMistake".
 */
export interface CommonMistake {
  right_fr: RightFr;
  why_es: WhyEs;
  wrong_fr: WrongFr;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "GrammarPoint".
 */
export interface GrammarPoint {
  examples: Examples;
  explanation_es: ExplanationEs;
  title: Title2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "Example".
 */
export interface Example {
  es: Es;
  fr: Fr;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "SpeechCredentials".
 */
export interface SpeechCredentials {
  key: Key;
  locale?: Locale;
  region: Region;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "TopicOut".
 */
export interface TopicOut {
  course_id: CourseId1;
  id: Id6;
  name: Name1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "VoiceOut".
 */
export interface VoiceOut {
  accent: Accent;
  age: Age;
  gender: Gender;
  id: Id7;
  label: Label;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "BundleManifest".
 */
export interface BundleManifest {
  check: Check;
  created_at: CreatedAt1;
  format: Format;
  index: FileRef;
  kdf: KdfParams;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "KdfParams".
 */
export interface KdfParams {
  hash: Hash;
  iterations: Iterations;
  name: Name2;
  salt: Salt;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PronResult".
 */
export interface PronResult {
  at: At;
  card_id: CardId;
  duration_ms: DurationMs;
  id: Id8;
  recognized_text: RecognizedText;
  reference_text: ReferenceText;
  scores: PronScores;
  words: Words;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PronScores".
 */
export interface PronScores {
  accuracy: Accuracy;
  completeness: Completeness;
  fluency: Fluency;
  pron: Pron;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "WordScore".
 */
export interface WordScore {
  accuracy: Accuracy1;
  error_type: ErrorType;
  phonemes: Phonemes1;
  word: Word;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PhonemeScore".
 */
export interface PhonemeScore {
  accuracy: Accuracy2;
  phoneme: Phoneme1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AcceptInviteRequest".
 */
export interface AcceptInviteRequest {
  display_name: DisplayName;
  email: Email;
  password: Password;
  token: Token;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AnswerIn".
 */
export interface AnswerIn {
  answer: Answer;
  question_id: QuestionId;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AnswerResult".
 */
export interface AnswerResult {
  correct: Correct;
  expected: Expected;
  explanation_es: ExplanationEs1;
  question_id: QuestionId1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ApiError".
 */
export interface ApiError {
  code: Code;
  message_es: MessageEs;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AttachmentView".
 */
export interface AttachmentView {
  file: FileLink | null;
  id: Id9;
  kind: Kind3;
  mime_type: MimeType1;
  status: Status1;
  title: Title3;
  url: Url2;
  view_pdf: FileLink | null;
}
/**
 * ``url`` relativa: /api/files/<sha256>.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "FileLink".
 */
export interface FileLink {
  mime: Mime1;
  sha256: Sha2561;
  size: Size1;
  url: Url1;
}
/**
 * ``url`` relativa: /api/audio/<cache_key>.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "AudioClip".
 */
export interface AudioClip {
  duration_ms: DurationMs1;
  field: Field2;
  url: Url3;
  voice_id: VoiceId2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CardFlagsIn".
 */
export interface CardFlagsIn {
  flagged_hard?: FlaggedHard;
  suspended?: Suspended;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CardOverride".
 */
export interface CardOverride {
  back_es: BackEs1;
  base_updated_at: BaseUpdatedAt;
  example_es: ExampleEs1;
  example_fr: ExampleFr1;
  front_fr: FrontFr1;
  notes: Notes1;
  updated_at: UpdatedAt1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CardOverrideIn".
 */
export interface CardOverrideIn {
  back_es: BackEs2;
  example_es?: ExampleEs2;
  example_fr?: ExampleFr2;
  front_fr: FrontFr2;
  notes?: Notes2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CardPage".
 */
export interface CardPage {
  cards: Cards1;
  next_cursor: NextCursor;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CardView".
 */
export interface CardView {
  audio: Audio1;
  audio_pending: AudioPending2;
  back_es: BackEs3;
  edited_by_human: EditedByHuman;
  example_es: ExampleEs3;
  example_fr: ExampleFr3;
  front_fr: FrontFr3;
  id: Id10;
  ipa: Ipa1;
  kind: Kind4;
  mine: CardOverride | null;
  notes: Notes3;
  owner: Owner;
  phonemes: Phonemes2;
  source_changed: SourceChanged;
  source_item_ids: SourceItemIds1;
  stale: Stale1;
  state: UserCardStateOut | null;
  tags: Tags1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "UserCardStateOut".
 */
export interface UserCardStateOut {
  card_id: CardId1;
  flagged_hard: FlaggedHard1;
  fsrs: FsrsCard;
  suspended: Suspended1;
  updated_at: UpdatedAt2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "FsrsCard".
 */
export interface FsrsCard {
  difficulty: Difficulty;
  due: Due;
  elapsed_days: ElapsedDays;
  lapses: Lapses;
  last_review: LastReview;
  learning_steps: LearningSteps;
  reps: Reps;
  scheduled_days: ScheduledDays;
  stability: Stability;
  state: State;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ChangePasswordRequest".
 */
export interface ChangePasswordRequest {
  current_password: CurrentPassword;
  new_password: NewPassword;
}
/**
 * ``question``: 1…2000 caracteres tras ``strip()`` (se guarda sin espacios de borde).
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ChatAskIn".
 */
export interface ChatAskIn {
  question: Question;
}
/**
 * Cada evento SSE del chat (``event`` = ``kind``).
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ChatEvent".
 */
export interface ChatEvent {
  citation?: Citation | null;
  code?: Code1;
  kind: Kind5;
  message_id?: MessageId;
  text?: Text1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "Citation".
 */
export interface Citation {
  block_id: BlockId;
  item_id: ItemId2;
  page: Page;
  snippet: Snippet;
  source: Source;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ChatMessageOut".
 */
export interface ChatMessageOut {
  citations: Citations;
  content: Content;
  created_at: CreatedAt2;
  id: Id11;
  role: Role;
  status: Status2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ChatThreadDetail".
 */
export interface ChatThreadDetail {
  messages: Messages;
  thread: ChatThreadOut;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ChatThreadOut".
 */
export interface ChatThreadOut {
  created_at: CreatedAt3;
  id: Id12;
  title: Title4;
  updated_at: UpdatedAt3;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "CreateInviteRequest".
 */
export interface CreateInviteRequest {
  note?: Note;
  role?: Role1;
  ttl_hours?: TtlHours;
}
/**
 * ``day`` = YYYY-MM-DD en Bogotá.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "DayCount".
 */
export interface DayCount {
  day: Day;
  quiz_attempts: QuizAttempts;
  reviews: Reviews;
}
/**
 * Voces por defecto del audio (``PUT /api/admin/voices/default``).
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "DefaultVoicesIn".
 */
export interface DefaultVoicesIn {
  voice_ids: VoiceIds;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "Health".
 */
export interface Health {
  db_ok: DbOk;
  schema_version: SchemaVersion1;
  status: Status3;
  version: Version;
  worker_seen_at: WorkerSeenAt;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "InviteCheckRequest".
 */
export interface InviteCheckRequest {
  token: Token1;
}
/**
 * ``url`` = f"{FRANCES_PUBLIC_ORIGIN}/invitacion#{token}"; el token solo se muestra aquí.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "InviteCreated".
 */
export interface InviteCreated {
  invite: InviteOut;
  url: Url4;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "InviteOut".
 */
export interface InviteOut {
  created_at: CreatedAt4;
  expires_at: ExpiresAt;
  id: Id13;
  note: Note1;
  revoked_at: RevokedAt;
  role: Role2;
  used_at: UsedAt;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "InviteStatus".
 */
export interface InviteStatus {
  expires_at: ExpiresAt1;
  valid: Valid;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ItemDetail".
 */
export interface ItemDetail {
  alternate_link: AlternateLink1;
  attachments: Attachments1;
  card_ids: CardIds2;
  item: ItemSummary;
  sheet: StudySheet | null;
  text: Text2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ItemSummary".
 */
export interface ItemSummary {
  course_id: CourseId2;
  created_at: CreatedAt5;
  due_at: DueAt1;
  first_seen_at: FirstSeenAt1;
  has_sheet: HasSheet1;
  id: Id14;
  kind: Kind6;
  n_attachments: NAttachments;
  n_cards: NCards;
  text_lang: TextLang1;
  title: Title5;
  topic_id: TopicId1;
  updated_at: UpdatedAt4;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ItemPage".
 */
export interface ItemPage {
  items: Items1;
  next_cursor: NextCursor1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "JobOut".
 */
export interface JobOut {
  attempts: Attempts;
  created_at: CreatedAt6;
  finished_at: FinishedAt;
  id: Id15;
  kind: Kind7;
  last_error: LastError;
  max_attempts: MaxAttempts;
  run_after: RunAfter;
  state: State1;
  updated_at: UpdatedAt5;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "LoginRequest".
 */
export interface LoginRequest {
  email: Email1;
  password: Password1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "Me".
 */
export interface Me {
  csrf_token: CsrfToken;
  user: UserOut;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "UserOut".
 */
export interface UserOut {
  created_at: CreatedAt7;
  disabled: Disabled;
  display_name: DisplayName1;
  email: Email2;
  id: Id16;
  last_login_at: LastLoginAt;
  role: Role3;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "OwnCardIn".
 */
export interface OwnCardIn {
  back_es: BackEs4;
  example_es?: ExampleEs4;
  example_fr?: ExampleFr4;
  front_fr: FrontFr4;
  kind: Kind8;
  notes?: Notes4;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PipelineRunRequest".
 */
export interface PipelineRunRequest {
  kind: Kind9;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PipelineStatus".
 */
export interface PipelineStatus {
  jobs: Jobs;
  last_backup: RunOut | null;
  last_runs: LastRuns;
  next_daily_at: NextDailyAt;
  next_reconcile_at: NextReconcileAt;
  recent_failed: RecentFailed;
  worker_seen_at: WorkerSeenAt1;
}
export interface Jobs {
  [k: string]: number;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "RunOut".
 */
export interface RunOut {
  counts: Counts;
  finished_at: FinishedAt1;
  id: Id17;
  stage: Stage;
  started_at: StartedAt;
  status: Status4;
}
export interface Counts {
  [k: string]: number;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PlanEntry".
 */
export interface PlanEntry {
  done: Done;
  kind: Kind10;
  position: Position;
  reason_es: ReasonEs;
  ref_id: RefId;
  title_es: TitleEs1;
  why_llm_es: WhyLlmEs;
}
/**
 * Texto libre del usuario y la voz con la que quiere oírlo.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PracticeTtsIn".
 */
export interface PracticeTtsIn {
  text: Text3;
  voice_id: VoiceId3;
}
/**
 * Clip listo del texto normalizado; ``url`` se sirve con ``GET /api/audio/{key}``.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "PracticeTtsOut".
 */
export interface PracticeTtsOut {
  cache_key: CacheKey;
  duration_ms: DurationMs2;
  status: Status5;
  text: Text4;
  url: Url5;
  voice_id: VoiceId4;
}
/**
 * Pregunta de salida. La respuesta NO viaja al cliente: no hay campo para ella.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "Question".
 */
export interface Question1 {
  audio: AudioClip | null;
  id: Id18;
  kind: Kind11;
  options: Options;
  prompt_es: PromptEs;
  prompt_fr: PromptFr;
  source_item_id: SourceItemId;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "Quiz".
 */
export interface Quiz {
  id: Id19;
  questions: Questions;
  scope_id: ScopeId;
  scope_kind: ScopeKind;
  stale: Stale2;
  title_es: TitleEs2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "QuizAttemptIn".
 */
export interface QuizAttemptIn {
  answers: Answers;
  started_at: StartedAt1;
}
/**
 * Intento anterior del usuario. No incluye respuestas ni texto de otro usuario.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "QuizAttemptOut".
 */
export interface QuizAttemptOut {
  attempt_id: AttemptId;
  finished_at: FinishedAt2;
  quiz_id: QuizId;
  score: Score;
  started_at: StartedAt2;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "QuizAttemptResult".
 */
export interface QuizAttemptResult {
  attempt_id: AttemptId1;
  results: Results;
  score: Score1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "QuizBest".
 */
export interface QuizBest {
  attempts: Attempts1;
  best_score: BestScore;
  last_at: LastAt;
  quiz_id: QuizId1;
  title_es: TitleEs3;
}
/**
 * Repaso calculado en el cliente con ts-fsrs; el servidor valida que sea posible (R-38).
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "ReviewIn".
 */
export interface ReviewIn {
  card_id: CardId2;
  next: FsrsCard;
  rating: Rating;
  reviewed_at: ReviewedAt;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "SearchHit".
 */
export interface SearchHit {
  block_id: BlockId1;
  item_id: ItemId3;
  page: Page1;
  score: Score2;
  snippet: Snippet1;
  source: Source1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "SpeechToken".
 */
export interface SpeechToken {
  expires_at: ExpiresAt2;
  locale?: Locale1;
  region: Region1;
  token: Token2;
}
/**
 * ``day`` = YYYY-MM-DD en Bogotá.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "StudyPlanDay".
 */
export interface StudyPlanDay {
  day: Day1;
  entries: Entries;
  generated_at: GeneratedAt1;
}
/**
 * ``scope_kind`` y ``scope_id`` solo con ``kind == "llm.quiz"``, y van juntos.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "StudyRunRequest".
 */
export interface StudyRunRequest {
  kind: Kind12;
  scope_id?: ScopeId1;
  scope_kind?: ScopeKind1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "StudyStatus".
 */
export interface StudyStatus {
  last_plan_at: LastPlanAt;
  last_topics_at: LastTopicsAt;
  llm_calls_cap: LlmCallsCap;
  llm_calls_today: LlmCallsToday;
  llm_enabled: LlmEnabled;
  pending: Pending;
}
export interface Pending {
  [k: string]: number;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "StudyTopic".
 */
export interface StudyTopic {
  card_count: CardCount;
  cefr: Cefr;
  course_id: CourseId3;
  description_es: DescriptionEs;
  edited_by_human: EditedByHuman1;
  id: Id20;
  item_ids: ItemIds;
  position: Position1;
  source_changed: SourceChanged1;
  title: Title6;
}
/**
 * Publicaciones que se mueven a otro tema.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "TopicItemsIn".
 */
export interface TopicItemsIn {
  item_ids: ItemIds1;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "TopicProgress".
 */
export interface TopicProgress {
  cards_learned: CardsLearned;
  cards_total: CardsTotal;
  last_quiz_score: LastQuizScore;
  topic_id: TopicId2;
}
/**
 * División de un tema: publicaciones que pasan al tema nuevo.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "TopicSplitIn".
 */
export interface TopicSplitIn {
  item_ids: ItemIds2;
  title: Title7;
}
/**
 * Cambios de un tema editable; al menos ``title`` o ``description_es``.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "TopicUpdateIn".
 */
export interface TopicUpdateIn {
  description_es?: DescriptionEs1;
  title?: Title8;
}
/**
 * Unión de temas; el primer id de ``topic_ids`` es el superviviente.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "TopicsMergeIn".
 */
export interface TopicsMergeIn {
  title: Title9;
  topic_ids: TopicIds;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "UsageLineOut".
 */
export interface UsageLineOut {
  cap: Cap;
  meter: Meter;
  period: Period;
  used: Used;
}
/**
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "UserPrefs".
 */
export interface UserPrefs {
  daily_new_cards?: DailyNewCards;
  preferred_voice_ids?: PreferredVoiceIds;
  theme?: Theme;
}
/**
 * ``retention_30d`` es None si hay menos de 10 reseñas con estado previo 2 en 30 días.
 *
 * ``week`` tiene 7 entradas, de lunes a domingo de la semana actual (Bogotá).
 * ``quiz_best`` tiene hasta 5 entradas, ordenadas por ``last_at`` descendente.
 *
 * This interface was referenced by `FrancesContracts`'s JSON-Schema
 * via the `definition` "UserStats".
 */
export interface UserStats {
  cards_learned: CardsLearned1;
  due_now: DueNow;
  quiz_best: QuizBest1;
  retention_30d: Retention30D;
  reviews_today: ReviewsToday;
  streak_days: StreakDays;
  week: Week;
}
