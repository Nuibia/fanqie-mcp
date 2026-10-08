import test from 'node:test';

import {
  ChapterCreationFixturePage,
  chapterCreationProfile,
  createdChapterUrl,
  assertUnknownChapterCreation,
  chapterCreationUrl,
} from './helpers/platform-writes-chapter-creation-profile.js';

import { saveChapterDraft } from '../src/platform/writes.js';

import {
  accountId,
  workId,
  content,
  options,
  chapterId,
  createdId,
} from './helpers/platform-writes-fixture-page.js';

import assert from 'node:assert/strict';

test('validation exhausts chapter ID deadline inside the first URL read and stays unknown before its hook', async () => {
  const page = new ChapterCreationFixturePage();
  page.routeDelayMs = 0;
  const originalUrl = page.url.bind(page),
    timeoutMs = 20,
    validationCostMs = 60;
  let getterCalls = 0;
  let getterCostMs = 0;
  let getterObservedUrl: string | undefined;
  let hookCalls = 0;
  let intents = 0;
  page.url = () => {
    if (page.creationReturnedUrl !== undefined && getterCalls === 0) {
      getterCalls++;
      getterObservedUrl = page.creationReturnedUrl;
      const startedAt = performance.now();
      // One local, bounded synchronous read consumes the budget after the waiter loop has entered.
      while (performance.now() < startedAt + validationCostMs) {
        /* synthetic URL validation cost */
      }
      getterCostMs = performance.now() - startedAt;
    }
    return originalUrl();
  };
  try {
    const result = await saveChapterDraft(
      page.asPage(),
      { accountId, workId, clientReference: 'chapter-validation-budget-fixture', content },
      {
        ...options,
        profile: chapterCreationProfile(),
        timeoutMs,
        beforeSideEffect: async () => {
          intents++;
        },
        onTargetDiscovered: async () => {
          hookCalls++;
        },
      },
    );
    assert.equal(getterCalls, 1);
    assert.equal(getterObservedUrl, createdChapterUrl);
    assert.ok(getterCostMs >= validationCostMs && getterCostMs > timeoutMs);
    assert.ok(
      page.creationNavigationTimeouts[0]! > 0 && page.creationNavigationTimeouts[0]! <= timeoutMs,
    );
    assertUnknownChapterCreation(result, page);
    assert.equal(result.target, undefined);
    assert.equal(hookCalls, 0);
    assert.equal(intents, 1);
    assert.equal(page.routeUpdates, 1);
  } finally {
    page.url = originalUrl;
    page.cleanup();
  }
});

test('chapter creation uses a finite default budget and caps an explicitly larger budget', async () => {
  for (const [timeoutMs, maximum] of [
    [undefined, 20_000],
    [100_000, 30_000],
  ] as const) {
    const page = new ChapterCreationFixturePage();
    page.routeDelayMs = 0;
    try {
      const result = await saveChapterDraft(
        page.asPage(),
        { accountId, workId, clientReference: 'chapter-budget-fixture', content },
        { ...options, profile: chapterCreationProfile(), timeoutMs },
      );
      assert.equal(result.status, 'succeeded');
      assert.ok(
        page.creationNavigationTimeouts[0]! > maximum - 1_000 &&
          page.creationNavigationTimeouts[0]! <= maximum,
      );
      assert.equal(page.gotoCalls.filter((url) => url === chapterCreationUrl).length, 1);
      assert.deepEqual(page.clicks, ['button:存草稿']);
    } finally {
      page.cleanup();
    }
  }
});

test('chapter creation rejects unsafe routes, wrong parents and incomplete or non-exact target routes before its hook', async () => {
  const routes = [
    chapterCreationUrl + '?changed=1',
    chapterCreationUrl + '#changed',
    createdChapterUrl + '?changed=1',
    createdChapterUrl + '#changed',
    createdChapterUrl.replace('https://fanqienovel.com', 'https://foreign.example'),
    createdChapterUrl.replace('https://', 'https://fixture-user@'),
    createdChapterUrl.replace('https://', 'https://:fixture-password@'),
    createdChapterUrl.replace('https://fanqienovel.com', 'https://fanqienovel.com:443'),
    createdChapterUrl.replace(workId, chapterId),
    createdChapterUrl.replace(createdId, '0'),
    createdChapterUrl.replace(createdId, 'not-stable'),
    createdChapterUrl + '/',
    'https://fanqienovel.com/main/writer/works',
    'not a valid URL',
  ];
  for (const route of routes) {
    const page = new ChapterCreationFixturePage();
    page.routeDelayMs = 5;
    page.routeAfterCreation = route;
    let hookCalls = 0;
    let intents = 0;
    try {
      const result = await saveChapterDraft(
        page.asPage(),
        { accountId, workId, clientReference: 'chapter-route-fixture', content },
        {
          ...options,
          profile: chapterCreationProfile(),
          timeoutMs: 250,
          beforeSideEffect: async () => {
            intents++;
          },
          onTargetDiscovered: async () => {
            hookCalls++;
          },
        },
      );
      assertUnknownChapterCreation(result, page);
      assert.equal(result.target, undefined);
      assert.equal(hookCalls, 0);
      assert.equal(intents, 1);
      assert.equal(page.routeUpdates, 1);
    } finally {
      page.cleanup();
    }
  }
  const page = new ChapterCreationFixturePage();
  page.routeDelayMs = 0;
  const nonExactProfile = chapterCreationProfile();
  nonExactProfile.editorRoute += '/different';
  let hookCalls = 0;
  try {
    const result = await saveChapterDraft(
      page.asPage(),
      { accountId, workId, clientReference: 'chapter-exact-route-fixture', content },
      {
        ...options,
        profile: nonExactProfile,
        timeoutMs: 100,
        onTargetDiscovered: async () => {
          hookCalls++;
        },
      },
    );
    assertUnknownChapterCreation(result, page);
    assert.equal(hookCalls, 0);
    assert.equal(result.target, undefined);
  } finally {
    page.cleanup();
  }
});

