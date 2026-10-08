import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export type PublicReadPurpose = 'status' | 'capabilities' | 'jobs';
export const PUBLIC_READ_MEMO_BUDGET_BYTES = 64 * 1024 * 1024;
export class PublicReadError extends Error {
  readonly code = 'capability_unavailable';
  constructor() {
    super('Public overview data is unavailable.');
    this.name = 'PublicReadError';
  }
}

/** Only descriptors are inspected before values; no thenable is assimilated. */
export function capturePublicReadJson<T>(input: T, allowUndefined = false): T {
  const pending = new Set<object>();
  const copy = (value: unknown): unknown => {
    if (value === undefined && allowUndefined) return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null) throw new PublicReadError();
    const proto = Object.getPrototypeOf(value),
      array = Array.isArray(value);
    if (
      !(array ? proto === Array.prototype : proto === Object.prototype || proto === null) ||
      Object.getOwnPropertySymbols(value).length
    )
      throw new PublicReadError();
    for (let cursor: object | null = value; cursor; cursor = Object.getPrototypeOf(cursor)) {
      if (Object.getOwnPropertyDescriptor(cursor, 'then')) throw new PublicReadError();
    }
    if (pending.has(value)) throw new PublicReadError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(proto);
    pending.add(value);
    try {
      if (array) {
        const length = descriptors.length;
        if (
          !length ||
          !Object.hasOwn(length, 'value') ||
          typeof length.value !== 'number' ||
          !Number.isSafeInteger(length.value) ||
          length.value < 0 ||
          Object.keys(descriptors).length !== length.value + 1
        )
          throw new PublicReadError();
        for (let i = 0; i < length.value; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
            throw new PublicReadError();
          (output as unknown[]).push(copy(descriptor.value));
        }
      } else {
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
            throw new PublicReadError();
          Object.defineProperty(output, key, {
            value: copy(descriptor.value),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
      return output;
    } finally {
      pending.delete(value);
    }
  };
  return copy(input) as T;
}
const encode = (value: unknown): string => {
  const tag = (item: unknown): unknown =>
    item === undefined
      ? ['undefined']
      : item === null
        ? ['null']
        : Array.isArray(item)
          ? ['array', item.map(tag)]
          : typeof item === 'object'
            ? [
                'object',
                Object.keys(item)
                  .sort()
                  .map((key) => [key, tag((item as Record<string, unknown>)[key])]),
              ]
            : [typeof item, item];
  return JSON.stringify(tag(capturePublicReadJson(value, true)));
};
export function assertNoPublicReadEntry(): void {
  carrier.getStore()?.token.coordinator.assertEntryAllowed();
}
const digest = (value: unknown): string => createHash('sha256').update(encode(value)).digest('hex');
const failureKey = (error: unknown): string => {
  if (!error || typeof error !== 'object') return typeof error;
  const descriptors = Object.getOwnPropertyDescriptors(error);
  return encode([
    descriptors.code?.value ?? null,
    descriptors.name?.value ?? null,
    error instanceof SyntaxError ? 'SyntaxError' : error instanceof Error ? 'Error' : 'unknown',
  ]);
};
interface Observation {
  ok: boolean;
  fingerprint: string;
  error?: unknown;
  value?: unknown;
}
interface QueryEntry {
  key: string;
  read(): unknown;
  observation: { fingerprint: string };
}
interface FileEntry {
  key: string;
  read(mark: (input: unknown) => void): unknown;
  observation: { fingerprint: string };
}
interface State {
  accountId: string;
  purpose: PublicReadPurpose;
  phase: 'active' | 'guarding' | 'closed';
  fault: boolean;
  transaction: boolean;
  guardDepth: number;
  memo: Map<string, unknown>;
  pending: Set<string>;
  bytes: number;
  queries: Map<string, QueryEntry>;
  files: Map<string, FileEntry>;
}
interface Token {
  readonly coordinator: PublicReadCoordinator;
  readonly state: State;
}
interface Context {
  readonly token: Token;
  readonly cleanup: object | null;
}
const carrier = new AsyncLocalStorage<Context>();
export interface PublicReadHooks {
  begin(): void;
  commit(): void;
  rollback(): void;
  assertLease(): void;
  isLeaseLost(): boolean;
  leaseLostError(): Error;
  unavailable?(): Error;
}

/** Data belongs to one synchronous operation. Closed tokens fence its async descendants. */
export class PublicReadCoordinator {
  #current?: State;
  #cleanup = Object.freeze(Object.create(null));
  constructor(
    private readonly hooks: PublicReadHooks,
    private readonly memoBudgetBytes = PUBLIC_READ_MEMO_BUDGET_BYTES,
  ) {
    if (!Number.isSafeInteger(memoBudgetBytes) || memoBudgetBytes < 0) throw new PublicReadError();
  }
  private unavailable(): Error {
    return this.hooks.unavailable?.() ?? new PublicReadError();
  }
  private reject(context?: Context): never {
    if (context) context.token.state.fault = true;
    if (this.hooks.isLeaseLost()) throw this.hooks.leaseLostError();
    throw this.unavailable();
  }
  assertEntryAllowed(): void {
    const context = carrier.getStore();
    if (context) this.reject(context);
  }
  assertMutationAllowed(): void {
    const context = carrier.getStore();
    if (context) this.reject(context);
  }
  assertReadAllowed(): void {
    const context = carrier.getStore();
    if (!context) return;
    const { token } = context,
      state = token.state;
    if (
      token.coordinator !== this ||
      context.cleanup ||
      state.phase === 'closed' ||
      state.fault ||
      (state.phase === 'guarding' && state.guardDepth === 0)
    )
      this.reject(context);
  }
  private state(): State | undefined {
    this.assertReadAllowed();
    const context = carrier.getStore();
    return context?.token.coordinator === this ? context.token.state : undefined;
  }
  hasContext(): boolean {
    return carrier.getStore() !== undefined;
  }
  isActive(): boolean {
    return this.state()?.phase === 'active';
  }
  run<T>(accountId: string, purpose: PublicReadPurpose, callback: () => T): T {
    this.assertEntryAllowed();
    if (
      !['status', 'capabilities', 'jobs'].includes(purpose) ||
      typeof accountId !== 'string' ||
      !accountId ||
      typeof callback !== 'function'
    )
      throw this.unavailable();
    const state: State = {
      accountId,
      purpose,
      phase: 'active',
      fault: false,
      transaction: false,
      guardDepth: 0,
      memo: new Map(),
      pending: new Set(),
      bytes: 0,
      queries: new Map(),
      files: new Map(),
    };
    const token: Token = Object.freeze({ coordinator: this, state });
    this.#current = state;
    return carrier.run(Object.freeze({ token, cleanup: null }), () => {
      try {
        this.hooks.assertLease();
        this.hooks.begin();
        state.transaction = true;
        const result = capturePublicReadJson(callback());
        if (state.fault || this.hooks.isLeaseLost()) this.reject(carrier.getStore());
        state.phase = 'guarding';
        state.memo.clear();
        state.pending.clear();
        const queries = [...state.queries.values()],
          files = [...state.files.values()];
        this.hooks.commit();
        state.transaction = false;
        this.guard(state, () => this.hooks.assertLease());
        for (const entry of queries) {
          const observation = this.guard(state, () => this.queryObservation(entry.read));
          if (observation.fingerprint !== entry.observation.fingerprint)
            this.reject(carrier.getStore());
        }
        for (const entry of files) {
          const observation = this.guard(state, () => this.fileObservation(entry.read));
          if (observation.fingerprint !== entry.observation.fingerprint)
            this.reject(carrier.getStore());
        }
        this.guard(state, () => this.hooks.assertLease());
        if (state.fault || this.hooks.isLeaseLost()) this.reject(carrier.getStore());
        return result;
      } finally {
        let rollbackFailed = false,
          rollbackError: unknown;
        try {
          if (state.transaction) {
            this.hooks.rollback();
            state.transaction = false;
          }
        } catch (error) {
          rollbackFailed = true;
          rollbackError = error;
        } finally {
          state.phase = 'closed';
          state.memo.clear();
          state.pending.clear();
          state.queries.clear();
          state.files.clear();
          state.bytes = 0;
          if (this.#current === state) this.#current = undefined;
        }
        if (rollbackFailed) {
          if (this.hooks.isLeaseLost()) throw this.hooks.leaseLostError();
          throw rollbackError;
        }
      }
    });
  }
  private guard<T>(state: State, action: () => T): T {
    state.guardDepth++;
    try {
      return action();
    } finally {
      state.guardDepth--;
    }
  }
  memo<T>(namespace: string, key: unknown, compute: () => T): T {
    const state = this.state();
    if (!state || state.phase === 'guarding') return compute();
    const encoded = digest([namespace, key]);
    if (state.memo.has(encoded)) return capturePublicReadJson(state.memo.get(encoded), true) as T;
    if (state.pending.has(encoded)) throw this.unavailable();
    state.pending.add(encoded);
    try {
      const value = compute();
      const copied = capturePublicReadJson(value, true),
        bytes = Buffer.byteLength(encode(copied));
      if (state.bytes + bytes <= this.memoBudgetBytes) {
        state.memo.set(encoded, copied);
        state.bytes += bytes;
      }
      return value;
    } finally {
      state.pending.delete(encoded);
    }
  }
  seedSql(
    sql: string,
    mode: 'get' | 'all',
    params: unknown[],
    value: unknown,
    read: () => unknown,
  ): void {
    const state = this.state();
    if (!state || state.phase !== 'active') return;
    const key = digest([sql, mode, params]);
    if (state.queries.has(key)) return;
    const copied = capturePublicReadJson(value, true);
    state.queries.set(key, {
      key,
      read,
      observation: { fingerprint: digest(['success', copied]) },
    });
    const bytes = Buffer.byteLength(encode(copied));
    if (state.bytes + bytes <= this.memoBudgetBytes) {
      state.memo.set(`sql:${key}`, copied);
      state.bytes += bytes;
    }
  }
  sql<T>(sql: string, mode: 'get' | 'all', params: unknown[], read: () => T): T {
    const state = this.state();
    if (!state || state.phase === 'guarding') return read();
    const key = digest([sql, mode, params]);
    const existing = state.queries.get(key);
    if (existing && state.memo.has(`sql:${key}`))
      return capturePublicReadJson(state.memo.get(`sql:${key}`), true) as T;
    const observation = this.queryObservation(read);
    if (!existing)
      state.queries.set(key, { key, read, observation: { fingerprint: observation.fingerprint } });
    else if (existing.observation.fingerprint !== observation.fingerprint)
      this.reject(carrier.getStore());
    if (!observation.ok) throw observation.error;
    const bytes = Buffer.byteLength(encode(observation.value));
    if (state.bytes + bytes <= this.memoBudgetBytes) {
      state.memo.set(`sql:${key}`, observation.value);
      state.bytes += bytes;
    }
    return capturePublicReadJson(observation.value, true) as T;
  }
  private queryObservation(read: () => unknown): Observation {
    try {
      const value = capturePublicReadJson(read(), true);
      return { ok: true, value, fingerprint: digest(['success', value]) };
    } catch (error) {
      return { ok: false, error, fingerprint: digest(['failure', failureKey(error)]) };
    }
  }
  file<T>(key: unknown, read: (mark: (input: unknown) => void) => T): T {
    const state = this.state();
    if (!state || state.phase === 'guarding') return read(() => {});
    const encoded = digest(key),
      prior = state.files.get(encoded);
    if (prior && state.memo.has(`file:${encoded}`))
      return capturePublicReadJson(state.memo.get(`file:${encoded}`), true) as T;
    const observation = this.fileObservation(read);
    if (!prior)
      state.files.set(encoded, {
        key: encoded,
        read,
        observation: { fingerprint: observation.fingerprint },
      });
    else if (prior.observation.fingerprint !== observation.fingerprint)
      this.reject(carrier.getStore());
    if (!observation.ok) throw observation.error;
    const bytes = Buffer.byteLength(encode(observation.value));
    if (state.bytes + bytes <= this.memoBudgetBytes) {
      state.memo.set(`file:${encoded}`, observation.value);
      state.bytes += bytes;
    }
    return capturePublicReadJson(observation.value, true) as T;
  }
  private fileObservation(read: (mark: (input: unknown) => void) => unknown): Observation {
    const marks: unknown[] = [];
    try {
      const value = capturePublicReadJson(
        read((input) => marks.push(capturePublicReadJson(input, true))),
        true,
      );
      return { ok: true, value, fingerprint: digest(['success', marks]) };
    } catch (error) {
      return { ok: false, error, fingerprint: digest(['failure', marks, failureKey(error)]) };
    }
  }
  invalidateForLeaseLoss(): void {
    if (!this.hooks.isLeaseLost()) return;
    const state = this.#current;
    if (!state) return;
    state.fault = true;
    state.memo.clear();
    state.pending.clear();
    if (state.transaction) {
      this.hooks.rollback();
      state.transaction = false;
    }
  }
  runFatalCleanup<T>(action: () => T): T {
    if (!this.hooks.isLeaseLost()) this.reject(carrier.getStore());
    this.invalidateForLeaseLoss();
    const context = carrier.getStore();
    if (!context) return action();
    if (context.token.coordinator !== this) this.reject(context);
    return carrier.run(Object.freeze({ token: context.token, cleanup: this.#cleanup }), action);
  }
  assertLifecycleCleanupAllowed(): void {
    const context = carrier.getStore();
    if (!context) return;
    if (
      context.token.coordinator !== this ||
      context.cleanup !== this.#cleanup ||
      !this.hooks.isLeaseLost() ||
      context.token.state.transaction
    )
      this.reject(context);
  }
}
