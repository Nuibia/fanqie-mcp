import test from 'node:test';

import {
  NativeAcknowledgementFixturePage,
  acknowledgementShortProfile,
  NativeResponseIdFixturePage,
  AuthoritativeShortFixturePage,
} from './helpers/platform-writes-native-query-fixture-page.js';

import {
  updateDraft,
  createDraft,
  readWriteSnapshot,
  hashDraftContent,
  getWriteCapabilities,
} from '../src/platform/writes.js';

import {
  nativeUpdateInput,
  nativeOptions,
  nativeContent,
} from './helpers/platform-writes-fixture-template-document.js';

import assert from 'node:assert/strict';

import {
  workId,
  accountId,
  createdId,
  target,
  chapterId,
  rejectsCode,
  profile,
} from './helpers/platform-writes-fixture-page.js';

import { nativeShortProfile } from './helpers/platform-writes-native-short-fixture-page.js';

test('native short old, GET, foreign-target, foreign-title and duplicate-parameter responses are not save ACKs', async () => {
  for (const acknowledgement of [
    'old',
    'get',
    'wrong-target',
    'wrong-title',
    'duplicate-param',
  ] as const) {
    const page = new NativeAcknowledgementFixturePage();
    page.acknowledgement = acknowledgement;
    try {
      // This checks ACK identity; allow fake read/click I/O to finish before rejecting the response.
      const result = await updateDraft(
        page.asPage(),
        nativeUpdateInput({ body: 'Possibly persisted fixture body\n' }),
        { ...nativeOptions, profile: acknowledgementShortProfile, timeoutMs: 1000 },
      );
      assert.equal(result.status, 'uncertain');
      assert.equal(result.target?.workId, workId);
      assert.equal(page.reopenedAfterSave, false);
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

test('native short HTTP or code failure cannot acknowledge a save even if the click persisted content', async () => {
  for (const acknowledgement of ['http-failed', 'code-failed'] as const) {
    const page = new NativeAcknowledgementFixturePage();
    page.acknowledgement = acknowledgement;
    try {
      // Test failed HTTP/code ACK after the simulated effect; give setup/read/click I/O its own finite budget.
      const result = await updateDraft(
        page.asPage(),
        nativeUpdateInput({ body: 'HTTP failure fixture body\n' }),
        { ...nativeOptions, profile: acknowledgementShortProfile, timeoutMs: 1000 },
      );
      assert.equal(result.status, 'uncertain');
      assert.equal(page.reopenedAfterSave, false);
      assert.equal(result.target?.workId, workId);
      assert.equal(page.records.get(workId)!.content.body, 'HTTP failure fixture body\n');
      assert.deepEqual(page.clicks, ['button:存草稿']);
    } finally {
      page.cleanup();
    }
  }
});

test('native short missing save ACK stays unknown after one save while preserving the created target', async () => {
  const page = new NativeAcknowledgementFixturePage();
  page.acknowledgement = 'missing';
  let discovered: string | undefined;
  try {
    // Test the missing ACK after one simulated save; allow setup/read/fill its own finite budget.
    const result = await createDraft(
      page.asPage(),
      { accountId, clientReference: 'native-created-missing-ack', content: nativeContent },
      {
        ...nativeOptions,
        profile: acknowledgementShortProfile,
        timeoutMs: 1000,
        onTargetDiscovered: async (value) => {
          discovered = value.workId;
          assert.equal(page.fills.length, 0);
        },
      },
    );
    assert.equal(result.status, 'uncertain');
    assert.equal(result.target?.workId, createdId);
    assert.equal(discovered, createdId);
    assert.equal(page.records.get(createdId)!.content.body, nativeContent.body);
    assert.equal(page.reopenedAfterSave, false);
    assert.equal(page.gotoCalls.filter((url) => url.includes('/publish-short/?')).length, 1);
    assert.deepEqual(page.clicks, ['button:存草稿']);
    assert.equal(
      [...page.nativeEvents.values()].every((entries) => entries.size === 0),
      true,
    );
  } finally {
    page.cleanup();
  }
});

test('native short exact string-zero response sentinel keeps the request target and create binding', async () => {
  const snapshotPage = new NativeResponseIdFixturePage();
  const snapshot = await readWriteSnapshot(snapshotPage.asPage(), accountId, target, {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
  });
  assert.deepEqual(snapshot.target, target);
  assert.equal(snapshot.state, 'draft');
  assert.equal(snapshot.contentHash, hashDraftContent(nativeContent));
  assert.deepEqual(snapshotPage.fills, []);
  assert.deepEqual(snapshotPage.clicks, []);
  const page = new NativeResponseIdFixturePage();
  page.requireBinding = true;
  const sequence: string[] = [];
  try {
    const result = await createDraft(
      page.asPage(),
      { accountId, clientReference: 'native-zero-sentinel-create', content: nativeContent },
      {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 200,
        beforeSideEffect: async (intent) => {
          sequence.push(intent.target ? 'desired' : 'entry');
          assert.equal(page.fills.length, 0);
          if (intent.target) assert.equal(page.targetBound, true);
        },
        onTargetDiscovered: async (discovered) => {
          assert.equal(discovered.workId, createdId);
          assert.equal(page.fills.length, 0);
          page.targetBound = true;
          sequence.push('bound');
        },
      },
    );
    assert.equal(result.status, 'succeeded');
    assert.equal(result.target?.workId, createdId);
    assert.equal(result.contentHash, hashDraftContent(nativeContent));
    assert.deepEqual(sequence, ['entry', 'bound', 'desired']);
    assert.equal(page.gotoCalls.filter((url) => url.includes('/publish-short/?')).length, 1);
    assert.deepEqual(page.clicks, ['button:存草稿']);
    assert.equal(
      [...page.nativeEvents.values()].every((entries) => entries.size === 0),
      true,
    );
  } finally {
    page.cleanup();
  }
});

test('native short response sentinel never accepts wrong IDs, other types or failed native request gates', async () => {
  for (const responseItemId of [chapterId, '', 0, null, false, {}, [], '00', ' 0']) {
    const page = new NativeResponseIdFixturePage();
    page.responseItemId = responseItemId;
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
  for (const failure of [
    'wrong-target',
    'duplicate-parent',
    'http-failed',
    'code-failed',
  ] as const) {
    const page = new NativeResponseIdFixturePage();
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
  }
});

test('native short authoritative server paragraphs preserve complete LF and reject unsupported HTML or fields', async () => {
  const capabilities = getWriteCapabilities(nativeShortProfile);
  assert.equal(capabilities.create_draft.available, true);
  assert.equal(capabilities.update_draft.available, true);
  assert.equal(capabilities.update_work_metadata.available, false);
  assert.equal(
    capabilities.update_work_metadata.reason,
    'The native short source verifies title and body only; editable metadata is unavailable.',
  );
  const examples = [
    { html: '', titles: [], text: '', title: '' },
    {
      html: '<p></p><p>A&amp;B<br>Next</p><p></p><p>  Last &lt;text&gt;  </p><p></p>',
      titles: ['Server title'],
      text: '\nA&B\nNext\n\n  Last <text>  \n',
      title: 'Server title',
    },
    {
      html: '<p>Literal &quot;quotes&quot; &#39;apostrophes&#39;</p>',
      titles: ['Primary', 'Alternate'],
      text: 'Literal "quotes" \'apostrophes\'',
      title: 'Primary',
    },
  ];
  for (const example of examples) {
    const page = new AuthoritativeShortFixturePage();
    page.serverHTMLOverride = example.html;
    page.serverTitlesOverride = example.titles;
    const result = await readWriteSnapshot(page.asPage(), accountId, target, {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    });
    assert.equal(result.body === example.text, true);
    assert.equal(result.title === example.title, true);
    assert.equal(
      result.contentHash ===
        hashDraftContent({ title: example.title, body: example.text, metadata: {} }),
      true,
    );
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
  for (const html of [
    null,
    [],
    '<div>text</div>',
    '<p class="a">text</p>',
    '<p>text',
    'outside<p>x</p>',
    '<p><img src="fixture"></p>',
    '<p><script>bad</script></p>',
    '<p><b>x</b></p>',
    '<p><!--comment--></p>',
    '<p>x</p> ',
    '<p>\0</p>',
    '<p>' + '字'.repeat(1_000_001) + '</p>',
  ]) {
    const page = new AuthoritativeShortFixturePage();
    page.serverHTMLOverride = html;
    await assert.rejects(
      readWriteSnapshot(page.asPage(), accountId, target, {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
      }),
      rejectsCode('capability_unavailable'),
    );
  }
  for (const titles of [null, '', [1], ['ok', null]]) {
    const page = new AuthoritativeShortFixturePage();
    page.serverTitlesOverride = titles;
    await assert.rejects(
      readWriteSnapshot(page.asPage(), accountId, target, {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
      }),
      rejectsCode('capability_unavailable'),
    );
  }
  const unsupported = new AuthoritativeShortFixturePage();
  await assert.rejects(
    readWriteSnapshot(unsupported.asPage(), accountId, target, {
      ...nativeOptions,
      profile: { ...nativeShortProfile, fields: profile.fields },
      timeoutMs: 100,
    }),
    rejectsCode('capability_unavailable'),
  );
  assert.equal(unsupported.gotoCalls.length, 0);
});
