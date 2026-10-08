import test from 'node:test';

import {
  getWriteCapabilities,
  type DraftMetadata,
  updateWorkMetadata,
  hashDraftContent,
  PlatformWriteError,
  createDraft,
  readWriteSnapshot,
  prepareSubmission,
  updateDraft,
} from '../src/platform/writes.js';

import {
  nativeShortProfile,
  NativeShortFixturePage,
} from './helpers/platform-writes-native-short-fixture-page.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

import {
  accountId,
  target,
  createdId,
  workId,
  rejectsCode,
} from './helpers/platform-writes-fixture-page.js';

import {
  nativeContent,
  nativeOptions,
  legacyNativeReadInput,
  nativeUpdateInput,
} from './helpers/platform-writes-fixture-template-document.js';

test('native short metadata capability rejects every request before page access, verification or intent', async () => {
  const capability = getWriteCapabilities(nativeShortProfile).update_work_metadata;
  assert.equal(capability.available, false);
  const cases: { label: string; metadata: DraftMetadata; title?: string }[] = [
    { label: 'empty metadata', metadata: {} },
    { label: 'title-only', metadata: {}, title: 'Fixture metadata title change' },
    { label: 'description', metadata: { description: 'Fixture metadata description' } },
    { label: 'categories', metadata: { categories: ['fixture-category'] } },
    { label: 'AI declaration', metadata: { aiDeclaration: 'yes' } },
    { label: 'trial ratio', metadata: { trialRatio: 50 } },
    { label: 'cover', metadata: { cover: { uploadPath: 'fixture.png', sha256: 'a'.repeat(64) } } },
    { label: 'unknown field', metadata: { unsupported: 'fixture' } as unknown as DraftMetadata },
  ];
  for (const scenario of cases) {
    let pageAccesses = 0,
      verified = 0,
      intents = 0;
    const page = new Proxy({} as Page, {
      get() {
        pageAccesses++;
        throw new Error('Unexpected native metadata page access');
      },
    });
    await assert.rejects(
      updateWorkMetadata(
        page,
        {
          accountId,
          target,
          expectedContentHash: hashDraftContent(nativeContent),
          expectedState: 'draft',
          metadata: scenario.metadata,
          title: scenario.title,
        },
        {
          ...nativeOptions,
          profile: nativeShortProfile,
          verifyAccount: async () => {
            verified++;
            throw new Error('Unexpected native metadata verification');
          },
          beforeSideEffect: async () => {
            intents++;
            throw new Error('Unexpected native metadata intent');
          },
        },
      ),
      (error) =>
        error instanceof PlatformWriteError &&
        error.code === 'capability_unavailable' &&
        error.message === capability.reason,
    );
    assert.deepEqual(
      { pageAccesses, verified, intents },
      { pageAccesses: 0, verified: 0, intents: 0 },
      scenario.label,
    );
  }
});

