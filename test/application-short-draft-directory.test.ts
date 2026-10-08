import test from 'node:test';

import {
  directoryApplicationFixture,
  assertDirectoryPublicPrivacy,
  directoryStoreFixture,
  directoryStoreObservation,
} from './helpers/application-directory-application-fixture.js';

import assert from 'node:assert/strict';

import { directoryRecordIds, directoryExpectedRecord } from './helpers/application-a6-unclosed.js';

import * as directoryDomain from '../src/platform/short-draft-directory.js';

import { canonicalJson as directoryCanonicalJson } from '../src/runtime/store.js';

import { createHash } from 'node:crypto';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import { DatabaseSync as DirectoryDatabase } from 'node:sqlite';

test('F02 directory App: complete fixture DTO keeps IDs and unknown fields with cleanup and immutable saved replay', async () => {
  const f = directoryApplicationFixture({ total: 11 });
  try {
    const fresh = await f.fresh();
    assert.equal(fresh.job.status, 'succeeded');
    assert.equal(fresh.sourceMode, 'fixture');
    assert.equal(fresh.verifiedLive, false);
    const business = fresh.data[0];
    assert.deepEqual(business.records, directoryRecordIds(11).map(directoryExpectedRecord));
    assert.equal(business.schema, 'fanqie-short-draft-directory/v1');
    assert.equal(business.dataset, 'short_drafts');
    assert.equal(business.status, 'success');
    assert.equal(business.reason, null);
    assert.deepEqual(business.source, {
      mode: 'fixture',
      origin: 'https://fanqienovel.com',
      path: '/api/author/short_article/draft_list/v0/',
    });
    assert.equal(business.coverage.pagesRead, 2);
    assert.equal(business.coverage.rowsRead, 11);
    assert.equal(business.coverage.declaredTotal, 11);
    assert.equal(business.coverage.complete, true);
    assert.equal(business.coverage.atomicRevision, false);
    assert.deepEqual(business.requests, {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 2, disposed: 2 },
    });
    assert.equal(business.cleanup.sessionDisposed, true);
    assert.equal(business.cleanup.pendingAtEnd, 0);
    assert.equal(business.cleanup.disposalFailures, 0);
    assert.equal(business.cleanup.quarantined, false);
    assert.equal(business.verifiedLive, false);
    assert.equal(business.bodyIncluded, false);
    const saved = await f.get(fresh.job.id),
      snapshot = await f.snapshot(),
      history = await f.history();
    assert.equal(saved.sourceMode, 'saved');
    assert.deepEqual(saved.evidence, fresh.evidence);
    assert.deepEqual(saved.data, fresh.data);
    assert.deepEqual(snapshot.data, fresh.data);
    assert.deepEqual(history.manifests[0].data, fresh.data);
    for (const result of [fresh, saved, snapshot, history]) assertDirectoryPublicPrivacy(result);
    assert.equal(f.calls, 4);
    assert.equal(f.disposed, 1);
    const capability = (await f.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    const directory = capability.reads.find((item: any) => item.dataset === 'short_drafts');
    assert.equal(directory.snapshotScope, 'native_short_draft_directory.v1');
    assert.equal(directory.verificationStatus, 'not-verified-live');
    assert.deepEqual(directory.supportedReadFields, ['id']);
  } finally {
    await f.close();
  }
});

test('F02 directory App: empty total zero is complete only after real own twice and one list GET', async () => {
  const f = directoryApplicationFixture({ total: 0 });
  try {
    const result = await f.fresh();
    assert.equal(result.job.status, 'succeeded');
    assert.deepEqual(result.data[0].records, []);
    assert.equal(result.data[0].coverage.declaredTotal, 0);
    assert.equal(result.data[0].coverage.complete, true);
    assert.deepEqual(result.data[0].requests, {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 1, disposed: 1 },
    });
    assert.equal(f.calls, 3);
    assert.equal(f.sessions, f.disposed);
    assertDirectoryPublicPrivacy(result);
  } finally {
    await f.close();
  }
});

