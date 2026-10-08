import { type ChapterReadState } from './chapterReadScope.js';
export function createCdpWithinDocument(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'deferCdp'
    | 'observeRejectedCheck'
    | 'nonempty'
    | 'cdpFault'
    | 'rootFrame'
    | 'acceptBootstrapNavigationEvent'
    | 'frozen'
    | 'pendingNavigation'
    | 'violated'
    | 'active'
    | 'cdpSource'
    | 'controlledGoto'
    | 'loader'
    | 'permittedRoute'
    | 'committed'
    | 'pendingSameDocument'
    | 'frozenUrl'
    | 'page'
    | 'frozenLoader'
    | 'frozenGeneration'
    | 'generation'
  >,
) {
  return (event: { frameId: string; url: string }) => {
    const value = { frameId: event.frameId, url: event.url };
    chapterReadScope.deferCdp(() => {
      if (
        chapterReadScope.observeRejectedCheck(
          'within_frame',
          'frame_missing',
          !chapterReadScope.nonempty(value.frameId),
        )
      ) {
        chapterReadScope.cdpFault('source_unverified', {
          site: 'within_frame',
          predicate: 'guard_failed',
        });
        return;
      }
      if (value.frameId !== chapterReadScope.rootFrame) return;
      if (!chapterReadScope.acceptBootstrapNavigationEvent()) return;
      if (!chapterReadScope.frozen && chapterReadScope.pendingNavigation) {
        if (
          chapterReadScope.observeRejectedCheck(
            'within_base',
            'prior_violation',
            chapterReadScope.violated,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'within_base',
            'inactive',
            !chapterReadScope.active(),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'within_base',
            'disconnected',
            !chapterReadScope.cdpSource.connected,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'within_base',
            'uncontrolled',
            !chapterReadScope.controlledGoto,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'within_base',
            'loader_missing',
            !chapterReadScope.nonempty(chapterReadScope.loader),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'within_base',
            'route_not_permitted',
            !chapterReadScope.permittedRoute(value.url),
          )
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'within_base',
            predicate: 'guard_failed',
          });
          return;
        }
        // A within-document notification has no loader or navigation identity.
        // While a new document is pending it grants no completion or sources:
        // retain every latch until a matching new-document commit arrives.
        return;
      }
      if (
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'prior_violation',
          chapterReadScope.violated,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'inactive',
          !chapterReadScope.active(),
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'disconnected',
          !chapterReadScope.cdpSource.connected,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'uncontrolled',
          !chapterReadScope.controlledGoto,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'pending_new_document',
          chapterReadScope.pendingNavigation,
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'loader_missing',
          !chapterReadScope.nonempty(chapterReadScope.loader),
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'route_not_permitted',
          !chapterReadScope.permittedRoute(value.url),
        ) ||
        chapterReadScope.observeRejectedCheck(
          'within_base',
          'unpaired_completion',
          !chapterReadScope.committed && !chapterReadScope.pendingSameDocument,
        ) ||
        (chapterReadScope.frozen &&
          (chapterReadScope.observeRejectedCheck(
            'within_frozen',
            'uncommitted',
            !chapterReadScope.committed,
          ) ||
            chapterReadScope.observeRejectedCheck(
              'within_frozen',
              'event_url_changed',
              value.url !== chapterReadScope.frozenUrl,
            ) ||
            chapterReadScope.observeRejectedCheck(
              'within_frozen',
              'page_url_changed',
              chapterReadScope.page.url() !== chapterReadScope.frozenUrl,
            ) ||
            chapterReadScope.observeRejectedCheck(
              'within_frozen',
              'frozen_loader_changed',
              chapterReadScope.loader !== chapterReadScope.frozenLoader,
            ) ||
            chapterReadScope.observeRejectedCheck(
              'within_frozen',
              'frozen_generation_changed',
              chapterReadScope.frozenGeneration !== chapterReadScope.generation,
            )))
      ) {
        chapterReadScope.cdpFault('source_unverified', {
          site: 'within_base',
          predicate: 'guard_failed',
        });
        return;
      }
      // Within-document events have no loader field: the bound committed loader
      // and final connected frame-tree barrier supply that independent check.
      if (chapterReadScope.frozen) {
        if (
          chapterReadScope.observeRejectedCheck(
            'within_event_bound',
            'event_limit',
            chapterReadScope.cdpSource.frozenSameDocumentEvents >= 32,
          )
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'within_event_bound',
            predicate: 'guard_failed',
          });
          return;
        }
        chapterReadScope.cdpSource.frozenSameDocumentEvents += 1;
      }
      // Only an explicit same-document completion can settle bootstrap starts;
      // it cannot cancel a pending new document or clear any prior violation.
      chapterReadScope.pendingSameDocument = false;
      chapterReadScope.committed = true;
      chapterReadScope.cdpSource.committedLoaderObserved = true;
    });
  };
}
