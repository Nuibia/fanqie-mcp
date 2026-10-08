import test from 'node:test';

import {
  a6SavedCorruptionFixture,
  a6SavedBaseline,
  a6RewriteSavedDocument,
  a6SavedRefuses,
  a6SavedSurfaces,
} from './helpers/application-a6-saved-corruption-fixture.js';

import {
  a6NativeDb,
  recoveryAppHash,
  a6RawRows,
  a6EvidenceFiles,
} from './helpers/application-long-book-metadata-application-fixture.js';

import { hashDraftContent as recoveryContentHash } from '../src/platform/writes.js';

import assert from 'node:assert/strict';

import {
  Store as CreationRecoveryStore,
  RuntimeError as R6AppRuntimeError,
  canonicalJson as recoveryCanonicalJson,
} from '../src/runtime/store.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

test('R6 A6 App related raw no-M11 failures and indeterminate other-root audit refuse all saved routes while complete Q remains disjoint', async (t) => {
  for (const variant of [
    'capture_failed',
    'persist_failed',
    'damaged-input',
    'damaged-scope',
    'other-root',
    'indeterminate',
  ] as const)
    await t.test(variant, async (variantTest) => {
      const p = await a6SavedCorruptionFixture(variantTest);
      try {
        await a6SavedBaseline(p);
        const { f, o } = p,
          db = a6NativeDb(o.store);
        if (variant === 'other-root' || variant === 'indeterminate') {
          const beforeRoot = (await o.run(() =>
              f.invoke('get_job', { jobId: f.original.id }),
            )) as Record<string, any>,
            target = { kind: 'short-story' as const, id: '1234567890123456789' };
          const queued = o.store.createJob({
            accountId: f.config.accountId,
            kind: 'write',
            operation: 'update_draft',
            idempotencyKey: 'a6-same-target-other-root',
            inputHash: recoveryAppHash('a6 other-root input'),
          }).job;
          o.store.startJob(queued.id);
          o.store.markPlatformReadStarted(queued.id);
          o.store.recordTarget(queued.id, target);
          o.store.saveEvidence(queued.id, 'write-intent', {
            target,
            desiredContentHash: recoveryContentHash(f.input.content),
            expectedStates: ['draft_saved'],
          });
          o.store.markPlatformWriteStarted(queued.id);
          o.store.failJob(queued.id, {
            code: 'outcome_unknown',
            message: 'Synthetic other-root unknown.',
          });
          await assert.rejects(
            o.run(() => f.invoke('reconcile_write', { jobId: queued.id }), false),
            { code: 'reconciliation_not_live' },
          );
          const read = o
            .records('reconcile_write')
            .find(
              (value) =>
                (value.refs[0]?.document.payload as Record<string, any> | undefined)?.reconciliation
                  ?.originalJobId === queued.id,
            );
          assert(read);
          assert.equal(read.row.status, 'succeeded');
          assert.equal(read.manifestCount, 1);
          assert.equal(read.metadata.genericShortStatus.stage, 'completed');
          const manifest = o.store.getManifestForJob(f.config.accountId, String(read.row.id));
          assert(manifest);
          await a6SavedBaseline(p, manifest);
          const afterRoot = await o.run(() => f.invoke('get_job', { jobId: f.original.id }));
          assert.deepEqual(
            afterRoot,
            beforeRoot,
            'Other same-target Q must not replace root R publication facts.',
          );
          if (variant === 'indeterminate') {
            const ref = o.store.listEvidence(String(read.row.id))[0]!;
            a6RewriteSavedDocument(p, ref, (payload) => {
              delete payload.originalAudit.priorEvidence;
            });
            await a6SavedRefuses(p, variant, variantTest, manifest);
          }
          return;
        }
        const existing = new Set(o.records('reconcile_write').map((value) => String(value.row.id)));
        if (variant === 'persist_failed') {
          const add = CreationRecoveryStore.prototype.addJobMetadata;
          let injected = false;
          variantTest.mock.method(
            CreationRecoveryStore.prototype,
            'addJobMetadata',
            function (this: CreationRecoveryStore, id: string, values: Record<string, unknown>) {
              const result = add.call(this, id, values),
                witness = values.genericShortStatus as { stage?: unknown } | undefined;
              if (!injected && !existing.has(id) && witness?.stage === 'read_saved') {
                injected = true;
                throw new R6AppRuntimeError(
                  'capability_unavailable',
                  'Synthetic fault after a durable read_saved observation.',
                );
              }
              return result;
            },
          );
          await assert.rejects(
            o.run(() => f.invoke('reconcile_write', { jobId: f.original.id }), false),
            { code: 'capability_unavailable' },
          );
          assert.equal(injected, true);
        } else {
          const display = f.state.displayStatus;
          f.state.displayStatus = Number.NaN;
          try {
            await assert.rejects(
              o.run(() => f.invoke('reconcile_write', { jobId: f.original.id }), false),
              { code: 'capability_unavailable' },
            );
          } finally {
            f.state.displayStatus = display;
          }
        }
        const failed = o
          .records('reconcile_write')
          .filter((value) => !existing.has(String(value.row.id)));
        assert.equal(failed.length, 1);
        const b = failed[0]!;
        assert.equal(b.row.status, variant === 'persist_failed' ? 'partial' : 'failed');
        assert.equal(b.manifestCount, 0);
        assert.equal(
          b.metadata.genericShortStatus.stage,
          variant === 'persist_failed' ? 'persist_failed' : 'capture_failed',
        );
        assert.equal(
          b.metadata.genericShortStatus.failure.kind,
          b.metadata.genericShortStatus.stage,
        );
        assert.equal(b.refs.length, variant === 'persist_failed' ? 1 : 0);
        assert.equal(b.metadata.genericShortStatus.observations.length, b.refs.length);
        if (variant === 'damaged-input')
          db.prepare('UPDATE jobs SET input_hash=? WHERE id=?').run(
            recoveryAppHash('a6 damaged SQL input'),
            b.row.id!,
          );
        if (variant === 'damaged-scope')
          db.prepare('UPDATE jobs SET scope=? WHERE id=?').run('account', b.row.id!);
        await a6SavedRefuses(p, variant, variantTest);
      } finally {
        variantTest.mock.restoreAll();
        await p.f.cleanup();
      }
    });
});