test('F02 directory App: total 100 reads ten fixed pages while total 101 cannot truncate or promote', async () => {
  const f = directoryApplicationFixture({ total: 100 });
  try {
    const initial = await f.fresh(),
      before = await f.snapshot();
    assert.equal(initial.job.status, 'succeeded');
    assert.equal(initial.data[0].records.length, 100);
    assert.equal(initial.data[0].coverage.pagesRead, 10);
    assert.equal(f.calls, 12);
    f.setMode('bounded');
    const refusal = await f.fresh();
    assert.equal(refusal.job.status, 'partial');
    assert.equal(refusal.sourceMode, 'incomplete');
    assert.equal(refusal.verifiedLive, false);
    assert.deepEqual(refusal.data[0].records, []);
    assert.equal(refusal.data[0].coverage.complete, false);
    assert.equal(refusal.data[0].reason, 'bounded_unavailable');
    assert.deepEqual(await f.snapshot(), before);
    assert.equal((await f.history()).manifests.length, 1);
    assert.equal(f.calls, 14);
    assertDirectoryPublicPrivacy(refusal);
  } finally {
    await f.close();
  }
});

test('F02 directory App: no typed binding and cold context fail without false empty snapshot or platform access', async () => {
  for (const options of [{ binding: false }, { mode: 'cold' as const }]) {
    const f = directoryApplicationFixture(options);
    try {
      const result = await f.fresh();
      assert.equal(result.job.status, 'failed');
      assert.equal(result.sourceMode, 'incomplete');
      assert.equal(result.verifiedLive, false);
      assert.deepEqual(result.data, []);
      assert.equal((await f.snapshot()).manifest, null);
      assert.equal((await f.history()).manifests.length, 0);
      assert.equal(f.calls, 0);
      assertDirectoryPublicPrivacy(result);
    } finally {
      await f.close();
    }
  }
});

test('F02 directory App: owner drift and outside errors keep first current and expose fixed safe failures', async () => {
  const f = directoryApplicationFixture();
  try {
    await f.fresh();
    const previous = await f.snapshot();
    f.setMode('owner_changed');
    const drift = await f.fresh();
    assert.equal(drift.job.status, 'partial');
    assert.equal(drift.sourceMode, 'incomplete');
    assert.equal(drift.data[0].reason, 'owner_changed');
    assert.deepEqual(drift.data[0].records, []);
    assertDirectoryPublicPrivacy(drift);
    f.setMode('outside_error');
    const failure = await f.fresh();
    assert.equal(failure.job.status, 'failed');
    assert.deepEqual(failure.job.error, {
      code: 'capability_unavailable',
      message: 'Short draft directory is unavailable.',
    });
    assertDirectoryPublicPrivacy(failure);
    assert.deepEqual(await f.snapshot(), previous);
    assert.equal((await f.history()).manifests.length, 1);
  } finally {
    await f.close();
  }
});

test('F02 directory App: concurrent fresh calls have independent UUID jobs and queue FIFO without merge', async () => {
  const f = directoryApplicationFixture();
  try {
    const [first, second] = await Promise.all([f.fresh(), f.fresh()]);
    assert.notEqual(first.job.id, second.job.id);
    assert.equal(first.job.status, 'succeeded');
    assert.equal(second.job.status, 'succeeded');
    assert.equal(f.sessions, 2);
    assert.equal(f.maximumActive, 1);
    assert.equal(f.calls, 6);
    assert.equal((await f.history()).manifests.length, 2);
    const jobs = (
      (await f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any
    ).jobs;
    assert.equal(jobs.length, 2);
    for (const job of jobs) assertDirectoryPublicPrivacy({ job });
  } finally {
    await f.close();
  }
});

test('F02 directory App: saved reopen preserves evidence cutoff and performs no fresh job or GET', async () => {
  const f = directoryApplicationFixture({ total: 10 });
  try {
    const fresh = await f.fresh(),
      initial = await f.snapshot(),
      calls = f.calls;
    await f.reopen();
    const saved = await f.get(fresh.job.id);
    assert.equal(saved.retrievalMode, 'saved');
    assert.equal(saved.sourceMode, 'saved');
    assert.deepEqual(saved.evidence, fresh.evidence);
    assert.deepEqual(saved.data, fresh.data);
    assert.deepEqual(await f.snapshot(), initial);
    assert.equal((await f.history()).manifests.length, 1);
    const cancelled = (await f.application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_cancel_job',
      new URLSearchParams(),
      { jobId: fresh.job.id },
    )) as any;
    assert.equal(cancelled.job.status, 'succeeded');
    assert.deepEqual(cancelled.data, fresh.data);
    assertDirectoryPublicPrivacy(cancelled);
    assert.equal(f.calls, calls);
    assert.equal(
      (
        (await f.application.dispatch(
          'GET',
          '/api/v1/jobs',
          new URLSearchParams(),
          undefined,
        )) as any
      ).jobs.length,
      1,
    );
  } finally {
    await f.close();
  }
});

