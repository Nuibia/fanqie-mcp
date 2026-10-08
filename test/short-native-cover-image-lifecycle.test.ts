import test from 'node:test';

import {
  fixture,
  forbiddenBrowser,
  expectCode,
  CODE,
  deferred,
  fakeBrowser,
  sha,
  type FakeOptions,
  framedJpeg,
} from './helpers/short-native-cover-image-fixtures.js';

import assert from 'node:assert/strict';

import { prepareNativeShortCoverImage } from '../src/platform/short-native-cover-image.js';

import { type BrowserContext, type Page } from 'playwright';

import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';

import { NATIVE_SHORT_COVER_LIMITS } from '../src/platform/short-native-cover.js';

test('pre-aborted request starts no browser operation', async () => {
  const f = fixture(),
    forbidden = forbiddenBrowser(),
    controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      prepareNativeShortCoverImage(forbidden.browser, f.directory, f.reference, {
        signal: controller.signal,
      }),
      expectCode(CODE.aborted),
    );
    assert.equal(forbidden.calls(), 0);
  } finally {
    f.close();
  }
});

test(
  'abort owns a late context and waits until its real close completes',
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      controller = new AbortController(),
      entered = deferred<void>(),
      contextGate = deferred<BrowserContext>(),
      closeGate = deferred<void>(),
      closeStarted = deferred<void>();
    const fake = fakeBrowser({
      newContext: async () => {
        entered.resolve();
        return contextGate.promise;
      },
      contextClose: async () => {
        closeStarted.resolve();
        await closeGate.promise;
      },
    });
    let settled = false;
    const preparing = prepareNativeShortCoverImage(fake.browser, f.directory, f.reference, {
      signal: controller.signal,
    }).finally(() => {
      settled = true;
    });
    const rejected = assert.rejects(preparing, expectCode(CODE.aborted));
    try {
      await entered.promise;
      controller.abort();
      await nextTurn();
      assert.equal(settled, false);
      assert(!fake.events.includes('newPage'));
      contextGate.resolve(fake.context);
      await closeStarted.promise;
      assert.equal(settled, false);
      closeGate.resolve();
      await rejected;
      assert(fake.events.includes('context-close-done'));
      assert(!fake.events.includes('browser-close-forbidden'));
    } finally {
      contextGate.resolve(fake.context);
      closeGate.resolve();
      await rejected;
      f.close();
    }
  },
);

test(
  'abort closes existing context while late page creation is pending, then waits for both closes',
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      controller = new AbortController(),
      entered = deferred<void>(),
      pageGate = deferred<Page>();
    const pageCloseGate = deferred<void>(),
      contextCloseGate = deferred<void>(),
      pageCloseStarted = deferred<void>(),
      contextCloseStarted = deferred<void>();
    const fake = fakeBrowser({
      newPage: async () => {
        entered.resolve();
        return pageGate.promise;
      },
      pageClose: async () => {
        pageCloseStarted.resolve();
        await pageCloseGate.promise;
      },
      contextClose: async () => {
        contextCloseStarted.resolve();
        await contextCloseGate.promise;
      },
    });
    let settled = false;
    const preparing = prepareNativeShortCoverImage(fake.browser, f.directory, f.reference, {
      signal: controller.signal,
    }).finally(() => {
      settled = true;
    });
    const rejected = assert.rejects(preparing, expectCode(CODE.aborted));
    try {
      await entered.promise;
      controller.abort();
      await contextCloseStarted.promise;
      assert.equal(settled, false);
      pageGate.resolve(fake.page);
      await pageCloseStarted.promise;
      pageCloseGate.resolve();
      await nextTurn();
      assert.equal(settled, false);
      contextCloseGate.resolve();
      await rejected;
      assert(fake.events.includes('page-close-done'));
      assert(fake.events.includes('context-close-done'));
    } finally {
      pageGate.resolve(fake.page);
      pageCloseGate.resolve();
      contextCloseGate.resolve();
      await rejected;
      f.close();
    }
  },
);

test(
  'timeout drains late rejected creation without leaking a context or raw message',
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      entered = deferred<void>(),
      gate = deferred<BrowserContext>();
    const fake = fakeBrowser({
      newContext: async () => {
        entered.resolve();
        return gate.promise;
      },
    });
    let settled = false;
    const preparing = prepareNativeShortCoverImage(fake.browser, f.directory, f.reference, {
      timeoutMs: 500,
    }).finally(() => {
      settled = true;
    });
    const rejected = assert.rejects(preparing, expectCode(CODE.timeout));
    try {
      await entered.promise;
      await delay(550);
      assert.equal(settled, false);
      gate.reject(new Error('secret-local-path'));
      await rejected;
      assert(!fake.events.includes('context-close-start'));
      assert(!fake.events.includes('newPage'));
    } finally {
      gate.reject(new Error('secret-local-path'));
      await rejected;
      f.close();
    }
  },
);

