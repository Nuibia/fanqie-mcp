import test from 'node:test';

import {
  fixture,
  prefix,
  finish,
  ACCOUNT,
  factory,
  PLATFORM,
} from './helpers/short-native-body-store-business.js';

import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';

import { type APIRequest } from 'playwright';

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { Store } from '../src/runtime/store.js';

import { NATIVE_SHORT_BODY_DATASETS } from '../src/platform/short-native-body-proof.js';

import { createHash } from 'node:crypto';

test('body Store native body markers take priority over legal trial fields and mixed generic completions', () => {
  const f = fixture();
  try {
    const p = prefix(f),
      done = finish(f, p);
    const job = f.store.completeWriteJob(f.job.id, done.result);
    assert.equal(job.operation, 'update_short_body');
    assert.equal(f.store.getJob(job.id)!.status, 'succeeded');
    assert.throws(() => f.store.listNativeShortBodyAttempts(job.id, 'other'));
    const db = new DatabaseSync(f.databasePath);
    db.prepare('UPDATE jobs SET result_json=? WHERE id=?').run('{broken native-short-body', job.id);
    db.close();
    assert.throws(() => f.store.getJob(job.id));
    assert.equal(
      f.store.getJobForPublicProjection(job.id, ACCOUNT)!.metadata.schema,
      'native-short-body-unvalidated/v1',
    );
  } finally {
    f.close();
  }
});

test('body Store fixture factory is captured once and live synthetic configuration rejects', async () => {
  let calls = 0;
  const mutable: Pick<APIRequest, 'newContext'> = {
      async newContext() {
        calls++;
        throw Error('captured');
      },
    },
    f = fixture({ factory: mutable });
  try {
    const b = f.binding();
    mutable.newContext = async () => {
      throw Error('replaced');
    };
    assert.equal(b.source.mode, 'fixture');
    assert.equal(Object.isFrozen(b.requestFactory), true);
    await assert.rejects(() => b.requestFactory.newContext());
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-factory-live-'));
  try {
    assert.throws(
      () =>
        new Store({
          databasePath: path.join(dir, 'db'),
          evidenceDirectory: path.join(dir, 'evidence'),
          evidenceMode: 'live',
          nativeShortBodyFixtureFactory: factory,
        }),
      { code: 'invalid_configuration' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('body Store actual SQL reconciliation history stops before replay beyond 128 rows', () => {
  const f = fixture();
  try {
    const p = prefix(f),
      done = finish(f, p, true);
    f.store.failJob(f.job.id, {
      code: 'capability_unavailable',
      message: 'Native short body is unavailable.',
    });
    const evidence = f.store.listEvidence(f.job.id)[0]!,
      db = new DatabaseSync(f.databasePath);
    try {
      for (let index = 0; index < 129; index++) {
        const read = f.store.createJob({
          accountId: ACCOUNT,
          kind: 'read',
          operation: 'reconcile_short_body_write',
          scope: 'body_bound_' + index,
          datasets: [NATIVE_SHORT_BODY_DATASETS.reconciliation],
        }).job;
        db.prepare(
          'INSERT INTO write_reconciliations(id,original_job_id,read_job_id,evidence_id,status,created_at,result_json) VALUES(?,?,?,?,?,?,?)',
        ).run(read.id, f.job.id, read.id, evidence.id, 'uncertain', new Date().toISOString(), '{}');
      }
    } finally {
      db.close();
    }
    assert.throws(() => f.store.getJob(f.job.id));
    assert.throws(() => f.store.getNativeShortBodyOriginalAudit(f.job.id, ACCOUNT));
    assert.equal(f.store.listNativeShortBodyAttempts(f.job.id, ACCOUNT).length, 1);
    assert.equal(done.result.outcome, 'unknown');
  } finally {
    f.close();
  }
});

test('body Store committed effect checkpoint recovery preserves unknown ordinal without surviving authority', () => {
  const f = fixture();
  let reopened: Store | undefined;
  try {
    const p = prefix(f),
      permit = p.b.beginAttempt(p.transport),
      refs = f.store.listEvidence(f.job.id),
      attempts = f.store.listNativeShortBodyAttempts(f.job.id, ACCOUNT);
    assert.equal(refs.length, 4);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.eventAt, f.store.getJob(f.job.id, ACCOUNT)!.platformWriteStartedAt);
    assert.throws(f.issue);
    f.store.close();
    assert.throws(() => p.b.consumeAttempt(permit));
    reopened = new Store({
      databasePath: f.databasePath,
      evidenceDirectory: f.evidenceDirectory,
      evidenceMode: 'fixture',
      nativeShortBodyWriteEnabled: false,
      nativeShortBodyFixtureFactory: factory,
    });
    const recovered = reopened.getJob(f.job.id, ACCOUNT);
    assert(recovered);
    assert.equal(recovered.status, 'uncertain');
    assert.equal(recovered.error!.code, 'outcome_unknown');
    assert.deepEqual(reopened.listEvidence(f.job.id), refs);
    assert.deepEqual(reopened.listNativeShortBodyAttempts(f.job.id, ACCOUNT), attempts);
    assert.equal(recovered.platformWriteStartedAt, attempts[0]!.eventAt);
    assert.equal(recovered.result !== null, true);
    assert.throws(() =>
      reopened!.issueNativeShortBodyWriteAuthority(f.job.id, ACCOUNT, f.input, PLATFORM),
    );
    assert.equal(reopened.getJob(f.job.id, 'foreign'), null);
    for (const ref of refs)
      assert.equal(
        createHash('sha256')
          .update(readFileSync(path.join(f.evidenceDirectory, ref.path)))
          .digest('hex'),
        ref.sha256,
      );
  } finally {
    if (reopened) reopened.close();
    f.close();
  }
});
