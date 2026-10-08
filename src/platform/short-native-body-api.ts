import {
  type NativeShortBodyProductionStart,
  type NativeShortBodyProductionDecision,
  configAccount,
  WORK,
  freeze,
  unavailableNativeShortBodyApi,
  type NativeShortBodyApiOptions,
  type NativeShortBodyOwnedRunHandle,
  ACCOUNT,
  signalAborted,
  BAD_UNICODE,
  NATIVE_SHORT_BODY_API_REASONS,
  ORIGIN,
  compact,
  type Factory,
  type NativeShortBodyApiReason,
  type NativeShortBodyApiResult,
  type NativeShortBodyDurableApiResult,
} from './short-native-body-api/signal-aborted.js';

import {
  type NativeShortBodyAuthorityBinding,
  resolveNativeShortBodyStoreAuthority,
} from '../runtime/store.js';

import { createBodyFields } from './short-native-body-api/fields.js';

import {
  validateNativeShortBodyWriteRequest,
  validateNativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  nativeShortBodyBusinessInputHash,
  type NativeShortBodyBusinessInput,
  type NativeShortBodySnapshot,
  type NativeShortBodyPlan,
} from './short-native-body.js';

import { type BrowserContext, type APIRequestContext, type APIResponse } from 'playwright';

import { createBodyOptions } from './short-native-body-api/capture-options.js';

import { createBodyJson } from './short-native-body-api/bounded-json.js';

import {
  type FixtureRunOperations,
  type FixtureRunOwner,
} from './short-native-body-api/create-owned-native-short-body-fixture-run.js';

import {
  type NativeShortBodyFixtureTrace,
  type NativeShortBodyRefLink,
  type NativeShortBodyFixtureStageKind,
} from './short-native-body-proof.js';

import { composeFixtureRun } from './short-native-body-api/compose.js';

import { type NativeShortFixedReadKind } from './short-native-metadata-api.js';

export type { NativeShortBodyFixtureTrace } from './short-native-body-proof.js';

const STARTS = new WeakMap<NativeShortBodyProductionStart, NativeShortBodyAuthorityBinding>();

const STOPPED = Symbol('owned body stopped');

function fields(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  return createBodyFields({ STOPPED })(input, required, optional);
}

/** Raw authority is resolved by Store identity, never by a caller callback or JSON brand. */
export function prepareNativeShortBodyProductionStart(
  input: unknown,
): NativeShortBodyProductionDecision {
  try {
    const value = fields(input, ['accountId', 'workId', 'businessRequest', 'authority']);
    if (
      !configAccount(value.accountId) ||
      typeof value.workId !== 'string' ||
      !WORK.test(value.workId)
    )
      throw STOPPED;
    const request = validateNativeShortBodyWriteRequest(value.businessRequest);
    const business = validateNativeShortBodyBusinessInput({
      ...request,
      target: { kind: 'short', workId: value.workId },
      snapshotScope: NATIVE_SHORT_BODY_SCOPE,
    });
    const inputHash = nativeShortBodyBusinessInputHash(value.accountId, business);
    const binding = resolveNativeShortBodyStoreAuthority(value.authority, {
      accountId: value.accountId,
      workId: value.workId,
      inputHash,
    });
    if (!binding)
      return freeze({
        allowed: false as const,
        result: unavailableNativeShortBodyApi('production_disabled'),
      });
    binding.check();
    const start = Object.freeze(Object.create(null)) as NativeShortBodyProductionStart;
    STARTS.set(start, binding);
    return Object.freeze({ allowed: true as const, start });
  } catch {
    return freeze({
      allowed: false as const,
      result: unavailableNativeShortBodyApi('invalid_input'),
    });
  }
}

/** Consumption occurs before any borrowed-context access or client creation. */
export function createOwnedNativeShortBodyRun(
  start: NativeShortBodyProductionStart,
  borrowed?: BrowserContext,
  workId?: string,
  options?: NativeShortBodyApiOptions,
): NativeShortBodyOwnedRunHandle {
  const binding = start && typeof start === 'object' ? STARTS.get(start) : undefined;
  if (binding) STARTS.delete(start);
  if (!binding || !borrowed || typeof workId !== 'string' || options === undefined)
    return {
      run: async () => freeze(unavailableNativeShortBodyApi('production_disabled')),
      stop: () => undefined,
      cleanupDone: Promise.resolve(),
    };
  return new FixtureRun(borrowed, workId, options, binding.requestFactory, binding);
}

