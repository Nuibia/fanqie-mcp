import {
  type ShortDraftDirectoryReason,
  type ShortDraftDirectoryResult,
  SHORT_DRAFT_DIRECTORY_REASONS,
  invalid,
  type ShortDraftDirectoryEvidence,
  exact,
  ORIGIN,
  SHORT_DRAFT_DIRECTORY_PATH,
  type ShortDraftDirectoryContext,
  type ShortDraftDirectoryProjection,
  string,
  UUID,
  SHORT_DRAFT_DIRECTORY_OPERATION,
  SHORT_DRAFT_DIRECTORY_SCOPE,
  SHORT_DRAFT_DIRECTORY_DATASET,
  SHORT_DRAFT_DIRECTORY_INPUT_HASH,
  count,
  array,
  ANCHOR_KEYS,
  JOB_SCHEMA,
  ACCOUNT,
  type ShortDraftDirectoryOptions,
  defaultNewContext,
  LIMIT,
  type ShortDraftDirectoryRecord,
  ITEM,
} from './unicode.js';
import {
  freeze,
  initial,
  readCommon,
  COMMON_KEYS,
  time,
  nullableTime,
  shortDraftDirectoryReadUrl,
} from './time.js';
import {
  validateShortDraftDirectoryApiResult,
  canonical,
  JOB_KEYS,
  same,
  validateRef,
  validateShortDraftDirectoryEvidence,
  validateManifest,
  safeRef,
  business,
  safeManifest,
} from './validate-short-draft-directory-api-result.js';
import { createHash } from 'node:crypto';
import { createDirectoryContextValidator } from './validate-context.js';
import {
  type APIRequest,
  type APIRequestContext,
  type BrowserContext,
  type APIResponse,
} from 'playwright';

const issued = new WeakMap<object, 'default-request' | 'fixture-request'>();

// Actual producer issuance, never reconstructed from serialized source declarations.
const issuedPayloads = new Map<
  string,
  { transport: 'default-request' | 'fixture-request'; application: 'default' | 'injected' }
>();

export function unavailableShortDraftDirectory(
  reason: ShortDraftDirectoryReason,
): ShortDraftDirectoryResult {
  if (!SHORT_DRAFT_DIRECTORY_REASONS.includes(reason)) return invalid();
  const value = freeze(initial(reason, 'fixture-request'));
  issued.set(value, 'fixture-request');
  return value;
}

export function createShortDraftDirectoryEvidence(
  result: ShortDraftDirectoryResult,
  applicationOrigin: 'default' | 'injected',
): ShortDraftDirectoryEvidence {
  if (!['default', 'injected'].includes(applicationOrigin)) return invalid();
  validateShortDraftDirectoryApiResult(result);
  const transport = issued.get(result);
  if (!transport || transport !== result.provenance.transport) return invalid();
  const common = readCommon(exact(result, ['schema', 'provenance', ...COMMON_KEYS]));
  const mode =
    transport === 'default-request' && applicationOrigin === 'default' ? 'live' : 'fixture';
  const evidence = freeze<ShortDraftDirectoryEvidence>({
    schema: 'short-draft-directory-evidence/v1',
    ...common,
    source: {
      mode,
      transport,
      application: applicationOrigin,
      origin: ORIGIN,
      path: SHORT_DRAFT_DIRECTORY_PATH,
    },
    bodyIncluded: false,
  });
  issuedPayloads.set(createHash('sha256').update(canonical(evidence)).digest('hex'), {
    transport,
    application: applicationOrigin,
  });
  return evidence;
}

export function validateShortDraftDirectoryContext(
  context: ShortDraftDirectoryContext,
  mode: 'prefix' | 'completion' | 'public',
): ShortDraftDirectoryProjection {
  return createDirectoryContextValidator({
    exact,
    string,
    invalid,
    time,
    JOB_KEYS,
    UUID,
    SHORT_DRAFT_DIRECTORY_OPERATION,
    SHORT_DRAFT_DIRECTORY_SCOPE,
    same,
    SHORT_DRAFT_DIRECTORY_DATASET,
    SHORT_DRAFT_DIRECTORY_INPUT_HASH,
    nullableTime,
    count,
    array,
    validateRef,
    ANCHOR_KEYS,
    freeze,
    JOB_SCHEMA,
    ACCOUNT,
    validateShortDraftDirectoryEvidence,
    issuedPayloads,
    canonical,
    validateManifest,
    safeRef,
    business,
    safeManifest,
  })(context, mode);
}

