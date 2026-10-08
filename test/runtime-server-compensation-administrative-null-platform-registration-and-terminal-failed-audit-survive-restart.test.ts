import test from 'node:test';

import { nativeCompensationFixture } from './helpers/runtime-native-compensation-fixture.js';

import assert from 'node:assert/strict';

import { digest } from './helpers/runtime-deferred.js';

import {
  nativeCompensationLater,
  nativeCompensationFiles,
} from './helpers/runtime-native-compensation-later.js';

import { nativeStoreRowCount, nativeStoreDb } from './helpers/runtime-recovery-baseline.js';

import { canonicalJson, Store, RuntimeError } from '../src/runtime/store.js';

test('server compensation administrative null-platform registration and terminal-failed audit survive restart', async (t) => {
  for (const withHistory of [true, false])
    await t.test(withHistory ? 'prior ordinary unknown' : 'no ordinary history', async () => {
      const f = await nativeCompensationFixture(withHistory);
      try {
        const oldCurrent = f.store.getCurrent('author'),
          originalBefore = f.store.getJob(f.original.id);
        const registry = f.store.registerNativeCompensationAttestation(f.input);
        assert.equal(registry.kind, 'read');
        assert.equal(registry.platformReadStartedAt, null);
        assert.equal(registry.platformWriteStartedAt, null);
        assert.deepEqual(f.store.getJob(f.original.id), originalBefore);
        assert.deepEqual(f.store.getCurrent('author'), oldCurrent);
        assert.equal(f.store.listEvidence(registry.id).length, 1);
        assert.equal(
          registry.scope,
          'native_compensation_attestation.' + digest(f.original.id).slice(0, 32),
        );
        const privateManifest = (registry.result as any).manifest;
        assert.equal(
          privateManifest.schema,
          'native-short-metadata-compensation-registration-manifest/v1',
        );
        assert.equal(privateManifest.platformReadStartedAt, null);
        assert.equal(privateManifest.platformWriteStartedAt, null);
        assert.deepEqual(f.store.getManifestForJob('author', registry.id), privateManifest);
        const later = await nativeCompensationLater(f),
          closed = f.store.reconcileWriteJob(f.original.id, later.read.id, later.resolution);
        assert.equal(closed.status, 'failed');
        assert.equal(closed.error!.code, 'native_write_compensated');
        assert.equal((closed.result as any).result.originalOutcome, 'unknown');
        assert.equal((closed.result as any).result.compensationOutcome, 'verified_restored');
        assert.equal((closed.result as any).originalAudit.originalEndedAt, f.initial.endedAt);
        assert.equal((closed.result as any).originalAudit.priorEndedAt, f.original.endedAt);
        assert.equal(nativeStoreRowCount(f), withHistory ? 2 : 1);
        const row = nativeStoreDb(f)
          .prepare(
            'SELECT * FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid DESC LIMIT 1',
          )
          .get(f.original.id)!;
        assert.equal(row.status, 'failed');
        assert.equal(row.result_json, canonicalJson(closed.result));
        assert.equal(row.created_at, closed.endedAt);
        assert.equal(closed.updatedAt, closed.endedAt);
        const rows = nativeStoreRowCount(f);
        assert.throws(() =>
          f.store.reconcileWriteJob(f.original.id, later.read.id, later.resolution),
        );
        assert.equal(nativeStoreRowCount(f), rows);
        assert.deepEqual(
          f.store.findIdempotent('author', 'write', closed.operation, closed.idempotencyKey!),
          closed,
        );
        await f.queue.drainAndStop();
        f.store.close();
        const reopened = new Store(f.options);
        try {
          assert.deepEqual(reopened.getJob(closed.id), closed);
          assert.deepEqual(reopened.getJob(registry.id), registry);
          assert.deepEqual(reopened.getManifestForJob('author', registry.id), privateManifest);
          assert.deepEqual(
            reopened.listJobs('author').find((job) => job.id === closed.id),
            closed,
          );
          assert.equal(
            reopened.getNativeCompensationContext(closed.id)!.authority.source
              .registrationInventory['test/runtime.test.ts'],
            f.authority.source.registrationInventory['test/runtime.test.ts'],
          );
        } finally {
          reopened.close();
        }
      } finally {
        await f.cleanup();
      }
    });
});

