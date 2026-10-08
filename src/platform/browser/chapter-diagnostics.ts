import { type BrowserCallOptions } from './contracts.js';

import { type ReadResponseStructure } from '../reads.js';

import { type Request } from 'playwright';

export interface DiagnosticOptions extends BrowserCallOptions {
  maxElements?: number;
  maxResponses?: number;
  openChaptersForWorkId?: string;
  chapterTab?: 'drafts';
  chapterVolumeContext?: true;
  chapterVolumeOptions?: true;
}

/** An independent context transport experiment; never a mainframe source or collection proof. */
export interface ChapterVolumeContextDiagnostic {
  transport: 'browser_context_get';
  status: 'success' | 'capability_unavailable' | 'login_required';
  reason:
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
    | null;
  checkedAt: string;
  pathTemplate: '/api/author/volume/volume_list/v1';
  attempts: 0 | 1;
  responseStatus: number | null;
  checks: {
    templateObserved: boolean;
    templateUnique: boolean;
    mainFrameRequest: boolean;
    currentDocumentRequest: boolean;
    parentBound: boolean;
    sameContext: boolean;
    currentPage: boolean;
    activeSlot: boolean;
    epochStable: boolean;
    routeStable: boolean;
    sameOwnerBefore: boolean;
    sameOwnerAfter: boolean;
    exactResponseUrl: boolean;
    httpSuccess: boolean;
    codeZero: boolean;
    responseDisposed: boolean;
  };
  schema: ReadResponseStructure | null;
  collectionProof: false;
  blockedRequests?: ContextBlockedRequests;
  /** Actual navigation observations only; never a permission or collection proof. */
  navigationTelemetry?: ContextNavigationTelemetry;
  cdpSource?: ContextCdpSourceSummary;
  /** Two sequential fixed own-account checks, separate from the one volume attempt. */
  ownAccountContext: ContextOwnAccountDiagnostic;
}

export interface ContextOwnAccountDiagnostic {
  transport: 'browser_context_get';
  attempts: 0 | 1 | 2;
  disposed: 0 | 1 | 2;
  responseStatusBefore: number | null;
  responseStatusAfter: number | null;
}

/** Only requests actually aborted by the isolated context experiment. No request permission is inferred. */
export interface ContextBlockedRequestStructure extends Omit<
  ChapterBlockedRequestStructure,
  'navigation'
> {
  navigation: boolean | 'unknown';
  blockReason: 'non_get' | 'write_path' | 'invalid_navigation' | 'invalid_url' | 'parent_mismatch';
  abortConfirmed: boolean;
  phase: 'bootstrap' | 'frozen' | 'cleanup';
}

export interface ContextBlockedRequests {
  entries: ContextBlockedRequestStructure[];
  count: number;
  truncated: boolean;
  summary: 'blocked_non_navigation' | null;
}

export interface ContextCdpSourceSummary {
  kind: 'owned_cdp_root_loader';
  epochBasis: 'owned_cdp_root_loader';
  publicFrameNavigatedMetadataOnly: true;
  frozenSameDocumentEvents: number;
  initialized: boolean;
  rootFrameObserved: boolean;
  committedLoaderObserved: boolean;
  connected: boolean;
  detached: boolean;
  /** Last connected canonical check; this is not a document proof after detach. */
  proofCapturedAt: string | null;
  failure:
    | 'unavailable'
    | 'initialization_failed'
    | 'source_unverified'
    | 'disconnected'
    | 'cleanup_failed'
    | null;
}

export interface ContextNavigationState {
  pendingNavigation: boolean;
  committed: boolean;
  frozen: boolean;
  violated: boolean;
  fatalBlocked: boolean;
  active: boolean;
  currentPage: boolean;
  activeSlot: boolean;
  pageOpen: boolean;
  sessionOpen: boolean;
  signalAborted: boolean;
  permittedRoute: boolean;
  localGenerationChanged: boolean;
  identityEpochChanged: boolean;
}

export type ContextNavigationPhase = 'bootstrap' | 'frozen' | 'cleanup';

export type ContextNavigationFrame = 'main' | 'other' | 'unavailable';

export interface ContextNavigationLatches {
  pendingNavigation: boolean;
  committed: boolean;
  violated: boolean;
}

export type ContextNavigationEvent =
  | {
      kind: 'nav_request';
      frame: ContextNavigationFrame;
      phase: ContextNavigationPhase;
      before: ContextNavigationLatches;
      after: ContextNavigationLatches;
    }
  | {
      kind: 'commit';
      frame: ContextNavigationFrame;
      phase: ContextNavigationPhase;
      before: ContextNavigationLatches;
      after: ContextNavigationLatches;
      sameOrigin: boolean | null;
      samePath: boolean | null;
      sameUrl: boolean | null;
      queryChanged: boolean | null;
      permittedRoute: boolean | null;
      outcome:
        | 'pending_navigation_commit'
        | 'bootstrap_query_transition'
        | 'unpaired_commit'
        | 'invalid_url'
        | 'other_frame'
        | 'public_observation';
    };

