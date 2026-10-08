import test from 'node:test';

import { fixture } from './helpers/runtime-deferred.js';

import {
  nativeStoreOriginal,
  nativeStoreLater,
  assertNativeStoreRejected,
  nativeStoreResignLater,
} from './helpers/runtime-native-store-original.js';

import {
  nativeStoreSnapshot,
  nativeStoreDb,
  nativeStoreProvenance,
} from './helpers/runtime-recovery-baseline.js';

import assert from 'node:assert/strict';

import { canonicalJson, Store } from '../src/runtime/store.js';

import {
  type NativeShortClosure,
  type NativeShortOriginalAudit,
} from '../src/platform/short-native-metadata-proof.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

test('C3 native reconciliation Store will not reuse an older read or forged continuation prior time', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await nativeStoreOriginal(f),
      first = await nativeStoreLater(f, original, nativeStoreSnapshot()),
      concurrent = await nativeStoreLater(f, original);
    const unknown = f.store.reconcileWriteJob(original.id, first.read.id, first.resolution);
    assertNativeStoreRejected(f, unknown, concurrent);
    assertNativeStoreRejected(f, unknown, first);
    const fresh = await nativeStoreLater(f, unknown);
    nativeStoreResignLater(f, fresh, (d) => {
      d.payload.originalAudit.priorEndedAt = original.endedAt;
      d.payload.originalAudit.previousClosure.settledAt = original.endedAt;
    });
    assertNativeStoreRejected(f, unknown, fresh);
  } finally {
    await f.cleanup();
  }
});

test('C3 native reconciliation Store rolls back real SQL insert or job update failure atomically', async (t) => {
  for (const site of ['insert', 'update'] as const)
    await t.test(site, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          later = await nativeStoreLater(f, original),
          db = nativeStoreDb(f);
        db.exec(
          site === 'insert'
            ? "CREATE TEMP TRIGGER fail_native_reconcile BEFORE INSERT ON write_reconciliations BEGIN SELECT RAISE(ABORT,'synthetic insert failure'); END"
            : "CREATE TEMP TRIGGER fail_native_reconcile BEFORE UPDATE OF result_json ON jobs WHEN OLD.id = '" +
                original.id +
                "' BEGIN SELECT RAISE(ABORT,'synthetic update failure'); END",
        );
        assertNativeStoreRejected(f, original, later);
        db.exec('DROP TRIGGER fail_native_reconcile');
        assert.equal(
          f.store.reconcileWriteJob(original.id, later.read.id, later.resolution).status,
          'succeeded',
        );
      } finally {
        await f.cleanup();
      }
    });
});

test('C3 native reconciliation Store saved closure rejects SQL first previous current tampering and cannot bypass getJob through lists or keys', async (t) => {
  for (const site of [
    'current result',
    'current time',
    'first row',
    'first audit',
    'previous row',
    'previous pointer',
    'fully forged first pointer',
    'raw result schema',
    'external evidence',
  ])
    await t.test(site, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          firstRead = await nativeStoreLater(f, original, nativeStoreSnapshot());
        const first = f.store.reconcileWriteJob(
          original.id,
          firstRead.read.id,
          firstRead.resolution,
        );
        const secondRead = await nativeStoreLater(f, first, nativeStoreSnapshot());
        const second = f.store.reconcileWriteJob(
          original.id,
          secondRead.read.id,
          secondRead.resolution,
        );
        const lastRead = await nativeStoreLater(f, second);
        const last = f.store.reconcileWriteJob(original.id, lastRead.read.id, lastRead.resolution),
          db = nativeStoreDb(f);
        const rows = db.prepare('SELECT rowid,* FROM write_reconciliations ORDER BY rowid').all();
        if (site === 'current result')
          db.prepare('UPDATE write_reconciliations SET result_json = ? WHERE id = ?').run(
            '{}',
            rows[2]!.id!,
          );
        if (site === 'current time')
          db.prepare('UPDATE jobs SET ended_at = ? WHERE id = ?').run(
            original.endedAt,
            original.id,
          );
        if (site === 'first row')
          db.prepare('UPDATE write_reconciliations SET evidence_id = ? WHERE id = ?').run(
            secondRead.ref.id,
            rows[0]!.id!,
          );
        if (site === 'previous row')
          db.prepare('UPDATE write_reconciliations SET created_at = ? WHERE id = ?').run(
            original.endedAt,
            rows[1]!.id!,
          );
        if (site === 'raw result schema') {
          const result = structuredClone(last.result) as any;
          result.schema = 'native-short-metadata-closure/v2';
          db.prepare('UPDATE jobs SET result_json = ? WHERE id = ?').run(
            canonicalJson(result),
            original.id,
          );
        }
        if (site === 'previous pointer') {
          const result = structuredClone(last.result) as any;
          result.originalAudit.previousClosure.reconciliationJobId = firstRead.read.id;
          const bytes = canonicalJson(result);
          db.prepare('UPDATE jobs SET result_json = ? WHERE id = ?').run(bytes, original.id);
          db.prepare('UPDATE write_reconciliations SET result_json = ? WHERE id = ?').run(
            bytes,
            rows[2]!.id!,
          );
        }
        if (site === 'fully forged first pointer') {
          const pointer = {
            readJobId: secondRead.read.id,
            evidenceId: secondRead.ref.id,
            evidenceHash: secondRead.ref.sha256,
          };
          nativeStoreResignLater(f, lastRead, (d) => {
            d.payload.originalAudit.originalAttemptEvidence = pointer;
          });
          const ref = f.store.listEvidence(lastRead.read.id)[0]!;
          const result = structuredClone(last.result) as NativeShortClosure;
          result.originalAttemptEvidence = pointer;
          result.originalAudit = (
            f.store.readEvidence(ref).payload as { originalAudit: NativeShortOriginalAudit }
          ).originalAudit;
          result.evidence = ref;
          result.result.evidenceHash = ref.sha256;
          const bytes = canonicalJson(result);
          db.prepare('UPDATE jobs SET result_json = ? WHERE id = ?').run(bytes, original.id);
          db.prepare('UPDATE write_reconciliations SET result_json = ? WHERE id = ?').run(
            bytes,
            rows[2]!.id!,
          );
        }
        if (site === 'first audit')
          nativeStoreResignLater(f, firstRead, (d) => {
            d.payload.originalAudit.originalEndedAt = first.endedAt;
          });
        if (site === 'external evidence')
          writeFileSync(path.join(f.options.evidenceDirectory, lastRead.ref.path), 'missing proof');
        for (const read of [
          () => f.store.getJob(original.id),
          () => f.store.listJobs('author'),
          () =>
            f.store.findIdempotent('author', 'write', original.operation, original.idempotencyKey!),
          () =>
            f.store.createJob({
              accountId: 'author',
              kind: 'write',
              operation: original.operation,
              scope: original.scope,
              idempotencyKey: original.idempotencyKey!,
              inputHash: original.inputHash,
            }),
        ])
          assert.throws(read, {
            code: 'capability_unavailable',
            message: 'Native short metadata reconciliation is unavailable.',
          });
        await f.queue.drainAndStop();
        f.store.close();
        const reopened = new Store(f.options);
        try {
          assert.throws(() => reopened.getJob(original.id), { code: 'capability_unavailable' });
        } finally {
          reopened.close();
        }
      } finally {
        await f.cleanup();
      }
    });
});

