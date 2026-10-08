import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store, RuntimeError, canonicalJson } from '../src/runtime/store.js';
import {
  nativeShortCoverScope,
  NATIVE_SHORT_COVER_OPERATION,
} from '../src/platform/short-native-cover-proof.js';
const WORK = '7000000001';
const PRIVATE = '<p>SYNTHETIC_PRIVATE_HTML_NO_PUBLIC_OUTPUT</p>';
function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cover-store-synthetic-'));
  const store = new Store({
    databasePath: path.join(dir, 'store.db'),
    evidenceDirectory: path.join(dir, 'evidence'),
    evidenceMode: 'live',
  });
  const create = () => {
    const { job } = store.createJob({
      accountId: 'synthetic',
      kind: 'write',
      idempotencyKey: randomUUID(),
      operation: NATIVE_SHORT_COVER_OPERATION,
      scope: nativeShortCoverScope(WORK),
      inputHash: '1'.repeat(64),
    });
    store.startJob(job.id);
    store.markPlatformReadStarted(job.id);
    store.recordTarget(job.id, { kind: 'short-story', id: WORK });
    return job.id;
  };
  return {
    dir,
    store,
    create,
    db: (store as unknown as { db: import('node:sqlite').DatabaseSync }).db,
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function unavailable(action: () => unknown) {
  assert.throws(
    action,
    (error) =>
      error instanceof RuntimeError &&
      error.code === 'capability_unavailable' &&
      !error.message.includes(PRIVATE),
  );
}

test('cover Store rejects arbitrary successful Queue return before committing it', () => {
  const f = setup();
  try {
    const id = f.create();
    f.store.markPlatformWriteStarted(id);
    unavailable(() =>
      f.store.completeWriteJob(id, {
        schema: 'native-short-cover-result-evidence/v1',
        status: 'success',
        payload: PRIVATE,
      }),
    );
    assert.equal(f.store.getJob(id)!.status, 'running');
    f.store.failJob(id, { code: 'synthetic', message: 'Synthetic only' });
    assert.equal(f.store.getJob(id)!.status, 'uncertain');
  } finally {
    f.cleanup();
  }
});

test('cover Store does not grant an attempt from a fabricated immutable observation', () => {
  const f = setup();
  try {
    const id = f.create(),
      eventAt = f.store.markPlatformWriteStarted(id);
    const ref = f.store.saveEvidence(id, 'short_native_cover_upload_attempt', {
      schema: 'native-short-cover-upload-attempt-evidence/v1',
      phase: 'upload',
      stage: 'attempt',
      ordinal: 1,
      eventAt,
    });
    unavailable(() => f.store.recordNativeShortCoverAttempt(id, 'upload', ref));
    assert.deepEqual(f.store.listNativeShortCoverAttempts(id), []);
  } finally {
    f.cleanup();
  }
});

test('cover attempt rejects wrong job, changed reference and cancellation without durable authorization', () => {
  const f = setup();
  try {
    const id = f.create(),
      other = f.create(),
      eventAt = f.store.markPlatformWriteStarted(id);
    f.store.markPlatformWriteStarted(other);
    const ref = f.store.saveEvidence(id, 'short_native_cover_upload_attempt', {
      phase: 'upload',
      stage: 'attempt',
      ordinal: 1,
      eventAt,
    });
    unavailable(() => f.store.recordNativeShortCoverAttempt(other, 'upload', ref));
    unavailable(() =>
      f.store.recordNativeShortCoverAttempt(id, 'upload', { ...ref, sha256: '2'.repeat(64) }),
    );
    f.store.requestCancellation(id, { code: 'cancelled', message: 'Synthetic cancellation' });
    unavailable(() => f.store.recordNativeShortCoverAttempt(id, 'upload', ref));
    assert.deepEqual(f.store.listNativeShortCoverAttempts(id), []);
    assert.deepEqual(f.store.listNativeShortCoverAttempts(other), []);
  } finally {
    f.cleanup();
  }
});

test('cover namespace cannot settle through generic caller-selected hash reconciliation', () => {
  const f = setup();
  try {
    const id = f.create();
    f.store.markPlatformWriteStarted(id);
    f.store.saveEvidence(id, 'write-intent', {
      desiredContentHash: '2'.repeat(64),
      expectedStates: ['draft'],
    });
    f.store.failJob(id, { code: 'synthetic', message: 'Synthetic only' });
    // Move the synthetic completed uncertainty one second behind the independent read.
    const endedAt = new Date(Date.now() - 1000).toISOString();
    f.db.prepare('UPDATE jobs SET ended_at=? WHERE id=?').run(endedAt, id);
    const { job: read } = f.store.createJob({
      accountId: 'synthetic',
      kind: 'read',
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: '3'.repeat(64),
    });
    f.store.startJob(read.id);
    f.store.markPlatformReadStarted(read.id);
    const ref = f.store.saveEvidence(read.id, 'reconciliation', {
      source: { mode: 'live', origin: 'https://fanqienovel.com' },
      reconciliation: {
        originalJobId: id,
        target: { kind: 'short-story', id: WORK },
        inputHash: '1'.repeat(64),
        observedStatus: 'draft',
        observedContentHash: '2'.repeat(64),
      },
    });
    f.store.completeReadJob(read.id, [ref]);
    unavailable(() =>
      f.store.reconcileWriteJob(id, read.id, {
        status: 'succeeded',
        result: { desiredContentHash: '2'.repeat(64) },
      }),
    );
    assert.equal(f.store.getJob(id)!.status, 'uncertain');
    assert.equal(
      f.db
        .prepare('SELECT COUNT(*) AS n FROM write_reconciliations WHERE original_job_id=?')
        .get(id)!.n,
      0,
    );
  } finally {
    f.cleanup();
  }
});

test('cover durable closure without its immutable reconciliation row fails closed', () => {
  const f = setup();
  try {
    const id = f.create();
    f.db
      .prepare('UPDATE jobs SET status=?,result_json=? WHERE id=?')
      .run(
        'uncertain',
        canonicalJson({ schema: 'native-short-cover-closure/v1', private: PRIVATE }),
        id,
      );
    unavailable(() => f.store.getJob(id));
  } finally {
    f.cleanup();
  }
});

test('malformed cover JSON returns fixed unavailable rather than falling into generic projection', () => {
  const f = setup();
  try {
    const id = f.create();
    f.db.prepare('UPDATE jobs SET result_json=? WHERE id=?').run(PRIVATE, id);
    unavailable(() => f.store.getJob(id));
  } finally {
    f.cleanup();
  }
});

test('nested cover evidence cannot use a generic Store completion or saved success', () => {
  const f = setup();
  try {
    const { job } = f.store.createJob({
      accountId: 'synthetic',
      kind: 'write',
      idempotencyKey: randomUUID(),
      operation: 'generic_synthetic',
      scope: 'generic',
      inputHash: '1'.repeat(64),
    });
    f.store.startJob(job.id);
    f.store.markPlatformReadStarted(job.id);
    f.store.saveEvidence(job.id, 'synthetic', {
      nested: { schema: 'native-short-cover-private/v1', content: PRIVATE },
    });
    unavailable(() => f.store.completeWriteJob(job.id, { safe: true }));
    f.db
      .prepare('UPDATE jobs SET status=?,result_json=? WHERE id=?')
      .run('succeeded', canonicalJson({ safe: true }), job.id);
    unavailable(() => f.store.getJob(job.id));
  } finally {
    f.cleanup();
  }
});
