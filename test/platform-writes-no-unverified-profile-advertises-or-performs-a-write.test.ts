import test from 'node:test';

import {
  FixturePage,
  updateInput,
  rejectsCode,
  profile,
  fixedNow,
  accountId,
  content,
  options,
  target,
  workId,
  createdId,
} from './helpers/platform-writes-fixture-page.js';

import assert from 'node:assert/strict';

import {
  getWriteCapabilities,
  updateDraft,
  hashDraftContent,
  createDraft,
  reconcileWrite,
  type DraftMetadata,
  updateWorkMetadata,
  prepareSubmission,
  submitShortStory,
} from '../src/platform/writes.js';

test('no unverified profile advertises or performs a write', async () => {
  const page = new FixturePage();
  assert.equal(getWriteCapabilities().create_draft.available, false);
  await assert.rejects(
    updateDraft(page.asPage(), updateInput()),
    rejectsCode('capability_unavailable'),
  );
  assert.deepEqual(page.clicks, []);
  assert.deepEqual(page.fills, []);
});

test('hash normalizes line endings while preserving empty paragraphs and whitespace', () => {
  assert.equal(
    hashDraftContent({ title: 'T', body: 'A\r\n\r\n B' }),
    hashDraftContent({ title: 'T', body: 'A\n\n B' }),
  );
  assert.notEqual(
    hashDraftContent({ title: 'T', body: 'A\n\n B' }),
    hashDraftContent({ title: 'T', body: 'A\nB' }),
  );
});

test('durable intent and creation-ID hooks are required before platform side effects', async () => {
  const page = new FixturePage();
  await assert.rejects(
    updateDraft(page.asPage(), updateInput(), { profile, now: fixedNow }),
    rejectsCode('capability_unavailable'),
  );
  await assert.rejects(
    createDraft(
      page.asPage(),
      { accountId, clientReference: 'fixture-no-id-hook', content },
      { profile, beforeSideEffect: async () => {} },
    ),
    rejectsCode('capability_unavailable'),
  );
  assert.deepEqual(page.fills, []);
  assert.deepEqual(page.clicks, []);
  assert.ok(page.gotoCalls.every((url) => !url.endsWith('/new-short')));
});

