import test from 'node:test';

import {
  NativeShortFixturePage,
  ownApiNativeShortProfile,
  nativeShortProfile,
} from './helpers/platform-writes-native-short-fixture-page.js';

import {
  validateGenericShortSnapshot,
  readWriteSnapshot,
  type ModernShortSnapshot,
  isGenericShortCaptureFailure,
  isModernShortSnapshot,
  type GenericShortObservation,
  updateDraft,
  createDraft,
} from '../src/platform/writes.js';

import {
  accountId,
  target,
  fixedNow,
  rejectsCode,
  chapterId,
  createdId,
} from './helpers/platform-writes-fixture-page.js';

import {
  nativeOptions,
  nativeUpdateInput,
  nativeContent,
} from './helpers/platform-writes-fixture-template-document.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

test('R6 Proof17 records both original owner invocations and preserves checkedAt at t+500ms', async () => {
  const page = new NativeShortFixturePage();
  let checks = 0;
  const checkedAt = '2026-10-02T10:00:00.500+00:00';
  const snapshot = validateGenericShortSnapshot(
    await readWriteSnapshot(page.asPage(), accountId, target, {
      ...nativeOptions,
      profile: ownApiNativeShortProfile,
      timeoutMs: 100,
      verifyAccount: async () => {
        checks++;
        return {
          status: 'authenticated',
          identity: { accountId, authorId: null },
          sourceUrl: 'https://fanqienovel.com/api/author/user/info/v0/',
          checkedAt,
        };
      },
    }),
  );
  const boundary = '2026-10-02T10:00:00.000Z';
  assert.equal(checks, 2);
  assert.deepEqual(snapshot.statusProof, {
    schema: 'fanqie-generic-short-editor-proof/v1',
    profileId: ownApiNativeShortProfile.id,
    profileVerifiedAt: ownApiNativeShortProfile.verifiedAt,
    profileSource: 'short_article_edit_v1',
    owner: {
      kind: 'account',
      id: accountId,
      before: { requestedAt: boundary, completedAt: boundary, checkedAt },
      after: { requestedAt: boundary, completedAt: boundary, checkedAt },
    },
    method: 'GET',
    endpoint: '/api/author/short_article/edit/v1/',
    requestCount: 1,
    responseCount: 1,
    mainFrame: true,
    fixedSourceVerified: true,
    routeStable: true,
    bodyBound: true,
    readStartedAt: boundary,
    getRequestedAt: boundary,
    getCompletedAt: boundary,
    readFinishedAt: boundary,
  });
  assert.equal(snapshot.platformReadAt, boundary);
  assert.equal(Date.parse(checkedAt) > Date.parse(snapshot.platformReadAt), true);
  for (const offset of [-1, 1001]) {
    const rejected = new NativeShortFixturePage();
    let calls = 0;
    await assert.rejects(
      readWriteSnapshot(rejected.asPage(), accountId, target, {
        ...nativeOptions,
        profile: ownApiNativeShortProfile,
        timeoutMs: 100,
        verifyAccount: async () => {
          calls++;
          return {
            status: 'authenticated',
            identity: { accountId, authorId: null },
            sourceUrl: 'https://fanqienovel.com/api/author/user/info/v0/',
            checkedAt: new Date(fixedNow().getTime() + offset).toISOString(),
          };
        },
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.equal(calls, 1);
    assert.equal(rejected.gotoCalls.length, 0);
    assert.deepEqual(rejected.fills, []);
    assert.deepEqual(rejected.clicks, []);
    rejected.cleanup();
  }
  page.cleanup();
});

test('R6 private snapshot validator rejects partials, entire unsafe descriptors, raw/facts drift and forged proof boundaries', async () => {
  const page = new NativeShortFixturePage();
  const original = validateGenericShortSnapshot(
    await readWriteSnapshot(page.asPage(), accountId, target, {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
    }),
  );
  let getters = 0;
  const malformed: unknown[] = [];
  for (const key of Object.keys(original)) {
    const partial = structuredClone(original) as unknown as Record<string, unknown>;
    delete partial[key];
    malformed.push(partial);
  }
  const extra = { ...structuredClone(original), extra: true };
  malformed.push(extra);
  const symbol = structuredClone(original);
  Object.defineProperty(symbol, Symbol('unexpected'), { value: true, enumerable: true });
  malformed.push(symbol);
  const getter = structuredClone(original);
  Object.defineProperty(getter, 'title', {
    get() {
      getters++;
      return original.title;
    },
    enumerable: true,
  });
  malformed.push(getter);
  const rawUndefined = structuredClone(original);
  rawUndefined.statusInput.publish_status = undefined;
  malformed.push(rawUndefined);
  const hidden = structuredClone(original);
  Object.defineProperty(hidden, 'body', { value: original.body, enumerable: false });
  malformed.push(hidden);
  const badTarget = structuredClone(original) as ModernShortSnapshot & {
    target: { chapterId?: string };
  };
  badTarget.target.chapterId = chapterId;
  malformed.push(badTarget);
  const badMetadata = structuredClone(original);
  Object.assign(badMetadata.metadata, { description: 'unexpected' });
  malformed.push(badMetadata);
  const facts = structuredClone(original);
  facts.statusFacts.reasons.push('editor_not_publication_proof');
  malformed.push(facts);
  const rawDrift = structuredClone(original);
  rawDrift.statusInput.display_status = 1;
  malformed.push(rawDrift);
  const falseSource = structuredClone(original);
  (falseSource.statusProof as unknown as Record<string, unknown>).fixedSourceVerified = false;
  malformed.push(falseSource);
  const owner = structuredClone(original);
  owner.statusProof.owner.id = '123456';
  malformed.push(owner);
  const time = structuredClone(original);
  time.statusProof.getCompletedAt = '2026-10-02T09:59:59.999Z';
  malformed.push(time);
  const hash = structuredClone(original);
  hash.contentHash = 'a'.repeat(64);
  malformed.push(hash);
  const publication = structuredClone(original);
  publication.state = 'unpublished';
  malformed.push(publication);
  const source = structuredClone(original);
  (source as unknown as Record<string, unknown>).sourceUrl = { toString: 'unsafe' };
  malformed.push(source);
  const thenable = structuredClone(original) as ModernShortSnapshot & { then?: () => void };
  thenable.then = () => {
    getters++;
  };
  malformed.push(thenable);
  for (const value of malformed)
    assert.throws(
      () => validateGenericShortSnapshot(value),
      (error) => isGenericShortCaptureFailure(error),
    );
  assert.equal(getters, 0);
  assert.equal(isModernShortSnapshot({ statusProof: null }), true);
  const reservedGetter = {};
  Object.defineProperty(reservedGetter, 'statusInput', {
    get() {
      getters++;
    },
    enumerable: true,
  });
  assert.equal(isModernShortSnapshot(reservedGetter), true);
  assert.equal(getters, 0);
  assert.equal(isModernShortSnapshot({ title: 'legacy' }), false);
  assert.deepEqual(validateGenericShortSnapshot(original), original);
  assert.equal(Object.isFrozen(original.statusProof.owner.before), true);
  page.cleanup();
});

test('R6 writer emits exactly baseline and after while specialized and final reads do not invoke its callback', async () => {
  const page = new NativeShortFixturePage(),
    seen: GenericShortObservation[] = [],
    sequence: string[] = [];
  let owners = 0;
  const runOptions = {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 150,
    verifyAccount: async (current: Page) => {
      owners++;
      return nativeOptions.verifyAccount(current);
    },
    onShortObservation: async (observation: GenericShortObservation) => {
      assert.deepEqual(Object.keys(observation).sort(), ['schema', 'phase', 'snapshot'].sort());
      assert.equal(observation.schema, 'fanqie-generic-short-editor-observation/v1');
      if (observation.phase === 'baseline') {
        assert.deepEqual(page.fills, []);
        assert.deepEqual(page.clicks, []);
      } else assert.deepEqual(page.clicks, ['button:存草稿']);
      seen.push(observation);
      sequence.push(observation.phase);
    },
    beforeSideEffect: async () => {
      sequence.push('desired');
    },
  };
  await readWriteSnapshot(page.asPage(), accountId, target, runOptions);
  assert.equal(seen.length, 0);
  const result = await updateDraft(page.asPage(), nativeUpdateInput(), runOptions);
  await readWriteSnapshot(page.asPage(), accountId, target, runOptions);
  assert.deepEqual(sequence, ['baseline', 'desired', 'after']);
  assert.equal(seen.length, 2);
  assert.equal(page.gotoCalls.length, 4);
  assert.equal(owners, 9);
  assert.deepEqual(page.clicks, ['button:存草稿']);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.platformState, 'draft');
  assert.equal(result.statusProtocol, 'fanqie-generic-short-status/v1');
  assert.deepEqual(result.shortObservation, seen[1]);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'status',
      'capability',
      'target',
      'contentHash',
      'platformState',
      'verifiedAt',
      'sourceUrl',
      'statusProtocol',
      'shortObservation',
    ].sort(),
  );
  page.cleanup();
});

