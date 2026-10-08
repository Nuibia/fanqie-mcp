import {
  type ShortMetadataResult,
  type OwnedShortMetadataRunOwner,
  type OwnedShortMetadataRunGlobals,
} from '../short-metadata-schema.js';
import { type Request, type Response } from 'playwright';

export function createOwnedShortMetadataRunRun(
  deps: Pick<
    OwnedShortMetadataRunOwner,
    | 'stop'
    | 'options'
    | 'timer'
    | 'check'
    | 'track'
    | 'borrowed'
    | 'browser'
    | 'fresh'
    | 'result'
    | 'listen'
    | 'closed'
    | 'ending'
    | 'wake'
    | 'reason'
    | 'startClose'
    | 'guardRoute'
    | 'eventTask'
    | 'page'
    | 'committed'
    | 'isRootRequest'
    | 'aliasRequests'
    | 'failProtocol'
    | 'workId'
    | 'requests'
    | 'acceptResponse'
    | 'cdp'
    | 'connected'
    | 'setupNetwork'
    | 'initialFrame'
    | 'root'
    | 'own'
    | 'navigating'
    | 'observation'
    | 'barrier'
    | 'closing'
    | 'pending'
    | 'unregister'
    | 'network'
    | 'alias'
    | 'pauses'
  >,
  globals: Pick<
    OwnedShortMetadataRunGlobals,
    | 'ORIGIN'
    | 'bounded'
    | 'SHORT_METADATA_STATIC_ALIAS'
    | 'isShortMetadataEditUrl'
    | 'shortMetadataDocument'
  >,
) {
  async function run(): Promise<ShortMetadataResult> {
    const onAbort = () => deps.stop('cancelled');
    deps.options.signal?.addEventListener('abort', onAbort, { once: true });
    deps.timer = setTimeout(
      () => deps.stop('timeout'),
      Math.max(1, deps.options.deadline - performance.now()),
    );
    try {
      deps.check();
      const cookies = (await deps.track(deps.borrowed.cookies(globals.ORIGIN))).filter((cookie) =>
        ['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain),
      );
      deps.check();
      // Cookie-only RAM bridge; no localStorage, IDB or full profile storageState.
      const fresh = await deps.track(
        deps.browser.newContext({
          serviceWorkers: 'block',
          storageState: { cookies, origins: [] },
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
        }),
      );
      deps.fresh = fresh;
      deps.result.cleanup.contextCreated = true;
      deps.listen(fresh, 'close', () => {
        deps.closed = true;
        deps.result.cleanup.contextClosed = true;
        if (!deps.ending) deps.stop('source_changed');
        deps.wake?.();
      });
      if (deps.reason || deps.options.signal?.aborted || performance.now() >= deps.options.deadline)
        deps.startClose();
      deps.check();
      deps.listen(fresh, 'serviceworker', () => {
        deps.result.blocked.serviceWorker = globals.bounded(deps.result.blocked.serviceWorker + 1);
        deps.stop('request_blocked');
      });
      await deps.track(
        fresh.route('**/*', (route, request) => deps.track(deps.guardRoute(route, request))),
      );
      deps.check();
      await deps.track(
        fresh.routeWebSocket('**/*', (socket) => {
          deps.result.blocked.webSocket = globals.bounded(deps.result.blocked.webSocket + 1);
          deps.stop('request_blocked');
          deps.eventTask(async () => {
            await socket.close();
          });
        }),
      );
      deps.check();
      let creatingPage = true;
      deps.listen(fresh, 'page', (other) => {
        if (creatingPage && !deps.page) deps.page = other;
        else if (other !== deps.page) deps.stop('source_changed');
      });
      const page = await deps.track(fresh.newPage());
      creatingPage = false;
      if ((deps.page && deps.page !== page) || page.context() !== fresh)
        deps.stop('source_changed');
      deps.page = page;
      if (
        deps.reason ||
        deps.options.signal?.aborted ||
        performance.now() >= deps.options.deadline
      ) {
        deps.startClose();
        await deps.track(page.close({ runBeforeUnload: false }));
      }
      deps.check();
      deps.listen(page, 'close', () => {
        if (!deps.ending) deps.stop('source_changed');
        deps.wake?.();
      });
      deps.listen(page, 'request', (request: Request) => {
        if (request.url() === globals.SHORT_METADATA_STATIC_ALIAS.source) {
          if (
            !deps.committed ||
            deps.reason ||
            deps.ending ||
            !deps.isRootRequest(request) ||
            request.method() !== 'GET' ||
            request.resourceType() !== 'script' ||
            request.isNavigationRequest() ||
            request.redirectedFrom() ||
            deps.aliasRequests.size
          )
            deps.failProtocol();
          else deps.aliasRequests.add(request);
        }
        if (globals.isShortMetadataEditUrl(request.url(), deps.workId)) {
          if (
            !deps.committed ||
            deps.reason ||
            deps.ending ||
            !deps.isRootRequest(request) ||
            deps.requests.size
          )
            deps.stop('response_unverified');
          else deps.requests.add(request);
        }
      });
      deps.listen(page, 'response', (response: Response) =>
        deps.eventTask(() => deps.acceptResponse(response)),
      );
      deps.cdp = await deps.track(fresh.newCDPSession(page));
      deps.check();
      deps.connected = true;
      deps.setupNetwork();
      await deps.track(deps.cdp.send('Page.enable'));
      deps.check();
      await deps.track(deps.cdp.send('Network.enable'));
      deps.check();
      const initial = await deps.track(deps.cdp.send('Page.getFrameTree'));
      deps.check();
      const frame = initial.frameTree?.frame;
      if (
        !frame?.id ||
        frame.parentId ||
        frame.url !== 'about:blank' ||
        frame.urlFragment ||
        !frame.loaderId ||
        initial.frameTree.childFrames?.length ||
        page.url() !== 'about:blank'
      ) {
        deps.stop('source_changed');
        throw new Error();
      }
      if (
        deps.initialFrame &&
        (deps.initialFrame.id !== frame.id || deps.initialFrame.loaderId !== frame.loaderId)
      ) {
        deps.stop('source_changed');
        throw new Error();
      }
      deps.root = frame.id;
      await deps.track(
        deps.cdp.send('Fetch.enable', {
          patterns: [{ urlPattern: '*', requestStage: 'Response' }],
        }),
      );
      deps.check();
      await deps.own('ownerBefore');
      deps.navigating = true;
      await deps.track(
        page.goto(globals.shortMetadataDocument(deps.workId), {
          waitUntil: 'domcontentloaded',
          timeout: Math.max(1, deps.options.deadline - performance.now()),
        }),
      );
      deps.check();
      if (!deps.observation)
        await new Promise<void>((resolve) => {
          deps.wake = () => {
            deps.wake = null;
            resolve();
          };
          if (deps.reason || deps.observation) deps.wake();
        });
      deps.check();
      await deps.own('ownerAfter');
      await deps.barrier();
    } catch {
      if (!deps.reason) deps.stop('response_unavailable');
    } finally {
      // Keep all request/Fetch/WS guards until the owned context is actually closed.
      deps.startClose();
      if (deps.closing) await deps.closing;
      if (deps.fresh) {
        try {
          await deps.track(deps.fresh.request.dispose());
          deps.result.cleanup.apiDisposed = true;
        } catch {
          deps.reason ??= 'cleanup_failed';
          deps.observation = null;
        }
      }
      while (deps.pending.size) await Promise.allSettled([...deps.pending]);
      deps.result.cleanup.pendingAtEnd = deps.pending.size;
      for (const off of deps.unregister.splice(0)) off();
      try {
        deps.check();
      } catch {
        /* permanent fixed reason already latched */
      }
      if (!deps.reason && deps.observation) {
        try {
          const callback: unknown = deps.options.onVerifiedAccount(
            deps.options.expectedAccountId,
            deps.result.proof.proofCapturedAt!,
          );
          if (callback && typeof callback === 'object' && 'then' in callback)
            throw new Error('Owner callback must be synchronous');
          deps.result.proof.ownerCallback = true;
          deps.check();
        } catch {
          deps.reason ??= 'callback_failed';
          deps.observation = null;
        }
      }
      if (deps.timer) clearTimeout(deps.timer);
      deps.options.signal?.removeEventListener('abort', onAbort);
      deps.result.cleanup.checkedAt = new Date().toISOString();
      if (
        !deps.reason &&
        deps.observation &&
        deps.result.proof.ownerCallback &&
        deps.result.cleanup.contextClosed &&
        deps.result.cleanup.apiDisposed
      ) {
        deps.result.status = 'success';
        deps.result.reason = null;
        Object.assign(deps.result, deps.observation);
      } else {
        deps.result.status = 'capability_unavailable';
        deps.result.reason = deps.reason ?? 'response_unavailable';
        deps.result.fields = null;
        deps.result.unknownKeyCount = null;
      }
      deps.observation = null;
      deps.network.clear();
      deps.requests.clear();
      deps.aliasRequests.clear();
      deps.alias = null;
      deps.pauses.clear();
      deps.wake = null;
    }
    return deps.result;
  }
  return { run };
}