export interface ContextNavigationTelemetry {
  initial: ContextNavigationState;
  final: ContextNavigationState;
  bootstrapGate: ContextNavigationState | null;
  firstViolation: {
    phase: ContextNavigationPhase;
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
      | 'cdp_cleanup_failed';
  } | null;
  events: ContextNavigationEvent[];
  count: number;
  truncated: boolean;
}

export interface ChapterRouteQuerySchema {
  entries: Array<{
    key: string;
    valueShape: 'empty' | 'numeric' | 'numeric_out_of_range' | 'other';
    allowedReadKey: boolean;
    rejection: 'unsupported_key' | 'value_not_numeric' | 'duplicate_key' | null;
  }>;
  truncated: boolean;
}

export interface ChapterEntryDiagnostic {
  status: 'opened' | 'unavailable';
  reason?: string;
  routeTemplate: string | null;
  routeObservation: 'landed' | 'navigation-request' | null;
  targetRef: string | null;
  /** Field names and fixed shapes only; this does not permit any additional query key/value. */
  querySchema?: ChapterRouteQuerySchema;
}

export interface ChapterTabDiagnostic {
  tab: 'drafts';
  status: 'opened' | 'unavailable';
  reason?: string;
  routeTemplate: string | null;
  targetRef: string | null;
  /** Rejected requests only: fixed enums/masked paths, never URLs, query values or bodies. */
  blockedRequests?: ChapterBlockedRequests;
}

export interface ChapterBlockedRequestStructure {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'OTHER';
  resourceType:
    'document' | 'script' | 'image' | 'stylesheet' | 'font' | 'media' | 'xhr' | 'fetch' | 'other';
  navigation: boolean;
  origin: 'platform' | 'external' | 'invalid';
  pathClass: 'known_author_api' | 'writer_route' | 'unknown' | 'invalid';
  pathTemplate: string;
  authorFamily: 'book' | 'chapter' | 'volume' | 'account' | 'inset' | 'hot_word' | 'banned' | null;
  count: number;
}

export interface ChapterBlockedRequests {
  entries: ChapterBlockedRequestStructure[];
  count: number;
  truncated: boolean;
}

