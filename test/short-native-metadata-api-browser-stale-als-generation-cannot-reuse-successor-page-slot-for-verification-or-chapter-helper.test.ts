import test from 'node:test';

import {
  fixture,
  deferred,
  WORK,
  turn,
  edit,
} from './helpers/short-native-metadata-api-deferred.js';

import assert from 'node:assert/strict';

import { chapterTransportFixture } from './helpers/short-native-metadata-api-chapter-transport-fixture.js';

import { writeFixture, writeFailed } from './helpers/short-native-metadata-api-write-fixture.js';

import {
  nativeShortMetadataEndpoints,
  type NativeShortMetadataRequest,
} from '../src/platform/short-native-metadata.js';

import { type NativeShortMetadataDurableReceiptFields } from '../src/platform/short-native-metadata-api.js';

test('Browser stale ALS generation cannot reuse successor Page slot for verification or chapter helper', async () => {
  const f = fixture(),
    staleStart = deferred<void>(),
    successorEntered = deferred<void>(),
    successorFinish = deferred<void>();
  let staleHelperSettled = false,
    stale: Promise<[unknown, unknown]>;
  await f.session.withPage(async (page) => {
    // Deliberately unawaited child retains reader A's ALS generation after A returns.
    stale = (async () => {
      await staleStart.promise;
      const chapter = f.session.enterCurrentChapterDirectory(page, WORK).then(
        () => null,
        (error) => error,
      );
      const helper = f.session.verifyCurrentAccount(page).then((value) => {
        staleHelperSettled = true;
        return value;
      });
      return Promise.all([helper, chapter]);
    })();
  });
  const successor = f.session.withPage(async (page) => {
    assert.equal(page, f.page);
    successorEntered.resolve();
    await successorFinish.promise;
  });
  await successorEntered.promise;
  const before = f.pageTouches;
  staleStart.resolve();
  await turn();
  const observations = {
    staleHelperSettledWhileSuccessorSlotHeld: staleHelperSettled,
    pageInspectionsDuringSuccessor: f.pageTouches - before,
  };
  console.log('ALS generation observations', JSON.stringify(observations));
  try {
    assert.equal(observations.staleHelperSettledWhileSuccessorSlotHeld, false);
    assert.equal(observations.pageInspectionsDuringSuccessor, 0);
  } finally {
    successorFinish.resolve();
    await successor;
  }
  const [identity, chapterError] = await stale!;
  assert.equal((identity as { status: string }).status, 'authenticated');
  assert.equal((chapterError as { code: string }).code, 'chapter_directory_slot_required');
  await f.session.close();
});

for (const kind of ['directory', 'drafts'] as const)
  for (const outsideReaderAls of [false, true])
    test(`Browser ${kind} management source accepts legal navigation and response delivery outside reader ALS=${outsideReaderAls}`, async () => {
      const f = chapterTransportFixture(outsideReaderAls);
      try {
        const result = await f.session.withPage((page) => f.collect(kind, page));
        assert.deepEqual(
          result.errors.map((error) => error.code),
          ['synthetic_source_accepted'],
        );
        assert.equal(f.entryAttempts, 1);
        assert.equal(f.navigations, 1);
        assert.equal(f.internals.identityEpoch, 1);
        assert(f.inspected > 0);
      } finally {
        await f.session.close();
        f.destroy();
      }
    });

for (const kind of ['directory', 'drafts'] as const)
  test(`Browser stale ${kind} transport observers cannot inspect a successor's same Page slot`, async () => {
    const f = chapterTransportFixture(true),
      entered = deferred<void>(),
      finish = deferred<void>();
    try {
      await f.session.withPage((page) => f.collect(kind, page));
      assert.equal(f.entryAttempts, 1);
      const successor = f.session.withPage(async (page) => {
        assert.equal(page, f.page);
        entered.resolve();
        await finish.promise;
      });
      await entered.promise;
      const before = f.inspected;
      f.deliverCaptured();
      await turn();
      try {
        assert.equal(f.inspected, before);
        assert.equal(f.entryAttempts, 1);
      } finally {
        finish.resolve();
        await successor;
      }
    } finally {
      await f.session.close();
      f.destroy();
    }
  });

for (const kind of ['directory', 'drafts'] as const)
  test(`Browser ${kind} transport observers cannot inspect a quarantined current slot`, async () => {
    const f = chapterTransportFixture(true);
    try {
      await assert.rejects(
        f.session.withPage(async (page) => {
          await f.collect(kind, page);
          const before = f.inspected;
          f.internals.apiQuarantined = true;
          f.deliverCaptured();
          await turn();
          assert.equal(f.inspected, before);
          assert.equal(f.entryAttempts, 1);
        }),
        { code: 'shutdown_incomplete' },
      );
      await assert.rejects(f.session.close(), { code: 'shutdown_incomplete' });
    } finally {
      f.destroy();
    }
  });

