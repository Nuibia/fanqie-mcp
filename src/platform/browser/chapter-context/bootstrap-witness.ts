import { type BootstrapMetadata, type RejectedCheck } from './contracts.js';
import { type ChapterReadState } from './chapterReadScope.js';
export function createObserveBootstrapInitial(
  chapterReadScope: Pick<ChapterReadState, 'collection' | 'bootstrapInitialChecks'>,
) {
  return (key: keyof BootstrapMetadata['initialChecks'], value: boolean) => {
    if (chapterReadScope.collection) chapterReadScope.bootstrapInitialChecks[key] = value;
    return value;
  };
}

export function createObserveBootstrapFreeze(
  chapterReadScope: Pick<ChapterReadState, 'collection' | 'bootstrapFreezeChecks'>,
) {
  return (key: keyof BootstrapMetadata['freezeChecks'], value: boolean) => {
    if (chapterReadScope.collection) chapterReadScope.bootstrapFreezeChecks[key] = value;
    return value;
  };
}

export function createSnapshotCanonicalBootstrap(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'cdpSource'
    | 'navigationTelemetry'
    | 'bootstrapSubphase'
    | 'firstCdpFaultCheck'
    | 'bootstrapInitialChecks'
    | 'bootstrapFreezeChecks'
  >,
) {
  return (): BootstrapMetadata => {
    const failure: unknown = chapterReadScope.cdpSource.failure,
      violation = chapterReadScope.navigationTelemetry.firstViolation;
    const phase: unknown = violation?.phase,
      reason: unknown = violation?.reason;
    return {
      subphase: chapterReadScope.bootstrapSubphase,
      firstCdpFaultCheck: chapterReadScope.firstCdpFaultCheck
        ? {
            site: chapterReadScope.firstCdpFaultCheck.site,
            predicate: chapterReadScope.firstCdpFaultCheck.predicate,
          }
        : null,
      cdp: {
        failure:
          failure === null ||
          failure === 'unavailable' ||
          failure === 'initialization_failed' ||
          failure === 'source_unverified' ||
          failure === 'disconnected' ||
          failure === 'cleanup_failed'
            ? failure
            : 'unknown',
        initialized: chapterReadScope.cdpSource.initialized === true,
        rootFrameObserved: chapterReadScope.cdpSource.rootFrameObserved === true,
        committedLoaderObserved: chapterReadScope.cdpSource.committedLoaderObserved === true,
      },
      firstViolation: violation
        ? {
            phase:
              phase === 'bootstrap' || phase === 'frozen' || phase === 'cleanup'
                ? phase
                : 'unknown',
            reason:
              reason === 'frozen_navigation_request' ||
              reason === 'frozen_commit' ||
              reason === 'unpaired_commit' ||
              reason === 'invalid_commit_url' ||
              reason === 'route_not_permitted' ||
              reason === 'fatal_blocked_request' ||
              reason === 'abort_failed' ||
              reason === 'cdp_source_unverified' ||
              reason === 'cdp_disconnected' ||
              reason === 'cdp_cleanup_failed'
                ? reason
                : 'unknown',
          }
        : null,
      initialChecks: {
        active: chapterReadScope.bootstrapInitialChecks.active,
        sameContext: chapterReadScope.bootstrapInitialChecks.sameContext,
        ownedContext: chapterReadScope.bootstrapInitialChecks.ownedContext,
        currentUrlMatchesAttach: chapterReadScope.bootstrapInitialChecks.currentUrlMatchesAttach,
        noParent: chapterReadScope.bootstrapInitialChecks.noParent,
        frameIdPresent: chapterReadScope.bootstrapInitialChecks.frameIdPresent,
        loaderIdPresent: chapterReadScope.bootstrapInitialChecks.loaderIdPresent,
        noFragment: chapterReadScope.bootstrapInitialChecks.noFragment,
        frameUrlMatchesAttach: chapterReadScope.bootstrapInitialChecks.frameUrlMatchesAttach,
      },
      freezeChecks: {
        rootMatches: chapterReadScope.bootstrapFreezeChecks.rootMatches,
        noParent: chapterReadScope.bootstrapFreezeChecks.noParent,
        loaderMatches: chapterReadScope.bootstrapFreezeChecks.loaderMatches,
        loaderPresent: chapterReadScope.bootstrapFreezeChecks.loaderPresent,
        noFragment: chapterReadScope.bootstrapFreezeChecks.noFragment,
        frameUrlMatchesCurrent: chapterReadScope.bootstrapFreezeChecks.frameUrlMatchesCurrent,
        permittedRoute: chapterReadScope.bootstrapFreezeChecks.permittedRoute,
        noPendingNavigation: chapterReadScope.bootstrapFreezeChecks.noPendingNavigation,
        noPendingSameDocument: chapterReadScope.bootstrapFreezeChecks.noPendingSameDocument,
        noViolation: chapterReadScope.bootstrapFreezeChecks.noViolation,
        connected: chapterReadScope.bootstrapFreezeChecks.connected,
      },
    };
  };
}

