import {
  unavailableNativeShortMetadataWriteApi,
  captureNativeShortMetadataWriteRequest,
  dataFields,
  writeTime,
  writeComposite,
} from './unavailable-native-short-metadata-write-api.js';

import {
  type NativeShortMetadataWriteReason,
  type NativeShortMetadataApiWriteOptions,
  type RequestKind,
  type NativeShortMetadataWriteReadPhase,
  readNativeShortMetadataFixedSnapshot,
  nativeShortMetadataFixedReadUrl,
  type NativeShortMetadataDurableReceiptFields,
  type NativeShortMetadataHeldBeforeV2,
  type NativeShortMetadataDurableReceiptV2,
  type NativeShortMetadataApiWriteResult,
  ACCOUNT,
  WORK,
  ORIGIN,
} from './native-short-metadata-fixed-read-url.js';

import {
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  request,
  type APIResponse,
} from 'playwright';

import {
  type NativeShortMetadataRequest,
  NATIVE_SHORT_RESOURCE_LIMITS,
  type NativeShortMetadataSnapshot,
  type NativeShortMetadataPlanV2,
  type NativeShortMetadataComparisonV2,
  planNativeShortMetadataUpdateV2,
  NativeShortMetadataError,
  compareNativeShortMetadataReadbackV2,
} from '../short-native-metadata.js';

import { object, freeze } from './unavailable-native-short-metadata-api.js';