test('C3 native reconciliation Store cannot settle complete legitimate fixture observations or reload forged fixture closures', async (t) => {
  const injected = { executor: 'dependency-injected-browser/v1', mode: 'fixture' } as const;
  for (const [name, baselineProvenance, laterProvenance] of [
    ['fixture both', injected, injected],
    ['fixture baseline live later', injected, nativeStoreProvenance],
    ['live baseline fixture later', nativeStoreProvenance, injected],
  ] as const)
    await t.test(name, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f, baselineProvenance),
          later = await nativeStoreLater(
            f,
            original,
            nativeStoreSnapshot('After'),
            laterProvenance,
          );
        // The pure helper intentionally accepts the complete safe synthetic view;
        // the Store must independently reject its use for durable settlement.
        assert.equal(later.resolution.status, 'succeeded');
        assertNativeStoreRejected(f, original, later);
      } finally {
        await f.cleanup();
      }
    });
  await t.test('saved and restart fixture closure', async () => {
    const f = fixture(30_000, 'live');
    try {
      const original = await nativeStoreOriginal(f, injected),
        later = await nativeStoreLater(f, original, nativeStoreSnapshot('After'), injected);
      const audit = (later.document.payload as { originalAudit: NativeShortOriginalAudit })
        .originalAudit;
      const closure: NativeShortClosure = {
        schema: 'native-short-metadata-closure/v1',
        target: audit.target,
        reconciliationJobId: later.read.id,
        evidence: later.ref,
        observedStatus: 'draft_saved',
        result: later.resolution.result,
        originalAudit: audit,
        originalAttemptEvidence: {
          readJobId: later.read.id,
          evidenceId: later.ref.id,
          evidenceHash: later.ref.sha256,
        },
      };
      const bytes = canonicalJson(closure),
        now = new Date().toISOString(),
        db = nativeStoreDb(f);
      db.prepare(
        'INSERT INTO write_reconciliations(id,original_job_id,read_job_id,evidence_id,status,created_at,result_json) VALUES(?,?,?,?,?,?,?)',
      ).run(
        '00000000-0000-0000-0000-000000000009',
        original.id,
        later.read.id,
        later.ref.id,
        'succeeded',
        now,
        bytes,
      );
      db.prepare(
        'UPDATE jobs SET status = ?, result_json = ?, error_json = NULL, ended_at = ?, updated_at = ? WHERE id = ?',
      ).run('succeeded', bytes, now, now, original.id);
      assert.throws(() => f.store.getJob(original.id), { code: 'capability_unavailable' });
      await f.queue.drainAndStop();
      f.store.close();
      const reopened = new Store(f.options);
      try {
        assert.throws(() => reopened.getJob(original.id), { code: 'capability_unavailable' });
      } finally {
        reopened.close();
      }
    } finally {
      await f.cleanup();
    }
  });
});
