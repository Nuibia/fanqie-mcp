import test from 'node:test';

import {
  fixture,
  prepare,
  submit,
  noPrivate,
} from './helpers/short-native-submission-integration-edit.js';

import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { fixtureClosure } from './helpers/short-native-submission-integration-fixture-closure.js';

test('GET-only native preparation works with writes false and exact descriptor input', async () => {
  const f = fixture(false);
  try {
    const p = await prepare(f);
    assert.equal(f.posts, 0);
    assert.equal(p.data[0].validation.clientFullGate, 'not_proven');
    await assert.rejects(submit(f, p), { code: 'writes_disabled' });
    const inputs = [
      { ...f.input(), useAi: undefined },
      { ...f.input(), activity: {} },
      { ...f.input(), expectedContentHash: 'a'.repeat(64) },
      { ...f.input(), content: 'PRIVATE_BODY' },
    ];
    for (const input of inputs)
      await assert.rejects(f.call('prepare_submission', input), { code: 'invalid_input' });
    let getters = 0;
    const value = f.input();
    Object.defineProperty(value, 'useAi', {
      enumerable: true,
      get() {
        getters++;
        return 1;
      },
    });
    await assert.rejects(f.call('prepare_submission', value), { code: 'invalid_input' });
    assert.equal(getters, 0);
    assert.equal(f.posts, 0);
  } finally {
    await f.close();
  }
});

test('one publish attempt, actual published, safe saved projection and persisted idempotency', async () => {
  const f = fixture();
  try {
    const p = await prepare(f),
      r = await submit(f, p);
    assert.equal(r.job.status, 'succeeded', JSON.stringify(r));
    assert.equal(r.job.schema, 'fanqie-short-native-submission-job/v1');
    assert.equal(r.data[0].publication.status, 'published');
    assert.deepEqual(r.data[0].useAi, {
      requested: 1,
      acknowledged: 1,
      observed: 1,
      evidence: 'matched',
    });
    assert.equal(f.posts, 1);
    noPrivate(r);
    const repeated = await submit(f, p);
    assert.equal(repeated.job.id, r.job.id);
    assert.equal(f.posts, 1);
    await f.restart();
    const saved = await f.call('get_job', { jobId: r.job.id });
    assert.equal(saved.job.status, 'succeeded');
    noPrivate(saved);
    assert.equal(f.posts, 1);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      assert.equal(
        db.prepare('SELECT * FROM native_short_submission_attempts WHERE job_id=?').all(r.job.id)
          .length,
        1,
      );
    } finally {
      db.close();
    }
    const httpSaved = await f.app.dispatch(
      'GET',
      '/api/v1/jobs/' + r.job.id,
      new URLSearchParams(),
      undefined,
    );
    assert.equal((httpSaved as any).retrievalMode, 'saved');
    assert.equal((httpSaved as any).sourceMode, 'saved');
    writeFileSync(
      path.join(tmpdir(), 'fanqie-native-submission-public-write-fixture-20261007.json'),
      JSON.stringify(httpSaved, null, 2),
    );
    const corrupted = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      corrupted
        .prepare('UPDATE native_short_submission_attempts SET evidence_sha256=? WHERE job_id=?')
        .run('f'.repeat(64), r.job.id);
    } finally {
      corrupted.close();
    }
    const unavailable = await f.call('get_job', { jobId: r.job.id });
    assert.equal(unavailable.job.schema, 'fanqie-short-native-submission-job/v1');
    assert.equal(unavailable.job.projectionStatus, 'capability_unavailable');
    assert.equal(unavailable.job.result, null);
    noPrivate(unavailable);
    assert.equal(f.posts, 1);
  } finally {
    await f.close();
  }
});

test('server rejection persists ACK and fails once without retry', async () => {
  const f = fixture(true, 'reject');
  try {
    const p = await prepare(f),
      r = await submit(f, p);
    assert.equal(r.job.status, 'failed', JSON.stringify(r));
    assert.equal(r.data[0].acknowledgement.code, 400123);
    assert.equal(r.data[0].acknowledgement.accepted, false);
    assert.equal(r.data[0].publication.status, 'draft');
    noPrivate(r);
    assert.equal((await submit(f, p)).job.id, r.job.id);
    assert.equal(f.posts, 1);
    await f.restart();
    assert.equal((await f.call('get_job', { jobId: r.job.id })).job.status, 'failed');
  } finally {
    await f.close();
  }
});

for (const mode of ['lost', 'missing-ai'] as const)
  test(
    'unknown ' + mode + ' uses only owner/edit/catalog/owner in later read and never retries',
    async () => {
      const f = fixture(true, mode);
      try {
        const p = await prepare(f),
          r = await submit(f, p);
        assert.equal(r.job.status, 'uncertain', JSON.stringify(r));
        assert.equal(f.posts, 1);
        const beforeLists = f.lists;
        const reconciled = await f.call('reconcile_write', { jobId: r.job.id });
        assert.equal(reconciled.original.job.status, 'uncertain');
        assert.equal(f.posts, 1);
        assert.equal(f.lists, beforeLists);
        assert.equal(
          reconciled.reconciliation.data[0].comparison?.ai.evidence,
          mode === 'missing-ai' ? 'missing' : 'matched',
        );
        noPrivate(reconciled);
        if (mode === 'lost') fixtureClosure(f, r.job.id, reconciled.reconciliation.job.id);
        await f.restart();
        assert.equal((await f.call('get_job', { jobId: r.job.id })).job.status, 'uncertain');
        assert.equal(f.posts, 1);
      } finally {
        await f.close();
      }
    },
  );

test('fresh preparation version conflict fails before POST', async () => {
  const f = fixture();
  try {
    const p = await prepare(f);
    f.drift();
    const r = await submit(f, p);
    assert.equal(r.job.status, 'failed');
    assert.equal(f.posts, 0);
  } finally {
    await f.close();
  }
});
