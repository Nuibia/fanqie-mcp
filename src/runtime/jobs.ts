import { canonicalJson, RuntimeError, Store } from './store.js';
import type { EvidenceRef, Job, NewJob, PlatformTarget, RuntimeFailure } from './store.js';

export interface JobContext {
  jobId: string;
  accountId: string;
  signal: AbortSignal;
  /** Call immediately before the first actual platform read, not when queued. */
  beforePlatformRead(): string;
  /** Persist the uncertainty boundary immediately before any platform side effect. */
  beforePlatformWrite(): string;
  saveEvidence(dataset: string, payload: unknown): EvidenceRef;
  addMetadata(values: Record<string, unknown>): Job;
  recordTarget(target: PlatformTarget | string): PlatformTarget;
}

export interface JobHandle {
  jobId: string;
  /** Resolves to the durable settled status, including waiting_for_login/partial/failed/uncertain. */
  completion: Promise<Job>;
}

type ReadInput = Omit<NewJob, 'kind'> & {
  datasets: string[];
  run(context: JobContext): Promise<EvidenceRef[]>;
};
type WriteInput = Omit<NewJob, 'kind'> & {
  idempotencyKey: string;
  inputHash: string;
  run(context: JobContext): Promise<unknown>;
};
interface Pending {
  handle: JobHandle;
  resolve(job: Job): void;
  reject(error: unknown): void;
  mergeKey: string | null;
  platformStarted: boolean;
  controller: AbortController;
  executing: boolean;
  timeoutMs: number;
  timer?: ReturnType<typeof setTimeout>;
  execute(context: JobContext): Promise<void>;
}

