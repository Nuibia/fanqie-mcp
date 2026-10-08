import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { contextVolumeProbeFixture } from './platform-reads-context-volume-probe-fixture.js';

import {
  type ContextBlockedFixture,
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_REF,
} from './platform-reads-legacy-chapter-application-fixture.js';

import { type LoginState, BrowserSession } from '../../src/platform/browser.js';

import { type Page } from 'playwright';

export function assertContextProbeSafe(result: unknown) {
  const encoded = JSON.stringify(result);
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    'PRIVATE_PROBE_OWNER',
    'PRIVATE_OPAQUE',
    'opaque_fixture',
    'PAIR',
    'PRIVATE_API_BODY',
    'PRIVATE_API_ERROR',
    'PRIVATE_PROBE_TOKEN',
    'PRIVATE_HTML_RESPONSE_BODY',
    'PRIVATE_DISPOSAL_ERROR',
    'PRIVATE_OWN_TRANSPORT_ERROR',
    'PRIVATE_OWN_JSON_ERROR',
    'PRIVATE_OWN_DISPOSE_ERROR',
    'PRIVATE_OWN_BODY',
    '7700000000000000001',
  ])
    assert.equal(encoded.includes(secret), false);
}

export const CURRENT_CHAPTER_VOLUME = '7700000000000000001';

export const CURRENT_CHAPTER_ITEM = '7800000000000000001';

export const CURRENT_DIRECTORY_BOOK = `https://fanqienovel.com/api/author/book/book_detail/v0/?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&opaque_fixture=PRIVATE_BOOK_TOKEN`;

export const CURRENT_DIRECTORY_CHAPTER = `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&volume_id=${CURRENT_CHAPTER_VOLUME}&page_index=0&page_count=10&opaque_fixture=PRIVATE_CHAPTER_TOKEN`;

export const currentVolumeJson = () => ({
  code: 0,
  data: {
    volume_list: [
      {
        index: 0,
        book_id: CHAPTER_ENTRY_FIXTURE_WORK,
        volume_id: CURRENT_CHAPTER_VOLUME,
        volume_name: 'Synthetic volume',
        item_count: 2,
      },
    ],
  },
});

export const currentBookJson = () => ({
  code: 0,
  data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
});

export const currentChapterJson = () => ({
  code: 0,
  data: {
    total_count: 2,
    item_list: [
      {
        item_id: CURRENT_CHAPTER_ITEM,
        volume_id: CURRENT_CHAPTER_VOLUME,
        index: 1,
        title: 'Synthetic current chapter',
        word_number: 1000,
        article_status: 99,
        display_status: 88,
        create_time: 'UNKNOWN_RAW_TIME',
        timer_time: '',
        content: 'PRIVATE_CHAPTER_BODY',
      },
    ],
  },
});

export function currentDirectoryFixture(
  options: Parameters<typeof contextVolumeProbeFixture>[0] & {
    managerRequest?: ContextBlockedFixture;
  } = {},
) {
  const fixture = contextVolumeProbeFixture({
    directoryReplies: {
      [CONTEXT_PROBE_SOURCE]: currentVolumeJson(),
      [CURRENT_DIRECTORY_BOOK]: currentBookJson(),
      [CURRENT_DIRECTORY_CHAPTER]: currentChapterJson(),
    },
    sources: [
      { url: CONTEXT_PROBE_SOURCE },
      { url: CURRENT_DIRECTORY_BOOK },
      { url: CURRENT_DIRECTORY_CHAPTER },
    ],
    ...options,
  });
  const internals = fixture.session as unknown as {
    openExistingChapterDirectory(...args: unknown[]): Promise<unknown>;
  };
  let entryCalls = 0;
  internals.openExistingChapterDirectory = async (page, sources, workId, before) => {
    assert.equal(page, fixture.page);
    assert.equal(workId, CHAPTER_ENTRY_FIXTURE_WORK);
    assert.equal((before as LoginState).identity?.accountId, '1001');
    assert.equal((sources as Set<string>).size, 1);
    entryCalls += 1;
    // Existing-work card/title/button verification has separate unchanged fixtures.
    // This narrow private fixture substitutes only that already-audited UI step.
    return {
      entry: { status: 'opened', targetRef: CONTEXT_PROBE_REF },
      login: before,
      ready: true,
      redactions: [],
    };
  };
  fixture.session.enterCurrentChapterDirectory = async () => {
    throw Error('The builtin must never run the old page-fetch entry or a fallback');
  };
  const goto = fixture.page.goto.bind(fixture.page);
  fixture.page.goto = (async (url: string, gotoOptions) => {
    if (url === 'https://fanqienovel.com/main/writer/book-manage') {
      if (options.managerRequest) await fixture.triggerBlocked(options.managerRequest);
      fixture.setUrl(url);
      fixture.emit('framenavigated', fixture.page.mainFrame());
      const request = fixture.request(
        'https://fanqienovel.com/api/author/book/book_list/v0/?page_index=0&page_count=10',
      );
      fixture.emit('request', request);
      fixture.emit('response', {
        request: () => request,
        url: request.url,
        status: () => 200,
        ok: () => true,
        async json() {
          return { code: 0, data: { book_list: [] } };
        },
      });
      return null;
    }
    return goto(url, gotoOptions);
  }) as Page['goto'];
  let identities: LoginState[] = [];
  const call = (
    extra: Partial<Parameters<BrowserSession['collectCurrentChapterDirectory']>[2]> = {},
  ) =>
    fixture.session.withPage(
      (page) =>
        fixture.session.collectCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
          timeoutMs: 20,
          jobId: '12345678-1234-1234-1234-123456789abc',
          expectedOwner: { kind: 'account', id: '1001' },
          onVerifiedOwner: (state) => {
            identities.push(state);
          },
          ...extra,
        }),
      { signal: extra.signal },
    );
  return Object.defineProperty(Object.assign(fixture, { call, identities }), 'entryCalls', {
    get: () => entryCalls,
  }) as typeof fixture & {
    call: typeof call;
    identities: LoginState[];
    readonly entryCalls: number;
  };
}

