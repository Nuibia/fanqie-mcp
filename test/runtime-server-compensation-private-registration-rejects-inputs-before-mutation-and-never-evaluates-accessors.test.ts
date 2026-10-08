import test from 'node:test';

import { fixture, digest } from './helpers/runtime-deferred.js';

import assert from 'node:assert/strict';

import { RuntimeError, canonicalJson, Store } from '../src/runtime/store.js';

import {
  nativeStoreDb,
  nativeStoreRowCount,
  nativeStoreProvenance,
  nativeStoreSnapshot,
} from './helpers/runtime-recovery-baseline.js';

import { nativeStoreOriginal, nativeStoreLater } from './helpers/runtime-native-store-original.js';

import { type NativeShortClosure } from '../src/platform/short-native-metadata-proof.js';

test('server compensation private registration rejects inputs before mutation and never evaluates accessors', async (t) => {
  const inputs: unknown[] = [
    null,
    {},
    { schema: 'native-short-metadata-compensation-registration-input/v999' },
    {
      schema: 'native-short-metadata-compensation-registration-input/v1',
      accountId: 'author',
      originalJobId: 'missing',
      operatorJobId: 'missing',
      authority: {},
      approvedAt: new Date().toISOString(),
      effectsEndedAt: new Date().toISOString(),
      target: { kind: 'short-story', id: '7000000001' },
    },
  ];
  for (const [index, input] of inputs.entries())
    await t.test(String(index), async () => {
      const f = fixture(30_000, 'live');
      try {
        const before = f.store.listJobs();
        assert.throws(
          () => f.store.registerNativeCompensationAttestation(input),
          (e: unknown) => e instanceof RuntimeError && e.code === 'capability_unavailable',
        );
        assert.deepEqual(f.store.listJobs(), before);
        assert.equal(nativeStoreDb(f).prepare('SELECT count(*) AS n FROM evidence').get()!.n, 0);
        assert.equal(nativeStoreDb(f).prepare('SELECT count(*) AS n FROM manifests').get()!.n, 0);
        assert.equal(
          nativeStoreDb(f).prepare('SELECT count(*) AS n FROM current_manifests').get()!.n,
          0,
        );
      } finally {
        await f.cleanup();
      }
    });
  await t.test('getter', async () => {
    const f = fixture(30_000, 'live');
    let invoked = 0;
    try {
      const input: Record<string, unknown> = {};
      Object.defineProperty(input, 'schema', {
        enumerable: true,
        get() {
          invoked++;
          return 'native-short-metadata-compensation-registration-input/v1';
        },
      });
      assert.throws(() => f.store.registerNativeCompensationAttestation(input));
      assert.equal(invoked, 0);
      assert.equal(f.store.listJobs().length, 0);
    } finally {
      await f.cleanup();
    }
  });
});

test('server compensation absent registry preserves ordinary v1 while damaged reserved markers cannot fall back', async (t) => {
  await t.test('absent', async () => {
    const f = fixture(30_000, 'live');
    try {
      const original = await nativeStoreOriginal(f);
      assert.equal(f.store.getNativeCompensationContext(original.id), null);
      const later = await nativeStoreLater(f, original);
      const closed = f.store.reconcileWriteJob(original.id, later.read.id, later.resolution);
      assert.equal(closed.status, 'succeeded');
      assert.equal(
        (closed.result as NativeShortClosure).schema,
        'native-short-metadata-closure/v1',
      );
    } finally {
      await f.cleanup();
    }
  });
  for (const mutation of [
    'scope',
    'metadata',
    'account',
    'missing linkage',
    'future original',
  ] as const)
    await t.test(mutation, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          before = f.store.getJob(original.id);
        if (mutation === 'future original')
          nativeStoreDb(f)
            .prepare('UPDATE jobs SET metadata_json=? WHERE id=?')
            .run(
              canonicalJson({
                extra: { schema: 'native-short-metadata-compensation-future/v999' },
              }),
              original.id,
            );
        else {
          const registry = f.store.createJob({
            accountId: 'author',
            kind: 'read',
            operation: 'generic_read',
            datasets: ['works'],
          }).job;
          const metadata = {
            schema: 'native-short-metadata-compensation-registration-job/v1',
            originalJobId: original.id,
            operatorJobId: 'missing',
            authorityHash: '0'.repeat(64),
            policyHash: '0'.repeat(64),
          };
          nativeStoreDb(f)
            .prepare(
              'UPDATE jobs SET operation=?,scope=?,idempotency_key=?,metadata_json=? WHERE id=?',
            )
            .run(
              'register_native_compensation_attestation',
              'native_compensation_attestation.' + digest(original.id).slice(0, 32),
              original.id,
              canonicalJson(metadata),
              registry.id,
            );
          if (mutation === 'scope')
            nativeStoreDb(f)
              .prepare('UPDATE jobs SET scope=? WHERE id=?')
              .run('wrong_scope', registry.id);
          if (mutation === 'metadata')
            nativeStoreDb(f)
              .prepare('UPDATE jobs SET metadata_json=? WHERE id=?')
              .run(canonicalJson({ ...metadata, operatorJobId: 'different' }), registry.id);
          if (mutation === 'account')
            nativeStoreDb(f)
              .prepare('UPDATE jobs SET account_id=? WHERE id=?')
              .run('other', registry.id);
          if (mutation === 'missing linkage')
            nativeStoreDb(f)
              .prepare('UPDATE jobs SET scope=?,idempotency_key=NULL,metadata_json=? WHERE id=?')
              .run(
                'native_compensation_attestation.corrupt',
                canonicalJson({ schema: metadata.schema }),
                registry.id,
              );
          assert.throws(() => f.store.getJob(registry.id));
        }
        assert.throws(
          () => f.store.getNativeCompensationContext(original.id),
          (e: unknown) => e instanceof RuntimeError && e.code === 'capability_unavailable',
        );
        const raw = nativeStoreDb(f)
          .prepare('SELECT status,result_json,error_json,ended_at FROM jobs WHERE id=?')
          .get(original.id)!;
        assert.equal(raw.status, before!.status);
        assert.equal(raw.result_json, canonicalJson(before!.result));
        assert.equal(raw.error_json, canonicalJson(before!.error));
        assert.equal(raw.ended_at, before!.endedAt);
        assert.equal(nativeStoreRowCount(f), 0);
      } finally {
        await f.cleanup();
      }
    });
});