test('chapter durable target hook rejection, route drift and profile changes preserve unknown without fill or another creation', async () => {
  for (const change of [
    'reject',
    'query',
    'hash',
    'username',
    'password',
    'foreign',
    'wrong-parent',
    'unrelated',
    'malformed',
    'identity',
    'profile-route',
    'profile-only',
    'target-binding',
  ] as const) {
    const page = new ChapterCreationFixturePage();
    page.routeDelayMs = 0;
    const chapterProfile = chapterCreationProfile();
    let hookCalls = 0;
    let intents = 0;
    try {
      const result = await saveChapterDraft(
        page.asPage(),
        { accountId, workId, clientReference: 'chapter-hook-fixture', content },
        {
          ...options,
          profile: chapterProfile,
          timeoutMs: 100,
          beforeSideEffect: async () => {
            intents++;
          },
          onTargetDiscovered: async (discovered) => {
            hookCalls++;
            assert.deepEqual(page.fills, []);
            assert.deepEqual(page.clicks, []);
            assert.deepEqual(page.gotoCalls, [chapterCreationUrl]);
            assert.deepEqual(discovered, { kind: 'chapter', workId, chapterId: createdId });
            if (change === 'reject') throw new Error('Durable target persistence failed');
            if (change === 'query') page.currentUrl += '?hook=1';
            if (change === 'hash') page.currentUrl += '#hook';
            if (change === 'username')
              page.currentUrl = page.currentUrl.replace('https://', 'https://fixture-user@');
            if (change === 'password')
              page.currentUrl = page.currentUrl.replace('https://', 'https://:fixture-password@');
            if (change === 'foreign')
              page.currentUrl = page.currentUrl.replace('fanqienovel.com', 'foreign.example');
            if (change === 'wrong-parent')
              page.currentUrl = page.currentUrl.replace(workId, chapterId);
            if (change === 'unrelated')
              page.currentUrl = 'https://fanqienovel.com/main/writer/works';
            if (change === 'malformed') page.currentUrl = 'not a valid URL';
            if (change === 'identity') page.account = '1002';
            if (change === 'profile-route' || change === 'profile-only') {
              chapterProfile.editorRoute += '?hook=1';
              if (change === 'profile-route') page.currentUrl += '?hook=1';
            }
            if (change === 'target-binding') discovered.workId = chapterId;
          },
        },
      );
      assertUnknownChapterCreation(result, page);
      assert.equal(hookCalls, 1, change);
      assert.equal(intents, 1, change);
      assert.deepEqual(result.target, { kind: 'chapter', workId, chapterId: createdId });
    } finally {
      page.cleanup();
    }
  }
});

test('chapter creation request lost after remote allocation stays unknown even when its route arrives later', async () => {
  const page = new ChapterCreationFixturePage();
  page.loseCreationResponse = true;
  page.routeDelayMs = 40;
  let hookCalls = 0;
  let intents = 0;
  try {
    const result = await saveChapterDraft(
      page.asPage(),
      { accountId, workId, clientReference: 'chapter-request-lost-fixture', content },
      {
        ...options,
        profile: chapterCreationProfile(),
        timeoutMs: 200,
        beforeSideEffect: async () => {
          intents++;
        },
        onTargetDiscovered: async () => {
          hookCalls++;
        },
      },
    );
    assertUnknownChapterCreation(result, page);
    assert.equal(result.target, undefined);
    assert.equal(page.creationReturnedUrl, chapterCreationUrl);
    assert.equal(hookCalls, 0);
    assert.equal(intents, 1);
    await page.pause(80);
    assert.equal(page.routeUpdates, 1);
    assert.equal(page.url(), createdChapterUrl);
    assertUnknownChapterCreation(result, page);
    assert.equal(hookCalls, 0);
    assert.equal(intents, 1);
  } finally {
    page.cleanup();
  }
});