function captureOptions(input: unknown, workId: string): NativeShortBodyApiOptions {
  return createBodyOptions({ fields, configAccount, ACCOUNT, WORK, STOPPED, signalAborted })(
    input,
    workId,
  );
}

function boundedJson(bytes: Buffer): Record<string, unknown> {
  return createBodyJson({ STOPPED, BAD_UNICODE })(bytes);
}

export interface FixtureRunGlobals {
  STOPPED: typeof STOPPED;
  NATIVE_SHORT_BODY_API_REASONS: typeof NATIVE_SHORT_BODY_API_REASONS;
  signalAborted: typeof signalAborted;
  boundedJson: typeof boundedJson;
  freeze: typeof freeze;
  unavailableNativeShortBodyApi: typeof unavailableNativeShortBodyApi;
  ORIGIN: typeof ORIGIN;
  compact: typeof compact;
}

class FixtureRun {
  #operations: FixtureRunOperations;

  private readonly result = unavailableNativeShortBodyApi('response_unavailable');

  private readonly options: NativeShortBodyApiOptions | null;

  private readonly factory: Factory | null;

  private reason: NativeShortBodyApiReason | null = null;

  private postReason: NativeShortBodyApiReason | null = null;

  private api: APIRequestContext | null = null;

  private readonly pending = new Set<Promise<unknown>>();

  private readonly responses = new Map<
    APIResponse,
    { dispose: Promise<void> | null; disposed: () => void }
  >();

  private disposal: Promise<void> | null = null;

  private cleanupRequested = false;

  private cleanupResolved = false;

  private finishCleanup!: () => void;

  readonly cleanupDone = new Promise<void>((resolve) => {
    this.finishCleanup = resolve;
  });

  private notifyStop!: () => void;

  private readonly stopped = new Promise<typeof STOPPED>((resolve) => {
    this.notifyStop = () => resolve(STOPPED);
  });

  private started = false;

  private timer: ReturnType<typeof setTimeout> | undefined;

  private business: NativeShortBodyBusinessInput | null = null;

  private trace: NativeShortBodyFixtureTrace | null = null;

  private noChange = false;

  private ownerCheckedAt: string | null = null;

  private persisted = false;

  private attemptBoundaryEntered = false;

  private committedAttemptRecoveryFailed = false;

