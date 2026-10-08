import test from 'node:test';

import {
  FixturePage,
  accountId,
  target,
  content,
  options,
  createdId,
  rejectsCode,
  profile,
  chapterId,
  workId,
} from './helpers/platform-writes-fixture-page.js';

import {
  hashDraftContent,
  prepareSubmission,
  submitShortStory,
  reconcileWrite,
  saveChapterDraft,
  type WriteTarget,
  publishChapter,
  type DraftContent,
} from '../src/platform/writes.js';

import assert from 'node:assert/strict';

import {
  ChapterCreationFixturePage,
  chapterCreationProfile,
  chapterCreationUrl,
  createdChapterUrl,
  assertUnknownChapterCreation,
} from './helpers/platform-writes-chapter-creation-profile.js';

test('changed terms, expired preparation, changed target, and unaccepted terms prevent submission', async () => {
  for (const condition of ['terms', 'expired', 'target', 'acceptance']) {
    const page = new FixturePage();
    const input = {
      accountId,
      target,
      expectedContentHash: hashDraftContent(content),
      expectedState: 'draft' as const,
    };
    const prepared = await prepareSubmission(page.asPage(), input, options);
    if (condition === 'terms') page.terms += ' Updated';
    if (condition === 'target') prepared.target = { ...target, workId: createdId };
    const currentOptions =
      condition === 'expired'
        ? { ...options, now: () => new Date('2026-10-02T10:02:00Z') }
        : options;
    await assert.rejects(
      submitShortStory(
        page.asPage(),
        { ...input, prepared, acceptPublicationTerms: condition !== 'acceptance' },
        currentOptions,
      ),
      rejectsCode(condition === 'acceptance' ? 'invalid_input' : 'version_conflict'),
    );
    assert.deepEqual(page.clicks, []);
    assert.equal(page.agreement, false);
  }
});

test('lost submit response remains uncertain, then reconciles without another submission', async () => {
  const page = new FixturePage();
  const input = {
    accountId,
    target,
    expectedContentHash: hashDraftContent(content),
    expectedState: 'draft' as const,
  };
  const prepared = await prepareSubmission(page.asPage(), input, options);
  page.failAfterSubmit = true;
  const result = await submitShortStory(
    page.asPage(),
    { ...input, prepared, acceptPublicationTerms: true },
    options,
  );
  assert.equal(result.status, 'uncertain');
  const reconciled = await reconcileWrite(
    page.asPage(),
    { ...input, capability: 'submit_short_story', expectedStates: ['reviewing', 'published'] },
    options,
  );
  assert.equal(reconciled.status, 'succeeded');
  assert.equal(reconciled.platformState, 'reviewing');
  assert.equal(page.clicks.length, 2);
});

test('changed confirmation prompt after first step stops further clicks as uncertain', async () => {
  const page = new FixturePage();
  const input = {
    accountId,
    target,
    expectedContentHash: hashDraftContent(content),
    expectedState: 'draft' as const,
  };
  const changedProfile = structuredClone(profile);
  changedProfile.submission!.steps[1]!.guard.equals = 'Different expected confirmation';
  const currentOptions = { ...options, profile: changedProfile };
  const prepared = await prepareSubmission(page.asPage(), input, currentOptions);
  const result = await submitShortStory(
    page.asPage(),
    { ...input, prepared, acceptPublicationTerms: true },
    currentOptions,
  );
  assert.equal(result.status, 'uncertain');
  assert.deepEqual(page.clicks, ['button:下一步']);
  assert.equal(page.agreement, false);
});

test('verified chapter fixture supports stable chapter save and separately prepared publication', async () => {
  const page = new FixturePage();
  page.records.set(chapterId, structuredClone(page.records.get(workId)!));
  const chapterProfile = structuredClone(profile);
  chapterProfile.kind = 'chapter';
  chapterProfile.editorRoute = '/main/writer/fixture-book/{workId}/fixture-chapter/{chapterId}';
  chapterProfile.targetPattern =
    '^/main/writer/fixture-book/(?<workId>\\d+)/fixture-chapter/(?<chapterId>\\d+)$';
  delete chapterProfile.newRoute;
  const currentOptions = { ...options, profile: chapterProfile };
  const desired = {
    ...content,
    title: 'Chapter fixture',
    body: 'Chapter paragraph one\nChapter paragraph two',
  };
  const result = await saveChapterDraft(
    page.asPage(),
    {
      accountId,
      workId,
      chapterId,
      expectedContentHash: hashDraftContent(content),
      expectedState: 'draft',
      content: desired,
    },
    currentOptions,
  );
  assert.equal(result.status, 'succeeded');
  const chapterTarget: WriteTarget = { kind: 'chapter', workId, chapterId };
  assert.deepEqual(result.target, chapterTarget);
  const input = {
    accountId,
    target: chapterTarget,
    expectedContentHash: hashDraftContent(desired),
    expectedState: 'draft' as const,
  };
  const prepared = await prepareSubmission(page.asPage(), input, currentOptions);
  const published = await publishChapter(
    page.asPage(),
    { ...input, prepared, acceptPublicationTerms: true },
    currentOptions,
  );
  assert.equal(published.platformState, 'reviewing');
});

