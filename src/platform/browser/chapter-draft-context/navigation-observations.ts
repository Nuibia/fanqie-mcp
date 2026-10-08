import {
  type ContextNavigationPhase,
  type ContextNavigationLatches,
  type ContextNavigationState,
  type ContextNavigationEvent,
} from '../chapter-diagnostics.js';

import { type ChapterReadState } from './chapterReadScope.js';
export function createNavigationPhase(
  chapterReadScope: Pick<ChapterReadState, 'cleanup' | 'frozen'>,
) {
  return (): ContextNavigationPhase =>
    chapterReadScope.cleanup ? 'cleanup' : chapterReadScope.frozen ? 'frozen' : 'bootstrap';
}

export function createNavigationLatches(
  chapterReadScope: Pick<ChapterReadState, 'pendingNavigation' | 'committed' | 'violated'>,
) {
  return (): ContextNavigationLatches => ({
    pendingNavigation: chapterReadScope.pendingNavigation,
    committed: chapterReadScope.committed,
    violated: chapterReadScope.violated,
  });
}

export function createNavigationState(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'permittedRoute'
    | 'page'
    | 'pendingNavigation'
    | 'committed'
    | 'frozen'
    | 'violated'
    | 'fatalBlocked'
    | 'active'
    | 'deps'
    | 'options'
    | 'generation'
    | 'initialEpoch'
  >,
) {
  return (): ContextNavigationState => {
    let routePermitted = false;
    try {
      routePermitted = chapterReadScope.permittedRoute(chapterReadScope.page.url());
    } catch {
      /* Fixed false state, no URL retained. */
    }
    return {
      pendingNavigation: chapterReadScope.pendingNavigation,
      committed: chapterReadScope.committed,
      frozen: chapterReadScope.frozen,
      violated: chapterReadScope.violated,
      fatalBlocked: chapterReadScope.fatalBlocked,
      active: chapterReadScope.active(),
      currentPage: chapterReadScope.page === chapterReadScope.deps.page,
      activeSlot: chapterReadScope.page === chapterReadScope.deps.activeReaderPage,
      pageOpen: !chapterReadScope.page.isClosed(),
      sessionOpen: !chapterReadScope.deps.closed,
      signalAborted: chapterReadScope.options.signal?.aborted === true,
      permittedRoute: routePermitted,
      localGenerationChanged: chapterReadScope.generation !== 0,
      identityEpochChanged: chapterReadScope.deps.identityEpoch !== chapterReadScope.initialEpoch,
    };
  };
}

export function createRecordNavigation(
  chapterReadScope: Pick<ChapterReadState, 'navigationTelemetry'>,
) {
  return (event: ContextNavigationEvent) => {
    if (chapterReadScope.navigationTelemetry.count >= 100) {
      chapterReadScope.navigationTelemetry.truncated = true;
      return;
    }
    chapterReadScope.navigationTelemetry.count += 1;
    if (chapterReadScope.navigationTelemetry.events.length < 32)
      chapterReadScope.navigationTelemetry.events.push(event);
    else chapterReadScope.navigationTelemetry.truncated = true;
  };
}

import { type Request } from 'playwright';