  private readonly links: Record<
    'baseline' | 'preSave' | 'intent' | 'attempt' | 'acknowledgement' | 'after',
    NativeShortBodyRefLink | null
  > = {
    baseline: null,
    preSave: null,
    intent: null,
    attempt: null,
    acknowledgement: null,
    after: null,
  };

  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    options: unknown,
    factory: unknown,
    private readonly binding: NativeShortBodyAuthorityBinding | null = null,
  ) {
    this.#operations = composeFixtureRun(this as unknown as FixtureRunOwner, this, {
      STOPPED,
      NATIVE_SHORT_BODY_API_REASONS,
      signalAborted,
      boundedJson,
      freeze,
      unavailableNativeShortBodyApi,
      ORIGIN,
      compact,
    });

    this.result.provenance = { mode: 'fixture', executor: 'dependency-injected-body-owned-run/v1' };
    try {
      this.options = captureOptions(options, workId);
      const f = fields(factory, ['newContext']);
      if (typeof f.newContext !== 'function') throw STOPPED;
      this.factory = { newContext: f.newContext as Factory['newContext'] };
      if (binding) {
        const business = validateNativeShortBodyBusinessInput({
          ...this.options.businessRequest,
          target: { kind: 'short', workId },
          snapshotScope: NATIVE_SHORT_BODY_SCOPE,
        });
        if (
          this.options.onStage !== undefined ||
          this.options.accountId !== binding.accountId ||
          workId !== binding.workId ||
          this.options.expectedOwner.id !== binding.expectedPlatformAccount ||
          nativeShortBodyBusinessInputHash(this.options.accountId, business) !== binding.inputHash
        )
          throw STOPPED;
        binding.check();
      }
    } catch {
      this.options = null;
      this.factory = null;
      this.reason = 'invalid_input';
    }
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.track(promise);
  }
  private wait<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.wait(promise);
  }
  private fail(reason: NativeShortBodyApiReason): never {
    return this.#operations.fail(reason);
  }
  stop(reason: NativeShortBodyApiReason = 'cancelled'): void {
    return this.#operations.stop(reason);
  }
  private quarantine(): void {
    return this.#operations.quarantine();
  }
  private disposalFailed(): void {
    return this.#operations.disposalFailed();
  }
  private check(): void {
    return this.#operations.check();
  }
  private ownResponse(response: APIResponse, disposed: () => void): APIResponse {
    return this.#operations.ownResponse(response, disposed);
  }
  private disposeResponse(response: APIResponse): Promise<void> {
    return this.#operations.disposeResponse(response);
  }
  private drain(): void {
    return this.#operations.drain();
  }
  private decode(response: APIResponse, url: string): Promise<Record<string, unknown>> {
    return this.#operations.decode(response, url);
  }
  private json(
    name: 'before' | 'preSave' | 'after',
    kind: NativeShortFixedReadKind,
    listIndex?: number,
  ): Promise<Record<string, unknown>> {
    return this.#operations.json(name, kind, listIndex);
  }
  private read(name: 'before' | 'preSave' | 'after'): Promise<NativeShortBodySnapshot> {
    return this.#operations.read(name);
  }
  private emit(
    kind: NativeShortBodyFixtureStageKind,
    payload: Readonly<Record<string, unknown>>,
    eventAt = new Date().toISOString(),
    observe = true,
  ): Promise<void> {
    return this.#operations.emit(kind, payload, eventAt, observe);
  }
  private ack(root: Record<string, unknown>, before: NativeShortBodySnapshot): void {
    return this.#operations.ack(root, before);
  }
  private post(plan: NativeShortBodyPlan, before: NativeShortBodySnapshot): Promise<void> {
    return this.#operations.post(plan, before);
  }
  private snapshotResult(): NativeShortBodyApiResult {
    return this.#operations.snapshotResult();
  }
  run(): Promise<NativeShortBodyApiResult> {
    return this.#operations.run();
  }
  private durableResult(
    clean: boolean,
    failed: NativeShortBodyApiReason | null,
  ): NativeShortBodyDurableApiResult {
    return this.#operations.durableResult(clean, failed);
  }
}

export type { FixtureRun };

export type OwnedStopSignal = typeof STOPPED;
export { NATIVE_SHORT_BODY_API_REASONS } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyApiReason } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyReadPhase } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyPostObservation } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyApiOptions } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyBrowserOptions } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyProductionStart } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyProductionDecision } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyOwnedRunHandle } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyFixtureApiResult } from './short-native-body-api/signal-aborted.js';
export { NATIVE_SHORT_BODY_DURABLE_API_REASONS } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyDurableApiReason } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyDurablePostObservation } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyDurableApiResult } from './short-native-body-api/signal-aborted.js';
export type { NativeShortBodyApiResult } from './short-native-body-api/signal-aborted.js';
export type { Factory } from './short-native-body-api/signal-aborted.js';
export { unavailableNativeShortBodyApi } from './short-native-body-api/signal-aborted.js';
export { captureNativeShortBodyWriteRequest } from './short-native-body-api/signal-aborted.js';
export type { FixtureRunOwner } from './short-native-body-api/create-owned-native-short-body-fixture-run.js';
export type { FixtureRunOperations } from './short-native-body-api/create-owned-native-short-body-fixture-run.js';

export function createOwnedNativeShortBodyFixtureRun(
  borrowed: BrowserContext,
  workId: string,
  options: NativeShortBodyApiOptions,
  factory: Factory,
): NativeShortBodyOwnedRunHandle {
  return new FixtureRun(borrowed, workId, options, factory);
}