test('saved short draft is confirmed only after reopening its stable ID', async () => {
  const page = new FixturePage();
  let persistedIntent = 0;
  const result = await updateDraft(page.asPage(), updateInput({ body: 'Changed\n\nBody' }), {
    ...options,
    beforeSideEffect: async () => {
      assert.equal(page.fills.length, 0);
      persistedIntent++;
    },
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.contentHash, hashDraftContent({ ...content, body: 'Changed\n\nBody' }));
  assert.equal(persistedIntent, 1);
  assert.equal(page.gotoCalls.length, 2);
  assert.deepEqual(result.target, target);
});

test('content/state conflicts and wrong identity reject before filling or clicking', async () => {
  for (const failure of ['hash', 'state', 'account']) {
    const page = new FixturePage();
    if (failure === 'hash') page.records.get(workId)!.content.body += '\nExternal edit';
    if (failure === 'state') page.records.get(workId)!.state = 'published';
    if (failure === 'account') page.account = 'different-author';
    await assert.rejects(
      updateDraft(page.asPage(), updateInput(), options),
      rejectsCode(failure === 'account' ? 'requires_login' : 'version_conflict'),
    );
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
});

test('visible author name falls back to fresh current-context own-account verification', async () => {
  const page = new FixturePage();
  page.account = 'Fixture pen name';
  let verified = 0;
  const result = await updateDraft(
    page.asPage(),
    updateInput({ body: 'Changed after own-ID verification' }),
    {
      ...options,
      verifyAccount: async (currentPage) => {
        assert.equal(currentPage, page.asPage());
        verified++;
        return {
          status: 'authenticated',
          identity: { authorId: accountId, accountId: null },
          checkedAt: fixedNow().toISOString(),
          sourceUrl: 'https://fanqienovel.com/api/author/info',
        };
      },
    },
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(verified, 2);
});

test('display name alone, stale verification, and mismatched own ID cannot authorize a write', async () => {
  for (const condition of ['name-only', 'stale', 'mismatch']) {
    const page = new FixturePage();
    page.account = 'Fixture pen name';
    const extra =
      condition === 'name-only'
        ? {}
        : {
            verifyAccount: async () => ({
              status: 'authenticated' as const,
              identity: {
                authorId: condition === 'mismatch' ? '999999999' : accountId,
                accountId: null,
              },
              sourceUrl: 'https://fanqienovel.com/api/author/info',
              checkedAt: condition === 'stale' ? '2026-10-01T00:00:00Z' : fixedNow().toISOString(),
            }),
          };
    await assert.rejects(
      updateDraft(page.asPage(), updateInput(), { ...options, ...extra }),
      rejectsCode(condition === 'stale' ? 'capability_unavailable' : 'requires_login'),
    );
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
});

test('missing, ambiguous and unsupported controls fail without side effects', async () => {
  for (const mode of ['missing', 'duplicate', 'metadata']) {
    const page = new FixturePage();
    if (mode === 'missing') page.missing.add('button:存草稿');
    if (mode === 'duplicate') page.duplicate.add('#title');
    const currentProfile = structuredClone(profile);
    if (mode === 'metadata') delete currentProfile.fields!.description;
    const beforeHash =
      mode === 'metadata'
        ? hashDraftContent({
            ...content,
            metadata: { aiDeclaration: 'no', categories: ['fixture-category'], trialRatio: 30 },
          })
        : hashDraftContent(content);
    await assert.rejects(
      updateDraft(
        page.asPage(),
        { ...updateInput(), expectedContentHash: beforeHash },
        { ...options, profile: currentProfile },
      ),
      rejectsCode('capability_unavailable'),
    );
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
  }
});

test('save toast without persisted content produces uncertain', async () => {
  const page = new FixturePage();
  page.savePersists = false;
  const result = await updateDraft(page.asPage(), updateInput({ body: 'Changed body' }), options);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'outcome_unknown');
});

test('lost save response is reconciled read-only without repeating save', async () => {
  const page = new FixturePage();
  page.failAfterSave = true;
  const desired = { ...content, body: 'Persisted despite timeout' };
  const result = await updateDraft(page.asPage(), updateInput({ body: desired.body }), options);
  assert.equal(result.status, 'uncertain');
  const reconciled = await reconcileWrite(
    page.asPage(),
    {
      accountId,
      target,
      capability: 'update_draft',
      expectedContentHash: hashDraftContent(desired),
      expectedStates: ['draft'],
    },
    options,
  );
  assert.equal(reconciled.status, 'succeeded');
  assert.deepEqual(page.clicks, ['button:存草稿']);
});

test('create persists discovered platform ID before filling, then verifies complete content', async () => {
  const page = new FixturePage();
  const events: string[] = [];
  const result = await createDraft(
    page.asPage(),
    { accountId, clientReference: 'fixture-create-1', content },
    {
      ...options,
      beforeSideEffect: async (intent) => {
        assert.equal(intent.clientReference, 'fixture-create-1');
        if (intent.target) assert.equal(intent.desiredContentHash, hashDraftContent(content));
        events.push(intent.target ? 'expected' : 'intent');
      },
      onTargetDiscovered: async (target) => {
        assert.equal(page.fills.length, 0);
        assert.equal(target.workId, createdId);
        events.push('target');
      },
    },
  );
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(events, ['intent', 'target', 'expected']);
  assert.equal(result.target?.workId, createdId);
});

test('interrupted creation with unknown ID cannot trigger another creation during reconciliation', async () => {
  const page = new FixturePage();
  page.failCreation = true;
  const result = await createDraft(
    page.asPage(),
    { accountId, clientReference: 'fixture-create-2', content },
    options,
  );
  assert.equal(result.status, 'uncertain');
  assert.equal(result.target, undefined);
  const navigations = page.gotoCalls.length;
  const reconciled = await reconcileWrite(
    page.asPage(),
    {
      accountId,
      capability: 'create_draft',
      expectedContentHash: hashDraftContent(content),
      expectedStates: ['draft'],
    },
    options,
  );
  assert.equal(reconciled.status, 'uncertain');
  assert.equal(page.gotoCalls.length, navigations);
  assert.deepEqual(page.clicks, []);
});

test('metadata update preserves body and verifies selected AI/category/trial values', async () => {
  const page = new FixturePage();
  const metadata: DraftMetadata = {
    aiDeclaration: 'yes',
    categories: ['other-category'],
    trialRatio: 50,
  };
  const result = await updateWorkMetadata(
    page.asPage(),
    {
      accountId,
      target,
      expectedContentHash: hashDraftContent(content),
      expectedState: 'draft',
      metadata,
    },
    options,
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(page.records.get(workId)!.content.body, content.body);
  assert.equal(
    result.contentHash,
    hashDraftContent({ ...content, metadata: { ...content.metadata, ...metadata } }),
  );
});

test('submission preparation is read-only and bound to exact content, account and visible terms', async () => {
  const page = new FixturePage();
  const prepared = await prepareSubmission(
    page.asPage(),
    { accountId, target, expectedContentHash: hashDraftContent(content), expectedState: 'draft' },
    options,
  );
  assert.equal(prepared.expectedContentHash, hashDraftContent(content));
  assert.deepEqual(prepared.terms, ['Fixture publication terms']);
  assert.deepEqual(page.clicks, []);
  assert.deepEqual(page.fills, []);
  assert.equal(page.agreement, false);
});

test('submission returns reviewing without claiming publication', async () => {
  const page = new FixturePage();
  const input = {
    accountId,
    target,
    expectedContentHash: hashDraftContent(content),
    expectedState: 'draft' as const,
  };
  const prepared = await prepareSubmission(page.asPage(), input, options);
  const result = await submitShortStory(
    page.asPage(),
    { ...input, prepared, acceptPublicationTerms: true },
    options,
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.platformState, 'reviewing');
  assert.deepEqual(page.clicks, ['button:下一步', 'button:确认提交']);
});
