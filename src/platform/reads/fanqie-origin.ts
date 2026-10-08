export const FANQIE_ORIGIN = 'https://fanqienovel.com';

export const SHORT_WORKS_URL = `${FANQIE_ORIGIN}/main/writer/short-manage`;

export const SHORT_METRICS_URL = `${FANQIE_ORIGIN}/main/writer/short-data?tab=2`;

export const LONG_WORKS_URL = `${FANQIE_ORIGIN}/main/writer/book-manage`;

export const LONG_METRICS_URL = `${FANQIE_ORIGIN}/main/writer/data`;

export type DatasetStatus = 'success' | 'partial' | 'login_required' | 'capability_unavailable';

export interface DatasetError {
  code: string;
  scope: string;
  page?: number;
  workId?: string;
}

export interface DatasetCoverage {
  complete: boolean;
  paginationComplete: boolean;
  pagesFetched: number;
  pagesDiscovered: number | null;
  recordsFetched: number;
  totalRecords: number | null;
  fields: string[];
}

/** Fixed, value-free event facts from one service-owned volume refresh window. Never coverage proof. */
export interface ChapterVolumeRefreshEvent {
  event: 'request' | 'response';
  method: 'GET' | 'POST' | 'other';
  resourceType: 'xhr' | 'fetch' | 'document' | 'other';
  frame: 'main_frame' | 'other_frame' | 'unavailable';
  query: {
    knownKeys: string[];
    opaqueKeyCount: number;
    duplicateKeys: boolean;
    identityFilter: boolean;
    parentBinding:
      'current_work' | 'other_work' | 'missing_work' | 'ambiguous_work' | 'invalid_work';
  };
  exactUrl: boolean;
  requestEpoch: 'current_refresh' | 'other_generation' | 'unobserved';
  refreshEpochCurrent: boolean;
  samePage: boolean;
  activeSlot: boolean;
  pageOpen: boolean;
  sessionOpen: boolean;
  signalAborted: boolean;
  strictSourceMatch: boolean;
  status: number | null;
}

export interface ChapterVolumeRefreshDiagnostic {
  kind: 'chapter_volume_refresh';
  outcome: 'verified' | 'unverified';
  observedEvents: { requests: number; responses: number };
  candidateEvents: { requests: number; responses: number };
  events: ChapterVolumeRefreshEvent[];
  truncated: boolean;
  fetchResult: 'not_completed' | 'http_success' | 'http_failure';
  proof: {
    requestObserved: boolean;
    requestAmbiguous: boolean;
    templateChanged: boolean;
    responseStatusMatched: boolean;
  };
}

export type CurrentChapterObservedReason =
  | 'identity_unverified'
  | 'target_owner_mismatch'
  | 'document_changed'
  | 'shell_unready'
  | 'template_missing'
  | 'template_ambiguous'
  | 'context_unavailable'
  | 'transport_failed'
  | 'http_failed'
  | 'response_url_changed'
  | 'json_unavailable'
  | 'code_not_zero'
  | 'owner_changed'
  | 'response_disposal_failed'
  | 'bootstrap_request_blocked'
  | 'unknown'
  | null;

export type CurrentChapterRejectedCheckSite =
  | 'bootstrap_event_bound'
  | 'cdp_close'
  | 'commit_controlled'
  | 'commit_frame'
  | 'commit_route'
  | 'commit_uncontrolled'
  | 'deferred_events'
  | 'detach_cleanup'
  | 'document_base'
  | 'document_state'
  | 'final_barrier'
  | 'frame_detach'
  | 'freeze_checks'
  | 'initial_checks'
  | 'initialization_callback'
  | 'public_commit_frame'
  | 'public_request_callback'
  | 'public_request_frame'
  | 'public_request_route'
  | 'source_request_id'
  | 'start_base'
  | 'start_frame'
  | 'start_new_document'
  | 'start_same_document'
  | 'within_base'
  | 'within_event_bound'
  | 'within_frame'
  | 'within_frozen';

export type CurrentChapterRejectedCheckPredicate =
  | 'already_committed'
  | 'callback_exception'
  | 'detach_failed'
  | 'disconnected'
  | 'duplicate_request_id'
  | 'event_limit'
  | 'event_url_changed'
  | 'fragment_present'
  | 'frame_missing'
  | 'frame_unavailable'
  | 'frozen'
  | 'frozen_generation_changed'
  | 'frozen_loader_changed'
  | 'guard_failed'
  | 'inactive'
  | 'loader_mismatch'
  | 'loader_missing'
  | 'no_pending_new_document'
  | 'other_root_without_parent'
  | 'page_url_changed'
  | 'parent_present'
  | 'pending_loader_mismatch'
  | 'pending_loader_missing'
  | 'pending_new_document'
  | 'pending_same_document'
  | 'prior_violation'
  | 'redirect_observed'
  | 'root_detached'
  | 'route_not_permitted'
  | 'uncommitted'
  | 'uncontrolled'
  | 'unexpected_close'
  | 'unknown_navigation_type'
  | 'unpaired_completion';

