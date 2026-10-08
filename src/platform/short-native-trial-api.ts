import {
  PostObservationFailure,
  copyCookies,
  type OwnedNativeShortTrialRunOperations,
  type OwnedNativeShortTrialRunOwner,
  captureNativeShortTrialWriteRequest,
} from './short-native-trial-api/copy-cookies.js';

import {
  fields,
  freeze,
  copyRef,
  UUID,
  sameData,
  time,
  OWNER,
  WORK,
  ORIGIN,
  type NativeShortTrialApiResult,
  type NativeShortTrialApiOptions,
  type NativeShortTrialApiReason,
  type NativeShortTrialReceiptStage,
  type NativeShortTrialEvidenceRef,
  unavailableNativeShortTrialApi,
  type NativeShortTrialTransport,
  type NativeShortTrialHeldIntent,
  type NativeShortTrialReceiptFields,
  type NativeShortTrialReceipt,
} from './short-native-trial-api/read-phase.js';

import {
  type NativeShortTrialWriteRequest,
  type NativeShortTrialSnapshot,
  type NativeShortTrialPlan,
} from './short-native-trial.js';

import {
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  request,
  type APIResponse,
} from 'playwright';

import { composeOwnedNativeShortTrialRun } from './short-native-trial-api/compose.js';

import {
  type NativeShortMetadataWriteReadPhase,
  type NativeShortFixedReadKind,
} from './short-native-metadata-api.js';

export interface OwnedNativeShortTrialRunGlobals {
  PostObservationFailure: typeof PostObservationFailure;
  fields: typeof fields;
  freeze: typeof freeze;
  copyRef: typeof copyRef;
  UUID: typeof UUID;
  sameData: typeof sameData;
  time: typeof time;
  OWNER: typeof OWNER;
  WORK: typeof WORK;
  copyCookies: typeof copyCookies;
  ORIGIN: typeof ORIGIN;
}

export class OwnedNativeShortTrialRun {
  #operations: OwnedNativeShortTrialRunOperations;

  private readonly result: NativeShortTrialApiResult;

  private readonly options: NativeShortTrialApiOptions;

  private readonly businessRequest: NativeShortTrialWriteRequest | null;

  private optionsValid = true;

  private reason: NativeShortTrialApiReason | null = null;

  private postFailure: NativeShortTrialApiReason | null = null;

  private api: APIRequestContext | null = null;

  private disposing: Promise<void> | null = null;

  private readonly pending = new Set<Promise<unknown>>();

  private readonly brands = new Map<NativeShortTrialReceiptStage, WeakSet<object>>();

  private readonly minted = new Set<NativeShortTrialReceiptStage>();

  private readonly refs = new Set<string>();

  private receiptIdentity: {
    accountId: string;
    jobId: string;
    baseline: NativeShortTrialEvidenceRef;
  } | null = null;

  private activeConfirmation: NativeShortTrialReceiptStage | null = null;

  private timer?: ReturnType<typeof setTimeout>;

