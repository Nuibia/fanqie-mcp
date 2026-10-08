import { createFields } from './short-native-submission-api/fields.js';

import { createCopy } from './short-native-submission-api/copy.js';

import {
  freeze,
  type NativeShortSubmissionEvidenceRef,
  UUID,
  HASH,
  type NativeShortSubmissionServicePrepared,
  type NativeShortSubmissionApiOptions,
  OWNER,
  SOURCE_KEYS,
  NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES,
  WORK,
  ORIGIN,
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionApiReason,
  type NativeShortSubmissionReceiptStage,
  unavailableNativeShortSubmissionApi,
  type NativeShortSubmissionHeldIntent,
  type NativeShortSubmissionTransport,
  type NativeShortSubmissionReceiptFields,
  type NativeShortSubmissionReceipt,
  NATIVE_SHORT_SUBMISSION_API_REASONS,
} from './short-native-submission-api/phase.js';

import { createReference } from './short-native-submission-api/reference.js';

import {
  time,
  type FixtureExecution,
  PostObservationFailure,
  same,
  type OwnedNativeShortSubmissionRunOperations,
  type OwnedNativeShortSubmissionRunOwner,
} from './short-native-submission-api/canonical.js';

import { createServicePrepared } from './short-native-submission-api/service-prepared.js';

import { createCaptureOptions } from './short-native-submission-api/capture-options.js';

import {
  type Cookie,
  type BrowserContext,
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
} from 'playwright';

import { createCookieCopy } from './short-native-submission-api/cookies.js';

import {
  type NativeShortSubmissionContract,
  validateNativeShortSubmissionContract,
  type NativeShortSubmissionBusinessInput,
  type NativeShortSubmissionPlan,
} from './short-native-submission.js';

import { composeOwnedNativeShortSubmissionRun } from './short-native-submission-api/compose.js';

import {
  type NativeShortFixedReadKind,
  type NativeShortMetadataWriteReadPhase,
} from './short-native-metadata-api.js';

import { type NativeShortMetadataSnapshot } from './short-native-metadata.js';

import { createResultValidator } from './short-native-submission-api/validate-result.js';

const STOPPED = Symbol('owned-submission-stopped');

function fields(
  input: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): Record<string, unknown> {
  return createFields({ STOPPED })(input, allowed, required);
}

export function copy<T>(input: T): T {
  return createCopy({ STOPPED, fields, freeze })(input);
}

function ref(input: unknown): NativeShortSubmissionEvidenceRef {
  return createReference({ fields, UUID, HASH, time, STOPPED, freeze })(input);
}

function servicePrepared(input: unknown): NativeShortSubmissionServicePrepared {
  return createServicePrepared({ fields, UUID, STOPPED, freeze, ref })(input);
}

export function captureNativeShortSubmissionOptions(
  input: unknown,
): NativeShortSubmissionApiOptions | null {
  return createCaptureOptions({ fields, STOPPED, OWNER, servicePrepared })(input);
}

function cookieCopy(input: Cookie[]): Cookie[] {
  return createCookieCopy({ copy, fields, STOPPED })(input);
}

const FIXTURES = new WeakMap<OwnedNativeShortSubmissionRun, FixtureExecution>();

/** Explicit internal synthetic execution. Production constructor cannot override URLs, pins or factory. */
export function createOwnedNativeShortSubmissionFixtureRun(
  borrowed: BrowserContext,
  workId: string,
  options: NativeShortSubmissionApiOptions,
  factory: Pick<APIRequest, 'newContext'>,
  contract: NativeShortSubmissionContract,
): OwnedNativeShortSubmissionRun {
  const f = fields(factory, ['newContext']);
  if (typeof f.newContext !== 'function') throw STOPPED;
  const capturedContract = validateNativeShortSubmissionContract(contract);
  const run = new OwnedNativeShortSubmissionRun(borrowed, workId, options);
  FIXTURES.set(run, {
    factory: { newContext: (f.newContext as APIRequest['newContext']).bind(factory) },
    contract: validateNativeShortSubmissionContract({
      ...capturedContract,
      mode: 'fixture-no-live',
    }),
  });
  return run;
}

