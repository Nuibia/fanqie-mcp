import { AsyncResource } from 'node:async_hooks';

import { BrowserSession, WRITER_HOME, BrowserSessionError } from '../../src/platform/browser.js';

import { type BrowserContext, type Page } from 'playwright';

import { EventEmitter } from 'node:events';

import { ACCOUNT, WORK, edit, type Overrides } from './short-native-metadata-api-deferred.js';

import { type NativeShortMetadataDurableReceiptFields } from '../../src/platform/short-native-metadata-api.js';

import { type NativeShortMetadataRequest } from '../../src/platform/short-native-metadata.js';

export function chapterTransportFixture(outsideReaderAls: boolean) {
  // Constructed before withPage: Playwright's shared transport does not inherit reader ALS.
  const transport = new AsyncResource('synthetic-playwright-shared-transport');
  const session = new BrowserSession({
    profileDir: '/synthetic-no-profile',
    headless: true,
    operationTimeoutMs: 5_000,
  });
  const context = {
    async close() {},
    browser: () => ({ isConnected: () => true }),
  } as unknown as BrowserContext;
  const emitter = new EventEmitter(),
    frame = {},
    source = 'https://fanqienovel.com/api/author/book/book_list/v0/?page_index=0&page_count=10';
  const observers: {
    request: Array<(value: unknown) => unknown>;
    response: Array<(value: unknown) => unknown>;
  } = { request: [], response: [] };
  const originalOn = emitter.on;
  emitter.on = function (event: string, listener: (...args: unknown[]) => unknown) {
    if (event === 'request' || event === 'response') observers[event].push(listener);
    return originalOn.call(this, event, listener);
  };
  let inspected = 0,
    entryAttempts = 0,
    navigations = 0;
  const touch = <T>(value: T) => {
    inspected++;
    return value;
  };
  const request = {
    method: () => touch('GET'),
    frame: () => touch(frame),
    url: () => touch(source),
  };
  const response = {
    url: () => touch(source),
    status: () => touch(200),
    request: () => touch(request),
  };
  const internals = session as unknown as {
    context: BrowserContext;
    page: Page;
    identityEpoch: number;
    apiQuarantined: boolean;
    waitForWriterReady(): Promise<boolean>;
    openExistingChapterDirectory(): Promise<never>;
  };
  const page = Object.assign(emitter, {
    context: () => context,
    isClosed: () => false,
    mainFrame: () => frame,
    url: () => 'https://fanqienovel.com/main/writer/book-manage',
    async route() {},
    async unroute() {},
    async waitForLoadState() {},
    async waitForResponse() {
      return response;
    },
    async goto() {
      const emit = () => {
        navigations++;
        internals.identityEpoch++;
        emitter.emit('framenavigated', frame);
        emitter.emit('request', request);
        emitter.emit('response', response);
      };
      if (outsideReaderAls) transport.runInAsyncScope(emit);
      else emit();
    },
  }) as unknown as Page;
  internals.context = context;
  internals.page = page;
  session.verifyCurrentAccount = async () => ({
    status: 'authenticated',
    identity: {
      accountId: ACCOUNT,
      authorId: null,
      displayName: null,
      evidenceSource: 'synthetic-typed-account',
    },
    checkedAt: new Date().toISOString(),
    sourceUrl: WRITER_HOME,
  });
  internals.waitForWriterReady = async () => true;
  internals.openExistingChapterDirectory = async () => {
    entryAttempts++;
    throw new BrowserSessionError(
      'synthetic_source_accepted',
      'Synthetic stopping point after source acceptance',
    );
  };
  const options = {
    jobId: '12345678-1234-1234-1234-123456789abc',
    expectedOwner: { kind: 'account' as const, id: ACCOUNT },
    onVerifiedOwner() {},
  };
  const collect = (
    kind: 'directory' | 'drafts',
    current: Page,
  ): Promise<{ errors: Array<{ code: string }> }> =>
    kind === 'directory'
      ? session.collectCurrentChapterDirectory(current, WORK, options)
      : session.collectCurrentChapterDraftDirectory(current, WORK, options);
  const deliverCaptured = () =>
    transport.runInAsyncScope(() => {
      for (const observer of observers.request) observer(request);
      for (const observer of observers.response) observer(response);
    });
  return {
    session,
    page,
    internals,
    collect,
    deliverCaptured,
    destroy: () => transport.emitDestroy(),
    get inspected() {
      return inspected;
    },
    get entryAttempts() {
      return entryAttempts;
    },
    get navigations() {
      return navigations;
    },
  };
}

export type WriteHold = 'durable' | 'mark' | 'post' | 'post_body' | 'post_dispose' | 'final_owner';

export type WriteRaw = ReturnType<typeof edit> & {
  latest_version?: unknown;
  modify_time?: unknown;
  display_status?: unknown;
};

export interface WriteOverrides extends Overrides {
  writeHold?: WriteHold;
  callbackFault?: 'durable' | 'mark' | 'final_owner';
  ack?: Record<string, unknown>;
  lostAck?: boolean;
  postDisposeFailure?: boolean;
  forgedReceipt?: boolean;
  receiptMutation?: (fields: NativeShortMetadataDurableReceiptFields) => void;
  requestMutation?: (request: NativeShortMetadataRequest) => void;
  afterMutation?: (raw: WriteRaw) => void;
  afterRows?: readonly string[];
  beforeMutation?: (raw: WriteRaw) => void;
  emptyCategories?: boolean;
}
