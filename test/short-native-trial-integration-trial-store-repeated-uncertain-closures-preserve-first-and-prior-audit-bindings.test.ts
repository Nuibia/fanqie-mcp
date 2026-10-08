import test from 'node:test';

import { directStoreFixture } from './helpers/short-native-trial-integration-direct-store-fixture.js';

import { edit, noPrivate } from './helpers/short-native-trial-integration-edit.js';

import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';

import { RuntimeError, canonicalJson } from '../src/runtime/store.js';

test('trial Store repeated uncertain closures preserve first and prior audit bindings', async () => {
  const d = await directStoreFixture();
  try {
    const { f, original } = d;
    f.setCurrent(edit());
    const first = await d.reconcile(original.id);
    noPrivate(first);
    assert.equal(first.original.job.status, 'uncertain');
    const firstAudit = d.store.getNativeShortTrialOriginalAudit(original.id);
    f.setCurrent({ ...edit(), multi_title: ['Synthetic title drift', 'PRIVATE_TAIL'] });
    const second = await d.reconcile(original.id);
    noPrivate(second);
    assert.equal(second.original.job.status, 'uncertain');
    const nextAudit = d.store.getNativeShortTrialOriginalAudit(original.id);
    assert.equal(nextAudit.originalEndedAt, original.endedAt);
    assert.equal(nextAudit.originalAttemptEvidence!.readJobId, first.reconciliation.job.id);
    assert.equal(nextAudit.previousClosure!.reconciliationJobId, second.reconciliation.job.id);
    assert.equal(nextAudit.priorEndedAt, second.original.job.endedAt);
    assert.equal(firstAudit.originalEndedAt, nextAudit.originalEndedAt);
    assert.deepEqual(firstAudit.priorEvidence, nextAudit.priorEvidence);
    f.setCurrent(f.posted);
    const matched = await d.reconcile(original.id);
    noPrivate(matched);
    assert.equal(matched.original.job.status, 'succeeded');
    assert.equal(matched.original.data[0].reason, 'saved_by_later_read');
    assert.equal(matched.original.data[0].originalSaveAcknowledged, false);
    assert.equal(f.writes, 1);
    await d.restart();
    assert.deepEqual(d.completed(d.store.getJob(original.id)!), matched.original);
    const db = new DatabaseSync(d.storeOptions.databasePath);
    const unavailable = () =>
      assert.throws(
        () => d.store.getJob(original.id),
        (error) => error instanceof RuntimeError && error.code === 'capability_unavailable',
      );
    try {
      const rows = db
        .prepare(
          'SELECT rowid AS sequence,* FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid',
        )
        .all(original.id);
      assert.equal(rows.length, 3);
      for (const index of [0, 1, 2]) {
        const row = rows[index]!;
        const closure = JSON.parse(String(row.result_json));
        const tamper = structuredClone(closure);
        tamper.originalAudit.originalEndedAt = new Date(
          Date.parse(original.endedAt!) - 1,
        ).toISOString();
        db.prepare('UPDATE write_reconciliations SET result_json=? WHERE id=?').run(
          canonicalJson(tamper),
          String(row.id),
        );
        unavailable();
        db.prepare('UPDATE write_reconciliations SET result_json=? WHERE id=?').run(
          String(row.result_json),
          String(row.id),
        );
        db.prepare('UPDATE write_reconciliations SET created_at=? WHERE id=?').run(
          new Date(Date.parse(String(row.created_at)) + 1).toISOString(),
          String(row.id),
        );
        unavailable();
        db.prepare('UPDATE write_reconciliations SET created_at=? WHERE id=?').run(
          String(row.created_at),
          String(row.id),
        );
        db.prepare('UPDATE write_reconciliations SET evidence_id=? WHERE id=?').run(
          d.store.listEvidence(original.id)[0]!.id,
          String(row.id),
        );
        unavailable();
        db.prepare('UPDATE write_reconciliations SET evidence_id=? WHERE id=?').run(
          String(row.evidence_id),
          String(row.id),
        );
      }
      const first = rows[0]!,
        middle = rows[1]!;
      for (const row of [first, middle]) {
        db.prepare('DELETE FROM write_reconciliations WHERE id=?').run(String(row.id));
        unavailable();
        // Restore the original rowid, preserving immutable history order.
        db.prepare(
          'INSERT INTO write_reconciliations(rowid,id,original_job_id,read_job_id,evidence_id,status,created_at,result_json) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          Number(row.sequence),
          String(row.id),
          String(row.original_job_id),
          String(row.read_job_id),
          String(row.evidence_id),
          String(row.status),
          String(row.created_at),
          String(row.result_json),
        );
      }
      const attempt = db
        .prepare('SELECT * FROM native_short_trial_attempts WHERE job_id=?')
        .get(original.id)!;
      db.prepare('UPDATE native_short_trial_attempts SET evidence_sha256=? WHERE job_id=?').run(
        'f'.repeat(64),
        original.id,
      );
      unavailable();
      db.prepare('UPDATE native_short_trial_attempts SET evidence_sha256=? WHERE job_id=?').run(
        String(attempt.evidence_sha256),
        original.id,
      );
      db.prepare('UPDATE native_short_trial_attempts SET event_at=? WHERE job_id=?').run(
        new Date(Date.parse(String(attempt.event_at)) - 1).toISOString(),
        original.id,
      );
      unavailable();
      db.prepare('UPDATE native_short_trial_attempts SET event_at=? WHERE job_id=?').run(
        String(attempt.event_at),
        original.id,
      );
      assert.deepEqual(d.completed(d.store.getJob(original.id)!), matched.original);
    } finally {
      db.close();
    }
    const before = [f.reads, f.writes, d.store.listJobs(f.config.accountId).length];
    const saved = await d.reconcile(original.id);
    noPrivate(saved);
    assert.equal(saved.settlement.status, 'saved');
    assert.deepEqual([f.reads, f.writes, d.store.listJobs(f.config.accountId).length], before);
  } finally {
    await d.close();
  }
});
