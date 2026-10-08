import test from 'node:test';

import {
  NativeShortFixturePage,
  nativeShortProfile,
  nativeUpdate,
  ownApiNativeShortProfile,
  NativeDocumentFixturePage,
} from './helpers/platform-writes-native-short-fixture-page.js';

import assert from 'node:assert/strict';

import {
  updateDraft,
  prepareSubmission,
  createDraft,
  readWriteSnapshot,
  PlatformWriteError,
  hashDraftContent,
} from '../src/platform/writes.js';

import {
  nativeUpdateInput,
  nativeOptions,
  legacyNativeReadInput,
  nativeContent,
} from './helpers/platform-writes-fixture-template-document.js';

import {
  rejectsCode,
  accountId,
  target,
  fixedNow,
  workId,
} from './helpers/platform-writes-fixture-page.js';

import {
  documentShortProfile,
  NativeQueryFixturePage,
  NativeAcknowledgementFixturePage,
  acknowledgementShortProfile,
} from './helpers/platform-writes-native-query-fixture-page.js';

test('native short rejects wrong target, duplicate parent, failed code and unobserved response before any fill', async () => {
  for (const failure of [
    'wrong-target',
    'duplicate-parent',
    'code-failed',
    'http-failed',
    'absent',
  ] as const) {
    const page = new NativeShortFixturePage();
    page.nativeResponse = failure;
    await assert.rejects(
      updateDraft(page.asPage(), nativeUpdateInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 35,
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
    assert.equal(
      [...page.nativeEvents.values()].every((entries) => entries.size === 0),
      true,
    );
  }
  for (const value of [null, '0', 2, 0.5]) {
    const page = new NativeShortFixturePage();
    page.statusOverride = value;
    await assert.rejects(
      prepareSubmission(page.asPage(), legacyNativeReadInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 35,
      }),
      rejectsCode('capability_unavailable'),
    );
  }
});

test('native short readiness and ID deadline do not fill or save on timeout, ambiguity or route drift', async () => {
  const noId = new NativeShortFixturePage();
  noId.noId = true;
  const unknown = await createDraft(
    noId.asPage(),
    { accountId, clientReference: 'native-no-id', content: nativeContent },
    { ...nativeOptions, profile: nativeShortProfile, timeoutMs: 35 },
  );
  assert.equal(unknown.status, 'uncertain');
  assert.equal(unknown.target, undefined);
  assert.deepEqual(noId.fills, []);
  assert.deepEqual(noId.clicks, []);
  assert.equal(noId.gotoCalls.length, 1);
  const neverReady = new NativeShortFixturePage();
  neverReady.readyDelay = 1000;
  assert.equal((await nativeUpdate(neverReady)).status, 'uncertain');
  assert.deepEqual(neverReady.fills, []);
  assert.deepEqual(neverReady.clicks, []);
  const duplicate = new NativeShortFixturePage();
  duplicate.duplicate.add('#title');
  await assert.rejects(nativeUpdate(duplicate), rejectsCode('capability_unavailable'));
  const drift = new NativeShortFixturePage();
  drift.routeChangedDuringReady = true;
  assert.equal((await nativeUpdate(drift)).status, 'uncertain');
  assert.deepEqual(drift.fills, []);
  assert.deepEqual(drift.clicks, []);
});

test('native short API identity accepts a fresh typed namespace without a display-name selector', async () => {
  for (const identityType of ['account', 'author'] as const) {
    const page = new NativeShortFixturePage();
    page.account = 'Fixture display name';
    let domIdentityReads = 0;
    const originalLocator = page.locator.bind(page);
    page.locator = (css) => {
      if (css === '#account') domIdentityReads++;
      return originalLocator(css);
    };
    let ownChecks = 0;
    const snapshot = await readWriteSnapshot(page.asPage(), accountId, target, {
      ...nativeOptions,
      profile: ownApiNativeShortProfile,
      timeoutMs: 100,
      identityType,
      verifyAccount: async () => {
        ownChecks++;
        return {
          status: 'authenticated',
          identity:
            identityType === 'account'
              ? { accountId, authorId: '123456' }
              : { accountId: '123456', authorId: accountId },
          sourceUrl: 'https://fanqienovel.com/api/author/user/info/v0/',
          checkedAt: fixedNow().toISOString(),
        };
      },
    });
    assert.equal(snapshot.state, 'draft');
    assert.equal(domIdentityReads, 0);
    assert.equal(ownChecks >= 2, true);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
});

test('native short API identity rejects a matching ID in the wrong namespace or absent callback before creation', async () => {
  for (const identityType of ['account', 'author'] as const) {
    const page = new NativeShortFixturePage();
    const result: string = await createDraft(
      page.asPage(),
      {
        accountId,
        clientReference: 'native-wrong-namespace-' + identityType,
        content: nativeContent,
      },
      {
        ...nativeOptions,
        profile: ownApiNativeShortProfile,
        timeoutMs: 100,
        identityType,
        verifyAccount: async () => ({
          status: 'authenticated',
          identity:
            identityType === 'account'
              ? { accountId: null, authorId: accountId }
              : { accountId, authorId: null },
          sourceUrl: 'https://fanqienovel.com/api/author/user/info/v0/',
          checkedAt: fixedNow().toISOString(),
        }),
      },
    ).then(
      () => 'unexpected-success',
      (error) => (error instanceof PlatformWriteError ? error.code : 'unexpected-error'),
    );
    assert.equal(result, 'requires_login');
    assert.deepEqual(page.gotoCalls, []);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
  const missing = new NativeShortFixturePage();
  await assert.rejects(
    createDraft(
      missing.asPage(),
      { accountId, clientReference: 'native-no-own-callback', content: nativeContent },
      {
        ...nativeOptions,
        profile: ownApiNativeShortProfile,
        timeoutMs: 100,
        verifyAccount: undefined,
      },
    ),
    rejectsCode('capability_unavailable'),
  );
  assert.deepEqual(missing.gotoCalls, []);
  assert.deepEqual(missing.fills, []);
  assert.deepEqual(missing.clicks, []);
  const defaultAccount = new NativeShortFixturePage();
  await assert.rejects(
    readWriteSnapshot(defaultAccount.asPage(), accountId, target, {
      ...nativeOptions,
      profile: ownApiNativeShortProfile,
      timeoutMs: 100,
      verifyAccount: async () => ({
        status: 'authenticated',
        identity: { accountId: null, authorId: accountId },
        sourceUrl: 'https://fanqienovel.com/api/author/user/info/v0/',
        checkedAt: fixedNow().toISOString(),
      }),
    }),
    rejectsCode('requires_login'),
  );
});

test('native short document body excludes DOM prompts and preserves actual empty paragraphs', async () => {
  for (const documentText of ['', 'First paragraph\n\nThird paragraph', '\nFirst\n\nThird\n']) {
    const page = new NativeDocumentFixturePage();
    page.documentText = documentText;
    page.documentSize = documentText ? documentText.length + 8 : 2;
    page.records.get(workId)!.content.body = 'Platform prompt '.repeat(8);
    const snapshot = await readWriteSnapshot(page.asPage(), accountId, target, {
      ...nativeOptions,
      profile: documentShortProfile,
      timeoutMs: 100,
    });
    assert.equal(snapshot.body, documentText);
    assert.equal(snapshot.contentHash, hashDraftContent({ ...nativeContent, body: documentText }));
    assert.deepEqual(page.textArguments, []);
    assert.equal(page.domBodyReads, 0);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
});

test('native short document body rejects missing API, wrong root, doc drift and extent limits before writes', async () => {
  const variants: Array<(page: NativeDocumentFixturePage) => void> = [
    (page) => {
      page.documentApiPresent = false;
    },
    (page) => {
      page.boundRoot = false;
    },
    (page) => {
      page.changeDocumentDuringRead = true;
    },
    (page) => {
      page.documentSize = 3_000_001;
    },
    (page) => {
      page.documentSize = NaN;
    },
    (page) => {
      page.documentText = ['not a complete document string'];
    },
    (page) => {
      page.documentText = '字'.repeat(1_000_001);
      page.documentSize = 1_000_003;
    },
  ];
  for (const [index, configure] of variants.entries()) {
    const page = new NativeDocumentFixturePage();
    configure(page);
    const execute: () => ReturnType<typeof updateDraft> = () =>
      updateDraft(
        page.asPage(),
        {
          ...nativeUpdateInput(),
          expectedContentHash: hashDraftContent({ ...nativeContent, body: page.serverBody() }),
        },
        { ...nativeOptions, profile: documentShortProfile, timeoutMs: 100 },
      );
    if (index === variants.length - 1)
      await assert.rejects(execute(), rejectsCode('capability_unavailable'));
    else assert.equal((await execute()).status, 'uncertain');
    assert.equal(page.domBodyReads, 0);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
});

test('native short GET accepts only observed unique signature keys without changing their URL', async () => {
  const signed = new NativeQueryFixturePage();
  const snapshot = await readWriteSnapshot(signed.asPage(), accountId, target, {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
  });
  assert.equal(snapshot.state, 'draft');
  assert.equal(snapshot.contentHash, hashDraftContent(nativeContent));
  assert.deepEqual(signed.fills, []);
  for (const suffix of [
    '&unknown_key=fixture',
    '&msToken=x&msToken=y',
    '&item_id=' + workId,
    '&app_name=x&app_name=y',
  ]) {
    const rejected = new NativeQueryFixturePage();
    rejected.querySuffix = suffix;
    await assert.rejects(
      updateDraft(rejected.asPage(), nativeUpdateInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 35,
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.deepEqual(rejected.fills, []);
    assert.deepEqual(rejected.clicks, []);
  }
});

test('native short save ACK from form or JSON parameters completes before reopening', async () => {
  for (const acknowledgement of ['valid', 'json'] as const) {
    const page = new NativeAcknowledgementFixturePage();
    page.acknowledgement = acknowledgement;
    try {
      const result = await updateDraft(
        page.asPage(),
        nativeUpdateInput({ body: 'New acknowledged fixture body\n' }),
        { ...nativeOptions, profile: acknowledgementShortProfile, timeoutMs: 100 },
      );
      assert.equal(result.status, 'succeeded');
      assert.equal(
        result.contentHash,
        hashDraftContent({ ...nativeContent, body: 'New acknowledged fixture body\n' }),
      );
      assert.equal(page.reopenedAfterSave, true);
      assert.deepEqual(page.clicks, ['button:存草稿']);
      assert.equal(
        [...page.nativeEvents.values()].every((entries) => entries.size === 0),
        true,
      );
    } finally {
      page.cleanup();
    }
  }
});
