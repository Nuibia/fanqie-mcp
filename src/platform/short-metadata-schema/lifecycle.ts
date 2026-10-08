import {
  type ShortMetadataReason,
  type OwnedShortMetadataRunOwner,
  type OwnedShortMetadataRunGlobals,
} from '../short-metadata-schema.js';

export function createOwnedShortMetadataRunLifecycle(
  deps: Pick<
    OwnedShortMetadataRunOwner,
    | 'pending'
    | 'reason'
    | 'options'
    | 'stop'
    | 'browser'
    | 'observation'
    | 'wake'
    | 'fresh'
    | 'startClose'
    | 'closing'
    | 'ending'
    | 'track'
    | 'closed'
    | 'closeTerminal'
    | 'unregister'
    | 'result'
    | 'failProtocol'
    | 'rejectAsync'
    | 'check'
    | 'connected'
    | 'committed'
    | 'documentRequests'
    | 'candidateCount'
    | 'page'
    | 'workId'
    | 'cdp'
    | 'root'
    | 'loader'
    | 'aliasRequests'
    | 'network'
    | 'alias'
  >,
  globals: Pick<
    OwnedShortMetadataRunGlobals,
    'bounded' | 'shortMetadataDocument' | 'SHORT_METADATA_STATIC_ALIAS'
  >,
) {
  function track<T>(promise: Promise<T>): Promise<T> {
    deps.pending.add(promise);
    void promise.then(
      () => deps.pending.delete(promise),
      () => deps.pending.delete(promise),
    );
    return promise;
  }
  function check(): void {
    if (deps.reason) throw new Error('Metadata observation stopped');
    if (deps.options.signal?.aborted) {
      deps.stop('cancelled');
      throw new Error('Metadata observation cancelled');
    }
    if (performance.now() >= deps.options.deadline) {
      deps.stop('timeout');
      throw new Error('Metadata deadline exceeded');
    }
    try {
      const result: unknown = deps.options.assertLease();
      if (result && typeof result === 'object' && 'then' in result) throw new Error();
    } catch {
      deps.stop('lease_unavailable');
      throw new Error('Metadata lease unavailable');
    }
    try {
      deps.options.assertBorrowedActive();
      if (!deps.browser.isConnected()) throw new Error();
    } catch {
      deps.stop('source_changed');
      throw new Error('Metadata borrowed context changed');
    }
  }
  function stop(reason: ShortMetadataReason = 'cancelled'): void {
    deps.reason ??= reason;
    deps.observation = null;
    deps.wake?.();
    if (deps.fresh) deps.startClose();
  }
  function startClose(): void {
    if (!deps.fresh || deps.closing) return;
    deps.ending = true;
    const context = deps.fresh;
    let resolve!: () => void, reject!: (error: unknown) => void;
    deps.closing = deps.track(
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    // Install the close promise before invoking a possibly synchronous close event.
    void (async () => {
      try {
        await context.close();
      } catch (error) {
        if (deps.closed && !deps.closeTerminal(error)) {
          deps.reason ??= 'cleanup_failed';
          deps.observation = null;
        }
        if (!deps.closed) {
          deps.reason = 'cleanup_failed';
          deps.observation = null;
          // An unclosed owned context must retain the browser/account FIFO. Runtime
          // shutdown grace reports shutdown_incomplete without closing the Store.
          await new Promise<void>(() => {});
        }
      }
      if (!deps.closed) {
        deps.reason = 'cleanup_failed';
        deps.observation = null;
        await new Promise<void>(() => {});
      }
    })().then(resolve, reject);
  }
  function listen(
    target: { on: Function; off: Function },
    event: string,
    handler: (...args: any[]) => void,
  ): void {
    target.on(event, handler);
    deps.unregister.push(() => target.off(event, handler));
  }
  function failProtocol(): void {
    deps.result.blocked.protocolFailure = globals.bounded(deps.result.blocked.protocolFailure + 1);
    deps.stop('protocol_failed');
  }
  function closeTerminal(error: unknown): boolean {
    // Playwright 1.63 serializes server TargetClosedError into the client
    // TargetClosedError2 class. Neither arbitrary text nor the close flag alone
    // proves an asynchronous failure was caused by owned context termination.
    if (!deps.closed || !(error instanceof Error)) return false;
    try {
      return (
        error.name === 'TargetClosedError' ||
        ['TargetClosedError', 'TargetClosedError2'].includes(error.constructor.name)
      );
    } catch {
      return false;
    }
  }
  function rejectAsync(error: unknown): void {
    if (!deps.closeTerminal(error)) deps.failProtocol();
  }
  function eventTask(action: () => Promise<void>): void {
    const task = deps.track(
      (async () => {
        try {
          await action();
        } catch (error) {
          deps.rejectAsync(error);
        }
      })(),
    );
    void task;
  }
  async function barrier(): Promise<void> {
    deps.check();
    if (
      !deps.connected ||
      !deps.committed ||
      deps.documentRequests !== 1 ||
      deps.candidateCount !== 1 ||
      !deps.observation ||
      deps.page!.url() !== globals.shortMetadataDocument(deps.workId)
    ) {
      deps.stop('source_changed');
      throw new Error();
    }
    const tree = await deps.track(deps.cdp!.send('Page.getFrameTree'));
    deps.check();
    const frame = tree.frameTree?.frame;
    if (
      !deps.connected ||
      !frame ||
      frame.id !== deps.root ||
      frame.parentId ||
      frame.urlFragment ||
      frame.loaderId !== deps.loader ||
      frame.url !== globals.shortMetadataDocument(deps.workId) ||
      tree.frameTree.childFrames?.length
    ) {
      deps.stop('source_changed');
      throw new Error();
    }
    const aliasTraffic =
      deps.aliasRequests.size ||
      [...deps.network.values()].some(
        (item) => item.url === globals.SHORT_METADATA_STATIC_ALIAS.source,
      );
    if (
      aliasTraffic &&
      (!deps.alias || !deps.alias.routeAck || !deps.alias.responseSeen || !deps.alias.fetchAck)
    ) {
      deps.stop('response_unverified');
      throw new Error();
    }
    deps.result.proof.connectedBarrier = true;
    deps.result.proof.proofCapturedAt = new Date().toISOString();
  }
  return {
    track,
    check,
    stop,
    startClose,
    listen,
    failProtocol,
    closeTerminal,
    rejectAsync,
    eventTask,
    barrier,
  };
}