export function createOnRequest(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'active'
    | 'navigationLatches'
    | 'navigationPhase'
    | 'recordNavigation'
    | 'cdpFault'
    | 'page'
    | 'observeRejectedCheck'
    | 'permittedRoute'
    | 'frozen'
    | 'recordSourceClear'
    | 'generation'
    | 'clearTemplates'
    | 'pendingNavigation'
    | 'recordViolation'
    | 'violated'
    | 'closeCollectionSourceWindow'
  >,
) {
  return (request: Request) => {
    if (!chapterReadScope.active()) return;
    try {
      if (request.isNavigationRequest()) {
        const before = chapterReadScope.navigationLatches(),
          phase = chapterReadScope.navigationPhase();
        let requestFrame: ReturnType<Request['frame']>;
        try {
          requestFrame = request.frame();
        } catch {
          chapterReadScope.recordNavigation({
            kind: 'nav_request',
            frame: 'unavailable',
            phase,
            before,
            after: chapterReadScope.navigationLatches(),
          });
          chapterReadScope.cdpFault('source_unverified', {
            site: 'public_request_frame',
            predicate: 'frame_unavailable',
          });
          return;
        }
        const frame =
          requestFrame === chapterReadScope.page.mainFrame()
            ? ('main' as const)
            : ('other' as const);
        if (
          chapterReadScope.observeRejectedCheck(
            'public_request_route',
            'route_not_permitted',
            !chapterReadScope.permittedRoute(request.url()),
          )
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'public_request_route',
            predicate: 'guard_failed',
          });
        }
        if (chapterReadScope.frozen && requestFrame === chapterReadScope.page.mainFrame()) {
          chapterReadScope.recordSourceClear('frozen_public_request');
          chapterReadScope.generation += 1;
          chapterReadScope.clearTemplates();
          chapterReadScope.pendingNavigation = true;
          chapterReadScope.recordViolation('frozen_navigation_request');
          chapterReadScope.violated = true;
          chapterReadScope.closeCollectionSourceWindow();
        }
        chapterReadScope.recordNavigation({
          kind: 'nav_request',
          frame,
          phase,
          before,
          after: chapterReadScope.navigationLatches(),
        });
      }
    } catch {
      chapterReadScope.cdpFault('source_unverified', {
        site: 'public_request_callback',
        predicate: 'callback_exception',
      });
    }
  };
}

export function createOnNavigation(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'navigationLatches'
    | 'navigationPhase'
    | 'page'
    | 'observeRejectedCheck'
    | 'cdpFault'
    | 'recordNavigation'
    | 'recordViolation'
    | 'violated'
    | 'closeCollectionSourceWindow'
    | 'route'
    | 'permittedRoute'
    | 'collectionSourceWake'
    | 'viewWindow'
    | 'stable'
    | 'closeViewWindow'
  >,
) {
  return (frame: unknown) => {
    const before = chapterReadScope.navigationLatches(),
      phase = chapterReadScope.navigationPhase();
    const frameClass =
      frame == null
        ? ('unavailable' as const)
        : frame === chapterReadScope.page.mainFrame()
          ? ('main' as const)
          : ('other' as const);
    if (frame !== chapterReadScope.page.mainFrame()) {
      if (
        chapterReadScope.observeRejectedCheck(
          'public_commit_frame',
          'frame_unavailable',
          frame == null,
        )
      )
        chapterReadScope.cdpFault('source_unverified', {
          site: 'public_commit_frame',
          predicate: 'guard_failed',
        });
      chapterReadScope.recordNavigation({
        kind: 'commit',
        frame: frameClass,
        phase,
        before,
        after: chapterReadScope.navigationLatches(),
        sameOrigin: null,
        samePath: null,
        sameUrl: null,
        queryChanged: null,
        permittedRoute: null,
        outcome: 'other_frame',
      });
      return;
    }
    let next: URL;
    try {
      next = new URL(chapterReadScope.page.url());
    } catch {
      chapterReadScope.recordViolation('invalid_commit_url');
      chapterReadScope.violated = true;
      chapterReadScope.closeCollectionSourceWindow();
      chapterReadScope.recordNavigation({
        kind: 'commit',
        frame: frameClass,
        phase,
        before,
        after: chapterReadScope.navigationLatches(),
        sameOrigin: null,
        samePath: null,
        sameUrl: null,
        queryChanged: null,
        permittedRoute: null,
        outcome: 'invalid_url',
      });
      return;
    }
    const relations = {
      sameOrigin: chapterReadScope.route.origin === next.origin,
      samePath: chapterReadScope.route.pathname === next.pathname,
      sameUrl: chapterReadScope.route.href === next.href,
      queryChanged: chapterReadScope.route.search !== next.search,
      permittedRoute: chapterReadScope.permittedRoute(chapterReadScope.page.url()),
    };
    chapterReadScope.route = next;
    chapterReadScope.recordNavigation({
      kind: 'commit',
      frame: frameClass,
      phase,
      before,
      after: chapterReadScope.navigationLatches(),
      ...relations,
      outcome: 'public_observation',
    });
    chapterReadScope.collectionSourceWake?.();
    if (chapterReadScope.viewWindow && !chapterReadScope.stable())
      chapterReadScope.closeViewWindow();
  };
}
