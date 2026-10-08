import test from 'node:test';

import {
  AuthoritativeShortFixturePage,
  NativeAcknowledgementFixturePage,
  acknowledgementShortProfile,
} from './helpers/platform-writes-native-query-fixture-page.js';

import { readWriteSnapshot, hashDraftContent, updateDraft } from '../src/platform/writes.js';

import { accountId, target, workId } from './helpers/platform-writes-fixture-page.js';

import {
  nativeOptions,
  nativeContent,
  nativeUpdateInput,
} from './helpers/platform-writes-fixture-template-document.js';

import {
  nativeShortProfile,
  NativeShortFixturePage,
} from './helpers/platform-writes-native-short-fixture-page.js';

import assert from 'node:assert/strict';

test('native short readonly snapshot bypasses cached body while exact discard follows desired intent only for a write', async () => {
  const page = new AuthoritativeShortFixturePage();
  page.cacheDialog = 'exact';
  page.cachedBody = 'Old local cache';
  page.readyDelay = 1000;
  const snapshot = await readWriteSnapshot(page.asPage(), accountId, target, {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
  });
  assert.equal(snapshot.contentHash === hashDraftContent(nativeContent), true);
  assert.equal(page.discardClicks, 0);
  assert.deepEqual(page.fills, []);
  assert.deepEqual(page.clicks, []);
  page.readyDelay = 0;
  const result = await updateDraft(page.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
    beforeSideEffect: async (intent) => {
      assert.equal(intent.desiredContentHash, hashDraftContent(nativeContent));
      assert.equal(page.discardClicks, 0);
      page.desiredRecorded = true;
    },
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(page.discardClicks, 1);
  assert.equal(page.disposedHandles, 2);
  assert.deepEqual(page.clicks, ['button:存草稿']);
  for (const mode of ['other', 'duplicate', 'detached'] as const) {
    const rejected = new AuthoritativeShortFixturePage();
    rejected.cacheDialog = mode === 'detached' ? 'exact' : mode;
    rejected.discardDetached = mode === 'detached';
    const answer = await updateDraft(rejected.asPage(), nativeUpdateInput(), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
      beforeSideEffect: async () => {
        rejected.desiredRecorded = true;
      },
    });
    assert.equal(answer.status, 'uncertain');
    assert.equal(rejected.discardClicks, 0);
    assert.deepEqual(rejected.fills, []);
    assert.deepEqual(rejected.clicks, []);
  }
});

test('native short bound setHTML retains every source line and rejects truncation, drift and wire changes before save', async () => {
  const source =
    '\n<A & B>\n\nSecond "line"\n' +
    Array.from({ length: 48 }, (_, i) => 'Line ' + i).join('\n') +
    '\n';
  const page = new NativeShortFixturePage();
  const result = await updateDraft(page.asPage(), nativeUpdateInput({ body: source }), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 150,
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.contentHash === hashDraftContent({ ...nativeContent, body: source }), true);
  assert.equal(page.records.get(workId)!.content.body === source, true);
  assert.deepEqual(page.fills, ['#title', '#body']);
  for (const binding of [
    'wrong-root',
    'missing-set',
    'missing-get',
    'truncate',
    'route-change',
  ] as const) {
    const rejected = new NativeShortFixturePage();
    rejected.bodyBinding = binding;
    const answer = await updateDraft(rejected.asPage(), nativeUpdateInput({ body: source }), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    });
    assert.equal(answer.status, 'uncertain');
    assert.deepEqual(rejected.clicks, []);
    assert.equal(answer.target?.workId, workId);
  }
  const noTrailingLF = new NativeShortFixturePage(),
    exactSource = 'No implicit LF';
  const rejected = await updateDraft(
    noTrailingLF.asPage(),
    nativeUpdateInput({ body: exactSource }),
    { ...nativeOptions, profile: nativeShortProfile, timeoutMs: 100 },
  );
  assert.equal(rejected.status, 'uncertain');
  assert.deepEqual(noTrailingLF.clicks, []);
  assert.equal(noTrailingLF.data.content.body === exactSource, true);
});