test('native write holds before through trusted receipt, one fixed POST and an independent full clean after', async () => {
  const f = writeFixture();
  const result = await f.run.run();
  assert.equal(result.status, 'success');
  assert(result.held && result.receipt && result.snapshot);
  assert.equal(result.reason, null);
  assert.equal(result.schema, 'native-short-metadata-api-write/v2');
  assert.equal(result.held.schema, 'native-short-metadata-held-before/v2');
  assert.equal(result.receipt.schema, 'native-short-metadata-durable-receipt/v2');
  assert.equal(result.held.cleanup.sessionDisposed, false);
  assert.equal(f.posts.length, 1);
  assert.equal(f.marks, 1);
  assert.equal(f.pageTouches, 0);
  assert.equal(f.borrowedCloses, 0);
  const post = f.posts[0]!;
  assert.equal(post.url, nativeShortMetadataEndpoints(WORK).save);
  assert.deepEqual(Object.keys(post.options).sort(), [
    'data',
    'failOnStatusCode',
    'headers',
    'maxRedirects',
    'maxRetries',
    'timeout',
  ]);
  assert.equal(post.options.maxRedirects, 0);
  assert.equal(post.options.maxRetries, 0);
  assert.deepEqual(post.options.headers, {
    'content-type': nativeShortMetadataEndpoints(WORK).contentType,
  });
  const form = new URLSearchParams(post.options.data as string);
  assert.equal(form.get('content'), edit().content);
  assert.equal(form.get('thumb_uri'), edit().thumb_uri);
  assert.equal(form.get('book_thumb_uri'), edit().book_thumb_uri);
  assert.deepEqual(JSON.parse(form.get('multi_title')!), [
    'Changed synthetic title',
    ...edit().multi_title.slice(1),
  ]);
  for (const phase of Object.values(result.phases)) {
    assert.deepEqual(phase.requests, {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 1, disposed: 1 },
      edit: { attempts: 1, disposed: 1 },
      catalog: { attempts: 1, disposed: 1 },
    });
    assert.equal(phase.proof.targetUnique, true);
  }
  assert.equal(f.calls.length, 10);
  assert.equal(result.post.attempts, 1);
  assert.equal(result.post.disposed, 1);
  assert.equal(result.post.acknowledged, true);
  assert.equal(result.comparison!.matches, true);
  assert.equal(result.desiredContentHash, result.observedContentHash);
  assert.equal(result.proof.atomicRevision, false);
  assert.equal(result.cleanup.sessionDisposed, true);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(result.cleanup.disposalFailures, 0);
  assert.equal(result.cleanup.quarantined, false);
  assert.equal(result.proof.proofCapturedAt, f.finalAt);
  assert(
    result.post.markedAt! <= result.post.startedAt! &&
      result.post.startedAt! <= result.post.acknowledgedAt! &&
      result.post.acknowledgedAt! <= result.phases.after.proof.readStartedAt!,
  );
  assert(
    f.events.indexOf('durable_done') < f.events.indexOf('mark') &&
      f.events.indexOf('mark') < f.events.indexOf('post'),
  );
});

test('native write title-only empty category baseline is preserved and never requests a category clear', async () => {
  const f = writeFixture({ emptyCategories: true });
  const result = await f.run.run();
  assert.equal(result.status, 'success');
  assert.equal(new URLSearchParams(f.posts[0]!.options.data as string).has('category'), false);
  assert.deepEqual(result.snapshot!.savedFields.category, []);
  assert.equal(result.held!.snapshot.categorySelectionHash, result.snapshot!.categorySelectionHash);
});

for (const [name, override, reason] of [
  ['plain forged receipt', { forgedReceipt: true }, 'durability_unverified'],
  [
    'wrong desired hash',
    {
      receiptMutation: (fields: NativeShortMetadataDurableReceiptFields) => {
        fields.desiredContentHash = '0'.repeat(64);
      },
    },
    'durability_unverified',
  ],
  [
    'same ref twice',
    {
      receiptMutation: (fields: NativeShortMetadataDurableReceiptFields) => {
        fields.intent.id = fields.baseline.id;
      },
    },
    'durability_unverified',
  ],
  [
    'wrong target',
    {
      receiptMutation: (fields: NativeShortMetadataDurableReceiptFields) => {
        fields.target.id = '9999999999';
      },
    },
    'durability_unverified',
  ],
  [
    'old baseline capture',
    {
      receiptMutation: (fields: NativeShortMetadataDurableReceiptFields) => {
        fields.baseline.capturedAt = '2000-01-01T00:00:00.000Z';
      },
    },
    'durability_unverified',
  ],
  ['durable failure', { callbackFault: 'durable' }, 'callback_failed'],
  ['mark failure', { callbackFault: 'mark' }, 'callback_failed'],
  [
    'old full version',
    {
      requestMutation: (value: NativeShortMetadataRequest) => {
        (value as any).expectedSnapshotVersionHash = '0'.repeat(64);
      },
    },
    'version_conflict',
  ],
] as const)
  test(`native write ${name} cannot POST or publish raw`, async () => {
    const f = writeFixture(override);
    writeFailed(await f.run.run(), reason);
    assert.equal(f.posts.length, 0);
    assert.equal(f.apiCloses, 1);
  });

for (const [name, change] of [
  [
    'empty patch',
    (value: NativeShortMetadataRequest) => {
      delete (value as any).title;
    },
  ],
  [
    'extra transport',
    (value: NativeShortMetadataRequest) => {
      (value as any).url = 'https://private.invalid';
    },
  ],
  [
    'empty categories',
    (value: NativeShortMetadataRequest) => {
      (value as any).metadata = { categories: [] };
    },
  ],
] as const)
  test(`native write ${name} is rejected before cookies or GET`, async () => {
    const f = writeFixture({ requestMutation: change });
    writeFailed(await f.run.run(), 'unsupported_schema');
    assert.equal(f.events.length, 0);
    assert.equal(f.posts.length, 0);
  });
