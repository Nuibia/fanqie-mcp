import { type ChapterReadState } from './chapterReadScope.js';
export function createCdpStart(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'deferCdp'
    | 'observeRejectedCheck'
    | 'nonempty'
    | 'cdpFault'
    | 'rootFrame'
    | 'acceptBootstrapNavigationEvent'
    | 'violated'
    | 'active'
    | 'cdpSource'
    | 'controlledGoto'
    | 'permittedRoute'
    | 'pendingNavigation'
    | 'loader'
    | 'frozen'
    | 'committed'
    | 'pendingSameDocument'
    | 'frozenUrl'
    | 'page'
    | 'frozenLoader'
    | 'generation'
    | 'recordSourceClear'
    | 'clearBootstrapSources'
    | 'pendingLoader'
  >,
) {
  return (event: { frameId: string; loaderId: string; url: string; navigationType: string }) => {
    const value = {
      frameId: event.frameId,
      loaderId: event.loaderId,
      url: event.url,
      navigationType: event.navigationType,
    };
    chapterReadScope.deferCdp(() => {
      if (
        chapterReadScope.observeRejectedCheck(
          'start_frame',
          'frame_missing',
          !chapterReadScope.nonempty(value.frameId),
        )
      ) {
        chapterReadScope.cdpFault('source_unverified', {
          site: 'start_frame',
          predicate: 'guard_failed',
        });
        return;
      }
      if (value.frameId !== chapterReadScope.rootFrame) return;
      if (!chapterReadScope.acceptBootstrapNavigationEvent()) return;
      if (
        chapterReadScope.observeRejectedCheck(
          'start_base',
          'prior_violation',
          chapterReadScope.violated,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'start_base',
          'inactive',
          !chapterReadScope.active(),
        ) ||
        chapterReadScope.observeRejectedCheck(
          'start_base',
          'disconnected',
          !chapterReadScope.cdpSource.connected,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'start_base',
          'uncontrolled',
          !chapterReadScope.controlledGoto,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'start_base',
          'loader_missing',
          !chapterReadScope.nonempty(value.loaderId),
        ) ||
        chapterReadScope.observeRejectedCheck(
          'start_base',
          'route_not_permitted',
          !chapterReadScope.permittedRoute(value.url),
        )
      ) {
        chapterReadScope.cdpFault('source_unverified', {
          site: 'start_base',
          predicate: 'guard_failed',
        });
        return;
      }
      if (['sameDocument', 'historySameDocument'].includes(value.navigationType)) {
        if (
          chapterReadScope.observeRejectedCheck(
            'start_same_document',
            'pending_new_document',
            chapterReadScope.pendingNavigation,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'start_same_document',
            'loader_mismatch',
            value.loaderId !== chapterReadScope.loader,
          ) ||
          (chapterReadScope.frozen &&
            (chapterReadScope.observeRejectedCheck(
              'start_same_document',
              'uncommitted',
              !chapterReadScope.committed,
            ) ||
              chapterReadScope.observeRejectedCheck(
                'start_same_document',
                'pending_same_document',
                chapterReadScope.pendingSameDocument,
              ) ||
              chapterReadScope.observeRejectedCheck(
                'start_same_document',
                'event_url_changed',
                value.url !== chapterReadScope.frozenUrl,
              ) ||
              chapterReadScope.observeRejectedCheck(
                'start_same_document',
                'page_url_changed',
                chapterReadScope.page.url() !== chapterReadScope.frozenUrl,
              ) ||
              chapterReadScope.observeRejectedCheck(
                'start_same_document',
                'frozen_loader_changed',
                chapterReadScope.loader !== chapterReadScope.frozenLoader,
              )))
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'start_same_document',
            predicate: 'guard_failed',
          });
          return;
        }
        chapterReadScope.pendingSameDocument = true;
        return;
      }
      if (
        chapterReadScope.observeRejectedCheck(
          'start_new_document',
          'frozen',
          chapterReadScope.frozen,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'start_new_document',
          'unknown_navigation_type',
          ![
            'reload',
            'reloadBypassingCache',
            'restore',
            'restoreWithPost',
            'historyDifferentDocument',
            'differentDocument',
          ].includes(value.navigationType),
        )
      ) {
        chapterReadScope.generation += 1;
        chapterReadScope.cdpFault('source_unverified', {
          site: 'start_new_document',
          predicate: 'guard_failed',
        });
        return;
      }
      // A known controlled bootstrap start may repeat or supersede a cancelled
      // candidate, including a same-document navigation becoming cross-document.
      // Only a commit matching the latest nonempty loader can settle it.
      chapterReadScope.recordSourceClear('new_document_start');
      chapterReadScope.generation += 1;
      chapterReadScope.clearBootstrapSources();
      chapterReadScope.pendingNavigation = true;
      chapterReadScope.pendingSameDocument = false;
      chapterReadScope.committed = false;
      chapterReadScope.pendingLoader = value.loaderId;
    });
  };
}