test('server compensation terminal signals require the actual SQL closure even after row removal', async (t) => {
  for (const kind of ['known closure', 'future closure', 'business only', 'error only'] as const)
    await t.test(kind, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f);
        const result =
          kind === 'business only'
            ? { schema: 'fanqie-short-native-metadata-compensation-business/v1' }
            : kind === 'error only'
              ? original.result
              : {
                  schema:
                    'native-short-metadata-compensated-closure/' +
                    (kind === 'future closure' ? 'v999' : 'v1'),
                };
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET status=?,result_json=?,error_json=? WHERE id=?')
          .run(
            'failed',
            canonicalJson(result),
            canonicalJson(
              kind === 'error only'
                ? { code: 'native_write_compensated', message: 'synthetic' }
                : original.error,
            ),
            original.id,
          );
        const unavailable = (error: unknown) =>
          error instanceof RuntimeError && error.code === 'capability_unavailable';
        assert.throws(() => f.store.getJob(original.id), unavailable);
        assert.throws(() => f.store.listJobs('author'), unavailable);
        assert.throws(
          () =>
            f.store.findIdempotent('author', 'write', original.operation, original.idempotencyKey!),
          unavailable,
        );
        assert.equal(nativeStoreRowCount(f), 0);
      } finally {
        await f.cleanup();
      }
    });
});

test('server compensation targeted registry lookup cannot be hidden after unrelated administrative history', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await nativeStoreOriginal(f);
    for (let index = 0; index < 3; index++) {
      const job = f.store.createJob({
        accountId: 'author',
        kind: 'read',
        operation: 'generic_read',
        datasets: ['works'],
      }).job;
      const originalJobId = index < 2 ? 'other-original-' + index : original.id;
      nativeStoreDb(f)
        .prepare('UPDATE jobs SET operation=?,scope=?,idempotency_key=?,metadata_json=? WHERE id=?')
        .run(
          'register_native_compensation_attestation',
          'native_compensation_attestation.' + digest(originalJobId).slice(0, 32),
          originalJobId,
          canonicalJson({
            schema: 'native-short-metadata-compensation-registration-job/v1',
            originalJobId,
            operatorJobId: 'missing',
            authorityHash: '0'.repeat(64),
            policyHash: '0'.repeat(64),
          }),
          job.id,
        );
    }
    assert.throws(
      () => f.store.getNativeCompensationContext(original.id),
      (e: unknown) => e instanceof RuntimeError && e.code === 'capability_unavailable',
    );
    assert.equal(nativeStoreRowCount(f), 0);
  } finally {
    await f.cleanup();
  }
});

test('server compensation ordinary v2 Store uses persisted carrier dispatch through unknown rounds and restart', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await nativeStoreOriginal(f, nativeStoreProvenance, 2);
    const unchanged = nativeStoreSnapshot('Before', (edit) => {
      edit.latest_version = 10;
      edit.modify_time = '1000000000';
    });
    const firstRead = await nativeStoreLater(f, original, unchanged);
    const first = f.store.reconcileWriteJob(original.id, firstRead.read.id, firstRead.resolution);
    assert.equal(first.status, 'uncertain');
    assert.equal((first.result as NativeShortClosure).schema, 'native-short-metadata-closure/v2');
    const restored = nativeStoreSnapshot('After', (edit) => {
      edit.latest_version = 11;
      edit.modify_time = '1000000001';
    });
    const later = await nativeStoreLater(f, first, restored);
    const closed = f.store.reconcileWriteJob(original.id, later.read.id, later.resolution);
    assert.equal(closed.status, 'succeeded');
    assert.equal((closed.result as NativeShortClosure).schema, 'native-short-metadata-closure/v2');
    assert.equal(
      (closed.result as NativeShortClosure).originalAudit.schema,
      'native-short-metadata-original-audit/v2',
    );
    assert.equal(
      (closed.result as NativeShortClosure).originalAudit.originalEndedAt,
      original.endedAt,
    );
    assert.equal(nativeStoreRowCount(f), 2);
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      assert.deepEqual(reopened.getJob(original.id), closed);
      assert.deepEqual(
        reopened.findIdempotent('author', 'write', original.operation, original.idempotencyKey!),
        closed,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});
