import test from 'node:test';

import { r6RuntimeFixture, r6Db, r6Begin } from './helpers/runtime-native-compensation-later.js';

import {
  r6LegacyUnknownRoot,
  r6SavedRead,
  r6RewriteReadDocument,
  r6Unavailable,
  r6Advance,
} from './helpers/runtime-r6-advance.js';

import {
  r6OtherRootSettlement,
  r6HistoricalEventFamily,
  r6EventRows,
} from './helpers/runtime-r6-resume-intent.js';

import assert from 'node:assert/strict';

import { readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import { canonicalJson } from '../src/runtime/store.js';

import { digest, recoveryTarget } from './helpers/runtime-deferred.js';

test('R6 complete same-target other-root ledger audits remain disjoint while missing head or partial legacy prefix refuses old A', async () => {
  for (const corruption of ['modern-head', 'legacy-first', 'legacy-last'] as const) {
    const f = r6RuntimeFixture();
    try {
      const root = r6LegacyUnknownRoot(f),
        savedA = r6SavedRead(f, root, 1),
        other = await r6OtherRootSettlement(f, corruption !== 'modern-head'),
        savedB = r6SavedRead(f, other, 4),
        audit = savedB.payload.originalAudit;
      assert.ok(audit);
      assert.equal(audit.schema, 'generic-short-terminal-publication-bridge/v1');
      assert.equal(other.status, 'succeeded');
      assert.equal(
        (audit.effectHistory as { kind: string }).kind,
        corruption === 'modern-head' ? 'modern-ledger' : 'legacy-ledger',
      );
      assert.equal(
        f.store.genericShortPublication(other.id, 'author').statusEvidence?.id,
        savedB.ref.id,
      );
      assert.equal(
        f.store.genericShortPublication(root.id, 'author').statusEvidence?.id,
        savedA.ref.id,
      );
      const beforeRoot = f.store.getJob(root.id),
        beforeOther = f.store.getJob(other.id),
        beforeLedger = r6Db(f)
          .prepare('SELECT * FROM write_reconciliations WHERE original_job_id=?')
          .all(other.id);
      r6RewriteReadDocument(f, savedB.ref, (payload) => {
        const effect = payload.originalAudit.effectHistory as Record<string, unknown>;
        if (corruption === 'modern-head') delete effect.head;
        else
          delete (effect.prefix as Record<string, unknown>)[
            corruption === 'legacy-first' ? 'first' : 'last'
          ];
      });
      assert.throws(() => f.store.genericShortPublication(root.id, 'author'), r6Unavailable);
      assert.throws(() => f.store.genericShortProjection(root.id, 'author'), r6Unavailable);
      assert.deepEqual(f.store.getJob(root.id), beforeRoot);
      assert.deepEqual(f.store.getJob(other.id), beforeOther);
      assert.deepEqual(
        r6Db(f)
          .prepare('SELECT * FROM write_reconciliations WHERE original_job_id=?')
          .all(other.id),
        beforeLedger,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('R6 historical creation event authenticates old members and refuses stable closed time or prior corruption', async () => {
  for (const variant of [
    'root-ended',
    'member-ended',
    'partial-prior',
    'nonmember',
    'other-account',
  ] as const) {
    const f = r6RuntimeFixture();
    try {
      const p = await r6HistoricalEventFamily(f),
        db = r6Db(f),
        account = p.original.accountId,
        old = [p.recovery, p.first];
      for (const prior of old) {
        const actual = f.store.getJob(prior.id)!,
          rows = r6EventRows(f),
          bytes = f.store
            .listEvidence(prior.id)
            .map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path))),
          event = f.store.genericShortCreationEventProjection(prior.id, account);
        assert.deepEqual(event.job, {
          ...actual,
          state: 'unknown',
          statusFacts: null,
          statusSource: null,
          statusEvidence: null,
        });
        assert.equal(event.job.status, 'failed');
        assert.equal(event.job.endedAt, prior.endedAt);
        assert.deepEqual(event.evidence, f.store.listEvidence(prior.id));
        assert.deepEqual(r6EventRows(f), rows);
        assert.deepEqual(
          f.store
            .listEvidence(prior.id)
            .map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path))),
          bytes,
        );
        assert.throws(() => f.store.genericShortProjection(prior.id, account), {
          code: 'creation_repair_conflict',
        });
      }
      if (variant === 'root-ended')
        db.prepare('UPDATE jobs SET ended_at=? WHERE id=?').run(
          '2025-01-01T00:00:00.000Z',
          p.original.id,
        );
      else if (variant === 'member-ended')
        db.prepare('UPDATE jobs SET ended_at=? WHERE id=?').run(
          '2025-01-01T00:00:00.000Z',
          p.first.id,
        );
      else if (variant === 'partial-prior') {
        const row = db
            .prepare('SELECT * FROM creation_repair_successors WHERE previous_repair_job_id = ?')
            .get(p.first.id)!,
          prior = JSON.parse(String(row.prior_json));
        delete prior.recovery;
        db.prepare(
          'UPDATE creation_repair_successors SET prior_json=? WHERE previous_repair_job_id=?',
        ).run(canonicalJson(prior), p.first.id);
      }
      const before = r6EventRows(f);
      if (variant === 'other-account')
        assert.throws(
          () => f.store.genericShortCreationEventProjection(p.first.id, 'other-synthetic-account'),
          r6Unavailable,
        );
      else if (variant === 'nonmember') {
        const other = f.store.createJob({
          accountId: account,
          kind: 'write',
          operation: 'update_draft',
          idempotencyKey: 'r6-event-nonmember',
          inputHash: digest('r6-event-nonmember'),
        }).job;
        assert.throws(
          () => f.store.genericShortCreationEventProjection(other.id, account),
          r6Unavailable,
        );
      } else {
        assert.throws(
          () => f.store.genericShortCreationEventProjection(p.first.id, account),
          r6Unavailable,
        );
        assert.throws(
          () => f.store.genericShortCreationEventProjection(p.recovery.id, account),
          r6Unavailable,
        );
        assert.deepEqual(r6EventRows(f), before);
      }
    } finally {
      await f.cleanup();
    }
  }
});

