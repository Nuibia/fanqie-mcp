import { type ShortResolvedState, type ShortStatusFactsV1 } from '../short-status.js';

import { type Page } from 'playwright';

import { createHash } from 'node:crypto';

export type PlatformState = 'draft' | 'reviewing' | 'submitted' | 'published' | 'rejected';

export type WriteCapability =
  | 'create_draft'
  | 'update_draft'
  | 'update_work_metadata'
  | 'save_chapter_draft'
  | 'prepare_submission'
  | 'submit_short_story'
  | 'publish_chapter';

export interface WriteTarget {
  kind: 'short' | 'chapter';
  workId: string;
  chapterId?: string;
}

export type Selector =
  | { css: string }
  | { role: 'button' | 'textbox' | 'checkbox' | 'radio' | 'combobox'; name: string }
  | { label: string }
  | { placeholder: string };

export interface ReadField {
  selector: Selector;
  mode?: 'text' | 'value' | 'attribute';
  attribute?: string;
}

export type FieldBinding =
  | { kind: 'text'; selector: Selector }
  | { kind: 'select'; selector: Selector; values?: Record<string, string>; multiple?: boolean }
  | { kind: 'radio'; choices: Record<string, Selector> }
  | { kind: 'checkbox'; selector: Selector; values: Record<string, boolean> }
  | { kind: 'upload'; selector: Selector; readHash: ReadField };

export interface SubmissionStep {
  button: Selector;
  /** The exact visible prompt is checked before this particular click. */
  guard: ReadField & { equals: string };
  /** Only the publication agreement may be accepted; financial/signing controls are excluded. */
  publicationAgreement?: Selector;
}

interface UiWriteProfileFields {
  id: string;
  evidenceRef: string;
  verifiedAt: string;
  kind: WriteTarget['kind'];
  editorRoute: string;
  /** Opening this route may itself create a zero-word draft. */
  newRoute?: string;
  /** Named captures workId and, for chapters, chapterId must identify the editor URL. */
  targetPattern: string;
  /** The observed short save control is enabled only after initialization/cache loading. */
  readiness?: 'short_editor_save_enabled';
  states: Record<string, PlatformState>;
  editableStates: PlatformState[];
  title: Selector;
  body: Selector;
  bodyParagraphSelector?: string;
  save: Selector;
  fields?: Partial<Record<keyof DraftMetadata, FieldBinding>>;
  submission?: {
    terms: ReadField[];
    steps: SubmissionStep[];
    acceptedStates: PlatformState[];
    preparationTtlMs?: number;
  };
}

/** DOM profiles retain a required state field; the native short source needs no invented DOM state. */
export type UiWriteProfile = UiWriteProfileFields &
  (
    | {
        identity: ReadField;
        state: ReadField;
        serverState?: undefined;
        bodyRead?: undefined;
        saveAcknowledgement?: undefined;
      }
    | {
        kind: 'short';
        identity: ReadField | { kind: 'own_account_api' };
        serverState: 'short_article_edit_v1';
        state?: ReadField;
        bodyRead?: 'short_editor_document';
        saveAcknowledgement?: 'short_article_cover_v0';
      }
  );

export interface UploadReference {
  uploadPath: string;
  sha256: string;
}

export interface DraftMetadata {
  description?: string;
  categories?: string[];
  aiDeclaration?: 'yes' | 'no';
  trialRatio?: number;
  cover?: UploadReference | string;
}

export interface DraftContent {
  title: string;
  body: string;
  metadata?: DraftMetadata;
}

export interface WriteSnapshot extends DraftContent {
  accountId: string;
  target: WriteTarget;
  state: PlatformState;
  contentHash: string;
  sourceUrl: string;
  platformReadAt: string;
}

export interface GenericShortOwnerInvocation {
  requestedAt: string;
  completedAt: string;
  checkedAt: string;
}

export interface GenericShortEditorProof {
  schema: 'fanqie-generic-short-editor-proof/v1';
  profileId: string;
  profileVerifiedAt: string;
  profileSource: 'short_article_edit_v1';
  owner: {
    kind: 'account' | 'author';
    id: string;
    before: GenericShortOwnerInvocation;
    after: GenericShortOwnerInvocation;
  };
  method: 'GET';
  endpoint: '/api/author/short_article/edit/v1/';
  requestCount: 1;
  responseCount: 1;
  mainFrame: true;
  fixedSourceVerified: true;
  routeStable: true;
  bodyBound: true;
  readStartedAt: string;
  getRequestedAt: string;
  getCompletedAt: string;
  readFinishedAt: string;
}