/** One isolated RAM request client; borrowed BrowserContext is never disposed by this run. */
export class OwnedShortDraftDirectoryRun {
  private readonly result: ShortDraftDirectoryResult;
  private readonly options: ShortDraftDirectoryOptions;
  private readonly newContext: APIRequest['newContext'];
  private api: APIRequestContext | null = null;
  private disposing: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  private reason: ShortDraftDirectoryReason | null = null;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly borrowed: BrowserContext,
    options: ShortDraftDirectoryOptions,
    fixtureFactory?: Pick<APIRequest, 'newContext'>,
  ) {
    const o = exact(
      options,
      [
        'mode',
        'expectedOwner',
        'deadline',
        'assertLease',
        'assertBorrowedActive',
        'onBeforePlatformRead',
        'onVerifiedAccount',
        'onQuarantine',
      ],
      ['signal'],
    );
    const owner = exact(o.expectedOwner, ['kind', 'id']);
    if (
      o.mode !== 'read' ||
      owner.kind !== 'account' ||
      !string(owner.id, 30) ||
      !ACCOUNT.test(owner.id) ||
      typeof o.deadline !== 'number' ||
      !Number.isFinite(o.deadline)
    )
      throw new Error('Short draft directory is unavailable.');
    for (const key of [
      'assertLease',
      'assertBorrowedActive',
      'onBeforePlatformRead',
      'onVerifiedAccount',
      'onQuarantine',
    ])
      if (typeof o[key] !== 'function') throw new Error('Short draft directory is unavailable.');
    if (o.signal !== undefined && !(o.signal instanceof AbortSignal))
      throw new Error('Short draft directory is unavailable.');
    this.options = {
      mode: 'read',
      expectedOwner: { kind: 'account', id: owner.id },
      deadline: o.deadline,
      signal: o.signal as AbortSignal | undefined,
      assertLease: o.assertLease as () => void,
      assertBorrowedActive: o.assertBorrowedActive as () => void,
      onBeforePlatformRead: o.onBeforePlatformRead as () => void,
      onVerifiedAccount: o.onVerifiedAccount as ShortDraftDirectoryOptions['onVerifiedAccount'],
      onQuarantine: o.onQuarantine as () => void,
    };
    if (fixtureFactory !== undefined) {
      const f = exact(fixtureFactory, ['newContext']);
      if (typeof f.newContext !== 'function')
        throw new Error('Short draft directory is unavailable.');
      this.newContext = (f.newContext as APIRequest['newContext']).bind(fixtureFactory);
    } else this.newContext = defaultNewContext;
    this.result = initial(
      'response_unavailable',
      fixtureFactory === undefined ? 'default-request' : 'fixture-request',
    );
    this.result.owner = { kind: 'account', id: owner.id };
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }
  stop(reason: ShortDraftDirectoryReason = 'cancelled'): void {
    if (!SHORT_DRAFT_DIRECTORY_REASONS.includes(reason)) reason = 'cancelled';
    this.reason ??= reason;
    this.startDispose();
  }
  private disposalFailed(): void {
    this.result.cleanup.disposalFailures++;
    this.result.cleanup.quarantined = true;
    this.reason = 'cleanup_failed';
    try {
      this.options.onQuarantine();
    } catch {
      /* Quarantine stays fixed. */
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
    if (this.reason) return invalid();
    try {
      this.options.assertLease();
    } catch {
      this.stop('lease_unavailable');
      return invalid();
    }
    try {
      this.options.assertBorrowedActive();
    } catch {
      this.stop('source_changed');
      return invalid();
    }
  }
  private fail(reason: ShortDraftDirectoryReason): never {
    this.stop(reason);
    return invalid();
  }
  private async json(kind: 'own' | 'list', pageIndex?: number): Promise<Record<string, unknown>> {
    this.check();
    if (!this.result.proof.platformStarted) {
      try {
        this.options.onBeforePlatformRead();
      } catch {
        this.fail('callback_failed');
      }
      this.check();
      this.result.proof.platformStarted = true;
      this.result.coverage.readStartedAt = new Date().toISOString();
    }
    const url = shortDraftDirectoryReadUrl(kind, pageIndex);
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
      if (response.status() >= 300 && response.status() < 400) {
        this.result.transport.redirects++;
        this.fail('redirect_blocked');
      }
      if (response.url() !== url || response.status() < 200 || response.status() >= 300)
        this.fail('response_unverified');
      const headers = response.headers(),
        length = headers['content-length'];
      if (
        !/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '') ||
        (length !== undefined && !/^[0-9]+$/.test(length))
      )
        this.fail('response_unverified');
      if (length !== undefined && Number(length) > LIMIT) {
        this.result.transport.oversizeResponses++;
        this.fail('bounded_unavailable');
      }
      const bytes = await this.track(response.body());
      this.check();
      if (bytes.length > LIMIT) {
        this.result.transport.oversizeResponses++;
        this.fail('bounded_unavailable');
      }
      let envelope: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          this.fail('response_unverified');
        envelope = parsed as Record<string, unknown>;
      } catch {
        this.fail('response_unverified');
      }
      if (
        envelope.code !== 0 ||
        !envelope.data ||
        typeof envelope.data !== 'object' ||
        Array.isArray(envelope.data)
      )
        this.fail('response_unverified');
      return envelope.data as Record<string, unknown>;
    } catch {
      if (!this.reason) {
        this.result.transport.responseFailures++;
        this.stop('response_unavailable');
      }
      return invalid();
    } finally {
      if (response) {
        try {
          await this.track(response.dispose());
          this.result.requests[kind].disposed++;
        } catch {
          this.disposalFailed();
          this.startDispose();
        }
        try {
          this.check();
        } catch {
          /* Every disposal checks the fences; real drain continues after stop. */
        }
      }
    }
  }
  async run(): Promise<ShortDraftDirectoryResult> {
    if (this.started) return invalid();
    this.started = true;
    const abort = () => this.stop('cancelled');
    this.options.signal?.addEventListener('abort', abort, { once: true });
    this.timer = setTimeout(
      () => this.stop('timeout'),
      Math.max(1, Math.ceil(this.options.deadline - performance.now())),
    );
    const records: ShortDraftDirectoryRecord[] = [];
    try {
      this.check();
      const cookies = (await this.track(this.borrowed.cookies(ORIGIN))).filter((cookie) =>
        ['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain),
      );
      this.check();
      this.api = await this.track(this.newContext({ storageState: { cookies, origins: [] } }));
      this.result.cleanup.sessionCreated = true;
      if (this.reason || this.options.signal?.aborted || performance.now() >= this.options.deadline)
        this.startDispose();
      this.check();
      const own = async (which: 'ownerBefore' | 'ownerAfter') => {
        const data = await this.json('own');
        this.check();
        if (typeof data.id !== 'string' || !ACCOUNT.test(data.id)) this.fail('identity_unverified');
        if (data.id !== this.options.expectedOwner.id) this.fail('owner_changed');
        this.result.proof[which] = true;
      };
      await own('ownerBefore');
      const ids = new Set<string>();
      let total: number | null = null;
      for (let i = 0; i === 0 || i < Math.ceil(total! / 10); i++) {
        const data = await this.json('list', i);
        this.check();
        if (
          typeof data.total_count !== 'number' ||
          !Number.isSafeInteger(data.total_count) ||
          Object.is(data.total_count, -0) ||
          data.total_count < 0 ||
          !Array.isArray(data.item_list)
        )
          this.fail('response_unverified');
        if (data.total_count > 100) this.fail('bounded_unavailable');
        if (total === null) {
          total = data.total_count;
          this.result.coverage.declaredTotal = total;
        }
        if (total !== data.total_count || data.item_list.length !== Math.min(10, total - i * 10))
          this.fail('pagination_inconsistent');
        for (const raw of data.item_list) {
          if (
            !raw ||
            typeof raw !== 'object' ||
            Array.isArray(raw) ||
            typeof raw.item_id !== 'string' ||
            !ITEM.test(raw.item_id)
          )
            this.fail('response_unverified');
          if (ids.has(raw.item_id)) this.fail('pagination_inconsistent');
          ids.add(raw.item_id);
          records.push({
            id: { namespace: 'native_short_item', value: raw.item_id },
            title: null,
            publicationStatus: 'unknown',
            signingStatus: 'unknown',
            listingScope: 'own_draft_list',
          });
        }
        this.result.coverage.pagesRead++;
        this.result.coverage.rowsRead += data.item_list.length;
      }
      if (ids.size !== total) this.fail('pagination_inconsistent');
      this.result.proof.paginationComplete = true;
      await own('ownerAfter');
      this.check();
      this.result.proof.fixedSourceVerified = true;
      this.result.coverage.readFinishedAt = new Date().toISOString();
    } catch {
      if (!this.reason) this.stop('response_unavailable');
    } finally {
      this.startDispose();
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      this.result.cleanup.pendingAtEnd = this.pending.size;
      this.result.cleanup.checkedAt = new Date().toISOString();
    }
    try {
      this.check();
      if (
        !this.result.cleanup.sessionDisposed ||
        this.result.cleanup.quarantined ||
        !this.result.proof.fixedSourceVerified
      )
        this.fail('cleanup_failed');
      const checkedAt = new Date().toISOString();
      try {
        this.options.onVerifiedAccount(this.options.expectedOwner.id, checkedAt);
      } catch {
        this.fail('callback_failed');
      }
      this.check();
      this.result.proof.ownerCallback = true;
      this.result.proof.ownerCheckedAt = checkedAt;
      this.result.coverage.proofCapturedAt = checkedAt;
      this.result.records = records;
      this.result.coverage.complete = true;
      this.result.status = 'success';
      this.result.reason = null;
    } catch {
      this.result.records = [];
      this.result.coverage.complete = false;
      this.result.reason = this.reason ?? 'response_unavailable';
    } finally {
      if (this.timer) clearTimeout(this.timer);
      this.options.signal?.removeEventListener('abort', abort);
    }
    validateShortDraftDirectoryApiResult(this.result);
    const result = freeze(this.result);
    issued.set(result, result.provenance.transport);
    return result;
  }
}
