import { type BrowserContext, type Page, type APIRequest } from 'playwright';
import {
  type ShortMetadataApiResult,
  type ShortMetadataApiOptions,
} from '../short-metadata-api-schema.js';
import {
  type ShortDraftDirectoryResult,
  type ShortDraftDirectoryOptions,
} from '../short-draft-directory.js';
import {
  type NativeShortMetadataApiResult,
  type NativeShortMetadataApiWriteResult,
  type NativeShortMetadataApiOptions,
  type NativeShortMetadataApiWriteOptions,
} from '../short-native-metadata-api.js';
import {
  type NativeShortCoverApiResult,
  type NativeShortCoverApiOptions,
} from '../short-native-cover-api.js';
import {
  type NativeShortTrialApiResult,
  type NativeShortTrialApiWriteOptions,
} from '../short-native-trial-api.js';
import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
} from '../short-native-submission-api.js';
import {
  type NativeShortBodyApiResult,
  type NativeShortBodyBrowserOptions,
  type NativeShortBodyProductionStart,
} from '../short-native-body-api.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot, type BodyFixtureBrowserOptions } from './body-options.js';
import { type ShortMetadataResult, type ShortMetadataOptions } from '../short-metadata-schema.js';
import { type PlatformIdentity, type LoginState } from './own-identity.js';
import { type CurrentLoginDiagnostic, type OwnResponseStructure } from './read-diagnostics.js';
import {
  type ReadResponseStructure,
  type DatasetResult,
  type ChapterRecord,
  type ChapterDraftRecord,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../reads.js';
import { BrowserSessionError } from './errors.js';
import {
  type BrowserSessionConfig,
  type BrowserCallOptions,
  type ChapterDirectoryCallOptions,
  type CurrentChapterDirectoryOptions,
  type CurrentChapterBodyRead,
} from './contracts.js';

import { type NativeShortSubmissionContract } from '../short-native-submission.js';
import { type DiagnosticOptions, type ReadPageDiagnostic } from './chapter-diagnostics.js';
import { type LoginQrcodeResult } from './qr-login.js';

import { type ChapterBodyRecord } from '../chapter-body.js';

import { type BrowserOperations } from './operations.js';
import { type BrowserOwner } from './owner.js';
import { composeBrowserOperations } from './compose.js';
export class BrowserSession {
  #operations: BrowserOperations;

  private context: BrowserContext | null = null;

  private page: Page | null = null;

  private queue: Promise<void> = Promise.resolve();

  private activeShortMetadataApi: { stop(): void; done: Promise<ShortMetadataApiResult> } | null =
    null;

  private activeShortDraftDirectory: {
    stop(): void;
    done: Promise<ShortDraftDirectoryResult>;
  } | null = null;

  private activeNativeShortMetadata: {
    stop(): void;
    done: Promise<NativeShortMetadataApiResult>;
  } | null = null;

  private activeNativeShortMetadataWrite: {
    stop(): void;
    done: Promise<NativeShortMetadataApiWriteResult>;
  } | null = null;

  private activeNativeShortCover: {
    stop(): void;
    done: Promise<NativeShortCoverApiResult>;
  } | null = null;

  private activeNativeShortTrial: {
    stop(): void;
    done: Promise<NativeShortTrialApiResult>;
  } | null = null;

  private activeNativeShortSubmission: {
    stop(): void;
    done: Promise<NativeShortSubmissionApiResult>;
    cleanupDone: Promise<void>;
  } | null = null;

  private activeNativeShortBody: {
    stop(): void;
    done: Promise<NativeShortBodyApiResult>;
    cleanupDone: Promise<void>;
  } | null = null;

  private readonly pageSlots = new AsyncLocalStorage<BrowserPageSlot>();

  private activePageSlot: BrowserPageSlot | null = null;

  private apiQuarantined = false;

  private activeShortMetadata: { stop(): void; done: Promise<ShortMetadataResult> } | null = null;

  private closed = false;

  private identity: PlatformIdentity | null = null;

  private identityEpoch = 0;

  private activeReaderPage: Page | null = null;

  private qrLoginPage: Page | null = null;

  private readonly ownInfoUrls = new WeakMap<Page, Set<string>>();

  private readonly pageGetMetadata = new WeakMap<
    Page,
    { entries: CurrentLoginDiagnostic['getResponses']; truncated: boolean }
  >();

  private readonly pageOwnStructures = new WeakMap<Page, Map<string, OwnResponseStructure>>();

  private readonly pageReadStructures = new WeakMap<Page, Map<string, ReadResponseStructure>>();

  private readonly diagnosticTargets = new Map<string, string>();

  private readonly chapterTargetOwners = new Map<
    string,
    { kind: 'account' | 'author'; id: string }
  >();

  private readonly discoveredStableTargets = new Set<string>();

  get hasUnsafeApiCleanup(): boolean {
    return this.apiQuarantined;
  }

  constructor(public readonly config: BrowserSessionConfig) {
    if (!config.profileDir)
      throw new BrowserSessionError('invalid_config', 'profileDir is required');

    this.#operations = composeBrowserOperations(this as unknown as BrowserOwner, this);
  }
  private assertAccountUsable(): void {
    return this.#operations.assertAccountUsable();
  }
  private isCurrentPageSlot(slot: BrowserPageSlot | null | undefined, page: Page): boolean {
    return this.#operations.isCurrentPageSlot(slot, page);
  }
  private ownsPageSlot(page: Page): boolean {
    return this.#operations.ownsPageSlot(page);
  }
  private observeIdentity(page: Page): void {
    return this.#operations.observeIdentity(page);
  }
  private rememberIdentity(identity: PlatformIdentity): void {
    return this.#operations.rememberIdentity(identity);
  }
  private ensurePage(ownedInitialization = false): Promise<Page> {
    return this.#operations.ensurePage(ownedInitialization);
  }
  withPage<T>(reader: (page: Page) => Promise<T>, options: BrowserCallOptions = {}): Promise<T> {
    return this.#operations.withPage(reader, options);
  }
  diagnoseShortMetadataSchema(
    workId: string,
    options: Omit<ShortMetadataOptions, 'deadline' | 'assertBorrowedActive'> & BrowserCallOptions,
  ): Promise<ShortMetadataResult> {
    return this.#operations.diagnoseShortMetadataSchema(workId, options);
  }
  diagnoseShortMetadataApiSchema(
    workId: string,
    options: Omit<ShortMetadataApiOptions, 'deadline' | 'assertBorrowedActive' | 'onQuarantine'> &
      BrowserCallOptions,
  ): Promise<ShortMetadataApiResult> {
    return this.#operations.diagnoseShortMetadataApiSchema(workId, options);
  }
  runShortDraftDirectory(
    options: Omit<
      ShortDraftDirectoryOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
    fixtureFactory?: Pick<APIRequest, 'newContext'>,
  ): Promise<ShortDraftDirectoryResult> {
    return this.#operations.runShortDraftDirectory(options, fixtureFactory);
  }
  runNativeShortMetadata(
    workId: string,
    options: Omit<
      NativeShortMetadataApiOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortMetadataApiResult> {
    return this.#operations.runNativeShortMetadata(workId, options);
  }
  runNativeShortMetadataUpdate(
    workId: string,
    options: Omit<
      NativeShortMetadataApiWriteOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortMetadataApiWriteResult> {
    return this.#operations.runNativeShortMetadataUpdate(workId, options);
  }
  runNativeShortCoverUpdate(
    workId: string,
    options: Omit<
      NativeShortCoverApiOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortCoverApiResult> {
    return this.#operations.runNativeShortCoverUpdate(workId, options);
  }
  runNativeShortTrialUpdate(
    workId: string,
    options: Omit<
      NativeShortTrialApiWriteOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortTrialApiResult> {
    return this.#operations.runNativeShortTrialUpdate(workId, options);
  }
  runNativeShortSubmission(
    workId: string,
    options: NativeShortSubmissionBrowserOptions,
  ): Promise<NativeShortSubmissionApiResult> {
    return this.#operations.runNativeShortSubmission(workId, options);
  }
  runNativeShortSubmissionFixture(
    workId: string,
    options: NativeShortSubmissionBrowserOptions,
    factory: Pick<APIRequest, 'newContext'>,
    contract: NativeShortSubmissionContract,
  ): Promise<NativeShortSubmissionApiResult> {
    return this.#operations.runNativeShortSubmissionFixture(workId, options, factory, contract);
  }
  private runNativeShortSubmissionOwned(
    workId: string,
    input: NativeShortSubmissionBrowserOptions,
    fixture?: { factory: Pick<APIRequest, 'newContext'>; contract: NativeShortSubmissionContract },
  ): Promise<NativeShortSubmissionApiResult> {
    return this.#operations.runNativeShortSubmissionOwned(workId, input, fixture);
  }
  runNativeShortBodyUpdate(
    workId: string,
    options: NativeShortBodyBrowserOptions,
  ): Promise<NativeShortBodyApiResult> {
    return this.#operations.runNativeShortBodyUpdate(workId, options);
  }
  runNativeShortBodyFixtureUpdate(
    workId: string,
    options: BodyFixtureBrowserOptions,
    factory: Pick<APIRequest, 'newContext'>,
  ): Promise<NativeShortBodyApiResult> {
    return this.#operations.runNativeShortBodyFixtureUpdate(workId, options, factory);
  }
  private runNativeShortBodyOwned(
    workId: string,
    options: BodyFixtureBrowserOptions,
    execution:
      | { kind: 'fixture'; factory: Pick<APIRequest, 'newContext'> }
      | { kind: 'production'; start: NativeShortBodyProductionStart },
  ): Promise<NativeShortBodyApiResult> {
    return this.#operations.runNativeShortBodyOwned(workId, options, execution);
  }
  read<T>(reader: (page: Page) => Promise<T>, options: BrowserCallOptions = {}): Promise<T> {
    return this.#operations.read(reader, options);
  }
  private inspectLogin(page: Page, allowCachedIdentity = true): Promise<LoginState> {
    return this.#operations.inspectLogin(page, allowCachedIdentity);
  }
  checkLogin(options: BrowserCallOptions = {}): Promise<LoginState> {
    return this.#operations.checkLogin(options);
  }
  startLogin(
    options: BrowserCallOptions = {},
  ): Promise<LoginState & { interactionMode: 'visible_browser' | 'screenshot'; pageUrl: string }> {
    return this.#operations.startLogin(options);
  }
  inspectCurrentLogin(options: BrowserCallOptions = {}): Promise<LoginState> {
    return this.#operations.inspectCurrentLogin(options);
  }
  diagnoseCurrentLoginPage(options: DiagnosticOptions = {}): Promise<CurrentLoginDiagnostic> {
    return this.#operations.diagnoseCurrentLoginPage(options);
  }
  private readLoginQrUi(page: Page): Promise<{
    challenge: boolean;
    expired: boolean;
    appInstructions: string | null;
    expiryText: string | null;
  }> {
    return this.#operations.readLoginQrUi(page);
  }
  getLoginQrcode(options: BrowserCallOptions = {}): Promise<LoginQrcodeResult> {
    return this.#operations.getLoginQrcode(options);
  }
  screenshot(options: BrowserCallOptions = {}): Promise<Buffer> {
    return this.#operations.screenshot(options);
  }
  verifyCurrentAccount(page: Page): Promise<LoginState> {
    return this.#operations.verifyCurrentAccount(page);
  }
  private waitForWriterReady(page: Page, timeoutMs: number): Promise<boolean> {
    return this.#operations.waitForWriterReady(page, timeoutMs);
  }
  private waitForObservedOwnSource(page: Page, timeoutMs: number): Promise<void> {
    return this.#operations.waitForObservedOwnSource(page, timeoutMs);
  }
  enterCurrentChapterDirectory(
    page: Page,
    workId: string,
    options: ChapterDirectoryCallOptions = {},
  ): Promise<{ sourceUrl: string }> {
    return this.#operations.enterCurrentChapterDirectory(page, workId, options);
  }
  private openExistingChapterDirectory(
    page: Page,
    sources: ReadonlySet<string>,
    workId: string,
    before: LoginState,
    timeoutMs: number,
  ): ReturnType<BrowserOperations['openExistingChapterDirectory']> {
    return this.#operations.openExistingChapterDirectory(page, sources, workId, before, timeoutMs);
  }
  private openChapterDraftTab(
    page: Page,
    sources: ReadonlyMap<string, { raw: string; epoch: number }>,
    before: LoginState,
    timeoutMs: number,
  ): ReturnType<BrowserOperations['openChapterDraftTab']> {
    return this.#operations.openChapterDraftTab(page, sources, before, timeoutMs);
  }
  collectCurrentChapterDirectory(
    page: Page,
    workId: string,
    options: CurrentChapterDirectoryOptions,
  ): Promise<DatasetResult<ChapterRecord>> {
    return this.#operations.collectCurrentChapterDirectory(page, workId, options);
  }
  collectCurrentChapterBody(
    page: Page,
    workId: string,
    chapterId: string,
    options: CurrentChapterDirectoryOptions,
  ): Promise<DatasetResult<ChapterBodyRecord>> {
    return this.#operations.collectCurrentChapterBody(page, workId, chapterId, options);
  }
  private collectChapterDirectoryRead(
    page: Page,
    workId: string,
    options: CurrentChapterDirectoryOptions,
    bodyRead?: CurrentChapterBodyRead,
  ): Promise<DatasetResult<ChapterRecord>> {
    return this.#operations.collectChapterDirectoryRead(page, workId, options, bodyRead);
  }
  collectCurrentChapterDraftDirectory(
    page: Page,
    workId: string,
    options: CurrentChapterDirectoryOptions,
  ): Promise<DatasetResult<ChapterDraftRecord>> {
    return this.#operations.collectCurrentChapterDraftDirectory(page, workId, options);
  }
  private openOwnedChapterDraftTab(
    page: Page,
    targetRef: string,
    options: CurrentChapterDirectoryOptions,
    deadline: number,
  ): Promise<string> {
    return this.#operations.openOwnedChapterDraftTab(page, targetRef, options, deadline);
  }
  private readCurrentChapterDraftContext(
    page: Page,
    targetRef: string,
    options: BrowserCallOptions,
    collection: {
      result: DatasetResult<ChapterDraftRecord>;
      options: CurrentChapterDirectoryOptions;
      failureMetadata: CurrentChapterCollectionFailureDiagnostic;
    },
    deadline: number,
  ): Promise<void> {
    return this.#operations.readCurrentChapterDraftContext(
      page,
      targetRef,
      options,
      collection,
      deadline,
    );
  }
  diagnoseChapterVolumeContext(
    targetRef: string,
    options: BrowserCallOptions = {},
  ): Promise<ReadPageDiagnostic> {
    return this.#operations.diagnoseChapterVolumeContext(targetRef, options);
  }
  private readCurrentChapterContext(
    page: Page,
    targetRef: string,
    options: BrowserCallOptions,
    collection?: {
      result: DatasetResult<ChapterRecord>;
      options: CurrentChapterDirectoryOptions;
      failureMetadata: CurrentChapterCollectionFailureDiagnostic;
      bodyRead?: CurrentChapterBodyRead;
    },
  ): Promise<ReadPageDiagnostic> {
    return this.#operations.readCurrentChapterContext(page, targetRef, options, collection);
  }
  private prepareChapterDiagnostic(
    page: Page,
    targetRef: string,
    before: LoginState,
    timeoutMs: number,
    options: BrowserCallOptions,
  ): ReturnType<BrowserOperations['prepareChapterDiagnostic']> {
    return this.#operations.prepareChapterDiagnostic(page, targetRef, before, timeoutMs, options);
  }
  diagnoseReadPage(
    sourceUrl: string,
    options: DiagnosticOptions = {},
  ): Promise<ReadPageDiagnostic> {
    return this.#operations.diagnoseReadPage(sourceUrl, options);
  }
  close(): Promise<void> {
    return this.#operations.close();
  }
}
