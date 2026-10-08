import test from 'node:test';

import {
  r6RuntimeFixture,
  r6Db,
  r6Target,
  r6Begin,
} from './helpers/runtime-native-compensation-later.js';

import {
  r6SavedRead,
  r6Unavailable,
  r6DirectSuccess,
  r6RewriteReadDocument,
  r6LegacyUnknownRoot,
  r6Advance,
} from './helpers/runtime-r6-advance.js';

import assert from 'node:assert/strict';

import { digest } from './helpers/runtime-deferred.js';

import { canonicalJson, type Manifest } from '../src/runtime/store.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

test('R6 absent SQL observation cannot become a present null in the final native selector', async (t) => {
  const f = r6RuntimeFixture();
  try {
    const saved = r6SavedRead(f),
      db = r6Db(f),
      prepare = db.prepare.bind(db),
      exec = db.exec.bind(db);
    let absenceReads = 0,
      commits = 0;
    const sql = 'SELECT * FROM creation_recoveries WHERE original_job_id = ?';
    t.mock.method(db, 'prepare', (statement: string) => {
      const actual = prepare(statement);
      if (statement !== sql) return actual;
      return new Proxy(actual, {
        get(target, key) {
          if (key === 'get')
            return (...args: unknown[]) => {
              absenceReads++;
              return absenceReads === 1 ? (target.get as Function).apply(target, args) : null;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    t.mock.method(db, 'exec', (statement: string) => {
      if (statement === 'COMMIT') commits++;
      return exec(statement);
    });
    assert.throws(() => f.store.genericShortProjection(saved.job.id, 'author'), r6Unavailable);
    assert.ok(absenceReads >= 2);
    assert.equal(commits, 0, 'the selector must refuse before the post-COMMIT journal begins');
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
});

test('R6 terminal publication bridge changes only publication tuple and cannot mutate old event or ledger', async () => {
  const f = r6RuntimeFixture();
  try {
    const original = r6DirectSuccess(f),
      db = r6Db(f),
      oldJob = db.prepare('SELECT * FROM jobs WHERE id=?').get(original.id),
      oldEvidence = f.store.listEvidence(original.id),
      oldRelations = db
        .prepare('SELECT * FROM write_reconciliations WHERE original_job_id=?')
        .all(original.id);
    const later = r6SavedRead(f, original, 1),
      audit = (later.payload as Record<string, any>).originalAudit;
    assert.equal(audit.schema, 'generic-short-terminal-publication-bridge/v1');
    assert.equal(audit.mode, 'observation-only');
    assert.equal((later.payload as Record<string, any>).reconciliation.observedStatus, 'unknown');
    assert.deepEqual(audit.requestedOriginal, original);
    assert.deepEqual(audit.effectHistory, {
      kind: 'modern-direct-success',
      resultEvidence: oldEvidence.find((ref) => ref.dataset === 'write-result'),
    });
    assert.equal(f.store.genericShortPublication(original.id, 'author').state, 'published');
    assert.equal(
      f.store.genericShortPublication(original.id, 'author').statusEvidence?.id,
      later.ref.id,
    );
    assert.deepEqual(db.prepare('SELECT * FROM jobs WHERE id=?').get(original.id), oldJob);
    assert.deepEqual(f.store.listEvidence(original.id), oldEvidence);
    assert.deepEqual(
      db.prepare('SELECT * FROM write_reconciliations WHERE original_job_id=?').all(original.id),
      oldRelations,
    );
    assert.throws(
      () =>
        f.store.reconcileWriteJob(original.id, later.job.id, {
          status: 'succeeded',
          result: { contentHash: later.snapshot.contentHash, platformState: 'draft_saved' },
        }),
      { code: 'invalid_reconciliation' },
    );
    assert.deepEqual(db.prepare('SELECT * FROM jobs WHERE id=?').get(original.id), oldJob);
    assert.deepEqual(
      db.prepare('SELECT * FROM write_reconciliations WHERE original_job_id=?').all(original.id),
      oldRelations,
    );
    r6RewriteReadDocument(f, later.ref, (payload) => {
      payload.reconciliation.observedStatus = 'draft_saved';
    });
    assert.throws(() => f.store.genericShortPublication(original.id, 'author'), r6Unavailable);
  } finally {
    await f.cleanup();
  }
});

test('R6 complete legacy prefix boundary preserves effect tier and continuation uses adjacent actual pointer', async () => {
  const f = r6RuntimeFixture();
  try {
    const root = r6LegacyUnknownRoot(f),
      old = f.store.createJob({
        accountId: 'author',
        kind: 'read',
        operation: 'reconcile_write',
        scope: 'reconciliation',
        datasets: ['reconciliation'],
        inputHash: digest(canonicalJson({ jobId: root.id })),
      }).job;
    f.store.startJob(old.id);
    const at = f.store.markPlatformReadStarted(old.id),
      ref = f.store.saveEvidence(old.id, 'reconciliation', {
        source: { mode: 'live', origin: 'https://fanqienovel.com' },
        reconciliation: {
          originalJobId: root.id,
          target: root.target,
          inputHash: root.inputHash,
          observedContentHash: digest('legacy-independent-version'),
          observedStatus: 'unknown',
        },
        sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + r6Target.id,
        platformReadAt: at,
      });
    f.store.completeReadJob(old.id, [ref]);
    f.store.reconcileWriteJob(root.id, old.id, {
      status: 'uncertain',
      result: { contentHash: digest('legacy-independent-version'), platformState: 'unknown' },
    });
    // Historicalize this complete legacy settlement atomically in the fixture.
    const db = r6Db(f),
      historical = '2025-01-02T00:00:00.000Z',
      oldJob = f.store.getJob(old.id)!,
      doc = f.store.readEvidence(ref);
    doc.capturedAt = historical;
    (doc.payload as Record<string, unknown>).platformReadAt = historical;
    const bytes = JSON.stringify(doc),
      oldRef = { ...ref, capturedAt: historical, sha256: digest(bytes) };
    writeFileSync(path.join(f.options.evidenceDirectory, ref.path), bytes);
    db.prepare('UPDATE evidence SET captured_at=?,sha256=? WHERE id=?').run(
      historical,
      oldRef.sha256,
      ref.id,
    );
    const manifest = (oldJob.result as { manifest: Manifest }).manifest;
    Object.assign(manifest, {
      requestedAt: historical,
      platformReadStartedAt: historical,
      committedAt: historical,
      evidence: [oldRef],
    });
    db.prepare('UPDATE manifests SET committed_at=?,manifest_json=? WHERE job_id=?').run(
      historical,
      canonicalJson(manifest),
      old.id,
    );
    db.prepare(
      'UPDATE jobs SET requested_at=?,started_at=?,read_started_at=?,ended_at=?,updated_at=?,result_json=? WHERE id=?',
    ).run(
      historical,
      historical,
      historical,
      historical,
      historical,
      canonicalJson({ manifest }),
      old.id,
    );
    const closed = f.store.getJob(root.id)!,
      closure = { ...(closed.result as Record<string, unknown>), evidence: oldRef };
    db.prepare(
      'UPDATE write_reconciliations SET created_at=?,result_json=? WHERE original_job_id=?',
    ).run(historical, canonicalJson(closure), root.id);
    db.prepare('UPDATE jobs SET ended_at=?,updated_at=?,result_json=? WHERE id=?').run(
      historical,
      historical,
      canonicalJson(closure),
      root.id,
    );
    const first = r6SavedRead(f, f.store.getJob(root.id)!, 1),
      audit = (first.payload as Record<string, any>).originalAudit;
    assert.equal(audit.schema, 'generic-short-write-publication-bridge-audit/v1');
    assert.equal(audit.phase, 'boundary');
    assert.equal(audit.effectLevel, 'legacy-reconciliation');
    assert.equal(audit.legacyPrefix.rowCount, 1);
    assert.equal(audit.firstBridgeSettlement, null);
    assert.deepEqual(audit.legacyPrefix.first, audit.legacyPrefix.last);
    assert.deepEqual(audit.previousSettlement, audit.legacyPrefix.last);
    assert.equal(audit.legacyPrefix.first.readJobId, old.id);
    assert.equal(audit.legacyPrefix.first.evidenceHash, oldRef.sha256);
    assert.equal(audit.legacyPrefix.rowsHash, digest(canonicalJson([audit.legacyPrefix.first])));
    const modernClosure = f.store.reconcileWriteJob(root.id, first.job.id, {
      status: 'uncertain',
      result: { contentHash: first.snapshot.contentHash, platformState: 'unknown' },
    });
    const secondRun = r6Begin(f, modernClosure),
      continuation = f.store.getGenericShortOriginalAudit(
        root.id,
        'author',
        secondRun.job.id,
      ) as Record<string, any>;
    assert.equal(continuation.phase, 'continuation');
    assert.equal(continuation.effectLevel, 'legacy-reconciliation');
    assert.deepEqual(continuation.legacyPrefix, audit.legacyPrefix);
    assert.equal(continuation.firstBridgeSettlement.readJobId, first.job.id);
    assert.deepEqual(continuation.previousSettlement, continuation.firstBridgeSettlement);
    r6Advance(f, secondRun, 'source_unavailable', undefined, 'later_read', 'source_unavailable');
    f.store.failJob(secondRun.job.id, {
      code: 'capability_unavailable',
      message: 'Synthetic unused continuation read.',
    });
    assert.equal(f.store.genericShortPublication(root.id, 'author').state, 'published');
    db.prepare('DELETE FROM write_reconciliations WHERE original_job_id=? AND read_job_id=?').run(
      root.id,
      old.id,
    );
    assert.throws(() => f.store.genericShortPublication(root.id, 'author'), r6Unavailable);
  } finally {
    await f.cleanup();
  }
});