export interface OwnedNativeShortSubmissionRunGlobals {
  STOPPED: typeof STOPPED;
  PostObservationFailure: typeof PostObservationFailure;
  fields: typeof fields;
  copy: typeof copy;
  SOURCE_KEYS: typeof SOURCE_KEYS;
  FIXTURES: typeof FIXTURES;
  freeze: typeof freeze;
  ref: typeof ref;
  UUID: typeof UUID;
  same: typeof same;
  NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES: typeof NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES;
  time: typeof time;
  WORK: typeof WORK;
  cookieCopy: typeof cookieCopy;
  ORIGIN: typeof ORIGIN;
}

export class OwnedNativeShortSubmissionRun {
  #operations: OwnedNativeShortSubmissionRunOperations;

  private readonly options: NativeShortSubmissionApiOptions | null;

  private readonly result: NativeShortSubmissionApiResult;

  private api: APIRequestContext | null = null;

  private reason: NativeShortSubmissionApiReason | null = null;

  private postFailure: NativeShortSubmissionApiReason | null = null;

  private started = false;

  private timer?: ReturnType<typeof setTimeout>;

  private cleanupRequested = false;

  private cleanupResolved = false;

  private disposal: Promise<void> | null = null;

  private readonly pending = new Set<Promise<unknown>>();

  private readonly responses = new Map<
    APIResponse,
    { promise: Promise<void> | null; disposed(): void }
  >();

  private finishCleanup!: () => void;

  readonly cleanupDone = new Promise<void>((resolve) => {
    this.finishCleanup = resolve;
  });

  private notifyStopped!: () => void;

  private readonly stopped = new Promise<typeof STOPPED>((resolve) => {
    this.notifyStopped = () => resolve(STOPPED);
  });

  private activeConfirmation: NativeShortSubmissionReceiptStage | null = null;

  private readonly brands = new Map<NativeShortSubmissionReceiptStage, WeakSet<object>>();

  private readonly minted = new Set<string>();

  private readonly references = new Set<string>();