  private started = false;

  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    options: NativeShortTrialApiOptions,
    private readonly factory: Pick<APIRequest, 'newContext'> = request,
  ) {
    this.#operations = composeOwnedNativeShortTrialRun(
      this as unknown as OwnedNativeShortTrialRunOwner,
      this,
      {
        PostObservationFailure,
        fields,
        freeze,
        copyRef,
        UUID,
        sameData,
        time,
        OWNER,
        WORK,
        copyCookies,
        ORIGIN,
      },
    );

    let mode: 'read' | 'write' = 'write',
      captured: NativeShortTrialWriteRequest | null = null;
    try {
      const base = [
        'mode',
        'expectedOwner',
        'deadline',
        'signal',
        'assertLease',
        'assertBorrowedActive',
        'onBeforePlatformRead',
        'onVerifiedAccount',
        'onQuarantine',
      ];
      const write = [
        'businessRequest',
        'onBaseline',
        'onDurableIntent',
        'onBeforePlatformWrite',
        'onDurableAcknowledgement',
      ];
      const raw = fields(
        options,
        [...base, ...write],
        base.filter((key) => key !== 'signal'),
      );
      if (raw.mode !== 'read' && raw.mode !== 'write') throw Error('Invalid trial mode');
      mode = raw.mode;
      const value = fields(
        options,
        mode === 'write' ? [...base, ...write] : base,
        (mode === 'write' ? [...base, ...write] : base).filter((key) => key !== 'signal'),
      );
      const owner = fields(value.expectedOwner, ['kind', 'id']);
      if (value.signal !== undefined)
        Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(value.signal);
      if (
        [
          'assertLease',
          'assertBorrowedActive',
          'onBeforePlatformRead',
          'onVerifiedAccount',
          'onQuarantine',
          ...(mode === 'write' ? write.filter((key) => key !== 'businessRequest') : []),
        ].some((key) => typeof value[key] !== 'function')
      )
        throw Error('Invalid trial callback');
      if (mode === 'write') captured = captureNativeShortTrialWriteRequest(value.businessRequest);
      this.options = {
        ...value,
        expectedOwner: { ...owner },
        ...(mode === 'write' ? { businessRequest: captured } : {}),
      } as unknown as NativeShortTrialApiOptions;
    } catch {
      this.optionsValid = false;
      this.options = {
        mode: 'read',
        expectedOwner: { kind: 'account', id: '' },
        deadline: 0,
        assertLease() {},
        assertBorrowedActive() {},
        onBeforePlatformRead() {},
        onVerifiedAccount() {},
        onQuarantine() {},
      };
    }
    this.businessRequest = captured;
    this.result = unavailableNativeShortTrialApi('response_unavailable', mode);
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.track(promise);
  }
  stop(reason: NativeShortTrialApiReason = 'cancelled'): void {
    return this.#operations.stop(reason);
  }
  private disposalFailed(): void {
    return this.#operations.disposalFailed();
  }
  private startDispose(): void {
    return this.#operations.startDispose();
  }
  private fail(reason: NativeShortTrialApiReason): never {
    return this.#operations.fail(reason);
  }
  private check(): void {
    return this.#operations.check();
  }
  private httpOptions(): ReturnType<OwnedNativeShortTrialRunOperations['httpOptions']> {
    return this.#operations.httpOptions();
  }
  private responseJson(
    response: APIResponse,
    url: string,
    post = false,
  ): Promise<Record<string, unknown>> {
    return this.#operations.responseJson(response, url, post);
  }
  private json(
    phase: NativeShortMetadataWriteReadPhase,
    kind: NativeShortFixedReadKind,
    index?: number,
  ): Promise<Record<string, unknown>> {
    return this.#operations.json(phase, kind, index);
  }
  private read(phase: NativeShortMetadataWriteReadPhase): Promise<NativeShortTrialSnapshot> {
    return this.#operations.read(phase);
  }
  private transport(): NativeShortTrialTransport {
    return this.#operations.transport();
  }
  private held(
    snapshot: NativeShortTrialSnapshot,
    beforeSnapshot: NativeShortTrialSnapshot,
    plan: NativeShortTrialPlan,
    read: NativeShortMetadataWriteReadPhase,
  ): NativeShortTrialHeldIntent {
    return this.#operations.held(snapshot, beforeSnapshot, plan, read);
  }
  private confirm(
    input: NativeShortTrialReceiptFields,
    stage: NativeShortTrialReceiptStage,
  ): NativeShortTrialReceipt {
    return this.#operations.confirm(input, stage);
  }
  private callback(stage: NativeShortTrialReceiptStage): Promise<NativeShortTrialReceipt> {
    return this.#operations.callback(stage);
  }
  private post(plan: NativeShortTrialPlan): Promise<void> {
    return this.#operations.post(plan);
  }
  private assertSaveAcknowledgement(
    envelope: Record<string, unknown>,
    plan: NativeShortTrialPlan,
  ): void {
    return this.#operations.assertSaveAcknowledgement(envelope, plan);
  }
  run(): Promise<NativeShortTrialApiResult> {
    return this.#operations.run();
  }
}
export { NATIVE_SHORT_TRIAL_API_REASONS } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiReason } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialReceiptStage } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialEvidenceRef } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialTransport } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialReceiptFields } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialReceipt } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialHeldIntent } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialAcknowledgement } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiBaseOptions } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiReadOptions } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiWriteOptions } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiOptions } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialPost } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiSaveResult } from './short-native-trial-api/read-phase.js';
export type { NativeShortTrialApiResult } from './short-native-trial-api/read-phase.js';
export { unavailableNativeShortTrialApi } from './short-native-trial-api/read-phase.js';
export { captureNativeShortTrialWriteRequest } from './short-native-trial-api/copy-cookies.js';
export type { OwnedNativeShortTrialRunOwner } from './short-native-trial-api/copy-cookies.js';
export type { OwnedNativeShortTrialRunOperations } from './short-native-trial-api/copy-cookies.js';