export interface ModernShortSnapshot extends Omit<WriteSnapshot, 'state' | 'target' | 'metadata'> {
  metadata: Record<string, never>;
  target: { kind: 'short'; workId: string };
  state: ShortResolvedState;
  statusInput: { publish_status?: unknown; display_status?: unknown };
  statusFacts: ShortStatusFactsV1;
  statusProof: GenericShortEditorProof;
}

export type DraftSnapshot = WriteSnapshot | ModernShortSnapshot;

export interface GenericShortObservation {
  schema: 'fanqie-generic-short-editor-observation/v1';
  phase: 'baseline' | 'after';
  snapshot: ModernShortSnapshot;
}

export interface WriteOptions {
  profile?: UiWriteProfile;
  /** The runtime resolves upload references into this private service directory. */
  uploadRoot?: string;
  now?: () => Date;
  timeoutMs?: number;
  /** Called again when creation discovers its complete post-save expectation. */
  beforeSideEffect?: (intent: {
    capability: WriteCapability;
    target?: WriteTarget;
    clientReference?: string;
    requestedContentHash?: string;
    expectedContentHash?: string;
    desiredContentHash?: string;
    expectedStates?: PlatformState[];
  }) => Promise<void>;
  onTargetDiscovered?: (target: WriteTarget) => Promise<void>;
  /** Writer observations only; specialized, final and standalone reads persist in App. */
  onShortObservation?: (observation: GenericShortObservation) => Promise<void>;
  /** Trusted service callback: current-context, fresh own-account observation, with no navigation. */
  identityType?: 'account' | 'author';
  verifyAccount?: (page: Page) => Promise<{
    status: 'authenticated' | 'login_required' | 'unknown';
    identity: { accountId: string | null; authorId: string | null } | null;
    sourceUrl: string;
    checkedAt: string;
  }>;
}

export interface UpdateDraftInput {
  accountId: string;
  target: WriteTarget;
  expectedContentHash: string;
  expectedState: PlatformState;
  content: DraftContent;
}

export interface CreateDraftInput {
  accountId: string;
  clientReference: string;
  content: DraftContent;
}

export interface UpdateMetadataInput extends Omit<UpdateDraftInput, 'content'> {
  metadata: DraftMetadata;
  title?: string;
}

export type SaveChapterInput = { accountId: string; workId: string; content: DraftContent } & (
  | { chapterId: string; expectedContentHash: string; expectedState: PlatformState }
  | { chapterId?: undefined; clientReference: string }
);

export interface CreateChapterInput extends CreateDraftInput {
  workId: string;
}

export interface PreparedSubmission {
  preparationId: string;
  accountId: string;
  target: WriteTarget;
  expectedContentHash: string;
  expectedState: PlatformState;
  profileHash: string;
  termsHash: string;
  terms: string[];
  title: string;
  metadata: DraftMetadata;
  preparedAt: string;
  expiresAt: string;
}

export interface SubmitInput {
  accountId: string;
  target: WriteTarget;
  expectedContentHash: string;
  expectedState: PlatformState;
  prepared: PreparedSubmission;
  acceptPublicationTerms: boolean;
}

export interface WriteResult {
  status: 'succeeded' | 'uncertain';
  capability: WriteCapability;
  target?: WriteTarget;
  contentHash?: string;
  platformState?: PlatformState;
  verifiedAt?: string;
  sourceUrl?: string;
  reason?: string;
  code?: 'outcome_unknown';
  /** Private transient markers: App authenticates and removes them before canonical persistence. */
  statusProtocol?: 'fanqie-generic-short-status/v1';
  shortObservation?: GenericShortObservation | null;
}

export class PlatformWriteError extends Error {
  constructor(
    public readonly code:
      'capability_unavailable' | 'invalid_input' | 'version_conflict' | 'requires_login',
    message: string,
  ) {
    super(message);
    this.name = 'PlatformWriteError';
  }
}

export const origin = 'https://fanqienovel.com';

export const idPattern = /^\d{10,22}$/;

export const metadataKeys = new Set([
  'description',
  'categories',
  'aiDeclaration',
  'trialRatio',
  'cover',
]);

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

/** Only line endings are normalized. Empty paragraphs and interior whitespace remain significant. */
export const normalizeBody = (body: string): string => body.replace(/\r\n?/g, '\n');

export function hashDraftContent(content: DraftContent): string {
  const metadata = { ...content.metadata };
  if (metadata.cover && typeof metadata.cover !== 'string') metadata.cover = metadata.cover.sha256;
  return sha256(canonical({ title: content.title, body: normalizeBody(content.body), metadata }));
}
