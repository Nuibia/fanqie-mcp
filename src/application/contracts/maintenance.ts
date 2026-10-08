import { type JobContext } from '../../runtime/jobs.js';
import * as writes from '../../platform/writes.js';

import { type CompletedOperation } from './query.js';
import * as bodyModel from '../../platform/short-native-body.js';
import * as coverRuntime from '../../platform/short-native-cover-runtime.js';
import {
  type NativeShortWriteBusinessInput,
  type NativeShortProvenance,
} from '../../platform/short-native-metadata-proof.js';
import * as submissionRuntime from '../../platform/short-native-submission-runtime.js';
import * as trialRuntime from '../../platform/short-native-trial-runtime.js';
import { BrowserSession } from '../../platform/browser.js';

export type BookWriteOptionsOperation = (ctx: JobContext) => writes.LongBookMetadataOptions;
export type ExecuteBookMetadataWriteOperation = (
  args: Record<string, unknown>,
) => Promise<ReturnType<CompletedOperation>>;
export type ExecuteNativeShortBodyWriteOperation = (
  business: bodyModel.NativeShortBodyBusinessInput,
  idempotencyKey: string,
) => Promise<ReturnType<CompletedOperation>>;
export type ExecuteNativeShortCoverWriteOperation = (
  business: coverRuntime.NativeShortCoverBusinessInput,
  idempotencyKey: string,
) => Promise<ReturnType<CompletedOperation>>;
export type ExecuteNativeShortMetadataWriteOperation = (
  business: NativeShortWriteBusinessInput,
  idempotencyKey: string,
) => Promise<ReturnType<CompletedOperation>>;
export type ExecuteNativeShortSubmissionWriteOperation = (
  business: submissionRuntime.NativeShortSubmissionBusinessInput,
  idempotencyKey: string,
) => Promise<ReturnType<CompletedOperation>>;
export type ExecuteNativeShortTrialWriteOperation = (
  business: trialRuntime.NativeShortTrialBusinessInput,
  idempotencyKey: string,
) => Promise<ReturnType<CompletedOperation>>;
export type ExecuteWriteOperation = (
  operation: string,
  args: Record<string, unknown>,
  kind: 'short' | 'chapter',
  run: (
    page: Parameters<Parameters<BrowserSession['withPage']>[0]>[0],
    ctx: JobContext,
    options: writes.WriteOptions,
    accountId: string,
  ) => Promise<writes.WriteResult>,
) => Promise<ReturnType<CompletedOperation>>;
export type RuntimeTargetOperation = (
  target: writes.WriteTarget | writes.LongBookMetadataTarget,
) =>
  | {
      kind: 'long-book';
      id: string;
      parentId?: undefined;
    }
  | {
      kind: 'short-story';
      id: string;
      parentId?: undefined;
    }
  | {
      kind: 'chapter';
      id: string;
      parentId: string;
    };
export type SubmissionOptionsOperation = (expectedPlatformAccount: string) => {
  timeoutMs: number;
  expectedPlatformAccount: string;
  provenance: NativeShortProvenance;
  currentPlatformAccount: () => string | null;
  onVerifiedAccount: (accountId: string, checkedAt: string) => void;
};
export type WriteOptionsOperation = (
  ctx: JobContext,
  kind: 'short' | 'chapter',
) => writes.WriteOptions;
