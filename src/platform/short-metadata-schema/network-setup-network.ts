import {
  type OwnedShortMetadataRunOwner,
  type OwnedShortMetadataRunGlobals,
} from '../short-metadata-schema.js';
export function createOwnedShortMetadataRunNetworkSetupNetwork(
  deps: Pick<
    OwnedShortMetadataRunOwner,
    | 'cdp'
    | 'listen'
    | 'closed'
    | 'check'
    | 'root'
    | 'stop'
    | 'networkKind'
    | 'workId'
    | 'network'
    | 'failProtocol'
    | 'documentRequests'
    | 'navigating'
    | 'committed'
    | 'documentLoader'
    | 'loader'
    | 'initialFrame'
    | 'result'
    | 'ending'
    | 'connected'
    | 'eventTask'
    | 'pauses'
    | 'alias'
    | 'aliasRequests'
    | 'allowed'
    | 'isRootRequest'
    | 'reason'
    | 'rejectAsync'
  >,
  globals: Pick<
    OwnedShortMetadataRunGlobals,
    | 'classifyShortMetadataRequest'
    | 'SHORT_METADATA_STATIC_ALIAS'
    | 'shortMetadataDocument'
    | 'bounded'
  >,
) {
  function setupNetwork(): void {
    const cdp = deps.cdp!;
    deps.listen(cdp, 'Network.requestWillBeSent', (event) => {
      if (deps.closed) return;
      try {
        deps.check();
        if (
          !event.requestId ||
          !event.loaderId ||
          event.frameId !== deps.root ||
          event.redirectResponse
        ) {
          deps.stop('source_changed');
          return;
        }
        const kind = globals.classifyShortMetadataRequest(
          event.request.url,
          event.request.method,
          deps.networkKind(event.type),
          event.type === 'Document',
          deps.workId,
        );
        const item = {
          url: event.request.url,
          method: event.request.method,
          type: event.type,
          loader: event.loaderId,
          frame: event.frameId,
          allowed: kind !== 'deny',
        };
        if (
          item.url === globals.SHORT_METADATA_STATIC_ALIAS.source &&
          [...deps.network.values()].some(
            (previous) => previous.url === globals.SHORT_METADATA_STATIC_ALIAS.source,
          )
        ) {
          deps.failProtocol();
          return;
        }
        if (deps.network.has(event.requestId) || deps.network.size >= 200) {
          deps.stop('source_changed');
          return;
        }
        deps.network.set(event.requestId, item);
        if (event.type === 'Document') {
          deps.documentRequests++;
          if (
            !deps.navigating ||
            deps.committed ||
            kind !== 'document' ||
            deps.documentRequests !== 1 ||
            (deps.documentLoader && deps.documentLoader !== event.loaderId)
          ) {
            deps.stop('source_changed');
            return;
          }
          deps.documentLoader = event.loaderId;
        } else if (!deps.committed || event.loaderId !== deps.loader) deps.stop('source_changed');
      } catch {
        deps.stop('source_changed');
      }
    });
    deps.listen(cdp, 'Page.frameStartedNavigating', (event) => {
      if (deps.closed) return;
      if (
        !deps.navigating ||
        deps.committed ||
        event.frameId !== deps.root ||
        event.url !== globals.shortMetadataDocument(deps.workId) ||
        !event.loaderId ||
        (deps.documentLoader && deps.documentLoader !== event.loaderId)
      )
        deps.stop('source_changed');
      else deps.documentLoader = event.loaderId;
    });
    deps.listen(cdp, 'Page.frameRequestedNavigation', (event) => {
      if (
        !deps.closed &&
        (!deps.navigating ||
          deps.committed ||
          event.frameId !== deps.root ||
          event.url !== globals.shortMetadataDocument(deps.workId))
      )
        deps.stop('source_changed');
    });
    deps.listen(cdp, 'Page.frameNavigated', (event) => {
      if (deps.closed) return;
      const frame = event.frame;
      if (!deps.root) {
        if (
          frame?.id &&
          frame.loaderId &&
          !frame.parentId &&
          !frame.urlFragment &&
          frame.url === 'about:blank' &&
          !deps.initialFrame
        )
          deps.initialFrame = { id: frame.id, loaderId: frame.loaderId };
        else deps.stop('source_changed');
        return;
      }
      if (
        !deps.navigating &&
        !deps.committed &&
        frame?.id === deps.root &&
        frame.url === 'about:blank'
      )
        return;
      if (
        !frame ||
        frame.id !== deps.root ||
        frame.parentId ||
        frame.urlFragment ||
        !deps.navigating ||
        deps.committed ||
        frame.url !== globals.shortMetadataDocument(deps.workId) ||
        !frame.loaderId ||
        frame.loaderId !== deps.documentLoader ||
        deps.documentRequests !== 1
      ) {
        deps.stop('source_changed');
        return;
      }
      deps.loader = frame.loaderId;
      deps.committed = true;
      deps.result.proof.rootCommitted = true;
    });
    deps.listen(cdp, 'Page.navigatedWithinDocument', (event) => {
      if (
        !deps.closed &&
        (event.frameId !== deps.root ||
          !deps.committed ||
          event.url !== globals.shortMetadataDocument(deps.workId))
      )
        deps.stop('source_changed');
    });
    deps.listen(cdp, 'Page.frameAttached', () => deps.stop('source_changed'));
    deps.listen(cdp, 'Page.frameDetached', () => {
      if (!deps.ending) deps.stop('source_changed');
    });
    deps.listen(cdp, 'Disconnected', () => {
      deps.connected = false;
      if (!deps.ending) deps.stop('source_changed');
    });
    deps.listen(cdp, 'Fetch.requestPaused', (event) =>
      deps.eventTask(async () => {
        const pauseId = event.requestId;
        if (typeof pauseId !== 'string' || !pauseId || deps.pauses.has(pauseId)) {
          deps.failProtocol();
          return;
        }
        deps.pauses.add(pauseId);
        // Close-only terminal events are accepted solely after the owned close event.
        if (deps.closed) return;
        const observed = deps.network.get(event.networkId);
        try {
          deps.check();
        } catch {
          /* response permission below fails closed */
        }
        const alias =
          observed?.url === globals.SHORT_METADATA_STATIC_ALIAS.source ? deps.alias : null;
        // Only the measured source/source CDP pair and registered wire Request can
        // explain this URL difference. Private requests still require exact equality.
        const aliasMatches =
          alias &&
          alias.networkId === event.networkId &&
          alias.routeAck &&
          !alias.fetchSeen &&
          deps.aliasRequests.has(alias.request) &&
          deps.allowed.has(alias.request) &&
          deps.isRootRequest(alias.request) &&
          alias.request.url() === globals.SHORT_METADATA_STATIC_ALIAS.wire &&
          alias.request.method() === 'GET' &&
          alias.request.resourceType() === 'script' &&
          !alias.request.isNavigationRequest() &&
          !alias.request.redirectedFrom() &&
          event.request?.url === globals.SHORT_METADATA_STATIC_ALIAS.source;
        const matches =
          observed &&
          (observed.url === globals.SHORT_METADATA_STATIC_ALIAS.source
            ? aliasMatches
            : observed.url === event.request?.url) &&
          observed.method === event.request?.method &&
          observed.type === event.resourceType &&
          observed.frame === deps.root &&
          event.frameId === deps.root &&
          observed.loader === (observed.type === 'Document' ? deps.documentLoader : deps.loader);
        const status = event.responseStatusCode;
        const safe =
          !deps.reason &&
          !deps.ending &&
          matches &&
          observed.allowed &&
          !event.responseErrorReason &&
          Number.isInteger(status) &&
          status >= 200 &&
          status < 300;
        if (!safe) {
          if (Number.isInteger(status) && status >= 300 && status < 400) {
            deps.result.blocked.redirect = globals.bounded(deps.result.blocked.redirect + 1);
            deps.reason ??= 'redirect_blocked';
          } else if (!deps.ending) deps.reason ??= 'protocol_failed';
          try {
            await cdp.send('Fetch.failRequest', {
              requestId: pauseId,
              errorReason: 'BlockedByClient',
            });
          } catch (error) {
            deps.rejectAsync(error);
          }
          deps.stop(deps.reason ?? 'protocol_failed');
          return;
        }
        if (alias) alias.fetchSeen = true;
        await cdp.send('Fetch.continueResponse', { requestId: pauseId });
        if (alias) alias.fetchAck = true;
      }),
    );
  }
  return { setupNetwork };
}