test(
  'abort during decode closes resources before draining the interrupted operation',
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      controller = new AbortController(),
      entered = deferred<void>(),
      evaluation = deferred<unknown>();
    const fake = fakeBrowser({
      evaluate: async () => {
        entered.resolve();
        return evaluation.promise;
      },
      pageClose: async () => {
        evaluation.reject(new Error('secret-local-path'));
      },
    });
    const preparing = prepareNativeShortCoverImage(fake.browser, f.directory, f.reference, {
      signal: controller.signal,
    });
    const rejected = assert.rejects(preparing, expectCode(CODE.aborted));
    try {
      await entered.promise;
      controller.abort();
      await rejected;
      assert(fake.events.includes('page-close-done'));
      assert(fake.events.includes('context-close-done'));
    } finally {
      evaluation.reject(new Error('secret-local-path'));
      await rejected;
      f.close();
    }
  },
);

test(
  'a successful decode still cannot resolve before actual page and context cleanup',
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      pageStarted = deferred<void>(),
      contextStarted = deferred<void>(),
      pageGate = deferred<void>(),
      contextGate = deferred<void>();
    const fake = fakeBrowser({
      pageClose: async () => {
        pageStarted.resolve();
        await pageGate.promise;
      },
      contextClose: async () => {
        contextStarted.resolve();
        await contextGate.promise;
      },
    });
    let settled = false;
    const preparing = prepareNativeShortCoverImage(fake.browser, f.directory, f.reference).finally(
      () => {
        settled = true;
      },
    );
    try {
      await Promise.all([pageStarted.promise, contextStarted.promise]);
      assert.equal(settled, false);
      pageGate.resolve();
      await nextTurn();
      assert.equal(settled, false);
      contextGate.resolve();
      const result = await preparing;
      assert.equal(result.asset.preparedSha256, sha(result.bytes));
      assert.equal(settled, true);
    } finally {
      pageGate.resolve();
      contextGate.resolve();
      await preparing;
      f.close();
    }
  },
);

test('finite lifecycle failures are sanitized and every obtained resource is closed', async (t) => {
  const throws = async () => {
    throw new Error('secret-local-path https://example.invalid');
  };
  const failures: Array<{
    name: string;
    options: FakeOptions;
    code: string;
    page: boolean;
    context: boolean;
  }> = [
    {
      name: 'context creation',
      options: { newContext: throws },
      code: CODE.prepare,
      page: false,
      context: false,
    },
    {
      name: 'route installation',
      options: { route: throws },
      code: CODE.prepare,
      page: false,
      context: true,
    },
    {
      name: 'cookie inspection',
      options: { cookies: throws },
      code: CODE.prepare,
      page: false,
      context: true,
    },
    {
      name: 'unexpected cookie',
      options: { cookies: async () => [{}] },
      code: CODE.prepare,
      page: false,
      context: true,
    },
    {
      name: 'page creation',
      options: { newPage: throws },
      code: CODE.prepare,
      page: false,
      context: true,
    },
    {
      name: 'offline document',
      options: { setContent: throws },
      code: CODE.prepare,
      page: true,
      context: true,
    },
    {
      name: 'decoder',
      options: { evaluate: throws },
      code: CODE.prepare,
      page: true,
      context: true,
    },
    {
      name: 'non-base64 encoder output',
      options: { evaluate: async () => 'secret-local-path' },
      code: CODE.image,
      page: true,
      context: true,
    },
    {
      name: 'oversized encoder output',
      options: {
        evaluate: async () =>
          'A'.repeat(Math.ceil(NATIVE_SHORT_COVER_LIMITS.preparedBytes / 3) * 4 + 4),
      },
      code: CODE.image,
      page: true,
      context: true,
    },
    {
      name: 'wrong prepared dimensions',
      options: { evaluate: async () => framedJpeg(800, 600).toString('base64') },
      code: CODE.image,
      page: true,
      context: true,
    },
    {
      name: 'page cleanup',
      options: { pageClose: throws },
      code: CODE.cleanup,
      page: true,
      context: true,
    },
    {
      name: 'context cleanup',
      options: { contextClose: throws },
      code: CODE.cleanup,
      page: true,
      context: true,
    },
  ];
  for (const value of failures)
    await t.test(value.name, async () => {
      const f = fixture(),
        fake = fakeBrowser(value.options);
      try {
        await assert.rejects(
          prepareNativeShortCoverImage(fake.browser, f.directory, f.reference),
          expectCode(value.code),
        );
        assert.equal(fake.events.includes('page-close-start'), value.page);
        assert.equal(fake.events.includes('context-close-start'), value.context);
        assert(!fake.events.includes('browser-close-forbidden'));
      } finally {
        f.close();
      }
    });
});