/** Fixed bootstrap observations only. Null checks were not evaluated by the original short-circuit guard. */
export interface CurrentChapterCanonicalBootstrapDiagnostic {
  /** First actual canonical fault only; fixed classification is not a root cause. */
  firstCdpFaultCheck: {
    site: CurrentChapterRejectedCheckSite;
    predicate: CurrentChapterRejectedCheckPredicate;
  } | null;
  subphase:
    | 'context_binding'
    | 'cdp_attach'
    | 'page_enable'
    | 'network_enable'
    | 'initial_frame_tree'
    | 'initial_checks'
    | 'initial_events'
    | 'controlled_goto'
    | 'network_idle'
    | 'abort_drain'
    | 'bootstrap_gate'
    | 'writer_ready'
    | 'freeze_frame_tree'
    | 'freeze_checks'
    | 'freeze_commit';
  cdp: {
    failure:
      | 'unavailable'
      | 'initialization_failed'
      | 'source_unverified'
      | 'disconnected'
      | 'cleanup_failed'
      | 'unknown'
      | null;
    initialized: boolean;
    rootFrameObserved: boolean;
    committedLoaderObserved: boolean;
  };
  firstViolation: {
    phase: 'bootstrap' | 'frozen' | 'cleanup' | 'unknown';
    reason:
      | 'frozen_navigation_request'
      | 'frozen_commit'
      | 'unpaired_commit'
      | 'invalid_commit_url'
      | 'route_not_permitted'
      | 'fatal_blocked_request'
      | 'abort_failed'
      | 'cdp_source_unverified'
      | 'cdp_disconnected'
      | 'cdp_cleanup_failed'
      | 'unknown';
  } | null;
  initialChecks: {
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
  freezeChecks: {
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

export type CurrentChapterSourceFamily = 'volume' | 'book' | 'chapter';

export type CurrentChapterSourceClearReason =
  | 'new_document_start'
  | 'new_document_request'
  | 'new_document_commit'
  | 'cdp_fault'
  | 'frozen_public_request'
  | 'cleanup';

export type CurrentChapterSourceOutcome =
  | 'state_filtered'
  | 'request_filtered'
  | 'duplicate_request_id'
  | 'redirected'
  | 'url_filtered'
  | 'url_parse_failed'
  | 'retained_add_attempt'
  | 'capacity_limit';

export interface CurrentChapterSourceCounts {
  volume: number;
  book: number;
  chapter: number;
}

/** Private plain-string hints and actual original branch outcomes, never accepted-source proof. */
export interface CurrentChapterSourceRequestObservation {
  kind: 'request';
  phase: 'bootstrap' | 'frozen' | 'cleanup';
  familyHint: CurrentChapterSourceFamily;
  outcome: CurrentChapterSourceOutcome;
  method: 'get' | 'other' | 'unavailable';
  resource: 'xhr_fetch' | 'other' | 'unavailable';
  frame: 'root' | 'other' | 'unavailable';
  loader: 'current' | 'pending' | 'other' | 'unavailable';
  state: {
    pendingNewDocument: boolean;
    pendingSameDocument: boolean;
    committed: boolean;
    frozen: boolean;
    violated: boolean;
    controlled: boolean;
  };
  filters: {
    origin: 'platform' | 'external';
    credentialsPresent: boolean;
    fragmentPresent: boolean;
    duplicateQueryKeys: boolean;
    parentBinding: 'current_work' | 'other_work' | 'missing_work' | 'ambiguous_work';
    identityFilter: boolean;
  };
}

export interface CurrentChapterSourceClearObservation {
  kind: 'clear';
  phase: 'bootstrap' | 'frozen' | 'cleanup';
  reason: CurrentChapterSourceClearReason;
  removed: CurrentChapterSourceCounts;
}

/** Failure-origin snapshot only; counters saturate at 100 and entries at 32. */
export interface CurrentChapterSourceObservation {
  count: number;
  truncated: boolean;
  unclassifiedRequests: number;
  retainedAttempts: CurrentChapterSourceCounts;
  currentSizes: CurrentChapterSourceCounts;
  clearCounts: Record<CurrentChapterSourceClearReason, number>;
  removedTotals: CurrentChapterSourceCounts;
  events: Array<CurrentChapterSourceRequestObservation | CurrentChapterSourceClearObservation>;
}