test('R6 historical event audits full raw attempts and final physical files without granting an older member current authority', async (t) => {
  for (const variant of ['capture_failed', 'persist_failed', 'disjoint', 'final-file'] as const) {
    const f = r6RuntimeFixture();
    try {
      const p = await r6HistoricalEventFamily(f),
        account = p.original.accountId;
      if (variant === 'final-file') {
        const privateStore = f.store as unknown as {
            genericCreationEvent: (graph: unknown) => unknown;
          },
          check = privateStore.genericCreationEvent.bind(f.store),
          ref = f.store.listEvidence(p.first.id)[0]!;
        let firstChecks = 0;
        t.mock.method(privateStore, 'genericCreationEvent', (graph: unknown) => {
          const value = check(graph);
          if (++firstChecks === 1)
            writeFileSync(
              path.join(f.options.evidenceDirectory, ref.path),
              'SYNTHETIC_EVENT_CHANGED_PHYSICAL_BYTES',
            );
          return value;
        });
        assert.throws(
          () => f.store.genericShortCreationEventProjection(p.first.id, account),
          r6Unavailable,
        );
        assert.equal(firstChecks, 1);
        assert.equal(f.store.getJob(p.first.id)!.status, 'failed');
        continue;
      }
      let original = f.store.getJob(p.first.id)!;
      if (variant === 'disjoint') {
        const queued = f.store.createJob({
          accountId: account,
          kind: 'write',
          operation: 'update_draft',
          idempotencyKey: 'r6-event-other-root',
          inputHash: digest('r6-event-other-root'),
        }).job;
        f.store.startJob(queued.id);
        f.store.markPlatformReadStarted(queued.id);
        f.store.recordTarget(queued.id, recoveryTarget);
        f.store.saveEvidence(queued.id, 'write-intent', {
          target: recoveryTarget,
          desiredContentHash: digest('r6-event-other-desired'),
          expectedStates: ['draft_saved'],
        });
        f.store.markPlatformWriteStarted(queued.id);
        original = f.store.failJob(queued.id, {
          code: 'outcome_unknown',
          message: 'Synthetic same-target other root.',
        });
      }
      const b = r6Begin(f, original);
      r6Advance(
        f,
        b,
        variant === 'persist_failed' ? 'persist_failed' : 'capture_failed',
        undefined,
        'later_read',
        variant === 'persist_failed' ? 'persist_failed' : 'capture_failed',
      );
      f.store.failJob(b.job.id, {
        code: 'capability_unavailable',
        message: 'Synthetic event newer no-M11 read failure.',
      });
      assert.equal(f.store.getManifestForJob(account, b.job.id), null);
      assert.deepEqual(f.store.listEvidence(b.job.id), []);
      const before = r6EventRows(f);
      if (variant === 'disjoint') {
        const event = f.store.genericShortCreationEventProjection(p.first.id, account);
        assert.equal(event.job.id, p.first.id);
        assert.deepEqual(event.tuple, {
          state: 'unknown',
          statusFacts: null,
          statusSource: null,
          statusEvidence: null,
        });
      } else
        assert.throws(
          () => f.store.genericShortCreationEventProjection(p.first.id, account),
          r6Unavailable,
        );
      assert.deepEqual(r6EventRows(f), before);
      assert.throws(() => f.store.genericShortProjection(p.first.id, account), {
        code: 'creation_repair_conflict',
      });
    } finally {
      t.mock.restoreAll();
      await f.cleanup();
    }
  }
});