test('server compensation approved operator-before null target rejects a nonnull synthetic binding', async () => {
  const f = await nativeCompensationFixture();
  try {
    assert.equal(f.store.getJob(f.operatorBefore.id)!.target, null);
    const beforeOriginal = f.store.getJob(f.original.id),
      beforeJobs = f.store.listJobs().length;
    const beforeReferences = nativeStoreDb(f)
      .prepare('SELECT COUNT(*) AS count FROM evidence')
      .get()!.count;
    // Even the original write's typed target is invalid here: the approved
    // actor never recorded it on this separate read. It cannot be invented.
    nativeStoreDb(f)
      .prepare('UPDATE jobs SET target_json=? WHERE id=?')
      .run(canonicalJson(f.original.target), f.operatorBefore.id);
    assert.throws(
      () => f.store.registerNativeCompensationAttestation(f.input),
      (error: any) => error.code === 'capability_unavailable',
    );
    assert.equal(f.store.listJobs().length, beforeJobs);
    assert.equal(
      nativeStoreDb(f).prepare('SELECT COUNT(*) AS count FROM evidence').get()!.count,
      beforeReferences,
    );
    assert.deepEqual(f.store.getJob(f.original.id), beforeOriginal);
    assert.equal(f.store.getNativeCompensationContext(f.original.id), null);
  } finally {
    await f.cleanup();
  }
});

test('server compensation administrative SQL faults roll back every row and unpublished file without current promotion', async (t) => {
  for (const table of ['jobs', 'evidence', 'manifests'])
    await t.test(table, async () => {
      const f = await nativeCompensationFixture();
      try {
        const before = nativeStoreDb(f).prepare('SELECT count(*) AS n FROM jobs').get()!.n,
          files = nativeCompensationFiles(f.options.evidenceDirectory),
          current = f.store.getCurrent('author'),
          original = f.store.getJob(f.original.id);
        let fired = 0;
        nativeStoreDb(f).function('registration_fault_probe', () => {
          fired++;
          return 1;
        });
        nativeStoreDb(f).exec(
          `CREATE TRIGGER fail_registration BEFORE INSERT ON ${table} BEGIN SELECT registration_fault_probe(); SELECT RAISE(ABORT, 'synthetic registration fault'); END`,
        );
        assert.throws(
          () => f.store.registerNativeCompensationAttestation(f.input),
          (error: unknown) =>
            error instanceof RuntimeError && error.code === 'capability_unavailable',
        );
        assert.equal(fired, 1, 'The intended SQL mutation boundary must actually be reached.');
        assert.equal(nativeStoreDb(f).prepare('SELECT count(*) AS n FROM jobs').get()!.n, before);
        assert.deepEqual(nativeCompensationFiles(f.options.evidenceDirectory), files);
        assert.deepEqual(f.store.getCurrent('author'), current);
        assert.deepEqual(f.store.getJob(f.original.id), original);
        assert.equal(f.store.getNativeCompensationContext(f.original.id), null);
      } finally {
        await f.cleanup();
      }
    });
});