test('new chapter draft records its stable ID under the requested work before filling', async () => {
  const page = new FixturePage();
  const chapterProfile = structuredClone(profile);
  chapterProfile.kind = 'chapter';
  chapterProfile.editorRoute = '/main/writer/fixture-book/{workId}/fixture-chapter/{chapterId}';
  chapterProfile.newRoute = '/main/writer/fixture-book/{workId}/fixture-new-chapter';
  chapterProfile.targetPattern =
    '^/main/writer/fixture-book/(?<workId>\\d+)/fixture-chapter/(?<chapterId>\\d+)$';
  let recorded: WriteTarget | undefined;
  const result = await saveChapterDraft(
    page.asPage(),
    { accountId, workId, clientReference: 'new-chapter-fixture', content },
    {
      ...options,
      profile: chapterProfile,
      onTargetDiscovered: async (value) => {
        assert.equal(page.fills.length, 0);
        recorded = value;
      },
    },
  );
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(recorded, { kind: 'chapter', workId, chapterId: createdId });
  assert.deepEqual(result.target, recorded);
});

test('delayed chapter ID waits after one creation goto, binds before filling, and verifies full LF and retained metadata', async () => {
  const page = new ChapterCreationFixturePage();
  const requested: DraftContent = {
    title: 'Delayed fixture chapter',
    body: '\nFirst\r\n\r\nLast\r\n',
    metadata: { description: 'Updated description' },
  };
  const expected = { ...requested, metadata: { ...content.metadata, ...requested.metadata } };
  const events: string[] = [];
  let recorded: WriteTarget | undefined;
  try {
    const result = await saveChapterDraft(
      page.asPage(),
      { accountId, workId, clientReference: 'delayed-chapter-fixture', content: requested },
      {
        ...options,
        profile: chapterCreationProfile(),
        timeoutMs: 500,
        beforeSideEffect: async (intent) => {
          assert.deepEqual(page.fills, []);
          assert.deepEqual(page.clicks, []);
          events.push(intent.target ? 'desired' : 'creation');
          if (intent.target) {
            assert.equal(intent.desiredContentHash, hashDraftContent(expected));
            assert.deepEqual(intent.target, recorded);
          } else {
            assert.equal(page.gotoCalls.length, 0);
            assert.equal(intent.requestedContentHash, hashDraftContent(requested));
          }
        },
        onTargetDiscovered: async (value) => {
          assert.deepEqual(page.fills, []);
          assert.deepEqual(page.clicks, []);
          assert.deepEqual(page.gotoCalls, [chapterCreationUrl]);
          assert.equal(page.creationReturnedUrl, chapterCreationUrl);
          assert.equal(page.routeUpdates, 1);
          assert.equal(page.url(), createdChapterUrl);
          assert.deepEqual(value, { kind: 'chapter', workId, chapterId: createdId });
          recorded = structuredClone(value);
          events.push('target');
        },
      },
    );
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(events, ['creation', 'target', 'desired']);
    assert.deepEqual(result.target, recorded);
    assert.equal(result.contentHash, hashDraftContent(expected));
    assert.equal(page.records.get(createdId)!.content.body, '\nFirst\n\nLast\n');
    assert.deepEqual(page.records.get(createdId)!.content.metadata, expected.metadata);
    assert.deepEqual(page.fills, ['#title', '#body', '#description']);
    assert.deepEqual(page.clicks, ['button:存草稿']);
    assert.deepEqual(page.gotoCalls, [chapterCreationUrl, createdChapterUrl]);
  } finally {
    page.cleanup();
  }
});

test('chapter ID absence, late allocation and spent navigation budget stay unknown without later writing', async () => {
  for (const scenario of [
    { name: 'no ID', routeDelayMs: undefined, gotoDelayMs: 0, timeoutMs: 30 },
    { name: 'ID after deadline', routeDelayMs: 80, gotoDelayMs: 0, timeoutMs: 25 },
    {
      name: 'navigation consumes shared budget',
      routeDelayMs: 130,
      gotoDelayMs: 70,
      timeoutMs: 100,
    },
    {
      name: 'target present only after navigation deadline',
      routeDelayMs: 10,
      gotoDelayMs: 60,
      timeoutMs: 25,
    },
  ]) {
    const page = new ChapterCreationFixturePage();
    page.routeDelayMs = scenario.routeDelayMs;
    page.gotoDelayMs = scenario.gotoDelayMs;
    let hookCalls = 0;
    let intents = 0;
    try {
      const result = await saveChapterDraft(
        page.asPage(),
        { accountId, workId, clientReference: 'chapter-timeout-fixture', content },
        {
          ...options,
          profile: chapterCreationProfile(),
          timeoutMs: scenario.timeoutMs,
          beforeSideEffect: async () => {
            intents++;
          },
          onTargetDiscovered: async () => {
            hookCalls++;
          },
        },
      );
      assertUnknownChapterCreation(result, page);
      assert.equal(result.target, undefined, scenario.name);
      assert.equal(hookCalls, 0, scenario.name);
      assert.equal(intents, 1, scenario.name);
      assert.ok(
        page.creationNavigationTimeouts[0]! > 0 &&
          page.creationNavigationTimeouts[0]! <= scenario.timeoutMs,
      );
      if (scenario.routeDelayMs !== undefined) {
        await page.pause(150);
        assert.equal(page.routeUpdates, 1, scenario.name);
        assertUnknownChapterCreation(result, page);
        assert.equal(hookCalls, 0);
        assert.equal(intents, 1);
      }
    } finally {
      page.cleanup();
    }
  }
});