test('native short create waits for the real asynchronous ID and records it before any fill', async () => {
  const page = new NativeShortFixturePage();
  page.requireBinding = true;
  const sequence: string[] = [];
  try {
    const result = await createDraft(
      page.asPage(),
      { accountId, clientReference: 'native-short-create', content: nativeContent },
      {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 200,
        beforeSideEffect: async (intent) => {
          if (!intent.target) {
            assert.equal(page.gotoCalls.length, 0);
            assert.equal(intent.requestedContentHash, hashDraftContent(nativeContent));
            assert.equal(intent.desiredContentHash, undefined);
          } else {
            assert.equal(page.targetBound, true);
            assert.equal(page.fills.length, 0);
            assert.equal(intent.desiredContentHash, hashDraftContent(nativeContent));
          }
          sequence.push(intent.target ? 'desired' : 'entry');
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
    assert.deepEqual(sequence, ['entry', 'bound', 'desired']);
    assert.equal(page.gotoCalls.filter((url) => url.includes('/publish-short/?')).length, 1);
    assert.equal(page.gotoCalls.filter((url) => url.endsWith('/' + createdId)).length, 2);
    assert.deepEqual(page.clicks, ['button:存草稿']);
    assert.equal(
      [...page.nativeEvents.values()].every((entries) => entries.size === 0),
      true,
    );
  } finally {
    page.cleanup();
  }
});

test('native short server state needs same-response display1 to establish published (official O10/O13/O15)', async () => {
  const page = new NativeShortFixturePage();
  const snapshot = await readWriteSnapshot(page.asPage(), accountId, target, {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
  });
  assert.equal(snapshot.state, 'draft');
  assert.equal(snapshot.contentHash, hashDraftContent(nativeContent));
  page.records.get(workId)!.state = 'published';
  await assert.rejects(
    prepareSubmission(page.asPage(), legacyNativeReadInput(), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    }),
    rejectsCode('capability_unavailable'),
  );
  page.displayStatusOverride = 1; // Explicit raw management code; never inferred from fixture UI state.
  const published = await readWriteSnapshot(page.asPage(), accountId, target, {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
  });
  assert.equal(published.state, 'published');
  await assert.rejects(
    updateDraft(page.asPage(), nativeUpdateInput(), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    }),
    rejectsCode('version_conflict'),
  );
  assert.deepEqual(page.fills, []);
  assert.deepEqual(page.clicks, []);
});

test('generic native short state matrix rejects conflict before intent/fill/click and observes display4/5/7 exactly', async () => {
  for (const display of [1, 4, 5, 7, 10, 12, 999, null, '0']) {
    const page = new NativeShortFixturePage();
    page.statusOverride = 0;
    page.displayStatusOverride = display;
    let intents = 0;
    await assert.rejects(
      updateDraft(page.asPage(), nativeUpdateInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
        beforeSideEffect: async () => {
          intents++;
        },
      }),
      rejectsCode('version_conflict'),
    );
    assert.equal(intents, 0);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
    page.cleanup();
  }
  for (const [display, state] of [
    [4, 'reviewing'],
    [5, 'reviewing'],
    [7, 'rejected'],
  ] as const) {
    const page = new NativeShortFixturePage();
    page.statusOverride = 1;
    page.displayStatusOverride = display;
    const read = await readWriteSnapshot(page.asPage(), accountId, target, {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    });
    assert.equal(read.state, state);
    await assert.rejects(
      updateDraft(page.asPage(), nativeUpdateInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
      }),
      rejectsCode('version_conflict'),
    );
    assert.deepEqual(page.clicks, []);
    page.cleanup();
  }
  for (const display of [undefined, 0, 10, 12, 999]) {
    const page = new NativeShortFixturePage();
    page.statusOverride = 1;
    page.displayStatusOverride = display;
    await assert.rejects(
      prepareSubmission(page.asPage(), legacyNativeReadInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
      }),
      rejectsCode('capability_unavailable'),
    );
    page.cleanup();
  }
});

test('generic short unknown after a single save stays uncertain and asynchronous malicious response rejects without getters', async () => {
  for (const display of [4, 7, 10, 12, 999]) {
    const page = new NativeShortFixturePage();
    page.displayStatusOverride = 0;
    page.onReopen = () => {
      if (page.clicks.length) page.displayStatusOverride = display;
    };
    const result = await updateDraft(page.asPage(), nativeUpdateInput(), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    });
    assert.equal(result.status, 'uncertain');
    assert.equal(result.platformState, undefined);
    assert.deepEqual(page.clicks, ['button:存草稿']);
    page.cleanup();
  }
  let invoked = 0;
  for (const location of ['envelope', 'data', 'titles'] as const) {
    const page = new NativeShortFixturePage();
    page.rawResponseTransform = (raw) => {
      const value = raw as { data: { multi_title: string[] } };
      if (location === 'envelope')
        Object.defineProperty(value, 'data', {
          get() {
            invoked++;
            return {};
          },
          enumerable: true,
        });
      else if (location === 'data')
        Object.defineProperty(value.data, 'display_status', {
          get() {
            invoked++;
            return 0;
          },
          enumerable: true,
        });
      else
        Object.defineProperty(value.data.multi_title, '0', {
          get() {
            invoked++;
            return 'unsafe';
          },
          enumerable: true,
        });
      return value;
    };
    await assert.rejects(
      readWriteSnapshot(page.asPage(), accountId, target, {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.equal(
      [...page.nativeEvents.values()].every((entries) => entries.size === 0),
      true,
    );
    page.cleanup();
  }
  assert.equal(invoked, 0);
});
