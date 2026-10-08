import { type BrowserContext, type Page } from 'playwright';

import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
} from '../../src/platform/short-native-submission-api.js';

import { createSubmissionFixture } from '../short-native-submission-fixture.js';

import { BrowserSession } from '../../src/platform/browser.js';

export const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

type Internals = {
  context: BrowserContext | null;
  page: Page | null;
  queue: Promise<void>;
  identityEpoch: number;
  apiQuarantined: boolean;
  activeNativeShortSubmission: {
    stop(): void;
    done: Promise<NativeShortSubmissionApiResult>;
    cleanupDone: Promise<void>;
  } | null;
};

export function fixture(options: Parameters<typeof createSubmissionFixture>[0] = {}) {
  const api = createSubmissionFixture(options),
    session = new BrowserSession({
      profileDir: '/synthetic-submission-no-profile',
      headless: true,
      operationTimeoutMs: 5_000,
    }),
    state = session as unknown as Internals;
  let closes = 0,
    navigation = 0,
    pageCreates = 0;
  const connected = { value: true };
  let context!: BrowserContext;
  const page = {
    context: () => context,
    isClosed: () => false,
    on() {},
    async goto() {
      navigation++;
      throw Error('Editor navigation forbidden');
    },
    async evaluate() {
      throw Error('Editor scripting forbidden');
    },
  } as unknown as Page;
  context = {
    async cookies(origin: string) {
      return api.borrowed.cookies(origin);
    },
    browser: () => ({ isConnected: () => connected.value }),
    setDefaultTimeout() {},
    pages: () => [page],
    async newPage() {
      pageCreates++;
      throw Error('Extra page forbidden');
    },
    async close() {
      closes++;
    },
    get request() {
      throw Error('Shared request forbidden');
    },
  } as unknown as BrowserContext;
  const {
    deadline: _deadline,
    assertBorrowedActive: _borrowed,
    onQuarantine: _quarantine,
    ...optionsCopy
  } = api.options;
  const browserOptions = {
    ...optionsCopy,
    timeoutMs: 5_000,
  } as NativeShortSubmissionBrowserOptions;
  state.context = context;
  state.page = page;
  return {
    api,
    session,
    state,
    context,
    page,
    connected,
    options: browserOptions,
    get closes() {
      return closes;
    },
    get navigation() {
      return navigation;
    },
    get pageCreates() {
      return pageCreates;
    },
  };
}