test('R6 writer callback rejection remains sticky before save, after save and after creation binding', async () => {
  for (const failPhase of ['baseline', 'after'] as const) {
    const page = new NativeShortFixturePage(),
      failure = new Error('R6 callback failure ' + failPhase);
    let observations = 0;
    await assert.rejects(
      updateDraft(page.asPage(), nativeUpdateInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 150,
        onShortObservation: async (observation) => {
          observations++;
          if (observation.phase === failPhase) throw failure;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(observations, failPhase === 'baseline' ? 1 : 2);
    assert.deepEqual(page.clicks, failPhase === 'baseline' ? [] : ['button:存草稿']);
    if (failPhase === 'baseline') assert.deepEqual(page.fills, []);
    assert.equal(page.gotoCalls.length, failPhase === 'baseline' ? 1 : 2);
    page.cleanup();
  }
  const created = new NativeShortFixturePage(),
    failure = new Error('R6 allocation baseline callback failure');
  let bound = 0;
  try {
    await assert.rejects(
      createDraft(
        created.asPage(),
        { accountId, clientReference: 'R6-callback-create', content: nativeContent },
        {
          ...nativeOptions,
          profile: nativeShortProfile,
          timeoutMs: 200,
          onTargetDiscovered: async (actual) => {
            bound++;
            assert.equal(actual.workId, createdId);
          },
          onShortObservation: async () => {
            throw failure;
          },
        },
      ),
      (error) => error === failure,
    );
    assert.equal(bound, 1);
    assert.deepEqual(created.fills, []);
    assert.deepEqual(created.clicks, []);
    assert.equal(created.gotoCalls.filter((url) => url.includes('/publish-short/?')).length, 1);
  } finally {
    created.cleanup();
  }
});
