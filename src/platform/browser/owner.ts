import { type BrowserContext, type Page } from 'playwright';
import { type ShortMetadataApiResult } from '../short-metadata-api-schema.js';
import { type ShortDraftDirectoryResult } from '../short-draft-directory.js';
import {
  type NativeShortMetadataApiResult,
  type NativeShortMetadataApiWriteResult,
} from '../short-native-metadata-api.js';
import { type NativeShortCoverApiResult } from '../short-native-cover-api.js';
import { type NativeShortTrialApiResult } from '../short-native-trial-api.js';
import { type NativeShortSubmissionApiResult } from '../short-native-submission-api.js';
import { type NativeShortBodyApiResult } from '../short-native-body-api.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot } from './body-options.js';
import { type ShortMetadataResult } from '../short-metadata-schema.js';
import { type PlatformIdentity } from './own-identity.js';
import { type CurrentLoginDiagnostic, type OwnResponseStructure } from './read-diagnostics.js';
import { type ReadResponseStructure } from '../reads.js';

import { type BrowserSessionConfig } from './contracts.js';

import { type BrowserOperations } from './operations.js';
export interface BrowserOwner extends BrowserOperations {
  context: BrowserContext | null;
  page: Page | null;
  queue: Promise<void>;
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
  pageSlots: AsyncLocalStorage<BrowserPageSlot>;
  activePageSlot: BrowserPageSlot | null;
  apiQuarantined: boolean;
  activeShortMetadata: { stop(): void; done: Promise<ShortMetadataResult> } | null;
  closed: boolean;
  identity: PlatformIdentity | null;
  identityEpoch: number;
  activeReaderPage: Page | null;
  qrLoginPage: Page | null;
  ownInfoUrls: WeakMap<Page, Set<string>>;
  pageGetMetadata: WeakMap<
    Page,
    { entries: CurrentLoginDiagnostic['getResponses']; truncated: boolean }
  >;
  pageOwnStructures: WeakMap<Page, Map<string, OwnResponseStructure>>;
  pageReadStructures: WeakMap<Page, Map<string, ReadResponseStructure>>;
  diagnosticTargets: Map<string, string>;
  chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
  discoveredStableTargets: Set<string>;
  hasUnsafeApiCleanup: boolean;
  config: BrowserSessionConfig;
}