/** Holds its own RAM client from before read through exactly one write and final drain. */
export class OwnedNativeShortMetadataWriteRun {
  private readonly result = unavailableNativeShortMetadataWriteApi('response_unavailable');
  private reason: NativeShortMetadataWriteReason | null = null;
  private api: APIRequestContext | null = null;
  private disposing: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly receipts = new WeakSet<object>();
  private minted = false;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private readonly options: NativeShortMetadataApiWriteOptions;
  private readonly businessRequest: NativeShortMetadataRequest | null;
  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    options: NativeShortMetadataApiWriteOptions,
    private readonly factory: Pick<APIRequest, 'newContext'> = request,
  ) {
    this.options = { ...options, expectedOwner: { ...options.expectedOwner } };
    this.businessRequest = captureNativeShortMetadataWriteRequest(options.businessRequest);
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }
  stop(reason: NativeShortMetadataWriteReason = 'cancelled'): void {
    this.reason ??= reason;
    this.startDispose();
  }
  private disposalFailed(): void {
    this.result.cleanup.disposalFailures++;
    this.reason = 'cleanup_failed';
    this.result.cleanup.quarantined = true;
    try {
      this.options.onQuarantine();
    } catch {
      /* The account remains fenced. */
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
  private fail(reason: NativeShortMetadataWriteReason): never {
    this.stop(reason);
    throw Error('Owned native metadata write unavailable');
  }
  private check(): void {
    if (this.options.signal?.aborted) this.stop('cancelled');
    if (performance.now() >= this.options.deadline) this.stop('timeout');
    if (this.reason) throw Error('Owned native metadata write stopped');
    try {
      this.options.assertLease();
    } catch {
      this.fail('lease_unavailable');
    }
    try {
      this.options.assertBorrowedActive();
    } catch {
      this.fail('source_changed');
    }
  }
  private async responseJson(response: APIResponse, url: string): Promise<Record<string, unknown>> {
    this.check();
    if (response.status() >= 300 && response.status() < 400) this.fail('redirect_blocked');
    if (response.url() !== url || response.status() < 200 || response.status() >= 300)
      this.fail('response_unverified');
    const headers = response.headers();
    if (
      !/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '') ||
      (headers['content-length'] !== undefined &&
        (!/^\d+$/.test(headers['content-length']) ||
          Number(headers['content-length']) > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes))
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
    if (!envelope || envelope.code !== 0) this.fail('response_unverified');
    return envelope;
  }
  private async json(
    url: string,
    kind: RequestKind,
    phase: NativeShortMetadataWriteReadPhase,
  ): Promise<Record<string, unknown>> {
    this.check();
    if (!this.result.proof.platformStarted) {
      try {
        this.options.onBeforePlatformRead();
      } catch {
        this.fail('callback_failed');
      }
      this.check();
      this.result.proof.platformStarted = true;
    }
    if (!phase.proof.platformStarted) {
      phase.proof.platformStarted = true;
      phase.proof.readStartedAt = new Date().toISOString();
    }
    phase.requests[kind].attempts++;
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
      const envelope = await this.responseJson(response, url);
      if (!object(envelope.data)) this.fail('response_unverified');
      return envelope.data as Record<string, unknown>;
    } catch {
      if (!this.reason) this.stop('response_unavailable');
      throw Error('Owned native metadata write read unavailable');
    } finally {
      if (response) {
        try {
          await this.track(response.dispose());
          phase.requests[kind].disposed++;
        } catch {
          this.disposalFailed();
          this.startDispose();
        }
      }
    }
  }
  private async read(
    phase: NativeShortMetadataWriteReadPhase,
  ): Promise<NativeShortMetadataSnapshot> {
    return readNativeShortMetadataFixedSnapshot({
      workId: this.workId,
      expectedOwner: this.options.expectedOwner,
      phase,
      check: () => this.check(),
      fail: (reason) => this.fail(reason),
      json: (kind, listIndex) =>
        this.json(nativeShortMetadataFixedReadUrl(this.workId, kind, listIndex), kind, phase),
      captureReadProof: true,
    });
  }
  private confirm(
    fields: NativeShortMetadataDurableReceiptFields,
    held: NativeShortMetadataHeldBeforeV2,
  ): NativeShortMetadataDurableReceiptV2 {
    this.check();
    if (this.minted) this.fail('durability_unverified');
    try {
      const value = dataFields(fields, [
        'accountId',
        'jobId',
        'baseline',
        'intent',
        'target',
        'expectedSnapshotVersionHash',
        'desiredContentHash',
      ]);
      const target = dataFields(value.target, ['kind', 'id']);
      const copyRef = (input: unknown) => {
        const ref = dataFields(input, ['id', 'sha256', 'capturedAt']);
        if (
          typeof ref.id !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(ref.id) ||
          typeof ref.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(ref.sha256) ||
          !writeTime(ref.capturedAt)
        )
          this.fail('durability_unverified');
        return { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt };
      };
      const baseline = copyRef(value.baseline),
        intent = copyRef(value.intent);
      if (
        typeof value.accountId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.accountId) ||
        typeof value.jobId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.jobId) ||
        target.kind !== 'short-story' ||
        target.id !== this.workId ||
        value.expectedSnapshotVersionHash !== held.snapshot.snapshotVersionHash ||
        value.desiredContentHash !== held.desiredContentHash ||
        baseline.id === intent.id ||
        baseline.capturedAt < held.cleanup.checkedAt ||
        intent.capturedAt < baseline.capturedAt ||
        intent.capturedAt > new Date().toISOString()
      )
        this.fail('durability_unverified');
      const receipt = freeze({
        schema: 'native-short-metadata-durable-receipt/v2' as const,
        accountId: value.accountId,
        jobId: value.jobId,
        baseline,
        intent,
        target: { kind: 'short-story' as const, id: this.workId },
        expectedSnapshotVersionHash: held.snapshot.snapshotVersionHash,
        desiredContentHash: held.desiredContentHash,
      });
      this.receipts.add(receipt);
      this.minted = true;
      return receipt;
    } catch {
      this.fail('durability_unverified');
    }
  }
  private async post(plan: NativeShortMetadataPlanV2): Promise<void> {
    this.check();
    if (this.result.post.attempts !== 0) this.fail('durability_unverified');
    this.result.post.startedAt = new Date().toISOString();
    this.result.post.attempts++;
    let response: APIResponse | null = null;
    try {
      response = await this.track(
        this.api!.post(plan.request.url, {
          data: plan.request.body,
          headers: { 'content-type': plan.request.contentType },
          maxRedirects: 0,
          maxRetries: 0,
          failOnStatusCode: false,
          timeout: Math.max(1, Math.ceil(this.options.deadline - performance.now())),
        }),
      );
      await this.responseJson(response, plan.request.url);
      this.check();
      this.result.post.acknowledged = true;
      this.result.post.acknowledgedAt = new Date().toISOString();
    } catch {
      if (!this.reason) this.stop('response_unavailable');
      throw Error('Owned native metadata POST unavailable');
    } finally {
      if (response) {
        try {
          await this.track(response.dispose());
          this.result.post.disposed++;
        } catch {
          this.disposalFailed();
          this.startDispose();
        }
      }
    }
  }
  async run(): Promise<NativeShortMetadataApiWriteResult> {
    if (this.started) throw Error('Owned native metadata write is single-use');
    this.started = true;
    const abort = () => this.stop();
    this.options.signal?.addEventListener('abort', abort, { once: true });
    this.timer = setTimeout(
      () => this.stop('timeout'),
      Math.max(1, this.options.deadline - performance.now()),
    );
    let held: NativeShortMetadataHeldBeforeV2 | null = null,
      receipt: NativeShortMetadataDurableReceiptV2 | null = null,
      snapshot: NativeShortMetadataSnapshot | null = null,
      comparison: NativeShortMetadataComparisonV2 | null = null;
    try {
      if (
        this.options.mode !== 'write' ||
        this.options.expectedOwner?.kind !== 'account' ||
        typeof this.options.expectedOwner.id !== 'string' ||
        !ACCOUNT.test(this.options.expectedOwner.id) ||
        typeof this.workId !== 'string' ||
        !WORK.test(this.workId) ||
        !Number.isFinite(this.options.deadline)
      )
        this.fail('identity_unverified');
      if (!this.businessRequest) this.fail('unsupported_schema');
      this.check();
      const cookies = (await this.track(this.borrowed.cookies(ORIGIN))).filter((cookie) =>
        ['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain),
      );
      this.check();
      this.api = await this.track(
        this.factory.newContext({ storageState: { cookies, origins: [] } }),
      );
      this.result.cleanup.sessionCreated = true;
      if (this.reason || this.options.signal?.aborted || performance.now() >= this.options.deadline)
        this.startDispose();
      this.check();
      const before = await this.read(this.result.phases.before);
      this.check();
      let plan: NativeShortMetadataPlanV2;
      try {
        plan = planNativeShortMetadataUpdateV2(before, this.businessRequest);
      } catch (error) {
        this.fail(
          error instanceof NativeShortMetadataError && error.code === 'source_version_mismatch'
            ? 'version_conflict'
            : 'unsupported_schema',
        );
      }
      held = freeze({
        schema: 'native-short-metadata-held-before/v2',
        phase: 'held-for-write',
        snapshot: before,
        businessRequest: this.businessRequest,
        expectation: plan.expectation,
        desiredContentHash: writeComposite(plan.expectation),
        read: this.result.phases.before,
        cleanup: {
          ...this.result.cleanup,
          pendingAtEnd: this.pending.size,
          checkedAt: new Date().toISOString(),
        },
      });
      if (
        held.cleanup.pendingAtEnd !== 0 ||
        held.cleanup.sessionDisposed ||
        held.cleanup.disposalFailures
      )
        this.fail('cleanup_failed');
      const candidate = await this.track(
        Promise.resolve().then(() =>
          this.options.onDurableBeforeWrite(held!, (fields) => this.confirm(fields, held!)),
        ),
      );
      this.check();
      if (
        !candidate ||
        !this.receipts.has(candidate) ||
        candidate.schema !== 'native-short-metadata-durable-receipt/v2'
      )
        this.fail('durability_unverified');
      receipt = candidate;
      // The trusted callback marks the real Job once; the following check can still veto HTTP.
      let markedAt: unknown;
      try {
        markedAt = await this.track(
          Promise.resolve().then(() => this.options.onBeforePlatformWrite(receipt!)),
        );
      } catch {
        this.fail('callback_failed');
      }
      if (
        !writeTime(markedAt) ||
        markedAt < receipt.intent.capturedAt ||
        markedAt > new Date().toISOString()
      )
        this.fail('durability_unverified');
      this.result.proof.writeMarked = true;
      this.result.post.markedAt = markedAt;
      this.check();
      await this.post(plan);
      this.check();
      snapshot = await this.read(this.result.phases.after);
      this.check();
      comparison = compareNativeShortMetadataReadbackV2(plan.expectation, snapshot);
      if (
        !comparison.matches ||
        writeComposite(plan.expectation, snapshot, comparison) !== held.desiredContentHash
      )
        this.fail('readback_mismatch');
    } catch {
      if (!this.reason) this.stop('callback_failed');
    } finally {
      this.startDispose();
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      this.result.cleanup.pendingAtEnd = this.pending.size;
      this.result.cleanup.checkedAt = new Date().toISOString();
    }
    try {
      this.check();
      if (
        !held ||
        !receipt ||
        !snapshot ||
        !comparison ||
        !this.result.cleanup.sessionDisposed ||
        this.result.cleanup.quarantined
      )
        this.fail('cleanup_failed');
      const checkedAt = new Date().toISOString();
      try {
        await this.track(
          Promise.resolve().then(() =>
            this.options.onVerifiedAccount(this.options.expectedOwner.id, checkedAt),
          ),
        );
      } catch {
        this.fail('callback_failed');
      }
      this.check();
      this.result.proof.ownerCallback = true;
      this.result.proof.proofCapturedAt = checkedAt;
      this.result.held = held;
      this.result.receipt = receipt;
      this.result.snapshot = snapshot;
      this.result.comparison = comparison;
      this.result.desiredContentHash = held.desiredContentHash;
      this.result.observedContentHash = writeComposite(held.expectation, snapshot, comparison);
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
