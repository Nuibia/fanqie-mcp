import { type ChapterReadState } from './chapterReadScope.js';
export function createSettleAborts(
  chapterReadScope: Pick<ChapterReadState, 'pendingAborts' | 'pendingRoutes'>,
) {
  return async () => {
    while (chapterReadScope.pendingAborts.size || chapterReadScope.pendingRoutes.size)
      await Promise.allSettled([
        ...chapterReadScope.pendingAborts,
        ...chapterReadScope.pendingRoutes,
      ]);
  };
}

import { type Request, type Route } from 'playwright';

import {
  projectChapterBlockedRequest,
  type ContextBlockedRequestStructure,
  type ContextNavigationTelemetry,
} from '../chapter-diagnostics.js';

export function createRecordBlocked(chapterReadScope: Pick<ChapterReadState, 'blockedRequests'>) {
  return (
    request: Request,
    navigation: ContextBlockedRequestStructure['navigation'],
    blockReason: ContextBlockedRequestStructure['blockReason'],
    abortConfirmed: boolean,
    phase: ContextBlockedRequestStructure['phase'],
  ) => {
    if (chapterReadScope.blockedRequests.count >= 100) {
      chapterReadScope.blockedRequests.truncated = true;
      return;
    }
    chapterReadScope.blockedRequests.count += 1;
    const projected = {
      ...projectChapterBlockedRequest(request),
      navigation,
      blockReason,
      abortConfirmed,
      phase,
    };
    if (projected.pathTemplate.endsWith('/{truncated}'))
      chapterReadScope.blockedRequests.truncated = true;
    const existing = chapterReadScope.blockedRequests.entries.find(
      (entry) =>
        entry.method === projected.method &&
        entry.resourceType === projected.resourceType &&
        entry.navigation === navigation &&
        entry.origin === projected.origin &&
        entry.pathClass === projected.pathClass &&
        entry.pathTemplate === projected.pathTemplate &&
        entry.authorFamily === projected.authorFamily &&
        entry.blockReason === blockReason &&
        entry.abortConfirmed === abortConfirmed &&
        entry.phase === phase,
    );
    if (existing) existing.count += 1;
    else if (chapterReadScope.blockedRequests.entries.length < 16)
      chapterReadScope.blockedRequests.entries.push({ ...projected, count: 1 });
    else chapterReadScope.blockedRequests.truncated = true;
  };
}

export function createActive(
  chapterReadScope: Pick<ChapterReadState, 'deps' | 'slot' | 'page' | 'options'>,
) {
  return () =>
    chapterReadScope.deps.isCurrentPageSlot(chapterReadScope.slot, chapterReadScope.page) &&
    !chapterReadScope.options.signal?.aborted;
}

import { validateDiagnosticSource, chapterDirectoryWorkId } from '../chapter-routes.js';

export function createPermittedRoute(
  chapterReadScope: Pick<ChapterReadState, 'deps' | 'target' | 'workId'>,
) {
  return (value: string) => {
    try {
      const current = validateDiagnosticSource(
        value,
        chapterReadScope.deps.discoveredStableTargets,
      );
      return (
        current.origin === chapterReadScope.target.origin &&
        current.pathname === chapterReadScope.target.pathname &&
        chapterDirectoryWorkId(value) === chapterReadScope.workId &&
        ['book_id', 'bookId', 'work_id', 'workId'].every(
          (key) =>
            !current.searchParams.has(key) ||
            current.searchParams.get(key) === chapterReadScope.workId,
        )
      );
    } catch {
      return false;
    }
  };
}

export function createSourceSizes(
  chapterReadScope: Pick<ChapterReadState, 'templates' | 'bookTemplates' | 'chapterTemplates'>,
) {
  return () => ({
    volume: chapterReadScope.templates.size,
    book: chapterReadScope.bookTemplates.size,
    chapter: chapterReadScope.chapterTemplates.size,
  });
}

export function createRecordViolation(
  chapterReadScope: Pick<ChapterReadState, 'navigationTelemetry' | 'navigationPhase'>,
) {
  return (reason: NonNullable<ContextNavigationTelemetry['firstViolation']>['reason']) => {
    chapterReadScope.navigationTelemetry.firstViolation ??= {
      phase: chapterReadScope.navigationPhase(),
      reason,
    };
  };
}

import { type RejectedCheck } from './contracts.js';

export function createObserveRejectedCheck(
  chapterReadScope: Pick<ChapterReadState, 'collection' | 'rejectedCandidate'>,
) {
  return <T>(site: RejectedCheck['site'], predicate: RejectedCheck['predicate'], value: T): T => {
    if (chapterReadScope.collection && value)
      chapterReadScope.rejectedCandidate = { site, predicate };
    return value;
  };
}

export function createObservedFences(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'deadline'
    | 'active'
    | 'requestContext'
    | 'deps'
    | 'page'
    | 'violated'
    | 'pendingNavigation'
    | 'pendingSameDocument'
    | 'cdpSource'
    | 'frozenGeneration'
    | 'generation'
    | 'nonempty'
    | 'frozenLoader'
    | 'loader'
    | 'frozenUrl'
    | 'permittedRoute'
  >,
) {
  return () =>
    performance.now() < chapterReadScope.deadline &&
    chapterReadScope.active() &&
    (!chapterReadScope.requestContext ||
      (chapterReadScope.deps.context === chapterReadScope.requestContext &&
        chapterReadScope.page.context() === chapterReadScope.requestContext)) &&
    !chapterReadScope.violated &&
    !chapterReadScope.pendingNavigation &&
    !chapterReadScope.pendingSameDocument &&
    chapterReadScope.cdpSource.initialized &&
    chapterReadScope.frozenGeneration === chapterReadScope.generation &&
    chapterReadScope.nonempty(chapterReadScope.frozenLoader) &&
    chapterReadScope.loader === chapterReadScope.frozenLoader &&
    chapterReadScope.page.url() === chapterReadScope.frozenUrl &&
    chapterReadScope.permittedRoute(chapterReadScope.page.url());
}