test('F02 directory App: default origin refuses saved fixture across job list cancel snapshot history', async () => {
  const f = directoryApplicationFixture();
  try {
    const fresh = await f.fresh();
    await f.reopen(true);
    for (const value of [
      await f.get(fresh.job.id),
      await f.snapshot(),
      (await f.history()).manifests[0],
      await f.application.dispatch(
        'POST',
        '/api/v1/tools/fanqie_cancel_job',
        new URLSearchParams(),
        { jobId: fresh.job.id },
      ),
    ]) {
      const result = value as any;
      assert.equal(result.sourceMode, 'incomplete');
      assert.equal(result.data[0].status, 'capability_unavailable');
      assert.deepEqual(result.data[0].records, []);
      assert.equal(result.verifiedLive, false);
      assertDirectoryPublicPrivacy(result);
    }
    const jobs = (
      (await f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any
    ).jobs;
    assert.equal(jobs[0].status, null);
    assertDirectoryPublicPrivacy({ job: jobs[0] });
    assert.equal(f.calls, 3);
  } finally {
    await f.close();
  }
});

test('F02 directory Store: actual file tamper with recomputed SQL hash cannot promote after App prefix', async () => {
  const f = directoryStoreFixture();
  try {
    const prior = await directoryStoreObservation(f.store),
      original = f.store.completeReadJob(prior.job.id, [prior.ref]);
    const next = await directoryStoreObservation(f.store);
    directoryDomain.validateShortDraftDirectoryContext(
      {
        accountId: next.job.accountId,
        job: next.job,
        manifest: null,
        refs: [next.ref],
        documents: [f.store.readEvidence(next.ref)],
        evaluationAt: new Date().toISOString(),
      },
      'prefix',
    );
    const document = f.store.readEvidence(next.ref) as any;
    document.payload.records[0].id.value = '7900000000000000002';
    const bytes = Buffer.from(`${directoryCanonicalJson(document)}\n`),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(f.evidenceDirectory, next.ref.path), bytes);
    const sql = new DirectoryDatabase(f.databasePath);
    try {
      sql.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(sha256, next.ref.id);
    } finally {
      sql.close();
    }
    await assert.rejects(
      async () => f.store.completeReadJob(next.job.id, [{ ...next.ref, sha256 }]),
      { code: 'capability_unavailable', message: 'Short draft directory is unavailable.' },
    );
    assert.deepEqual(
      f.store.getCurrent(next.job.accountId, 'native_short_draft_directory.v1'),
      original,
    );
    assert.equal(f.store.history(next.job.accountId, 'native_short_draft_directory.v1').length, 1);
    assert.equal(f.store.getJob(next.job.id)!.status, 'running');
  } finally {
    f.close();
  }
});

test('F02 directory Store: full actual SQL evidence set rejects hidden extra reference before current INSERT', async () => {
  const f = directoryStoreFixture();
  try {
    const next = await directoryStoreObservation(f.store);
    f.store.saveEvidence(next.job.id, 'short_drafts', next.evidence);
    await assert.rejects(async () => f.store.completeReadJob(next.job.id, [next.ref]), {
      code: 'capability_unavailable',
      message: 'Short draft directory is unavailable.',
    });
    assert.equal(f.store.getCurrent(next.job.accountId, 'native_short_draft_directory.v1'), null);
    assert.equal(f.store.history(next.job.accountId).length, 0);
  } finally {
    f.close();
  }
});