test('R6 A6 App saved surfaces refuse a real final physical change after initial full classification', async (t) => {
  for (const index of [0, 1, 2, 3, 4, 5, 6]) {
    const p = await a6SavedCorruptionFixture(t);
    try {
      await a6SavedBaseline(p);
      const privateStore = p.o.store as unknown as {
        genericSelect: (graph: unknown) => unknown;
        rereadGenericShortPublicationGraph: (plan: unknown) => unknown;
      };
      const classify = privateStore.genericSelect.bind(p.o.store),
        native = privateStore.rereadGenericShortPublicationGraph.bind(p.o.store),
        ref = p.o.store.listEvidence(p.member.id)[0]!;
      let changed = false,
        classified = 0,
        nativeChecks = 0;
      t.mock.method(privateStore, 'genericSelect', (graph: unknown) => {
        const result = classify(graph);
        classified++;
        if (!changed) {
          changed = true;
          writeFileSync(
            path.join(p.f.config.dataDir, 'evidence', ref.path),
            'SYNTHETIC_A6_CHANGED_AFTER_FIRST_CAPTURE',
          );
        }
        return result;
      });
      t.mock.method(privateStore, 'rereadGenericShortPublicationGraph', (plan: unknown) => {
        nativeChecks++;
        return native(plan);
      });
      const surface = a6SavedSurfaces(p)[index]!;
      // This vector deliberately changes a real file inside the request; rows
      // and page state still must not mutate. The injected file is the only diff.
      const beforeRows = a6RawRows(p.o.store),
        beforeState = structuredClone(p.f.state),
        beforeFiles = a6EvidenceFiles(path.join(p.f.config.dataDir, 'evidence'));
      await assert.rejects(surface.run(), { code: 'capability_unavailable' });
      assert.equal(changed, true);
      assert(classified >= 1);
      assert(nativeChecks >= 1, surface.name + ' must reach the final native selector seam');
      assert.deepEqual(a6RawRows(p.o.store), beforeRows);
      assert.deepEqual(p.f.state, beforeState);
      const afterFiles = a6EvidenceFiles(path.join(p.f.config.dataDir, 'evidence'));
      assert.deepEqual(
        afterFiles.filter((file) => file.path !== ref.path),
        beforeFiles.filter((file) => file.path !== ref.path),
      );
      assert.equal(
        afterFiles.find((file) => file.path === ref.path)!.bytes,
        Buffer.from('SYNTHETIC_A6_CHANGED_AFTER_FIRST_CAPTURE').toString('base64'),
      );
    } finally {
      t.mock.restoreAll();
      await p.f.cleanup();
    }
  }
});

test('R6 A6 App original bounded capture depth refuses an actual complete family on all seven saved surfaces before classification', async (t) => {
  const p = await a6SavedCorruptionFixture(t);
  try {
    await a6SavedBaseline(p);
    const { captureShortStatusJson } = await import('../src/platform/short-status.js');
    let nested: unknown = { leaf: 'synthetic-bounded-capture' };
    for (let depth = 0; depth < 45; depth++) nested = { next: nested };
    assert.throws(() => captureShortStatusJson(nested), { message: 'invalid_short_status' });
    const root = p.o.store.getJob(p.f.original.id)!;
    const result = { ...(root.result as Record<string, unknown>), captureBudgetProbe: nested };
    assert.throws(() => captureShortStatusJson(result), { message: 'invalid_short_status' });
    a6NativeDb(p.o.store)
      .prepare('UPDATE jobs SET result_json=? WHERE id=?')
      .run(recoveryCanonicalJson(result), root.id);
    const privateStore = p.o.store as unknown as {
      genericReadGraph: (...args: unknown[]) => unknown;
      genericSelect: (graph: unknown) => unknown;
    };
    const readGraph = privateStore.genericReadGraph.bind(p.o.store),
      classify = privateStore.genericSelect.bind(p.o.store);
    let captures = 0,
      classifications = 0;
    t.mock.method(privateStore, 'genericReadGraph', (...args: unknown[]) => {
      captures++;
      return readGraph(...args);
    });
    t.mock.method(privateStore, 'genericSelect', (graph: unknown) => {
      classifications++;
      return classify(graph);
    });
    await a6SavedRefuses(p, 'capture-depth', t);
    assert(captures >= 7, 'Every actual saved route must enter original graph capture.');
    assert.equal(
      classifications,
      0,
      'The original depth bound must reject before family schema classification.',
    );
  } finally {
    t.mock.restoreAll();
    await p.f.cleanup();
  }
});