export function createStable(
  chapterReadScope: Pick<ChapterReadState, 'cdpSource' | 'observedFences'>,
) {
  return () => chapterReadScope.cdpSource.connected && chapterReadScope.observedFences();
}

import { PlatformReadError } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';

export function createAssertStable(
  chapterReadScope: Pick<ChapterReadState, 'deadline' | 'stable'>,
) {
  return () => {
    if (performance.now() >= chapterReadScope.deadline)
      throw new PlatformReadError(
        'chapter_draft_budget_exceeded',
        'The draft-directory read budget expired',
      );
    if (!chapterReadScope.stable())
      throw new BrowserSessionError('read_diagnostic_stale', 'The current draft document changed');
  };
}

export function createHandleReadOnlyRoute(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'workId'
    | 'page'
    | 'permittedRoute'
    | 'recordViolation'
    | 'fatalBlocked'
    | 'violated'
    | 'closeCollectionSourceWindow'
    | 'cleanup'
    | 'frozen'
    | 'blockedNonNavigation'
    | 'recordBlocked'
    | 'pendingAborts'
    | 'closeViewWindow'
  >,
) {
  return async (route: Route) => {
    const request = route.request();
    let permitted = ['GET', 'HEAD'].includes(request.method());
    let navigation: ContextBlockedRequestStructure['navigation'] = 'unknown',
      verifiedUrl = false,
      parentConflict = false;
    let blockReason: ContextBlockedRequestStructure['blockReason'] = 'non_get';
    try {
      const requestUrl = new URL(request.url());
      verifiedUrl =
        ['https:', 'http:'].includes(requestUrl.protocol) &&
        !requestUrl.username &&
        !requestUrl.password &&
        !requestUrl.hash;
      if (!verifiedUrl) permitted = false;
      const observedNavigation = request.isNavigationRequest();
      if (observedNavigation === true || observedNavigation === false)
        navigation = observedNavigation;
      else {
        permitted = false;
        blockReason = 'invalid_navigation';
      }
      const parents = [...requestUrl.searchParams].filter(([key]) =>
        ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
      );
      parentConflict =
        parents.length > 1 || (parents.length === 1 && parents[0]![1] !== chapterReadScope.workId);
      if (parentConflict) permitted = false;
      // The draft source also rejects conflicting parent aliases before any forward.
      if (
        requestUrl.origin === 'https://fanqienovel.com' &&
        /(?:^|[\/_-])(?:create|new|edit|editor|publish|submit|delete|save|update|upload|sign|pay|withdraw)(?:[\/_-]|$)/i.test(
          requestUrl.pathname,
        )
      ) {
        permitted = false;
        blockReason = 'write_path';
      }
      if (
        observedNavigation &&
        (request.frame() !== chapterReadScope.page.mainFrame() ||
          !chapterReadScope.permittedRoute(request.url()))
      ) {
        permitted = false;
        blockReason = 'invalid_navigation';
      }
    } catch {
      permitted = false;
      blockReason = 'invalid_url';
    }
    if (!permitted) {
      if (!verifiedUrl) blockReason = 'invalid_url';
      else if (parentConflict) blockReason = 'parent_mismatch';
      else if (navigation === 'unknown') blockReason = 'invalid_navigation';
      const nonNavigation = navigation === false && verifiedUrl && !parentConflict;
      if (!nonNavigation) {
        chapterReadScope.recordViolation('fatal_blocked_request');
        chapterReadScope.fatalBlocked = true;
        chapterReadScope.violated = true;
        chapterReadScope.closeCollectionSourceWindow();
      }
      const phase = chapterReadScope.cleanup
        ? 'cleanup'
        : chapterReadScope.frozen
          ? 'frozen'
          : 'bootstrap';
      const pending = (async () => {
        let abortConfirmed = false;
        try {
          await route.abort('blockedbyclient');
          abortConfirmed = true;
        } catch {
          chapterReadScope.recordViolation('abort_failed');
          chapterReadScope.fatalBlocked = true;
          chapterReadScope.violated = true;
          chapterReadScope.closeCollectionSourceWindow();
        }
        if (nonNavigation && abortConfirmed) chapterReadScope.blockedNonNavigation = true;
        chapterReadScope.recordBlocked(request, navigation, blockReason, abortConfirmed, phase);
      })();
      chapterReadScope.pendingAborts.add(pending);
      try {
        await pending;
      } finally {
        chapterReadScope.pendingAborts.delete(pending);
      }
      return;
    }
    try {
      await route.continue();
    } catch {
      chapterReadScope.violated = true;
      chapterReadScope.fatalBlocked = true;
      chapterReadScope.closeCollectionSourceWindow();
      chapterReadScope.closeViewWindow();
    }
  };
}

export function createReadOnlyRoute(
  chapterReadScope: Pick<ChapterReadState, 'handleReadOnlyRoute' | 'pendingRoutes'>,
) {
  return (route: Route) => {
    const task = chapterReadScope.handleReadOnlyRoute(route);
    chapterReadScope.pendingRoutes.add(task);
    return task.finally(() => chapterReadScope.pendingRoutes.delete(task));
  };
}
