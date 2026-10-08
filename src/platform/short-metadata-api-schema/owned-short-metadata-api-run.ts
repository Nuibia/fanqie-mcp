import {
  unavailableShortMetadataApi,
  type ShortMetadataApiReason,
  type ShortMetadataApiOptions,
  LIMIT,
  object,
  OWN,
  shortMetadataApiListUrl,
  ID,
  type ShortMetadataApiResult,
  ORIGIN,
} from './short-metadata-api-list-url.js';

import {
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  request,
  type APIResponse,
} from 'playwright';

import { projectShortMetadataFields } from '../short-metadata-schema.js';

import { safeShortMetadataApiResult } from './safe-short-metadata-api-result.js';

/** Owns one RAM API session. No page/navigation, generic URL, header or signature surface. */
export class OwnedShortMetadataApiRun {
  readonly result = unavailableShortMetadataApi('response_unavailable');
  private reason: ShortMetadataApiReason | null = null;
  private api: APIRequestContext | null = null;
  private observedAccount: string | null = null;
  private closing: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    private readonly options: ShortMetadataApiOptions,
    private readonly factory: Pick<APIRequest, 'newContext'> = request,
  ) {}
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }
  stop(reason: ShortMetadataApiReason = 'cancelled'): void {
    this.reason ??= reason;
    this.startDispose();
  }
  private disposalFailed(): void {
    this.result.cleanup.disposalFailures++;
    this.reason = 'cleanup_failed';
    this.result.cleanup.quarantined = true;
    // This permanently fences the borrowed account from successor calls.
    this.options.onQuarantine();
  }
  private startDispose(): void {
    if (!this.api || this.closing) return;
    this.closing = this.track(
      (async () => {
        try {
          await this.api!.dispose();
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
    if (this.reason) throw new Error('Owned API observation stopped');
    try {
      this.options.assertLease();
    } catch {
      this.stop('lease_unavailable');
      throw new Error('Owned API lease unavailable');
    }
    try {
      this.options.assertBorrowedActive();
    } catch {
      this.stop('source_changed');
      throw new Error('Owned API source unavailable');
    }
  }
  private fail(reason: ShortMetadataApiReason): never {
    this.stop(reason);
    throw new Error('Fixed API response unavailable');
  }
  private async json(url: string, kind: 'own' | 'list'): Promise<Record<string, unknown>> {
    this.check();
    if (!this.result.proof.platformStarted) {
      this.options.onBeforePlatformRead();
      this.result.proof.platformStarted = true;
      this.result.proof.readStartedAt = new Date().toISOString();
    }
    this.result[kind].attempts++;
    let response: APIResponse | null = null;
    try {
      response = await this.track(
        this.api!.get(url, {
          maxRedirects: 0,
          maxRetries: 0,
          timeout: Math.max(1, Math.ceil(this.options.deadline - performance.now())),
        }),
      );
      this.check();
      if (response.status() >= 300 && response.status() < 400) {
        this.result.transport.redirects++;
        this.fail('redirect_blocked');
      }
      if (response.url() !== url || response.status() < 200 || response.status() >= 300)
        this.fail('response_unverified');
      const headers = response.headers();
      if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? ''))
        this.fail('response_unverified');
      const length = headers['content-length'];
      if (length !== undefined && /^\d+$/.test(length) && Number(length) > LIMIT) {
        this.result.transport.oversizeResponses++;
        this.fail('response_unverified');
      }
      const bytes = await this.track(response.body());
      this.check();
      if (bytes.length > LIMIT) {
        this.result.transport.oversizeResponses++;
        this.fail('response_unverified');
      }
      const envelope = object(JSON.parse(bytes.toString('utf8')));
      if (!envelope || envelope.code !== 0 || !object(envelope.data))
        this.fail('response_unverified');
      return envelope.data as Record<string, unknown>;
    } catch {
      if (!this.reason) {
        this.result.transport.responseFailures++;
        this.stop('response_unavailable');
      }
      throw new Error('Fixed API response unavailable');
    } finally {
      if (response) {
        try {
          await this.track(response.dispose());
          this.result[kind].disposed++;
        } catch {
          this.disposalFailed();
          this.startDispose();
        }
      }
    }
  }
  private async own(which: 'ownerBefore' | 'ownerAfter'): Promise<void> {
    const data = await this.json(OWN, 'own');
    this.check();
    if (typeof data.id !== 'string' || !/^\d{1,30}$/.test(data.id))
      this.fail('identity_unverified');
    if (data.id !== this.options.expectedAccountId) this.fail('owner_changed');
    this.observedAccount = data.id;
    this.result.proof[which] = true;
  }
  private async list(): Promise<ReturnType<typeof projectShortMetadataFields>> {
    const ids = new Set<string>();
    let target: ReturnType<typeof projectShortMetadataFields> | null = null;
    let total: number | null = null;
    for (let page = 0; page === 0 || page < Math.ceil(total! / 10); page++) {
      const data = await this.json(shortMetadataApiListUrl(page), 'list');
      this.check();
      if (
        !Number.isInteger(data.total_count) ||
        typeof data.total_count !== 'number' ||
        data.total_count < 0 ||
        !Array.isArray(data.item_list)
      )
        this.fail('response_unverified');
      if (data.total_count > 100) this.fail('bounded_unavailable');
      if (total === null) {
        total = data.total_count;
        this.result.list.totalCount = total;
      }
      if (data.total_count !== total || data.item_list.length !== Math.min(10, total - page * 10))
        this.fail('pagination_inconsistent');
      for (const item of data.item_list) {
        const row = object(item);
        if (!row || typeof row.item_id !== 'string' || !ID.test(row.item_id))
          this.fail('response_unverified');
        if (ids.has(row.item_id)) this.fail('pagination_inconsistent');
        ids.add(row.item_id);
        if (row.item_id === this.workId) target = projectShortMetadataFields(row);
      }
      this.result.list.pagesRead++;
      this.result.list.rowsRead += data.item_list.length;
    }
    if (ids.size !== total) this.fail('pagination_inconsistent');
    this.result.proof.paginationComplete = true;
    this.result.proof.fixedSourceVerified = true;
    if (!target) this.fail('target_unverified');
    this.result.proof.targetUnique = true;
    return target;
  }
  async run(): Promise<ShortMetadataApiResult> {
    const abort = () => this.stop('cancelled');
    this.options.signal?.addEventListener('abort', abort, { once: true });
    this.timer = setTimeout(
      () => this.stop('timeout'),
      Math.max(1, this.options.deadline - performance.now()),
    );
    let observation: ReturnType<typeof projectShortMetadataFields> | null = null;
    try {
      if (!ID.test(this.workId) || !/^\d{1,30}$/.test(this.options.expectedAccountId))
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
      // Cancellation can precede completion of newContext. Dispose its late handle.
      if (this.reason || this.options.signal?.aborted || performance.now() >= this.options.deadline)
        this.startDispose();
      this.check();
      await this.own('ownerBefore');
      observation = await this.list();
      await this.own('ownerAfter');
      this.check();
      this.result.proof.readFinishedAt = new Date().toISOString();
    } catch {
      if (!this.reason) this.stop('response_unavailable');
    } finally {
      this.startDispose();
      // Keep stop/deadline installed and the account FIFO held through real drain.
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      this.result.cleanup.pendingAtEnd = this.pending.size;
      this.result.cleanup.checkedAt = new Date().toISOString();
    }
    try {
      this.check();
      if (
        !observation ||
        !this.observedAccount ||
        !this.result.cleanup.sessionDisposed ||
        this.result.cleanup.quarantined
      )
        this.fail('cleanup_failed');
      const checkedAt = new Date().toISOString();
      try {
        this.options.onVerifiedAccount(this.observedAccount, checkedAt);
      } catch {
        this.fail('callback_failed');
      }
      this.check();
      this.result.proof.ownerCallback = true;
      this.result.proof.proofCapturedAt = checkedAt;
      Object.assign(this.result, observation);
      this.result.status = 'success';
      this.result.reason = null;
    } catch {
      this.result.reason = this.reason ?? 'response_unavailable';
    } finally {
      if (this.timer) clearTimeout(this.timer);
      this.options.signal?.removeEventListener('abort', abort);
    }
    return safeShortMetadataApiResult(this.result);
  }
}
