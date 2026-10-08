import { type Request, type Response, type Route } from 'playwright';
import {
  type OwnedShortMetadataRunOwner,
  type OwnedShortMetadataRunGlobals,
} from '../short-metadata-schema.js';
export function createOwnedShortMetadataRunNetwork(
  deps: Pick<
    OwnedShortMetadataRunOwner,
    | 'page'
    | 'fresh'
    | 'isRootRequest'
    | 'allowed'
    | 'workId'
    | 'committed'
    | 'connected'
    | 'alias'
    | 'aliasRequests'
    | 'network'
    | 'root'
    | 'loader'
    | 'failProtocol'
    | 'check'
    | 'reason'
    | 'ending'
    | 'navigating'
    | 'documentRequests'
    | 'result'
    | 'rejectAsync'
    | 'stop'
    | 'registerAlias'
    | 'aliasResponse'
    | 'sourceRequest'
    | 'candidateCount'
    | 'requests'
    | 'track'
    | 'observation'
    | 'wake'
  >,
  globals: Pick<
    OwnedShortMetadataRunGlobals,
    | 'isShortMetadataEditUrl'
    | 'shortMetadataDocument'
    | 'SHORT_METADATA_STATIC_ALIAS'
    | 'classifyShortMetadataRequest'
    | 'bounded'
    | 'object'
    | 'projectShortMetadataFields'
  >,
) {
  function isRootRequest(request: Request): boolean {
    try {
      return Boolean(
        deps.page &&
        request.frame() === deps.page.mainFrame() &&
        request.frame().page() === deps.page &&
        deps.page.context() === deps.fresh &&
        !request.serviceWorker(),
      );
    } catch {
      return false;
    }
  }
  function networkKind(type: string): string {
    return (
      (
        {
          Document: 'document',
          Script: 'script',
          Stylesheet: 'stylesheet',
          XHR: 'xhr',
          Fetch: 'fetch',
        } as Record<string, string>
      )[type] ?? 'other'
    );
  }
  function sourceRequest(request: Request): boolean {
    try {
      return (
        deps.isRootRequest(request) &&
        deps.allowed.has(request) &&
        request.method() === 'GET' &&
        globals.isShortMetadataEditUrl(request.url(), deps.workId) &&
        ['xhr', 'fetch'].includes(request.resourceType()) &&
        !request.redirectedFrom() &&
        deps.committed &&
        deps.connected &&
        deps.page?.url() === globals.shortMetadataDocument(deps.workId)
      );
    } catch {
      return false;
    }
  }
  function registerAlias(request: Request): boolean {
    // PW 1.63 keeps the original URL in owned Network/Fetch events but mutates
    // this same Request to wire after route.continue ACK (new isolated probe).
    // Register the exact source object before that mutation; never allow wire alone.
    if (
      deps.alias ||
      request.url() !== globals.SHORT_METADATA_STATIC_ALIAS.source ||
      deps.aliasRequests.size !== 1 ||
      !deps.aliasRequests.has(request) ||
      request.redirectedFrom()
    )
      return false;
    const candidates = [...deps.network.entries()].filter(
      ([, item]) =>
        item.url === globals.SHORT_METADATA_STATIC_ALIAS.source &&
        item.method === 'GET' &&
        item.type === 'Script' &&
        item.frame === deps.root &&
        item.loader === deps.loader &&
        item.allowed,
    );
    if (candidates.length !== 1) return false;
    deps.alias = {
      request,
      networkId: candidates[0]![0],
      routeAck: false,
      responseSeen: false,
      fetchSeen: false,
      fetchAck: false,
    };
    return true;
  }
  function aliasResponse(response: Response, request: Request): boolean {
    if (
      deps.alias?.request !== request &&
      request.url() !== globals.SHORT_METADATA_STATIC_ALIAS.source &&
      request.url() !== globals.SHORT_METADATA_STATIC_ALIAS.wire &&
      response.url() !== globals.SHORT_METADATA_STATIC_ALIAS.wire
    )
      return false;
    const alias = deps.alias,
      observed = alias && deps.network.get(alias.networkId);
    if (
      !alias ||
      alias.request !== request ||
      !alias.routeAck ||
      alias.responseSeen ||
      !alias.fetchSeen ||
      !deps.allowed.has(request) ||
      !deps.isRootRequest(request) ||
      request.url() !== globals.SHORT_METADATA_STATIC_ALIAS.wire ||
      request.method() !== 'GET' ||
      request.resourceType() !== 'script' ||
      request.isNavigationRequest() ||
      request.redirectedFrom() ||
      response.url() !== globals.SHORT_METADATA_STATIC_ALIAS.wire ||
      response.status() < 200 ||
      response.status() >= 300 ||
      !observed ||
      observed.url !== globals.SHORT_METADATA_STATIC_ALIAS.source ||
      observed.type !== 'Script' ||
      observed.method !== 'GET' ||
      observed.frame !== deps.root ||
      observed.loader !== deps.loader ||
      !observed.allowed
    ) {
      deps.failProtocol();
      return true;
    }
    alias.responseSeen = true;
    return true;
  }
  async function guardRoute(route: Route, request: Request): Promise<void> {
    try {
      deps.check();
    } catch {
      /* stop latch forces the route to abort below */
    }
    let kind: ReturnType<OwnedShortMetadataRunGlobals['classifyShortMetadataRequest']> = 'deny';
    try {
      kind = globals.classifyShortMetadataRequest(
        request.url(),
        request.method(),
        request.resourceType(),
        request.isNavigationRequest(),
        deps.workId,
      );
    } catch {
      /* fixed deny */
    }
    const root = deps.isRootRequest(request);
    const allowed =
      !deps.reason &&
      !deps.ending &&
      root &&
      kind !== 'deny' &&
      (kind === 'document'
        ? deps.navigating && !deps.committed && deps.documentRequests <= 1
        : deps.committed);
    if (!allowed) {
      if (!root)
        deps.result.blocked.foreignFrame = globals.bounded(deps.result.blocked.foreignFrame + 1);
      else if (request.method() !== 'GET')
        deps.result.blocked.nonGet = globals.bounded(deps.result.blocked.nonGet + 1);
      else deps.result.blocked.unknownGet = globals.bounded(deps.result.blocked.unknownGet + 1);
      try {
        await route.abort('blockedbyclient');
      } catch (error) {
        deps.rejectAsync(error);
      }
      deps.stop('request_blocked');
      return;
    }
    const isAlias = request.url() === globals.SHORT_METADATA_STATIC_ALIAS.source;
    if (isAlias && !deps.registerAlias(request)) {
      deps.failProtocol();
      try {
        await route.abort('blockedbyclient');
      } catch (error) {
        deps.rejectAsync(error);
      }
      return;
    }
    deps.allowed.add(request);
    try {
      await route.continue(isAlias ? { url: globals.SHORT_METADATA_STATIC_ALIAS.wire } : undefined);
      if (isAlias) {
        if (
          !deps.alias ||
          deps.alias.request !== request ||
          request.url() !== globals.SHORT_METADATA_STATIC_ALIAS.wire
        )
          deps.failProtocol();
        else deps.alias.routeAck = true;
      }
    } catch (error) {
      deps.rejectAsync(error);
    }
  }
  async function acceptResponse(response: Response): Promise<void> {
    const request = response.request();
    if (deps.aliasResponse(response, request)) return;
    if (!deps.sourceRequest(request)) {
      if (globals.isShortMetadataEditUrl(response.url(), deps.workId))
        deps.stop('response_unverified');
      return;
    }
    deps.candidateCount++;
    if (
      deps.candidateCount !== 1 ||
      !deps.requests.has(request) ||
      response.url() !== request.url() ||
      response.status() < 200 ||
      response.status() >= 300
    ) {
      deps.stop('response_unverified');
      return;
    }
    const candidates = [...deps.network.values()].filter(
      (item) =>
        item.url === request.url() &&
        item.method === 'GET' &&
        ['XHR', 'Fetch'].includes(item.type) &&
        item.frame === deps.root &&
        item.loader === deps.loader &&
        item.allowed,
    );
    if (candidates.length !== 1) {
      deps.stop('response_unverified');
      return;
    }
    deps.check();
    const bytes = await deps.track(response.body());
    deps.check();
    if (bytes.length > 3_000_000) {
      deps.stop('response_unverified');
      return;
    }
    const envelope = globals.object(JSON.parse(bytes.toString('utf8'))),
      data = globals.object(envelope?.data);
    if (
      envelope?.code !== 0 ||
      !data ||
      (data.item_id !== undefined && data.item_id !== deps.workId && data.item_id !== '0') ||
      ![0, 1].includes(data.publish_status as number)
    ) {
      deps.stop('response_unverified');
      return;
    }
    // JSON contains private values in RAM. Only these fixed metadata slots are inspected.
    deps.observation = globals.projectShortMetadataFields(data);
    deps.result.proof.uniqueNaturalResponse = true;
    deps.wake?.();
  }
  return {
    isRootRequest,
    networkKind,
    sourceRequest,
    registerAlias,
    aliasResponse,
    guardRoute,
    acceptResponse,
  };
}
