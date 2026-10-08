import { type BrowserContext, type Page } from 'playwright';
import { type ShortMetadataApiResult } from '../../short-metadata-api-schema.js';
import { type ShortDraftDirectoryResult } from '../../short-draft-directory.js';
import {
  type NativeShortMetadataApiResult,
  type NativeShortMetadataApiWriteResult,
} from '../../short-native-metadata-api.js';
import { type NativeShortCoverApiResult } from '../../short-native-cover-api.js';
import { type NativeShortTrialApiResult } from '../../short-native-trial-api.js';
import { type NativeShortSubmissionApiResult } from '../../short-native-submission-api.js';
import { type NativeShortBodyApiResult } from '../../short-native-body-api.js';
import { type ShortMetadataResult } from '../../short-metadata-schema.js';
import { type PlatformIdentity } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type CloseOperation } from '../contracts/close.js';
interface Dependencies {
  closed: boolean;
  identityEpoch: number;
  identity: PlatformIdentity | null;
  qrLoginPage: Page | null;
  activeShortMetadata: { stop(): void; done: Promise<ShortMetadataResult> } | null;
  activeShortMetadataApi: { stop(): void; done: Promise<ShortMetadataApiResult> } | null;
  activeShortDraftDirectory: { stop(): void; done: Promise<ShortDraftDirectoryResult> } | null;
  activeNativeShortMetadata: { stop(): void; done: Promise<NativeShortMetadataApiResult> } | null;
  activeNativeShortMetadataWrite: {
    stop(): void;
    done: Promise<NativeShortMetadataApiWriteResult>;
  } | null;
  activeNativeShortCover: { stop(): void; done: Promise<NativeShortCoverApiResult> } | null;
  activeNativeShortTrial: { stop(): void; done: Promise<NativeShortTrialApiResult> } | null;
  activeNativeShortSubmission: {
    stop(): void;
    done: Promise<NativeShortSubmissionApiResult>;
    cleanupDone: Promise<void>;
  } | null;
  activeNativeShortBody: {
    stop(): void;
    done: Promise<NativeShortBodyApiResult>;
    cleanupDone: Promise<void>;
  } | null;
  apiQuarantined: boolean;
  context: BrowserContext | null;
  queue: Promise<void>;
  page: Page | null;
  diagnosticTargets: Map<string, string>;
  discoveredStableTargets: Set<string>;
}
export function createClose(deps: Dependencies): CloseOperation {
  async function close(): Promise<void> {
    deps.closed = true;
    deps.identityEpoch += 1;
    deps.identity = null;
    deps.qrLoginPage = null;
    // Fresh jobs close/drain their own context before the borrowed persistent
    // context can close its entire Browser. A failed grace retains both resources.
    const isolated = deps.activeShortMetadata;
    if (isolated) {
      isolated.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          isolated.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Owned metadata cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const isolatedApi = deps.activeShortMetadataApi;
    if (isolatedApi) {
      isolatedApi.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          isolatedApi.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Owned API cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const directory = deps.activeShortDraftDirectory;
    if (directory) {
      directory.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          directory.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Owned directory cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const native = deps.activeNativeShortMetadata;
    if (native) {
      native.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          native.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Native API cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const nativeWrite = deps.activeNativeShortMetadataWrite;
    if (nativeWrite) {
      nativeWrite.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          nativeWrite.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Native write cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const cover = deps.activeNativeShortCover;
    if (cover) {
      cover.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          cover.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Native cover cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const trial = deps.activeNativeShortTrial;
    if (trial) {
      trial.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          trial.done,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Native trial cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const submission = deps.activeNativeShortSubmission;
    if (submission) {
      submission.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          submission.cleanupDone,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Owned submission cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
        await submission.done;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const body = deps.activeNativeShortBody;
    if (body) {
      body.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          body.cleanupDone,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BrowserSessionError(
                    'shutdown_incomplete',
                    'Owned body cleanup has not finished; keep the Store and borrowed browser open',
                  ),
                ),
              25_000,
            );
          }),
        ]);
        await body.done;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (deps.apiQuarantined)
      throw new BrowserSessionError(
        'shutdown_incomplete',
        'Owned API disposal is unverified; keep the Store and borrowed browser open',
      );
    // Existing primary-reader shutdown behavior remains unchanged.
    await deps.context?.close();
    await deps.queue;
    deps.context = null;
    deps.page = null;
    deps.diagnosticTargets.clear();
    deps.discoveredStableTargets.clear();
  }
  return close;
}
