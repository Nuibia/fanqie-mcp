import { type Page } from 'playwright';

import {
  type DatasetResult,
  type ChapterDraftRecord,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserCallOptions, type CurrentChapterDirectoryOptions } from '../contracts.js';
import { validateDiagnosticSource, chapterDirectoryWorkId } from '../chapter-routes.js';

import { type ChapterReadState } from './chapterReadScope.js';
import {
  createClearTemplates,
  createRecordCollectionFailureStage,
  createClearBootstrapSources,
} from './collection-state.js';
import {
  createCloseViewWindow,
  createSourceFamiliesReady,
  createSourceFamiliesAmbiguous,
  createCloseCollectionSourceWindow,
  createOpenCollectionSourceWindow,
  createCanAcquireFrozenCollectionSource,
  createAcquireCollectionSources,
} from './collection-window.js';

import {
  createSettleAborts,
  createRecordBlocked,
  createActive,
  createPermittedRoute,
  createSourceSizes,
  createRecordViolation,
  createObserveRejectedCheck,
  createObservedFences,
  createStable,
  createAssertStable,
  createHandleReadOnlyRoute,
  createReadOnlyRoute,
} from './read-only-guards.js';

import {
  createNavigationPhase,
  createNavigationLatches,
  createNavigationState,
  createRecordNavigation,
  createOnRequest,
  createOnNavigation,
} from './navigation-observations.js';

import {
  createBeginSourceObservation,
  createAppendSourceObservation,
  createRecordSourceClear,
  createRecordUnclassifiedSource,
  createRecordSourceRequest,
  createSnapshotSourceObservation,
} from './source-observations.js';

import {
  createObserveBootstrapInitial,
  createObserveBootstrapFreeze,
  createSnapshotCanonicalBootstrap,
  createCdpFault,
  createNonempty,
  createDeferCdp,
  createAcceptBootstrapNavigationEvent,
  createCdpFrameDetached,
  createCdpClosed,
} from './bootstrap-witness.js';

import { createCdpStart } from './cdp-start.js';
import { createCdpCommitted } from './cdp-committed.js';
import { createCdpWithinDocument } from './cdp-within-document.js';
import { createCdpRequest } from './cdp-request.js';