export function assertCurrentChapterFailureMetadataSafe(value: unknown) {
  const encoded = JSON.stringify(value);
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    CURRENT_CHAPTER_VOLUME,
    CURRENT_CHAPTER_ITEM,
    '1001',
    'PRIVATE_',
    'opaque_fixture',
    'https://',
    '?',
    'sourceProof',
    'lease',
    'schema',
    'headers',
  ])
    assert.equal(encoded.includes(secret), false);
}

export function guardCurrentCollectionPagePhase(
  fixture: ReturnType<typeof currentDirectoryFixture>,
) {
  const internals = fixture.session as unknown as {
    openExistingChapterDirectory(...args: unknown[]): Promise<unknown>;
  };
  const entry = internals.openExistingChapterDirectory.bind(internals),
    verify = fixture.session.verifyCurrentAccount.bind(fixture.session);
  let entered = false,
    redundantCalls = 0;
  internals.openExistingChapterDirectory = async (...args) => {
    const value = await entry(...args);
    entered = true;
    return value;
  };
  fixture.session.verifyCurrentAccount = async (page) => {
    if (entered) {
      redundantCalls += 1;
      throw Error('PRIVATE_REDUNDANT_PAGE_VERIFY');
    }
    return verify(page);
  };
  return {
    get redundantCalls() {
      return redundantCalls;
    },
  };
}

export function interceptCurrentBootstrapFrameTrees(
  fixture: ReturnType<typeof currentDirectoryFixture>,
  project: (read: number, value: unknown) => unknown,
) {
  const context = fixture.page.context(),
    attach = context.newCDPSession.bind(context);
  let reads = 0;
  context.newCDPSession = async (page) => {
    const cdp = await attach(page),
      mutable = cdp as unknown as { send(name: string): Promise<unknown> },
      send = mutable.send.bind(mutable);
    mutable.send = async (name) => {
      const value = await send(name);
      return name === 'Page.getFrameTree' ? project(++reads, value) : value;
    };
    return cdp;
  };
}

export function assertCurrentBootstrapMetadataShape(
  value: Awaited<ReturnType<ReturnType<typeof currentDirectoryFixture>['call']>>['readDiagnostics'],
) {
  assert.ok(value?.currentChapterCollection);
  const metadata = value.currentChapterCollection;
  assert.deepEqual(
    Object.keys(metadata).sort(),
    [
      'kind',
      'failedStage',
      'initialState',
      'identityTypes',
      'ownAccountContext',
      'callback',
      'observedReason',
      'canonicalBootstrap',
      'sourceObservation',
    ].sort(),
  );
  assertCurrentChapterFailureMetadataSafe(metadata);
  if (!metadata.canonicalBootstrap) return;
  const bootstrap = metadata.canonicalBootstrap;
  assert.deepEqual(
    Object.keys(bootstrap).sort(),
    [
      'subphase',
      'cdp',
      'firstViolation',
      'initialChecks',
      'freezeChecks',
      'firstCdpFaultCheck',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(bootstrap.cdp).sort(),
    ['failure', 'initialized', 'rootFrameObserved', 'committedLoaderObserved'].sort(),
  );
  assert.equal(Object.keys(bootstrap.initialChecks).length, 9);
  assert.equal(Object.keys(bootstrap.freezeChecks).length, 11);
  for (const checks of [bootstrap.initialChecks, bootstrap.freezeChecks])
    for (const observed of Object.values(checks))
      assert.ok(observed === null || typeof observed === 'boolean');
  if (bootstrap.firstViolation)
    assert.deepEqual(Object.keys(bootstrap.firstViolation).sort(), ['phase', 'reason']);
}

export type SourceObservationFixture = NonNullable<
  NonNullable<
    NonNullable<
      Awaited<ReturnType<ReturnType<typeof currentDirectoryFixture>['call']>>['readDiagnostics']
    >['currentChapterCollection']
  >['sourceObservation']
>;
