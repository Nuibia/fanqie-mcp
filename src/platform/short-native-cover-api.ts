import {
  freeze,
  UPLOAD_URL,
  fields,
  UUID,
  OWNER,
  WORK,
  ORIGIN,
  unavailableNativeShortCoverApi,
  type NativeShortCoverApiOptions,
  type NativeShortCoverWriteRequest,
  type NativeShortCoverApiReason,
  type NativeShortCoverEvidenceRef,
  type NativeShortCoverPhase,
  type NativeShortCoverTransport,
  type NativeShortCoverReceiptFields,
  type NativeShortCoverReceiptStage,
  type NativeShortCoverHeldIntent,
  type NativeShortCoverAcknowledgement,
  type NativeShortCoverReceipt,
  type NativeShortCoverApiResult,
} from './short-native-cover-api/read-phase.js';

import {
  copyRef,
  sameData,
  time,
  hashBytes,
  copyCookies,
  type OwnedNativeShortCoverRunOperations,
  type OwnedNativeShortCoverRunOwner,
  captureNativeShortCoverWriteRequest,
} from './short-native-cover-api/capture-native-short-cover-write-request.js';

import {
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  request,
  type APIResponse,
} from 'playwright';

import { prepareNativeShortCoverImage } from './short-native-cover-image.js';

import { composeOwnedNativeShortCoverRun } from './short-native-cover-api/compose.js';

import {
  type NativeShortMetadataWriteReadPhase,
  type NativeShortFixedReadKind,
} from './short-native-metadata-api.js';

import { type NativeShortCoverPlan } from './short-native-cover.js';

import { type NativeShortMetadataSnapshot } from './short-native-metadata.js';

export interface OwnedNativeShortCoverRunGlobals {
  freeze: typeof freeze;
  UPLOAD_URL: typeof UPLOAD_URL;
  fields: typeof fields;
  copyRef: typeof copyRef;
  UUID: typeof UUID;
  sameData: typeof sameData;
  time: typeof time;
  hashBytes: typeof hashBytes;
  OWNER: typeof OWNER;
  WORK: typeof WORK;
  copyCookies: typeof copyCookies;
  ORIGIN: typeof ORIGIN;
}

export class OwnedNativeShortCoverRun {
  #operations: OwnedNativeShortCoverRunOperations;

  private readonly result = unavailableNativeShortCoverApi('response_unavailable');

  private readonly options: NativeShortCoverApiOptions;

  private readonly businessRequest: NativeShortCoverWriteRequest | null;

  private optionsValid = true;

  private reason: NativeShortCoverApiReason | null = null;

  private api: APIRequestContext | null = null;

  private disposing: Promise<void> | null = null;

  private readonly pending = new Set<Promise<unknown>>();

  private readonly imageAbortController = new AbortController();

  private readonly brands = new Map<string, WeakSet<object>>();

  private readonly minted = new Set<string>();

  private readonly refs = new Set<string>();

  private receiptIdentity: {
    accountId: string;
    jobId: string;
    baseline: NativeShortCoverEvidenceRef;
  } | null = null;

  private activeConfirmation: string | null = null;

  private copiedBytes: Buffer | null = null;

  private timer?: ReturnType<typeof setTimeout>;

  private started = false;

  constructor(
    private readonly borrowed: BrowserContext,
    private readonly workId: string,
    options: NativeShortCoverApiOptions,
    private readonly factory: Pick<APIRequest, 'newContext'> = request,
    private readonly preparer: typeof prepareNativeShortCoverImage = prepareNativeShortCoverImage,
  ) {
    this.#operations = composeOwnedNativeShortCoverRun(
      this as unknown as OwnedNativeShortCoverRunOwner,
      this,
      {
        freeze,
        UPLOAD_URL,
        fields,
        copyRef,
        UUID,
        sameData,
        time,
        hashBytes,
        OWNER,
        WORK,
        copyCookies,
        ORIGIN,
      },
    );