/** Diagnostic projection only; these known path names grant no request or schema permission. */
export function projectChapterBlockedRequest(
  request: Pick<Request, 'method' | 'url' | 'resourceType' | 'isNavigationRequest'>,
): Omit<ChapterBlockedRequestStructure, 'count'> {
  let method: ChapterBlockedRequestStructure['method'] = 'OTHER';
  try {
    const observed = request.method();
    if (['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(observed))
      method = observed as typeof method;
  } catch {
    /* No raw method or exception is retained. */
  }
  let resourceType: ChapterBlockedRequestStructure['resourceType'] = 'other';
  let navigation = false;
  try {
    const observed = request.resourceType();
    if (
      ['document', 'script', 'image', 'stylesheet', 'font', 'media', 'xhr', 'fetch'].includes(
        observed,
      )
    )
      resourceType = observed as typeof resourceType;
  } catch {
    /* Unknown resource labels and raw exceptions remain private. */
  }
  try {
    navigation = request.isNavigationRequest() === true;
  } catch {
    /* Real Request supplies a boolean; malformed observations grant no permission. */
  }
  const invalid = {
    method,
    resourceType,
    navigation,
    origin: 'invalid' as const,
    pathClass: 'invalid' as const,
    pathTemplate: '/{invalid}',
    authorFamily: null,
  };
  try {
    const url = new URL(request.url());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return invalid;
    const origin =
      url.origin === 'https://fanqienovel.com' ? ('platform' as const) : ('external' as const);
    const parts = url.pathname.split('/').filter(Boolean);
    const knownFamilies = new Set([
      'book',
      'chapter',
      'volume',
      'account',
      'inset',
      'hot_word',
      'banned',
    ]);
    const authorFamily =
      origin === 'platform' &&
      parts[0] === 'api' &&
      parts[1] === 'author' &&
      knownFamilies.has(parts[2] ?? '')
        ? (parts[2] as NonNullable<ChapterBlockedRequestStructure['authorFamily']>)
        : null;
    // Only exact already-observed paths are preserved. A syntactically ordinary
    // lowercase segment may still be a title/token and is opaque everywhere else.
    const knownPaths = new Set([
      '/api/user/info/v2',
      '/api/author/volume/volume_list/v1',
      '/api/author/book/book_detail/v0/',
      '/api/author/chapter/chapter_list/v1',
      '/api/author/account/info/v0/',
      '/api/author/inset/qualification/v0',
      '/api/author/hot_word/word_list/v0',
      '/api/author/banned/info/v0/',
    ]);
    // Namespace/known-path classification only: resource type or an opaque path
    // does not establish a static asset, a safe query, or an editor navigation.
    const pathClass: ChapterBlockedRequestStructure['pathClass'] =
      origin === 'platform' &&
      knownPaths.has(url.pathname) &&
      url.pathname.startsWith('/api/author/')
        ? 'known_author_api'
        : origin === 'platform' && url.pathname.startsWith('/main/writer/')
          ? 'writer_route'
          : 'unknown';
    let pathTemplate: string;
    if (origin === 'platform' && knownPaths.has(url.pathname)) pathTemplate = url.pathname;
    else if (
      origin === 'platform' &&
      /^\/main\/writer\/chapter-manage\/[1-9]\d{9,29}&[^/]+$/.test(url.pathname)
    )
      pathTemplate = '/main/writer/chapter-manage/{workId}&{title}';
    else {
      pathTemplate =
        '/' +
        parts
          .slice(0, 8)
          .map((part, index) =>
            origin === 'platform' &&
            parts[0] === 'api' &&
            parts[1] === 'author' &&
            (index < 2 || (index === 2 && authorFamily !== null))
              ? part
              : '{opaque}',
          )
          .join('/');
      if (parts.length > 8) pathTemplate += '/{truncated}';
    }
    return { method, resourceType, navigation, origin, pathClass, pathTemplate, authorFamily };
  } catch {
    return invalid;
  }
}

export interface ChapterGetQuerySchema {
  entries: Array<{
    key: string;
    type: 'string';
    valueShape: 'empty' | 'numeric' | 'numeric_out_of_range' | 'other';
    allowedReadKey: boolean;
    duplicate: boolean;
  }>;
  truncated: boolean;
  workBinding:
    | 'current_work'
    | 'other_work'
    | 'missing_work'
    | 'ambiguous_work'
    | 'invalid_work'
    | 'invalid_source';
  /** Requires an observed source, fresh own identity and current epoch as well; this flag alone cannot authorize a GET. */
  replayBoundToCurrentWork: boolean;
}

export interface ChapterGetRequestStructure {
  pathTemplate: string;
  status: number;
  querySchema: ChapterGetQuerySchema;
  sourceState:
    | 'current_source'
    | 'superseded_same_family'
    | 'cleared_by_navigation'
    | 'prior_request'
    | 'unobserved_request'
    | 'non_success_response'
    | 'work_binding_unverified';
}

export interface ChapterDirectoryUiStructure {
  tabs: Array<{ index: number; label: string | null; active: boolean }>;
  tabsTruncated: boolean;
  statusFilter: { present: boolean; matches: number; label: string | null; all: boolean };
  volumeFilter: { present: boolean; matches: number; label: string | null; all: boolean };
  tablePresent: boolean;
  /** Static structure hints only: absence never proves a single page or complete directory. */
  pagination?: {
    state: 'not_observed' | 'observed' | 'ambiguous';
    rootCount: number;
    rootCountTruncated: boolean;
    controlCount: number;
    controls: Array<{
      type: 'button' | 'link' | 'input' | 'div' | 'span' | 'other';
      direction: 'next' | 'previous' | 'unknown';
      pageNumber: number | null;
      current: boolean | null;
      disabled: boolean | null;
    }>;
    truncated: boolean;
  };
  /** Only visible options within one observed volume control; closed or unbound portal options are unknown. */
  volumeOptions?: {
    state: 'not_observed' | 'ambiguous_control' | 'no_visible_options' | 'visible_options';
    controlCount: number;
    controlCountTruncated: boolean;
    selectionScope: 'all_label' | 'other_or_unknown' | 'not_observed';
    optionCount: number;
    options: Array<{
      type: 'native_option' | 'aria_option';
      selected: boolean | null;
      disabled: boolean | null;
    }>;
    truncated: boolean;
  };
}

export interface ReadPageDiagnostic {
  status: 'success' | 'login_required' | 'capability_unavailable';
  sourceUrl: string;
  capturedAt: string;
  identityObserved: { accountId: boolean; authorId: boolean; displayName: boolean };
  elements: Array<{ tag: string; attributes: Record<string, string>; label: string | null }>;
  links: Array<{ routeTemplate: string; targetRef: string; label: string | null }>;
  getResponses: Array<{ pathTemplate: string; status: number; resourceType: string }>;
  readResponseStructure?: ReadResponseStructure[];
  chapterGetRequests?: ChapterGetRequestStructure[];
  chapterUi?: ChapterDirectoryUiStructure;
  navigationLabels?: string[];
  chapterEntry?: ChapterEntryDiagnostic;
  chapterTab?: ChapterTabDiagnostic;
  chapterVolumeContext?: ChapterVolumeContextDiagnostic;
  truncated: { elements: boolean; responses: boolean };
  limitations: string[];
}

/** Current DOM markers only: no selector/action, ownership or directory proof. */
export interface ChapterTabStructureNode {
  tag: 'div' | 'span' | 'button' | 'a' | 'section' | 'main' | 'nav' | 'other';
  role: 'tab' | 'tablist' | 'presentation' | 'none' | null;
  classes: Array<
    | 'chapter-manage-tabs'
    | 'serial-tabs'
    | 'serial-tabs-text'
    | 'arco-tabs-size-small'
    | 'arco-tabs-header-nav'
    | 'arco-tabs-header-title'
    | 'arco-tabs-header-title-active'
  >;
  connected: boolean;
  visible: boolean;
  /** Explicit DOM disabled markers only; false is not a click permission. */
  disabled: boolean;
  active: boolean;
}
