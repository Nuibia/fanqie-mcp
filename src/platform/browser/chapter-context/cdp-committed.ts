import { type ChapterReadState } from './chapterReadScope.js';
export function createCdpCommitted(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'deferCdp'
    | 'observeRejectedCheck'
    | 'nonempty'
    | 'cdpFault'
    | 'rootFrame'
    | 'recordSourceClear'
    | 'generation'
    | 'clearBootstrapSources'
    | 'acceptBootstrapNavigationEvent'
    | 'controlledGoto'
    | 'frozen'
    | 'committed'
    | 'violated'
    | 'pendingLoader'
    | 'active'
    | 'cdpSource'
    | 'pendingNavigation'
    | 'permittedRoute'
    | 'loader'
    | 'pendingSameDocument'
  >,
) {
  return (event: {
    frame: {
      id: string;
      loaderId: string;
      url: string;
      parentId?: string;
      urlFragment?: string;
    };
  }) => {
    const frame = {
      id: event.frame.id,
      loaderId: event.frame.loaderId,
      url: event.frame.url,
      parentId: event.frame.parentId,
      urlFragment: event.frame.urlFragment,
    };
    chapterReadScope.deferCdp(() => {
      if (
        chapterReadScope.observeRejectedCheck(
          'commit_frame',
          'frame_missing',
          !chapterReadScope.nonempty(frame.id),
        )
      ) {
        chapterReadScope.cdpFault('source_unverified', {
          site: 'commit_frame',
          predicate: 'guard_failed',
        });
        return;
      }
      if (frame.id !== chapterReadScope.rootFrame) {
        if (
          chapterReadScope.observeRejectedCheck(
            'commit_frame',
            'other_root_without_parent',
            !frame.parentId,
          )
        )
          chapterReadScope.cdpFault('source_unverified', {
            site: 'commit_frame',
            predicate: 'guard_failed',
          });
        return;
      }
      // Every canonical new-document commit clears all candidate sources.
      chapterReadScope.recordSourceClear('new_document_commit');
      chapterReadScope.generation += 1;
      chapterReadScope.clearBootstrapSources();
      if (!chapterReadScope.acceptBootstrapNavigationEvent()) return;
      if (!chapterReadScope.controlledGoto) {
        // Initialization notifications keep the original loader-only semantics:
        // they never authorize a target document or clear an earlier violation.
        if (
          chapterReadScope.observeRejectedCheck(
            'commit_uncontrolled',
            'frozen',
            chapterReadScope.frozen,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_uncontrolled',
            'already_committed',
            chapterReadScope.committed,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_uncontrolled',
            'prior_violation',
            chapterReadScope.violated,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_uncontrolled',
            'parent_present',
            frame.parentId,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_uncontrolled',
            'loader_missing',
            !chapterReadScope.nonempty(frame.loaderId),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_uncontrolled',
            'fragment_present',
            frame.urlFragment,
          ) ||
          (chapterReadScope.pendingLoader &&
            chapterReadScope.observeRejectedCheck(
              'commit_uncontrolled',
              'pending_loader_mismatch',
              chapterReadScope.pendingLoader !== frame.loaderId,
            ))
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'commit_uncontrolled',
            predicate: 'guard_failed',
          });
          return;
        }
      } else {
        if (
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'frozen',
            chapterReadScope.frozen,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'prior_violation',
            chapterReadScope.violated,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'inactive',
            !chapterReadScope.active(),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'disconnected',
            !chapterReadScope.cdpSource.connected,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'parent_present',
            frame.parentId,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'loader_missing',
            !chapterReadScope.nonempty(frame.loaderId),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'fragment_present',
            frame.urlFragment,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'no_pending_new_document',
            !chapterReadScope.pendingNavigation,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'pending_loader_missing',
            !chapterReadScope.nonempty(chapterReadScope.pendingLoader),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'commit_controlled',
            'pending_loader_mismatch',
            chapterReadScope.pendingLoader !== frame.loaderId,
          )
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'commit_controlled',
            predicate: 'guard_failed',
          });
          return;
        }
        if (
          chapterReadScope.observeRejectedCheck(
            'commit_route',
            'route_not_permitted',
            !chapterReadScope.permittedRoute(frame.url),
          )
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'commit_route',
            predicate: 'guard_failed',
          });
          return;
        }
      }
      chapterReadScope.loader = frame.loaderId;
      chapterReadScope.pendingNavigation = false;
      chapterReadScope.pendingSameDocument = false;
      chapterReadScope.pendingLoader = '';
      chapterReadScope.committed = chapterReadScope.controlledGoto;
      chapterReadScope.cdpSource.committedLoaderObserved = chapterReadScope.committed;
    });
  };
}