    let businessRequest: NativeShortCoverWriteRequest | null = null;
    try {
      const value = fields(
        options,
        [
          'mode',
          'uploadDir',
          'businessRequest',
          'expectedOwner',
          'deadline',
          'signal',
          'assertLease',
          'assertBorrowedActive',
          'onBeforePlatformRead',
          'onDurableIntent',
          'onBeforePlatformWrite',
          'onDurableAcknowledgement',
          'onVerifiedAccount',
          'onQuarantine',
        ],
        [
          'mode',
          'uploadDir',
          'businessRequest',
          'expectedOwner',
          'deadline',
          'assertLease',
          'assertBorrowedActive',
          'onBeforePlatformRead',
          'onDurableIntent',
          'onBeforePlatformWrite',
          'onDurableAcknowledgement',
          'onVerifiedAccount',
          'onQuarantine',
        ],
      );
      businessRequest = captureNativeShortCoverWriteRequest(value.businessRequest);
      const owner = fields(value.expectedOwner, ['kind', 'id']);
      if (value.signal !== undefined)
        Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(value.signal);
      if (
        [
          'assertLease',
          'assertBorrowedActive',
          'onBeforePlatformRead',
          'onDurableIntent',
          'onBeforePlatformWrite',
          'onDurableAcknowledgement',
          'onVerifiedAccount',
          'onQuarantine',
        ].some((key) => typeof value[key] !== 'function')
      )
        throw Error('Invalid cover callback');
      this.options = {
        ...value,
        expectedOwner: { ...owner },
        businessRequest,
      } as unknown as NativeShortCoverApiOptions;
    } catch {
      this.optionsValid = false;
      this.options = {
        mode: 'write',
        uploadDir: '',
        businessRequest: businessRequest!,
        expectedOwner: { kind: 'account', id: '' },
        deadline: 0,
        assertLease() {},
        assertBorrowedActive() {},
        onBeforePlatformRead() {},
        onVerifiedAccount() {},
        onQuarantine() {},
        onDurableIntent() {
          throw Error('Invalid cover callback');
        },
        onBeforePlatformWrite() {
          throw Error('Invalid cover callback');
        },
        onDurableAcknowledgement() {
          throw Error('Invalid cover callback');
        },
      };
    }
    this.businessRequest = businessRequest;
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.track(promise);
  }
  stop(reason: NativeShortCoverApiReason = 'cancelled'): void {
    return this.#operations.stop(reason);
  }
  private disposalFailed(): void {
    return this.#operations.disposalFailed();
  }
  private startDispose(): void {
    return this.#operations.startDispose();
  }
  private check(): void {
    return this.#operations.check();
  }
  private fail(reason: NativeShortCoverApiReason): never {
    return this.#operations.fail(reason);
  }
  private transport(phase: NativeShortCoverPhase): NativeShortCoverTransport {
    return this.#operations.transport(phase);
  }
  private responseJson(
    response: APIResponse,
    url: string,
    requireData = true,
  ): Promise<Record<string, unknown>> {
    return this.#operations.responseJson(response, url, requireData);
  }
  private json(
    phase: NativeShortMetadataWriteReadPhase,
    kind: NativeShortFixedReadKind,
    index?: number,
  ): Promise<Record<string, unknown>> {
    return this.#operations.json(phase, kind, index);
  }
  private httpOptions(): ReturnType<OwnedNativeShortCoverRunOperations['httpOptions']> {
    return this.#operations.httpOptions();
  }
  private read(
    phase: NativeShortMetadataWriteReadPhase,
  ): ReturnType<OwnedNativeShortCoverRunOperations['read']> {
    return this.#operations.read(phase);
  }
  private confirm(
    input: NativeShortCoverReceiptFields,
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    held: NativeShortCoverHeldIntent,
    observation?: NativeShortCoverAcknowledgement,
  ): NativeShortCoverReceipt {
    return this.#operations.confirm(input, phase, stage, held, observation);
  }
  private callback(
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    held: NativeShortCoverHeldIntent,
    observation?: NativeShortCoverAcknowledgement,
  ): Promise<NativeShortCoverReceipt> {
    return this.#operations.callback(phase, stage, held, observation);
  }
  private post(
    phase: NativeShortCoverPhase,
    plan?: NativeShortCoverPlan,
  ): Promise<Record<string, unknown>> {
    return this.#operations.post(phase, plan);
  }
  private held(
    phase: NativeShortCoverPhase,
    snapshot: NativeShortMetadataSnapshot,
    plan?: NativeShortCoverPlan,
  ): NativeShortCoverHeldIntent {
    return this.#operations.held(phase, snapshot, plan);
  }
  private observation(
    phase: NativeShortCoverPhase,
    plan: NativeShortCoverPlan,
    picUri: string | null,
    picUrl: string | null,
  ): NativeShortCoverAcknowledgement {
    return this.#operations.observation(phase, plan, picUri, picUrl);
  }
  run(): Promise<NativeShortCoverApiResult> {
    return this.#operations.run();
  }
}
export type { NativeShortCoverPhase } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverReceiptStage } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverApiReason } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverWriteRequest } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverEvidenceRef } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverTransport } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverReceiptFields } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverReceipt } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverHeldIntent } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverAcknowledgement } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverApiOptions } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverPost } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverApiPhaseResult } from './short-native-cover-api/read-phase.js';
export type { NativeShortCoverApiResult } from './short-native-cover-api/read-phase.js';
export { unavailableNativeShortCoverApi } from './short-native-cover-api/read-phase.js';
export { captureNativeShortCoverWriteRequest } from './short-native-cover-api/capture-native-short-cover-write-request.js';
export type { OwnedNativeShortCoverRunOwner } from './short-native-cover-api/capture-native-short-cover-write-request.js';
export type { OwnedNativeShortCoverRunOperations } from './short-native-cover-api/capture-native-short-cover-write-request.js';