import { type ContextCdpSourceSummary } from '../chapter-diagnostics.js';

export function createCdpFault(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'collection'
    | 'firstCdpFaultCheck'
    | 'rejectedCandidate'
    | 'cdpSource'
    | 'recordViolation'
    | 'closeCollectionSourceWindow'
    | 'closeViewWindow'
    | 'recordSourceClear'
    | 'violated'
    | 'clearTemplates'
  >,
) {
  return (
    failure: NonNullable<ContextCdpSourceSummary['failure']>,
    fallbackCheck: RejectedCheck,
  ) => {
    if (chapterReadScope.collection)
      chapterReadScope.firstCdpFaultCheck ??= chapterReadScope.rejectedCandidate ?? fallbackCheck;
    chapterReadScope.rejectedCandidate = null;
    chapterReadScope.cdpSource.failure ??= failure;
    chapterReadScope.recordViolation(
      failure === 'disconnected'
        ? 'cdp_disconnected'
        : failure === 'cleanup_failed'
          ? 'cdp_cleanup_failed'
          : 'cdp_source_unverified',
    );
    chapterReadScope.closeCollectionSourceWindow();
    chapterReadScope.closeViewWindow();
    chapterReadScope.recordSourceClear('cdp_fault');
    chapterReadScope.violated = true;
    chapterReadScope.clearTemplates();
  };
}

export function createNonempty(chapterReadScope: Pick<ChapterReadState, never>) {
  return (value: unknown): value is string => typeof value === 'string' && value.length > 0;
}

export function createDeferCdp(
  chapterReadScope: Pick<ChapterReadState, 'rootFrame' | 'deferredCdp' | 'cdpFault'>,
) {
  return (callback: () => void) => {
    if (chapterReadScope.rootFrame) callback();
    else if (chapterReadScope.deferredCdp.length < 32) chapterReadScope.deferredCdp.push(callback);
    else
      chapterReadScope.cdpFault('source_unverified', {
        site: 'deferred_events',
        predicate: 'event_limit',
      });
  };
}

export function createAcceptBootstrapNavigationEvent(
  chapterReadScope: Pick<
    ChapterReadState,
    'controlledGoto' | 'frozen' | 'observeRejectedCheck' | 'bootstrapNavigationEvents' | 'cdpFault'
  >,
) {
  return () => {
    if (!chapterReadScope.controlledGoto || chapterReadScope.frozen) return true;
    if (
      chapterReadScope.observeRejectedCheck(
        'bootstrap_event_bound',
        'event_limit',
        chapterReadScope.bootstrapNavigationEvents >= 32,
      )
    ) {
      chapterReadScope.cdpFault('source_unverified', {
        site: 'bootstrap_event_bound',
        predicate: 'guard_failed',
      });
      return false;
    }
    chapterReadScope.bootstrapNavigationEvents += 1;
    return true;
  };
}

export function createCdpFrameDetached(
  chapterReadScope: Pick<
    ChapterReadState,
    'deferCdp' | 'observeRejectedCheck' | 'nonempty' | 'rootFrame' | 'cdpFault'
  >,
) {
  return (event: { frameId: string }) => {
    const frameId = event.frameId;
    chapterReadScope.deferCdp(() => {
      if (
        chapterReadScope.observeRejectedCheck(
          'frame_detach',
          'frame_missing',
          !chapterReadScope.nonempty(frameId),
        ) ||
        chapterReadScope.observeRejectedCheck(
          'frame_detach',
          'root_detached',
          frameId === chapterReadScope.rootFrame,
        )
      )
        chapterReadScope.cdpFault('source_unverified', {
          site: 'frame_detach',
          predicate: 'guard_failed',
        });
    });
  };
}

export function createCdpClosed(
  chapterReadScope: Pick<
    ChapterReadState,
    'cdpSource' | 'observeRejectedCheck' | 'expectedDetach' | 'cdpFault'
  >,
) {
  return () => {
    chapterReadScope.cdpSource.connected = false;
    if (
      chapterReadScope.observeRejectedCheck(
        'cdp_close',
        'unexpected_close',
        !chapterReadScope.expectedDetach,
      )
    )
      chapterReadScope.cdpFault('disconnected', { site: 'cdp_close', predicate: 'guard_failed' });
  };
}