import { createCollectDraftPages } from './management-collection.js';
import { type Dependencies } from '../operations/read-current-chapter-draft-context.js';
export function initializeDraftRead(
  deps: Dependencies,
  page: Page,
  targetRef: string,
  options: BrowserCallOptions,
  collection: {
    result: DatasetResult<ChapterDraftRecord>;
    options: CurrentChapterDirectoryOptions;
    failureMetadata: CurrentChapterCollectionFailureDiagnostic;
  },
  deadline: number,
): ChapterReadState {
  const chapterReadScope = {
    page,
    targetRef,
    options,
    collection,
    deadline,
    deps,
  } as ChapterReadState;

  chapterReadScope.slot = chapterReadScope.deps.activePageSlot;

  chapterReadScope.raw = chapterReadScope.deps.diagnosticTargets.get(chapterReadScope.targetRef);

  if (!chapterReadScope.raw)
    throw new BrowserSessionError(
      'invalid_chapter_context_target',
      'A verified current chapter target is required',
    );

  chapterReadScope.target = validateDiagnosticSource(
    chapterReadScope.raw,
    chapterReadScope.deps.discoveredStableTargets,
  );

  chapterReadScope.workId = chapterDirectoryWorkId(chapterReadScope.raw)!;

  chapterReadScope.diagnostic = {
    transport: 'browser_context_get',
    status: 'capability_unavailable',
    reason: 'template_missing',
    checkedAt: new Date().toISOString(),
    pathTemplate: '/api/author/chapter/draft_list/v1',
    attempts: 0,
    responseStatus: null,
    collectionProof: false,
    schema: null,
    ownAccountContext: {
      transport: 'browser_context_get',
      attempts: 0,
      disposed: 0,
      responseStatusBefore: null,
      responseStatusAfter: null,
    },
    checks: {
      templateObserved: false,
      templateUnique: false,
      mainFrameRequest: false,
      currentDocumentRequest: false,
      parentBound: false,
      sameContext: false,
      currentPage: false,
      activeSlot: false,
      epochStable: false,
      routeStable: false,
      sameOwnerBefore: false,
      sameOwnerAfter: false,
      exactResponseUrl: false,
      httpSuccess: false,
      codeZero: false,
      responseDisposed: false,
    },
  };

  chapterReadScope.result = {
    status: 'capability_unavailable',
    sourceUrl: 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}',
    capturedAt: chapterReadScope.diagnostic.checkedAt,
    identityObserved: { accountId: false, authorId: false, displayName: false },
    elements: [],
    links: [],
    getResponses: [],
    readResponseStructure: [],
    truncated: { elements: false, responses: false },
    limitations: [
      'This experiment issues at most one volume GET plus two sequential fresh own-account GET checks through the service-owned browser context. It supplies schema types only and cannot establish chapter coverage, create a page source, or advance saved data. A successful capturedAt is the last connected CDP proof cutoff; checkedAt marks cleanup completion. The isolated document epoch uses the connected owned CDP root/committed loader; valid public framenavigated observations are metadata only. The interval after detach is not document proof.',
    ],
  };

  chapterReadScope.timeout = Math.max(
    1,
    Math.min(
      12000,
      chapterReadScope.options.timeoutMs ?? chapterReadScope.deps.config.timeoutMs ?? 12000,
    ),
  );

  chapterReadScope.templates = new Set<string>();

  chapterReadScope.bookTemplates = new Set<string>();

  chapterReadScope.chapterTemplates = new Set<string>();

  chapterReadScope.clearTemplates = createClearTemplates(chapterReadScope);

  chapterReadScope.collected = null;

  chapterReadScope.chapterPagesFetched = 0;

  chapterReadScope.draftComplete = false;

  chapterReadScope.draftPartialReason = null;

  chapterReadScope.managementRequestIds = new Set<string>();

  chapterReadScope.viewWindow = null;

  chapterReadScope.closeViewWindow = createCloseViewWindow(chapterReadScope);

  chapterReadScope.verifiedOwner = null;

  chapterReadScope.collectionFailure = null;

  chapterReadScope.collectionStage = 'pre_context_identity';

  chapterReadScope.collectionFailureStageRecorded = false;

  chapterReadScope.recordCollectionFailureStage =
    createRecordCollectionFailureStage(chapterReadScope);

  chapterReadScope.generation = 0;

  chapterReadScope.pendingNavigation = false;

  chapterReadScope.pendingSameDocument = false;

  chapterReadScope.committed = false;

  chapterReadScope.frozen = false;

  chapterReadScope.violated = false;

  chapterReadScope.fatalBlocked = false;

  chapterReadScope.guarded = false;

  chapterReadScope.cleanup = false;

  chapterReadScope.cdp = null;

  chapterReadScope.rootFrame = '';

  chapterReadScope.loader = '';

  chapterReadScope.pendingLoader = '';

  chapterReadScope.controlledGoto = false;

  chapterReadScope.expectedDetach = false;

  chapterReadScope.bootstrapNavigationEvents = 0;

  chapterReadScope.requestIds = new Set<string>();

  chapterReadScope.deferredCdp = [] as Array<() => void>;

  chapterReadScope.clearBootstrapSources = createClearBootstrapSources(chapterReadScope);

  chapterReadScope.cdpSource = {
    kind: 'owned_cdp_root_loader',
    epochBasis: 'owned_cdp_root_loader',
    publicFrameNavigatedMetadataOnly: true,
    frozenSameDocumentEvents: 0,
    initialized: false,
    rootFrameObserved: false,
    committedLoaderObserved: false,
    connected: false,
    detached: false,
    proofCapturedAt: null,
    failure: null,
  };

  chapterReadScope.route = new URL(chapterReadScope.page.url());

  chapterReadScope.frozenGeneration = -1;

  chapterReadScope.frozenLoader = '';

  chapterReadScope.frozenUrl = '';

  chapterReadScope.requestContext = null;

  chapterReadScope.collectionSourceWindowOpen = false;

  chapterReadScope.collectionSourceDeadline = 0;

  chapterReadScope.collectionSourceTimer = null;

  chapterReadScope.collectionSourceWake = null;

  chapterReadScope.sealedCollectionSources = null;

  chapterReadScope.schema = null;

  chapterReadScope.blockedRequests = {
    entries: [],
    count: 0,
    truncated: false,
    summary: null,
  };

  chapterReadScope.pendingAborts = new Set<Promise<void>>();

  chapterReadScope.pendingRoutes = new Set<Promise<void>>();

  chapterReadScope.blockedNonNavigation = false;

  chapterReadScope.settleAborts = createSettleAborts(chapterReadScope);

  chapterReadScope.recordBlocked = createRecordBlocked(chapterReadScope);

  chapterReadScope.active = createActive(chapterReadScope);

  chapterReadScope.permittedRoute = createPermittedRoute(chapterReadScope);

  chapterReadScope.initialEpoch = chapterReadScope.deps.identityEpoch;

  chapterReadScope.navigationPhase = createNavigationPhase(chapterReadScope);

  chapterReadScope.sourceObservation = {
    count: 0,
    truncated: false,
    unclassifiedRequests: 0,
    retainedAttempts: { volume: 0, book: 0, chapter: 0 },
    currentSizes: { volume: 0, book: 0, chapter: 0 },
    clearCounts: {
      new_document_start: 0,
      new_document_request: 0,
      new_document_commit: 0,
      cdp_fault: 0,
      frozen_public_request: 0,
      cleanup: 0,
    },
    removedTotals: { volume: 0, book: 0, chapter: 0 },
    events: [],
  };

  chapterReadScope.sourceSizes = createSourceSizes(chapterReadScope);

  chapterReadScope.beginSourceObservation = createBeginSourceObservation(chapterReadScope);

  chapterReadScope.appendSourceObservation = createAppendSourceObservation(chapterReadScope);

  chapterReadScope.recordSourceClear = createRecordSourceClear(chapterReadScope);

  chapterReadScope.recordUnclassifiedSource = createRecordUnclassifiedSource(chapterReadScope);

  chapterReadScope.recordSourceRequest = createRecordSourceRequest(chapterReadScope);

  chapterReadScope.snapshotSourceObservation = createSnapshotSourceObservation(chapterReadScope);

  chapterReadScope.navigationLatches = createNavigationLatches(chapterReadScope);

  chapterReadScope.navigationState = createNavigationState(chapterReadScope);

  chapterReadScope.navigationTelemetry = {
    initial: chapterReadScope.navigationState(),
    final: chapterReadScope.navigationState(),
    bootstrapGate: null,
    firstViolation: null,
    events: [],
    count: 0,
    truncated: false,
  };

  chapterReadScope.firstCdpFaultCheck = null;

  chapterReadScope.rejectedCandidate = null;

  chapterReadScope.bootstrapSubphase = 'context_binding';

  chapterReadScope.bootstrapInitialChecks = {
    active: null,
    sameContext: null,
    ownedContext: null,
    currentUrlMatchesAttach: null,
    noParent: null,
    frameIdPresent: null,
    loaderIdPresent: null,
    noFragment: null,
    frameUrlMatchesAttach: null,
  };

  chapterReadScope.bootstrapFreezeChecks = {
    rootMatches: null,
    noParent: null,
    loaderMatches: null,
    loaderPresent: null,
    noFragment: null,
    frameUrlMatchesCurrent: null,
    permittedRoute: null,
    noPendingNavigation: null,
    noPendingSameDocument: null,
    noViolation: null,
    connected: null,
  };

  chapterReadScope.observeBootstrapInitial = createObserveBootstrapInitial(chapterReadScope);

  chapterReadScope.observeBootstrapFreeze = createObserveBootstrapFreeze(chapterReadScope);

  chapterReadScope.snapshotCanonicalBootstrap = createSnapshotCanonicalBootstrap(chapterReadScope);

  chapterReadScope.recordNavigation = createRecordNavigation(chapterReadScope);

  chapterReadScope.recordViolation = createRecordViolation(chapterReadScope);

  chapterReadScope.observeRejectedCheck = createObserveRejectedCheck(chapterReadScope);

  chapterReadScope.cdpFault = createCdpFault(chapterReadScope);

  chapterReadScope.nonempty = createNonempty(chapterReadScope);

  chapterReadScope.deferCdp = createDeferCdp(chapterReadScope);

  chapterReadScope.acceptBootstrapNavigationEvent =
    createAcceptBootstrapNavigationEvent(chapterReadScope);

  chapterReadScope.cdpStart = createCdpStart(chapterReadScope);

  chapterReadScope.cdpCommitted = createCdpCommitted(chapterReadScope);

  chapterReadScope.cdpWithinDocument = createCdpWithinDocument(chapterReadScope);

  chapterReadScope.cdpRequest = createCdpRequest(chapterReadScope);

  chapterReadScope.cdpFrameDetached = createCdpFrameDetached(chapterReadScope);

  chapterReadScope.cdpClosed = createCdpClosed(chapterReadScope);

  chapterReadScope.observedFences = createObservedFences(chapterReadScope);

  chapterReadScope.stable = createStable(chapterReadScope);

  chapterReadScope.assertStable = createAssertStable(chapterReadScope);

  chapterReadScope.sourceFamiliesReady = createSourceFamiliesReady(chapterReadScope);

  chapterReadScope.sourceFamiliesAmbiguous = createSourceFamiliesAmbiguous(chapterReadScope);

  chapterReadScope.closeCollectionSourceWindow =
    createCloseCollectionSourceWindow(chapterReadScope);

  chapterReadScope.openCollectionSourceWindow = createOpenCollectionSourceWindow(chapterReadScope);

  chapterReadScope.canAcquireFrozenCollectionSource =
    createCanAcquireFrozenCollectionSource(chapterReadScope);

  chapterReadScope.acquireCollectionSources = createAcquireCollectionSources(chapterReadScope);

  chapterReadScope.onRequest = createOnRequest(chapterReadScope);

  chapterReadScope.onNavigation = createOnNavigation(chapterReadScope);

  chapterReadScope.handleReadOnlyRoute = createHandleReadOnlyRoute(chapterReadScope);

  chapterReadScope.readOnlyRoute = createReadOnlyRoute(chapterReadScope);

  chapterReadScope.collectDraftPages = createCollectDraftPages(chapterReadScope);
  return chapterReadScope;
}