test('server compensation registry rejects untrusted receipts, source inventories and duplicate registration', async (t) => {
  for (const mutation of [
    'actor binary',
    'controller binary',
    'policy',
    'execution identity',
    'current source',
    'receipt hash',
    'receipt once',
    'effects future',
  ])
    await t.test(mutation, async () => {
      const f = await nativeCompensationFixture();
      try {
        const input = structuredClone(f.input);
        if (mutation === 'actor binary') input.authority.actor.sha256 = '0'.repeat(64);
        if (mutation === 'controller binary') input.authority.controller.sha256 = '0'.repeat(64);
        if (mutation === 'policy') input.authority.policy.sha256 = '0'.repeat(64);
        if (mutation === 'execution identity')
          input.authority.source.executionInventory['src/application.ts'] = '0'.repeat(64);
        if (mutation === 'current source')
          input.authority.source.registrationInventory['src/runtime/store.ts'] = '0'.repeat(64);
        if (mutation === 'receipt hash') input.authority.receipts.actor.sha256 = '0'.repeat(64);
        if (mutation === 'receipt once') {
          const actor = JSON.parse(input.authority.receipts.actor.bytes);
          actor.postAttempts = 2;
          input.authority.receipts.actor.bytes = canonicalJson(actor) + '\n';
          input.authority.receipts.actor.sha256 = digest(input.authority.receipts.actor.bytes);
          const controller = JSON.parse(input.authority.receipts.controller.bytes);
          controller.operatorSafe = actor;
          controller.operatorOutputSafe.sha256 = input.authority.receipts.actor.sha256;
          input.authority.receipts.controller.bytes = canonicalJson(controller) + '\n';
          input.authority.receipts.controller.sha256 = digest(
            input.authority.receipts.controller.bytes,
          );
        }
        if (mutation === 'effects future')
          input.approvedAt = input.effectsEndedAt = new Date(Date.now() + 60000).toISOString();
        const before = f.store.getJob(f.original.id),
          files = nativeCompensationFiles(f.options.evidenceDirectory);
        assert.throws(() => f.store.registerNativeCompensationAttestation(input));
        assert.equal(f.store.getNativeCompensationContext(f.original.id), null);
        assert.deepEqual(f.store.getJob(f.original.id), before);
        assert.deepEqual(nativeCompensationFiles(f.options.evidenceDirectory), files);
      } finally {
        await f.cleanup();
      }
    });
  await t.test('duplicate', async () => {
    const f = await nativeCompensationFixture();
    try {
      const registry = f.store.registerNativeCompensationAttestation(f.input),
        files = nativeCompensationFiles(f.options.evidenceDirectory);
      assert.throws(() => f.store.registerNativeCompensationAttestation(f.input));
      assert.deepEqual(f.store.getJob(registry.id), registry);
      assert.deepEqual(nativeCompensationFiles(f.options.evidenceDirectory), files);
    } finally {
      await f.cleanup();
    }
  });
});

test('server compensation settlement requires a fresh exact read and SQL INSERT plus UPDATE commit together', async (t) => {
  for (const fault of ['stale ordinary read', 'caller success', 'caller raw', 'insert', 'update'])
    await t.test(fault, async () => {
      const f = await nativeCompensationFixture();
      try {
        f.store.registerNativeCompensationAttestation(f.input);
        const later = await nativeCompensationLater(f),
          before = f.store.getJob(f.original.id),
          count = nativeStoreRowCount(f);
        let readId = later.read.id,
          resolution: Parameters<Store['reconcileWriteJob']>[2] = later.resolution,
          fired = 0;
        if (fault === 'stale ordinary read')
          readId = String(
            nativeStoreDb(f)
              .prepare(
                'SELECT read_job_id FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid LIMIT 1',
              )
              .get(f.original.id)!.read_job_id,
          );
        if (fault === 'caller success')
          resolution = { status: 'succeeded', result: later.resolution.result };
        if (fault === 'caller raw')
          resolution = {
            status: 'failed',
            result: { ...later.resolution.result, raw: 'SYNTHETIC_PRIVATE_BODY' },
          };
        if (fault === 'insert' || fault === 'update') {
          nativeStoreDb(f).function('settlement_fault_probe', () => {
            fired++;
            return 1;
          });
          nativeStoreDb(f).exec(
            fault === 'insert'
              ? "CREATE TRIGGER fail_settlement BEFORE INSERT ON write_reconciliations BEGIN SELECT settlement_fault_probe(); SELECT RAISE(ABORT, 'synthetic insert fault'); END"
              : "CREATE TRIGGER fail_settlement BEFORE UPDATE ON jobs WHEN NEW.status='failed' BEGIN SELECT settlement_fault_probe(); SELECT RAISE(ABORT, 'synthetic update fault'); END",
          );
        }
        assert.throws(() => f.store.reconcileWriteJob(f.original.id, readId, resolution));
        if (fault === 'insert' || fault === 'update') assert.equal(fired, 1);
        assert.equal(nativeStoreRowCount(f), count);
        assert.deepEqual(f.store.getJob(f.original.id), before);
      } finally {
        await f.cleanup();
      }
    });
});
