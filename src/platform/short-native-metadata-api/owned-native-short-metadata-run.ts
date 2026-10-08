import {
  unavailableNativeShortMetadataApi,
  object,
  type NativeShortMetadataApiResult,
  freeze,
} from './unavailable-native-short-metadata-api.js';

import {
  type NativeShortApiReason,
  type NativeShortMetadataApiOptions,
  type RequestKind,
  ACCOUNT,
  WORK,
  ORIGIN,
  readNativeShortMetadataFixedSnapshot,
  nativeShortMetadataFixedReadUrl,
} from './native-short-metadata-fixed-read-url.js';

import {
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  request,
  type APIResponse,
} from 'playwright';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

/** Owns one RAM-only request client. No page, arbitrary URL/header/body or primary client surface. */
export class OwnedNativeShortMetadataRun {
  private readonly result = unavailableNativeShortMetadataApi('response_unavailable');
  private reason: NativeShortApiReason | null = null;
  private api: APIRequestContext | null = null;
  private disposing: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private readonly options: NativeShortMetadataApiOptions;
  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    options: NativeShortMetadataApiOptions,
    private readonly factory: Pick<APIRequest, 'newContext'> = request,
  ) {
    // Freeze the requested owner/deadline/signal/callback references for this run.
    this.options = { ...options, expectedOwner: { ...options.expectedOwner } };
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }
  stop(reason: NativeShortApiReason = 'cancelled'): void {
    this.reason ??= reason;
    this.startDispose();
  }
  private disposalFailed(): void {
    this.result.cleanup.disposalFailures++;
    this.reason = 'cleanup_failed';
    this.result.cleanup.quarantined = true;
    // The trusted Browser callback permanently fences the entire borrowed account.
    try {
      this.options.onQuarantine();
    } catch {
      /* Failure stays quarantined and never publishes raw. */
    }
  }
  private startDispose(): void {
    if (!this.api || this.disposing) return;
    const api = this.api;
    this.disposing = this.track(
      (async () => {
        try {
          await api.dispose();
          this.result.cleanup.sessionDisposed = true;
        } catch {
          this.disposalFailed();
        }
      })(),
    );
  }
  private check(): void {
    if (this.options.signal?.aborted) this.stop('cancelled');
    if (performance.now() >= this.options.deadline) this.stop('timeout');
    if (this.reason) throw new Error('Owned native metadata read stopped');
    try {
      this.options.assertLease();
    } catch {
      this.stop('lease_unavailable');
      throw new Error('Owned native metadata lease unavailable');
    }
    try {
      this.options.assertBorrowedActive();
    } catch {
      this.stop('source_changed');
      throw new Error('Owned native metadata source unavailable');
    }
  }
  private fail(reason: NativeShortApiReason): never {
    this.stop(reason);
    throw new Error('Fixed native metadata read unavailable');
  }
  private async json(url: string, kind: RequestKind): Promise<Record<string, unknown>> {
    this.check();
    if (!this.result.proof.platformStarted) {
      try {
        this.options.onBeforePlatformRead();
      } catch {
        this.fail('callback_failed');
      }
      this.check();
      this.result.proof.platformStarted = true;
      this.result.proof.readStartedAt = new Date().toISOString();
    }
    this.result.requests[kind].attempts++;
    let response: APIResponse | null = null;
    try {
      response = await this.track(
        this.api!.get(url, {
          maxRedirects: 0,
          maxRetries: 0,
          failOnStatusCode: false,
          timeout: Math.max(1, Math.ceil(this.options.deadline - performance.now())),
        }),
      );
      this.check();
      if (response.status() >= 300 && response.status() < 400) this.fail('redirect_blocked');
      if (response.url() !== url || response.status() < 200 || response.status() >= 300)
        this.fail('response_unverified');
      const headers = response.headers();
      if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? ''))
        this.fail('response_unverified');
      if (
        headers['content-length'] !== undefined &&
        (!/^\d+$/.test(headers['content-length']) ||
          Number(headers['content-length']) > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes)
      )
        this.fail('response_unverified');
      const bytes = await this.track(response.body());
      this.check();
      if (bytes.length > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes)
        this.fail('response_unverified');
      let envelope: Record<string, unknown> | null;
      try {
        envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      } catch {
        this.fail('response_unverified');
      }
      if (!envelope || envelope.code !== 0 || !object(envelope.data))
        this.fail('response_unverified');
      return envelope.data as Record<string, unknown>;
    } catch {
      if (!this.reason) this.stop('response_unavailable');
      throw new Error('Fixed native metadata read unavailable');
    } finally {
      if (response) {
        try {
          await this.track(response.dispose());
          this.result.requests[kind].disposed++;
        } catch {
          this.disposalFailed();
          this.startDispose();
        }
      }
    }
  }
  async run(): Promise<NativeShortMetadataApiResult> {
    if (this.started) throw new Error('Owned native metadata run is single-use');
    this.started = true;
    const abort = () => this.stop('cancelled');
    this.options.signal?.addEventListener('abort', abort, { once: true });
    this.timer = setTimeout(
      () => this.stop('timeout'),
      Math.max(1, this.options.deadline - performance.now()),
    );
    let snapshot: NativeShortMetadataSnapshot | null = null;
    try {
      if (
        this.options.mode !== 'read' ||
        this.options.expectedOwner?.kind !== 'account' ||
        typeof this.options.expectedOwner.id !== 'string' ||
        !ACCOUNT.test(this.options.expectedOwner.id) ||
        typeof this.workId !== 'string' ||
        !WORK.test(this.workId) ||
        !Number.isFinite(this.options.deadline)
      )
        this.fail('identity_unverified');
      this.check();
      const cookies = (await this.track(this.borrowed.cookies(ORIGIN))).filter((cookie) =>
        ['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain),
      );
      this.check();
      this.api = await this.track(
        this.factory.newContext({ storageState: { cookies, origins: [] } }),
      );
      this.result.cleanup.sessionCreated = true;
      // A stop before creation settles still owns and disposes the late handle.
      if (this.reason || this.options.signal?.aborted || performance.now() >= this.options.deadline)
        this.startDispose();
      this.check();
      snapshot = await readNativeShortMetadataFixedSnapshot({
        workId: this.workId,
        expectedOwner: this.options.expectedOwner,
        phase: this.result,
        check: () => this.check(),
        fail: (reason) => this.fail(reason),
        json: (kind, listIndex) =>
          this.json(nativeShortMetadataFixedReadUrl(this.workId, kind, listIndex), kind),
        captureReadProof: false,
      });
    } catch {
      if (!this.reason) this.stop('response_unavailable');
    } finally {
      this.startDispose();
      // No timeout race: keep the account/FIFO owner until every real promise settles.
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      this.result.cleanup.pendingAtEnd = this.pending.size;
      this.result.cleanup.checkedAt = new Date().toISOString();
    }
    try {
      this.check();
      if (!snapshot || !this.result.cleanup.sessionDisposed || this.result.cleanup.quarantined)
        this.fail('cleanup_failed');
      const checkedAt = new Date().toISOString();
      try {
        this.options.onVerifiedAccount(this.options.expectedOwner.id, checkedAt);
      } catch {
        this.fail('callback_failed');
      }
      // Trusted callback can still revoke lease, identity epoch or cancellation.
      this.check();
      this.result.proof.ownerCallback = true;
      this.result.proof.proofCapturedAt = checkedAt;
      this.result.snapshot = snapshot;
      this.result.status = 'success';
      this.result.reason = null;
    } catch {
      this.result.reason = this.reason ?? 'response_unavailable';
    } finally {
      if (this.timer) clearTimeout(this.timer);
      this.options.signal?.removeEventListener('abort', abort);
    }
    return freeze(this.result);
  }
}