function failure(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeError) return error.toJSON();
  const known = new Set([
    'version_conflict',
    'account_mismatch',
    'capability_unavailable',
    'requires_login',
    'challenge_required',
    'verification_required',
    'risk_control',
    'outcome_unknown',
    'unsupported_schema',
    'cancelled',
    'timeout',
    'not_found',
    'permission_denied',
  ]);
  const trustedName =
    error instanceof Error &&
    ['PlatformReadError', 'PlatformWriteError', 'BrowserSessionError'].includes(error.name);
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[a-z][a-z0-9_]{0,63}$/.test(error.code) &&
    (known.has(error.code) || trustedName)
  ) {
    const message =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : 'The platform operation failed.';
    return {
      code: error.code,
      message: message
        .replace(/((?:cookie|authorization|token|password)\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>')
        .slice(0, 1000),
    };
  }
  return {
    code: 'collection_failed',
    message: error instanceof Error ? error.message : 'The platform operation failed.',
  };
}

/** Account queues cover an entire job; SQLite service fencing covers other processes. */
export class JobQueue {
  private readonly handles = new Map<string, JobHandle>();
  private readonly mergeable = new Map<string, Pending>();
  private readonly accounts = new Map<string, Pending[]>();
  private readonly activeAccounts = new Set<string>();
  private stopping = false;
  private leaseLost = false;
  private readonly pendingJobs = new Map<string, Pending>();
  private readonly timeoutMs: number;
  private readonly shutdownTimeoutMs: number;

  constructor(
    readonly store: Store,
    options: { timeoutMs?: number; shutdownTimeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 25_000;
    for (const duration of [this.timeoutMs, this.shutdownTimeoutMs]) {
      if (!Number.isInteger(duration) || duration < 1 || duration > 2_147_483_647)
        throw new RuntimeError(
          'invalid_configuration',
          'Runtime timeout durations must be positive supported timer values.',
        );
    }
    store.onServiceLeaseLost(() => this.abortForLeaseLoss());
  }

  enqueueRead(input: ReadInput): JobHandle {
    return this.enqueue(
      { ...input, kind: 'read' },
      async (jobId, context) => {
        const references = await input.run(context);
        this.assertLiveLease();
        this.store.completeReadJob(jobId, references);
      },
      true,
    );
  }

  enqueueWrite(input: WriteInput): JobHandle {
    return this.enqueue(
      { ...input, kind: 'write' },
      async (jobId, context) => {
        const result = await input.run(context);
        this.assertLiveLease();
        this.store.completeWriteJob(jobId, result);
      },
      false,
    );
  }

  private enqueue(
    input: NewJob,
    action: (jobId: string, context: JobContext) => Promise<void>,
    allowMerge: boolean,
  ): JobHandle {
    this.assertLiveLease();
    if (this.stopping)
      throw new RuntimeError(
        'service_stopping',
        'The runtime is draining and accepts no new jobs.',
      );
    const normalizedDatasets = [...new Set(input.datasets ?? [])].sort();
    const mergeKey =
      allowMerge && !input.idempotencyKey
        ? canonicalJson({
            accountId: input.accountId,
            operation: input.operation,
            scope: input.scope ?? 'account',
            datasets: normalizedDatasets,
            inputHash: input.inputHash ?? null,
            timeoutMs: input.timeoutMs ?? this.timeoutMs,
          })
        : null;
    const current = mergeKey ? this.mergeable.get(mergeKey) : null;
    if (current && !current.platformStarted) return current.handle;

    const created = this.store.createJob({
      ...input,
      timeoutMs: input.timeoutMs ?? this.timeoutMs,
    });
    const existing = this.handles.get(created.job.id);
    if (existing) return existing;
    if (!created.created)
      return { jobId: created.job.id, completion: Promise.resolve(created.job) };

    let resolve!: (job: Job) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<Job>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Fatal shutdown can reject an unobserved queued handle; retain rejection for actual callers.
    void completion.catch(() => {});
    const handle = { jobId: created.job.id, completion };
    const pending: Pending = {
      handle,
      resolve,
      reject,
      mergeKey,
      platformStarted: false,
      controller: new AbortController(),
      executing: false,
      timeoutMs: created.job.timeoutMs,
      execute: (context) => action(handle.jobId, context),
    };
    this.handles.set(handle.jobId, handle);
    this.pendingJobs.set(handle.jobId, pending);
    if (mergeKey) this.mergeable.set(mergeKey, pending);
    const queue = this.accounts.get(input.accountId) ?? [];
    queue.push(pending);
    this.accounts.set(input.accountId, queue);
    queueMicrotask(() => {
      void this.drain(input.accountId);
    });
    return handle;
  }

  private removeMergeCandidate(pending: Pending): void {
    if (pending.mergeKey && this.mergeable.get(pending.mergeKey) === pending)
      this.mergeable.delete(pending.mergeKey);
  }

  private hasLostLease(): boolean {
    return this.leaseLost || this.store.hasLostServiceLease();
  }
  private leaseLossError(): RuntimeError {
    return new RuntimeError(
      'service_lease_lost',
      'The runtime permanently lost its service lease.',
    );
  }
  private assertLiveLease(): void {
    if (this.hasLostLease()) {
      this.abortForLeaseLoss();
      throw this.leaseLossError();
    }
  }

  /** No Store calls. Active handles settle only after their actual callbacks finish cleanup. */
  abortForLeaseLoss(): void {
    this.stopping = true;
    this.leaseLost = true;
    for (const pending of [...this.pendingJobs.values()]) {
      if (pending.timer) clearTimeout(pending.timer);
      this.removeMergeCandidate(pending);
      if (!pending.controller.signal.aborted) pending.controller.abort(this.leaseLossError());
      if (pending.executing) continue;
      pending.reject(this.leaseLossError());
      for (const queue of this.accounts.values()) {
        const index = queue.indexOf(pending);
        if (index >= 0) queue.splice(index, 1);
      }
      this.handles.delete(pending.handle.jobId);
      this.pendingJobs.delete(pending.handle.jobId);
    }
  }

  private async drain(accountId: string): Promise<void> {
    if (this.hasLostLease()) {
      this.abortForLeaseLoss();
      return;
    }
    if (this.activeAccounts.has(accountId)) return;
    const queue = this.accounts.get(accountId);
    if (!queue) return;
    this.activeAccounts.add(accountId);
    try {
      while (queue.length > 0) {
        if (this.hasLostLease()) {
          this.abortForLeaseLoss();
          break;
        }
        const pending = queue.shift()!;
        pending.executing = true;
        try {
          this.store.startJob(pending.handle.jobId);
          pending.timer = setTimeout(() => {
            if (this.hasLostLease()) {
              this.abortForLeaseLoss();
              return;
            }
            try {
              this.cancel(pending.handle.jobId, {
                code: 'timeout',
                message: 'The platform operation exceeded its execution deadline.',
              });
            } catch (error) {
              if (this.hasLostLease()) this.abortForLeaseLoss();
              else pending.controller.abort(error);
            }
          }, pending.timeoutMs);
          const context: JobContext = {
            jobId: pending.handle.jobId,
            accountId,
            signal: pending.controller.signal,
            beforePlatformRead: () => {
              this.assertLiveLease();
              const marked = this.store.markPlatformReadStarted(pending.handle.jobId);
              pending.platformStarted = true;
              this.removeMergeCandidate(pending);
              return marked;
            },
            beforePlatformWrite: () => {
              this.assertLiveLease();
              const marked = this.store.markPlatformWriteStarted(pending.handle.jobId);
              pending.platformStarted = true;
              this.removeMergeCandidate(pending);
              return marked;
            },
            saveEvidence: (dataset, payload) => {
              this.assertLiveLease();
              return this.store.saveEvidence(pending.handle.jobId, dataset, payload);
            },
            addMetadata: (values) => {
              this.assertLiveLease();
              return this.store.addJobMetadata(pending.handle.jobId, values);
            },
            recordTarget: (target) => {
              this.assertLiveLease();
              return this.store.recordTarget(pending.handle.jobId, target);
            },
          };
          this.assertLiveLease();
          await pending.execute(context);
          this.assertLiveLease();
          pending.resolve(this.store.getJob(pending.handle.jobId)!);
        } catch (error) {
          if (this.hasLostLease()) {
            this.abortForLeaseLoss();
            pending.reject(this.leaseLossError());
          } else {
            try {
              pending.resolve(this.store.failJob(pending.handle.jobId, failure(error)));
            } catch (stateError) {
              if (this.hasLostLease()) this.abortForLeaseLoss();
              pending.reject(stateError);
            }
          }
        } finally {
          if (pending.timer) clearTimeout(pending.timer);
          this.removeMergeCandidate(pending);
          this.handles.delete(pending.handle.jobId);
          this.pendingJobs.delete(pending.handle.jobId);
        }
      }
    } finally {
      this.activeAccounts.delete(accountId);
      this.accounts.delete(accountId);
    }
  }

  getJob(id: string): Job | null {
    return this.store.getJob(id);
  }

  cancel(
    id: string,
    reason: RuntimeFailure = { code: 'cancelled', message: 'Cancelled by the caller.' },
  ): Job {
    this.assertLiveLease();
    const job = this.store.requestCancellation(id, reason);
    const pending = this.pendingJobs.get(id);
    if (!pending || !job.cancellationRequestedAt) return job;
    this.removeMergeCandidate(pending);
    if (!pending.controller.signal.aborted)
      pending.controller.abort(
        new RuntimeError(job.cancellationReason!.code, job.cancellationReason!.message),
      );
    if (job.status === 'cancelled') {
      const queue = this.accounts.get(job.accountId);
      const index = queue?.indexOf(pending) ?? -1;
      if (index >= 0) queue!.splice(index, 1);
      pending.resolve(job);
      this.handles.delete(id);
      this.pendingJobs.delete(id);
    }
    return job;
  }

  /** Abort work, then wait for real cleanup. Never release accounts by racing the callback. */
  async drainAndStop(options: { timeoutMs?: number; reason?: 'lease_lost' } = {}): Promise<void> {
    if (options.reason === 'lease_lost' || this.hasLostLease()) this.abortForLeaseLoss();
    this.stopping = true;
    const timeoutMs = options.timeoutMs ?? this.shutdownTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new RuntimeError('invalid_configuration', 'Invalid shutdown deadline.');
    for (const pending of [...this.pendingJobs.values()]) {
      if (this.hasLostLease()) {
        this.abortForLeaseLoss();
        break;
      }
      try {
        this.cancel(pending.handle.jobId, {
          code: 'shutdown',
          message: 'The service is shutting down.',
        });
      } catch (error) {
        if (this.hasLostLease()) {
          this.abortForLeaseLoss();
          break;
        }
        throw error;
      }
    }
    const remaining = [...this.handles.values()].map((handle) => handle.completion);
    if (remaining.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(remaining),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new RuntimeError(
                  'shutdown_incomplete',
                  'Underlying platform operations have not finished cleanup; do not close the store or reuse these accounts.',
                  { jobIds: [...this.pendingJobs.keys()] },
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
