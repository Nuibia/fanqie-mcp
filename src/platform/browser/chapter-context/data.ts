import { type BrowserContext, type Page, type CDPSession } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import {
  type ReadResponseStructure,
  type DatasetResult,
  type ChapterRecord,
  type CurrentChapterCollectionFailureDiagnostic,
  type ChapterManagementCoverage,
  type ChapterManagementControlObservation,
} from '../../reads.js';

import {
  type BrowserCallOptions,
  type CurrentChapterDirectoryOptions,
  type CurrentChapterBodyRead,
} from '../contracts.js';

import {
  type ChapterVolumeContextDiagnostic,
  type ReadPageDiagnostic,
  type ContextCdpSourceSummary,
  type ContextBlockedRequests,
  type ContextNavigationTelemetry,
} from '../chapter-diagnostics.js';
import { type ChapterBodyRecord } from '../../chapter-body.js';

import { type Dependencies } from '../operations/read-current-chapter-context.js';

export interface ChapterReadData {
  page: Page;
  targetRef: string;
  options: BrowserCallOptions;
  collection:
    | {
        result: DatasetResult<ChapterRecord>;
        options: CurrentChapterDirectoryOptions;
        failureMetadata: CurrentChapterCollectionFailureDiagnostic;
        bodyRead?: CurrentChapterBodyRead;
      }
    | undefined;
  deps: Dependencies;
  slot: BrowserPageSlot | null;
  raw: string | undefined;
  target: URL;
  workId: string;
  diagnostic: ChapterVolumeContextDiagnostic;
  result: ReadPageDiagnostic;
  timeout: number;
  templates: Set<string>;
  bookTemplates: Set<string>;
  chapterTemplates: Set<string>;
  collected: { records: ChapterRecord[]; total: number } | null;
  chapterPagesFetched: number;
  managementDeadline: number;
  initialManagementQualified: boolean;
  bodyBuffer: ChapterBodyRecord | null;
  managementCoverage: ChapterManagementCoverage | null;
  managementControlObservation: ChapterManagementControlObservation | null;
  managementRequestIds: Set<string>;
  viewWindow: {
    volumeId: string;
    deadline: number;
    sources: Set<string>;
    requestIds: Set<string>;
    open: boolean;
    actionStarted: boolean;
    exhausted: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    wake: (() => void) | null;
  } | null;
  verifiedOwner: LoginState | null;
  collectionFailure: string | null;
  collectionStage:
    | 'manager_entry'
    | 'pre_context_identity'
    | 'target_owner_binding'
    | 'canonical_bootstrap'
    | 'fresh_own_before'
    | 'volume_get'
    | 'directory_read'
    | 'fresh_own_after'
    | 'owner_callback'
    | 'cleanup';
  collectionFailureStageRecorded: boolean;
  generation: number;
  pendingNavigation: boolean;
  pendingSameDocument: boolean;
  committed: boolean;
  frozen: boolean;
  violated: boolean;
  fatalBlocked: boolean;
  guarded: boolean;
  cleanup: boolean;
  cdp: CDPSession | null;
  rootFrame: string;
  loader: string;
  pendingLoader: string;
  controlledGoto: boolean;
  expectedDetach: boolean;
  bootstrapNavigationEvents: number;
  requestIds: Set<string>;
  deferredCdp: (() => void)[];
  cdpSource: ContextCdpSourceSummary;
  route: URL;
  frozenGeneration: number;
  frozenLoader: string;
  frozenUrl: string;
  response: import('../../../../node_modules/playwright/index.js').APIResponse<unknown> | undefined;
  requestContext: BrowserContext | null;
  collectionSourceWindowOpen: boolean;
  collectionSourceDeadline: number;
  collectionSourceTimer: NodeJS.Timeout | null;
  collectionSourceWake: (() => void) | null;
  sealedCollectionSources: { volume: string; book: string; chapter: string } | null;
  schema: ReadResponseStructure | null;
  blockedRequests: ContextBlockedRequests;
  pendingAborts: Set<Promise<void>>;
  pendingBodyRoutes: Set<Promise<void>>;
  blockedNonNavigation: boolean;
  initialEpoch: number;
  sourceObservation: import('../../reads.js').CurrentChapterSourceObservation;
  navigationTelemetry: ContextNavigationTelemetry;
  firstCdpFaultCheck: {
    site: import('../../reads.js').CurrentChapterRejectedCheckSite;
    predicate: import('../../reads.js').CurrentChapterRejectedCheckPredicate;
  } | null;
  rejectedCandidate: {
    site: import('../../reads.js').CurrentChapterRejectedCheckSite;
    predicate: import('../../reads.js').CurrentChapterRejectedCheckPredicate;
  } | null;
  bootstrapSubphase:
    | 'freeze_checks'
    | 'initial_checks'
    | 'context_binding'
    | 'cdp_attach'
    | 'page_enable'
    | 'network_enable'
    | 'initial_frame_tree'
    | 'initial_events'
    | 'controlled_goto'
    | 'network_idle'
    | 'abort_drain'
    | 'bootstrap_gate'
    | 'writer_ready'
    | 'freeze_frame_tree'
    | 'freeze_commit';
  bootstrapInitialChecks: {
    active: boolean | null;
    sameContext: boolean | null;
    ownedContext: boolean | null;
    currentUrlMatchesAttach: boolean | null;
    noParent: boolean | null;
    frameIdPresent: boolean | null;
    loaderIdPresent: boolean | null;
    noFragment: boolean | null;
    frameUrlMatchesAttach: boolean | null;
  };
  bootstrapFreezeChecks: {
    rootMatches: boolean | null;
    noParent: boolean | null;
    loaderMatches: boolean | null;
    loaderPresent: boolean | null;
    noFragment: boolean | null;
    frameUrlMatchesCurrent: boolean | null;
    permittedRoute: boolean | null;
    noPendingNavigation: boolean | null;
    noPendingSameDocument: boolean | null;
    noViolation: boolean | null;
    connected: boolean | null;
  };
}