  private receiptIdentity: {
    accountId: string;
    jobId: string;
    baseline: NativeShortSubmissionEvidenceRef;
  } | null = null;

  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    options: NativeShortSubmissionApiOptions,
  ) {
    this.#operations = composeOwnedNativeShortSubmissionRun(
      this as unknown as OwnedNativeShortSubmissionRunOwner,
      this,
      {
        STOPPED,
        PostObservationFailure,
        fields,
        copy,
        SOURCE_KEYS,
        FIXTURES,
        freeze,
        ref,
        UUID,
        same,
        NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES,
        time,
        WORK,
        cookieCopy,
        ORIGIN,
      },
    );

    this.options = captureNativeShortSubmissionOptions(options);
    this.result = unavailableNativeShortSubmissionApi(
      'response_unavailable',
      this.options?.mode ?? 'submit',
    );
    if (!this.options) this.reason = 'invalid_input';
  }
  stop(reason: NativeShortSubmissionApiReason = 'cancelled'): void {
    return this.#operations.stop(reason);
  }
  private fail(reason: NativeShortSubmissionApiReason): never {
    return this.#operations.fail(reason);
  }
  private check(): void {
    return this.#operations.check();
  }
  private quarantine(): void {
    return this.#operations.quarantine();
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.track(promise);
  }
  private wait<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.wait(promise);
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
  private httpOptions(): ReturnType<OwnedNativeShortSubmissionRunOperations['httpOptions']> {
    return this.#operations.httpOptions();
  }
  private begin(): void {
    return this.#operations.begin();
  }
  private bytes(
    response: APIResponse,
    url: string,
    kind: 'json' | 'source',
    post = false,
  ): Promise<Buffer> {
    return this.#operations.bytes(response, url, kind, post);
  }
  private json(
    name: keyof NativeShortSubmissionApiResult['phases'],
    kind: NativeShortFixedReadKind,
    index?: number,
  ): Promise<Record<string, unknown>> {
    return this.#operations.json(name, kind, index);
  }
  private read(
    name: 'before' | 'preSubmit' | 'after',
    draftMembership: boolean,
  ): Promise<NativeShortMetadataSnapshot> {
    return this.#operations.read(name, draftMembership);
  }
  private sources(): Promise<NativeShortSubmissionContract> {
    return this.#operations.sources();
  }
  private business(): NativeShortSubmissionBusinessInput {
    return this.#operations.business();
  }
  private held(
    beforeSnapshot: NativeShortMetadataSnapshot,
    snapshot: NativeShortMetadataSnapshot,
    contract: NativeShortSubmissionContract,
    plan: NativeShortSubmissionPlan,
    read: NativeShortMetadataWriteReadPhase,
  ): NativeShortSubmissionHeldIntent {
    return this.#operations.held(beforeSnapshot, snapshot, contract, plan, read);
  }
  private checkFreshPublication(): void {
    return this.#operations.checkFreshPublication();
  }
  private transport(): NativeShortSubmissionTransport {
    return this.#operations.transport();
  }
  private confirm(
    input: NativeShortSubmissionReceiptFields,
    stage: NativeShortSubmissionReceiptStage,
  ): NativeShortSubmissionReceipt {
    return this.#operations.confirm(input, stage);
  }
  private callback(
    stage: NativeShortSubmissionReceiptStage,
  ): Promise<NativeShortSubmissionReceipt> {
    return this.#operations.callback(stage);
  }
  private post(): Promise<void> {
    return this.#operations.post();
  }
  run(): Promise<NativeShortSubmissionApiResult> {
    return this.#operations.run();
  }
}

/** Strict private result replay; job/evidence provenance and causal links are checked by Store/proof. */
export function validateNativeShortSubmissionApiResult(
  input: unknown,
  expectedBinding?: { accountId: string; workId: string },
): NativeShortSubmissionApiResult {
  return createResultValidator({
    copy,
    fields,
    NATIVE_SHORT_SUBMISSION_API_REASONS,
    STOPPED,
    OWNER,
    WORK,
    same,
    time,
    SOURCE_KEYS,
    HASH,
    servicePrepared,
    ref,
    UUID,
    NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES,
  })(input, expectedBinding);
}

export type OwnedStopSignal = typeof STOPPED;
export type { SourceKey } from './short-native-submission-api/phase.js';
export { NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES } from './short-native-submission-api/phase.js';
export { NATIVE_SHORT_SUBMISSION_API_REASONS } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionApiReason } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionReceiptStage } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionEvidenceRef } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionServicePrepared } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionTransport } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionReceiptFields } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionReceipt } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionHeldIntent } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionAcknowledgement } from './short-native-submission-api/phase.js';
export type { BaseOptions } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionApiPrepareOptions } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionApiReadOptions } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionApiSubmitOptions } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionApiOptions } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionBrowserOptions } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionPost } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionSourceRead } from './short-native-submission-api/phase.js';
export type { NativeShortSubmissionApiResult } from './short-native-submission-api/phase.js';
export { unavailableNativeShortSubmissionApi } from './short-native-submission-api/phase.js';
export { captureNativeShortSubmissionWriteRequest } from './short-native-submission-api/canonical.js';
export type { FixtureExecution } from './short-native-submission-api/canonical.js';
export type { OwnedNativeShortSubmissionRunOwner } from './short-native-submission-api/canonical.js';
export type { OwnedNativeShortSubmissionRunOperations } from './short-native-submission-api/canonical.js';