test('native short save ACK must bind the complete wire body and reopened server content must match the desired version', async () => {
  const wrong = new NativeAcknowledgementFixturePage();
  wrong.acknowledgement = 'wrong-content';
  try {
    const result = await updateDraft(wrong.asPage(), nativeUpdateInput(), {
      ...nativeOptions,
      profile: acknowledgementShortProfile,
      timeoutMs: 50,
    });
    assert.equal(result.status, 'uncertain');
    assert.equal(wrong.reopenedAfterSave, false);
    assert.deepEqual(wrong.clicks, ['button:存草稿']);
  } finally {
    wrong.cleanup();
  }
  const truncated = new NativeShortFixturePage();
  truncated.onReopen = () => {
    if (truncated.clicks.length > 0)
      truncated.records.get(workId)!.content.body = nativeContent.body.split('\n')[0]! + '\n';
  };
  const result = await updateDraft(truncated.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.contentHash, undefined);
  assert.deepEqual(truncated.clicks, ['button:存草稿']);
});

test('native short explicit paragraph preservation survives platform empty-paragraph merging defaults', async () => {
  for (const source of ['\n\nFirst\n', 'First\n\n\nLast\n', 'First\n\n\n']) {
    const page = new NativeShortFixturePage();
    const result = await updateDraft(page.asPage(), nativeUpdateInput({ body: source }), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 150,
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(page.nativeSetMergeEmpty, false);
    assert.equal(page.records.get(workId)!.content.body === source, true);
    assert.equal(result.contentHash === hashDraftContent({ ...nativeContent, body: source }), true);
    assert.deepEqual(page.clicks, ['button:存草稿']);
  }
});

test('native short cache discard binds the exact physically visible prompt despite an unrelated accessible tour', async () => {
  const page = new AuthoritativeShortFixturePage();
  page.cacheDialog = 'tour-cache';
  page.cachedBody = 'Unrelated local cache';
  page.readyDelay = 0;
  const answer = await updateDraft(page.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 150,
    beforeSideEffect: async () => {
      page.desiredRecorded = true;
    },
  });
  assert.equal(answer.status, 'succeeded');
  assert.equal(page.discardClicks, 1);
  assert.equal(page.tourClicks, 0);
  assert.equal(page.disposedHandles, 2);
  assert.equal(page.records.get(workId)!.content.body === nativeContent.body, true);
  const tourOnly = new AuthoritativeShortFixturePage();
  tourOnly.cacheDialog = 'tour-only';
  tourOnly.readyDelay = 0;
  const normal = await updateDraft(tourOnly.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 150,
  });
  assert.equal(normal.status, 'succeeded');
  assert.equal(tourOnly.discardClicks, 0);
  assert.equal(tourOnly.tourClicks, 0);
  assert.equal(tourOnly.disposedHandles, 0);
  for (const invalid of ['caption-hidden', 'button-hidden', 'wrong-nearest-dialog'] as const) {
    const rejected = new AuthoritativeShortFixturePage();
    rejected.cacheDialog = 'tour-cache';
    rejected.readyDelay = 0;
    rejected.cacheCaptionVisible = invalid !== 'caption-hidden';
    rejected.cacheButtonVisible = invalid !== 'button-hidden';
    rejected.captionWrongDialog = invalid === 'wrong-nearest-dialog';
    const failed = await updateDraft(rejected.asPage(), nativeUpdateInput(), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
      beforeSideEffect: async () => {
        rejected.desiredRecorded = true;
      },
    });
    assert.equal(failed.status, 'uncertain');
    assert.equal(rejected.discardClicks, 0);
    assert.equal(rejected.tourClicks, 0);
    assert.deepEqual(rejected.fills, []);
    assert.deepEqual(rejected.clicks, []);
  }
});
