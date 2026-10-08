import { type ChapterReadState } from './chapterReadScope.js';
export function createCdpRequest(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'deferCdp'
    | 'rootFrame'
    | 'acceptBootstrapNavigationEvent'
    | 'observeRejectedCheck'
    | 'frozen'
    | 'violated'
    | 'generation'
    | 'cdpFault'
    | 'active'
    | 'cdpSource'
    | 'controlledGoto'
    | 'nonempty'
    | 'permittedRoute'
    | 'pendingNavigation'
    | 'pendingLoader'
    | 'recordSourceClear'
    | 'clearBootstrapSources'
    | 'pendingSameDocument'
    | 'committed'
    | 'collection'
    | 'viewWindow'
    | 'stable'
    | 'closeViewWindow'
    | 'frozenLoader'
    | 'target'
    | 'workId'
    | 'requestIds'
    | 'managementRequestIds'
    | 'canAcquireFrozenCollectionSource'
    | 'recordSourceRequest'
    | 'loader'
    | 'diagnostic'
    | 'templates'
    | 'bookTemplates'
    | 'chapterTemplates'
    | 'collectionSourceWake'
  >,
) {
  return (event: {
    requestId: string;
    loaderId: string;
    frameId?: string;
    type?: string;
    request: {
      url: string;
      method: string;
    };
    redirectResponse?: unknown;
  }) => {
    const value = {
      requestId: event.requestId,
      loaderId: event.loaderId,
      frameId: event.frameId,
      type: event.type,
      url: event.request.url,
      method: event.request.method,
      redirected: event.redirectResponse !== undefined,
    };
    chapterReadScope.deferCdp(() => {
      if (value.type === 'Document' && value.frameId === chapterReadScope.rootFrame) {
        if (!chapterReadScope.acceptBootstrapNavigationEvent()) return;
        if (
          chapterReadScope.observeRejectedCheck(
            'document_state',
            'frozen',
            chapterReadScope.frozen,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'document_state',
            'prior_violation',
            chapterReadScope.violated,
          )
        ) {
          chapterReadScope.generation += 1;
          chapterReadScope.cdpFault('source_unverified', {
            site: 'document_state',
            predicate: 'guard_failed',
          });
          return;
        }
        if (
          chapterReadScope.observeRejectedCheck(
            'document_base',
            'inactive',
            !chapterReadScope.active(),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'document_base',
            'disconnected',
            !chapterReadScope.cdpSource.connected,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'document_base',
            'uncontrolled',
            !chapterReadScope.controlledGoto,
          ) ||
          chapterReadScope.observeRejectedCheck(
            'document_base',
            'loader_missing',
            !chapterReadScope.nonempty(value.loaderId),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'document_base',
            'route_not_permitted',
            !chapterReadScope.permittedRoute(value.url),
          ) ||
          chapterReadScope.observeRejectedCheck(
            'document_base',
            'redirect_observed',
            value.redirected,
          ) ||
          (chapterReadScope.pendingNavigation &&
            chapterReadScope.observeRejectedCheck(
              'document_base',
              'pending_loader_mismatch',
              chapterReadScope.pendingLoader !== value.loaderId,
            ))
        ) {
          chapterReadScope.cdpFault('source_unverified', {
            site: 'document_base',
            predicate: 'guard_failed',
          });
          return;
        }
        chapterReadScope.recordSourceClear('new_document_request');
        chapterReadScope.generation += 1;
        chapterReadScope.clearBootstrapSources();
        chapterReadScope.pendingNavigation = true;
        chapterReadScope.pendingSameDocument = false;
        chapterReadScope.committed = false;
        chapterReadScope.pendingLoader = value.loaderId;
        return;
      }
      if (
        chapterReadScope.collection &&
        chapterReadScope.frozen &&
        chapterReadScope.viewWindow?.open &&
        chapterReadScope.viewWindow.actionStarted
      ) {
        const window = chapterReadScope.viewWindow;
        if (performance.now() >= window.deadline || !chapterReadScope.stable()) {
          chapterReadScope.closeViewWindow();
          return;
        }
        if (
          value.method !== 'GET' ||
          !['XHR', 'Fetch'].includes(value.type ?? '') ||
          value.frameId !== chapterReadScope.rootFrame ||
          value.loaderId !== chapterReadScope.frozenLoader ||
          !chapterReadScope.nonempty(value.requestId) ||
          value.redirected
        )
          return;
        try {
          const source = new URL(value.url);
          if (
            source.origin !== chapterReadScope.target.origin ||
            source.pathname !== '/api/author/chapter/chapter_list/v1' ||
            source.username ||
            source.password ||
            source.hash ||
            new Set(source.searchParams.keys()).size !== source.searchParams.size ||
            source.searchParams.getAll('book_id').length !== 1 ||
            source.searchParams.get('book_id') !== chapterReadScope.workId ||
            source.searchParams.getAll('volume_id').length !== 1 ||
            source.searchParams.get('volume_id') !== window.volumeId ||
            [...source.searchParams.keys()].some((key) =>
              /^(?:author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id|bookId|work_id|workId)$/i.test(
                key,
              ),
            )
          )
            return;
          if (
            chapterReadScope.requestIds.has(value.requestId) ||
            chapterReadScope.managementRequestIds.has(value.requestId)
          ) {
            chapterReadScope.cdpFault('source_unverified', {
              site: 'source_request_id',
              predicate: 'duplicate_request_id',
            });
            return;
          }
          if (window.requestIds.size >= 32 || chapterReadScope.managementRequestIds.size >= 2048) {
            window.exhausted = true;
            chapterReadScope.closeViewWindow();
            return;
          }
          window.requestIds.add(value.requestId);
          chapterReadScope.managementRequestIds.add(value.requestId);
          if (window.sources.size < 2) window.sources.add(value.url);
          window.wake?.();
        } catch {
          /* No malformed or unrelated URL creates view authority. */
        }
        return;
      }
      if (
        (chapterReadScope.frozen && !chapterReadScope.canAcquireFrozenCollectionSource()) ||
        !chapterReadScope.controlledGoto ||
        chapterReadScope.pendingNavigation ||
        chapterReadScope.pendingSameDocument ||
        !chapterReadScope.committed ||
        chapterReadScope.violated ||
        !chapterReadScope.active()
      ) {
        chapterReadScope.recordSourceRequest(value, 'state_filtered');
        return;
      }
      if (
        value.method !== 'GET' ||
        !['XHR', 'Fetch'].includes(value.type ?? '') ||
        value.frameId !== chapterReadScope.rootFrame ||
        !chapterReadScope.nonempty(value.loaderId) ||
        value.loaderId !== chapterReadScope.loader ||
        !chapterReadScope.nonempty(value.requestId)
      ) {
        chapterReadScope.recordSourceRequest(value, 'request_filtered');
        return;
      }
      if (
        chapterReadScope.observeRejectedCheck(
          'source_request_id',
          'duplicate_request_id',
          chapterReadScope.requestIds.has(value.requestId),
        )
      ) {
        chapterReadScope.recordSourceRequest(value, 'duplicate_request_id');
        chapterReadScope.cdpFault('source_unverified', {
          site: 'source_request_id',
          predicate: 'guard_failed',
        });
        return;
      }
      if (value.redirected) {
        chapterReadScope.recordSourceRequest(value, 'redirected');
        return;
      }
      try {
        const source = new URL(value.url);
        if (
          source.origin !== 'https://fanqienovel.com' ||
          source.username ||
          source.password ||
          source.hash ||
          !(chapterReadScope.collection
            ? [
                chapterReadScope.diagnostic.pathTemplate,
                '/api/author/book/book_detail/v0/',
                '/api/author/chapter/chapter_list/v1',
              ].includes(source.pathname)
            : source.pathname === chapterReadScope.diagnostic.pathTemplate) ||
          new Set(source.searchParams.keys()).size !== source.searchParams.size ||
          source.searchParams.getAll('book_id').length !== 1 ||
          source.searchParams.get('book_id') !== chapterReadScope.workId ||
          [...source.searchParams.keys()].some((key) =>
            /^(?:author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id|bookId|work_id|workId)$/i.test(
              key,
            ),
          )
        ) {
          chapterReadScope.recordSourceRequest(value, 'url_filtered');
          return;
        }
        chapterReadScope.requestIds.add(value.requestId);
        const family =
          source.pathname === chapterReadScope.diagnostic.pathTemplate
            ? chapterReadScope.templates
            : source.pathname === '/api/author/book/book_detail/v0/'
              ? chapterReadScope.bookTemplates
              : chapterReadScope.chapterTemplates;
        const sourceCapacityAvailable = family.size < 2;
        if (family.size < 2) family.add(value.url);
        chapterReadScope.recordSourceRequest(
          value,
          sourceCapacityAvailable ? 'retained_add_attempt' : 'capacity_limit',
        );
        chapterReadScope.collectionSourceWake?.();
      } catch {
        chapterReadScope.recordSourceRequest(
          value,
          'url_parse_failed',
        ); /* Unknown source fields or URLs never become templates. */
      }
    });
  };
}
