import test from 'node:test';

import { type Job, canonicalJson as recoveryCanonicalJson } from '../src/runtime/store.js';

import { resumeAppFixture } from './helpers/application-resume-app-fixture.js';

import {
  recoveryAppHash,
  a6NativeDb,
} from './helpers/application-long-book-metadata-application-fixture.js';

import { hashDraftContent as recoveryContentHash } from '../src/platform/writes.js';

import { a6Observe, a6Details, a6OwnJob } from './helpers/application-a6-observe.js';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import {
  a6SavedCorruptionFixture,
  a6SavedBaseline,
  a6RewriteSavedDocument,
  a6SavedRefuses,
} from './helpers/application-a6-saved-corruption-fixture.js';

test('R6 legacy standalone own snapshot target and two historical short write operations retain unknown publication', async (t) => {
  const ids: string[] = [],
    expected: Job[] = [];
  const f = await resumeAppFixture(undefined, undefined, (store, config, target, input) => {
      const sourceUrl = 'https://fanqienovel.com/main/writer/publish-short/' + target.id,
        writeTarget = { kind: 'short', workId: target.id };
      for (const operation of ['update_work_metadata', 'submit_short_story']) {
        const queued = store.createJob({
          accountId: config.accountId,
          kind: 'write',
          operation,
          idempotencyKey: 'historical-' + operation,
          inputHash: recoveryAppHash({ operation, target: writeTarget }),
        }).job;
        store.startJob(queued.id);
        store.markPlatformReadStarted(queued.id);
        store.recordTarget(queued.id, target);
        store.saveEvidence(queued.id, 'write-intent', {
          target,
          desiredContentHash: recoveryContentHash(input.content),
          expectedStates: [operation === 'submit_short_story' ? 'reviewing' : 'draft_saved'],
        });
        store.markPlatformWriteStarted(queued.id);
        const result = {
          status: 'succeeded',
          capability: operation,
          target: writeTarget,
          contentHash: recoveryContentHash(input.content),
          platformState: operation === 'submit_short_story' ? 'reviewing' : 'draft',
          verifiedAt: new Date().toISOString(),
          sourceUrl,
        };
        store.saveEvidence(queued.id, 'write-result', result);
        store.completeWriteJob(queued.id, result);
        ids.push(queued.id);
        expected.push(store.getJob(queued.id)!);
      }
      const read = store.createJob({
        accountId: config.accountId,
        kind: 'read',
        operation: 'editable_snapshot',
        scope: 'editable_snapshot',
        datasets: ['editable_snapshot'],
        inputHash: recoveryAppHash({ target: writeTarget }),
      }).job;
      store.startJob(read.id);
      store.markPlatformReadStarted(read.id);
      const ref = store.saveEvidence(read.id, 'editable_snapshot', {
        title: input.content.title,
        body: input.content.body,
        metadata: {},
        accountId: '1001',
        target: writeTarget,
        state: 'published',
        contentHash: recoveryContentHash(input.content),
        sourceUrl,
        platformReadAt: new Date().toISOString(),
        source: { mode: 'live', origin: 'https://fanqienovel.com' },
      });
      store.completeReadJob(read.id, [ref]);
      ids.push(read.id);
      expected.push(store.getJob(read.id)!);
    }),
    o = a6Observe(t, f);
  try {
    await a6Details(f, o, expected);
    const manifest = o.store.getManifestForJob(f.config.accountId, ids.at(-1)!)!;
    assert(manifest);
    const saved = (await o.run(() =>
      f.invoke('get_saved_snapshot', { scope: 'editable_snapshot' }),
    )) as Record<string, any>;
    assert.deepEqual(saved.manifest, manifest);
    assert.equal(saved.state, 'unknown');
    assert.equal(saved.data[0].state, 'unknown');
    for (const key of ['statusFacts', 'statusSource', 'statusEvidence'])
      assert.equal(saved[key], null);
    assert.equal(saved.data[0].statusFacts, null);
    assert.equal(saved.data[0].statusSource, null);
    assert.equal(saved.data[0].sourceRef, manifest!.evidence[0]!.id);
    const list = (await o.run(() =>
      f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
    )) as Record<string, any>;
    for (const id of ids) {
      const job = list.jobs.find((value: Job) => value.id === id);
      assert(job);
      a6OwnJob(
        job,
        expected.find((value) => value.id === id)!,
      );
    }
    assert.equal(f.state.gotos.length, 0);
    assert.equal(f.state.checks, 0);
    assert.equal(f.state.fills, 0);
    assert.equal(f.state.saves, 0);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
});

test('R6 legacy physical target mismatch refuses full qualification while missing and spoofed carriers grant no Q4', async (t) => {
  for (const variant of [
    'bad-intent-target',
    'bad-result-target',
    'zero-ref',
    'physical-spoof',
    'unsupported-write',
    'partial-marker',
  ] as const) {
    let id = '';
    const f = await resumeAppFixture(undefined, undefined, (store, config, target, input) => {
        const operation =
            variant === 'physical-spoof'
              ? 'editable_snapshot'
              : variant === 'unsupported-write'
                ? 'synthetic_fixture_write'
                : 'update_work_metadata',
          isRead = variant === 'physical-spoof';
        const job = store.createJob({
          accountId: config.accountId,
          kind: isRead ? 'read' : 'write',
          operation,
          ...(isRead
            ? { scope: 'long_works', datasets: ['long_works'] }
            : { idempotencyKey: 'legacy-' + variant }),
          inputHash: recoveryAppHash({ variant }),
        }).job;
        id = job.id;
        store.startJob(id);
        store.markPlatformReadStarted(id);
        if (isRead) {
          const ref = store.saveEvidence(id, 'long_works', {
            dataset: 'editable_snapshot',
            target: { kind: 'short', workId: target.id },
            state: 'published',
            records: [],
          });
          store.completeReadJob(id, [ref]);
          return;
        }
        store.recordTarget(id, target);
        if (variant === 'zero-ref') {
          store.markPlatformWriteStarted(id);
          store.failJob(id, {
            code: 'outcome_unknown',
            message: 'Synthetic historical missing evidence.',
          });
          return;
        }
        const wrong = { kind: 'short-story', id: '9234567890123456789' };
        store.saveEvidence(id, 'write-intent', {
          target: variant === 'bad-intent-target' ? wrong : target,
          desiredContentHash: recoveryContentHash(input.content),
          expectedStates: ['draft_saved'],
        });
        store.markPlatformWriteStarted(id);
        const result = {
          status: 'succeeded',
          capability: operation,
          target: {
            kind: 'short',
            workId: variant === 'bad-result-target' ? '9234567890123456789' : target.id,
          },
          contentHash: recoveryContentHash(input.content),
          platformState: 'draft',
          verifiedAt: new Date().toISOString(),
          sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + target.id,
        };
        const ref = store.saveEvidence(id, 'write-result', result);
        store.completeWriteJob(id, result);
        if (variant === 'partial-marker') {
          const document = store.readEvidence(ref);
          (document.payload as Record<string, unknown>).statusProtocol =
            'fanqie-generic-short-status/v1';
          const bytes = JSON.stringify(document),
            sha256 = createHash('sha256').update(bytes).digest('hex');
          writeFileSync(path.join(config.dataDir, 'evidence', ref.path), bytes);
          a6NativeDb(store).prepare('UPDATE evidence SET sha256=? WHERE id=?').run(sha256, ref.id);
        }
      }),
      o = a6Observe(t, f);
    try {
      if (['bad-intent-target', 'bad-result-target', 'partial-marker'].includes(variant)) {
        await assert.rejects(
          o.run(() => f.invoke('get_job', { jobId: id })),
          { code: 'capability_unavailable' },
        );
        await assert.rejects(
          o.run(() =>
            f.application.dispatch('GET', '/api/v1/jobs/' + id, new URLSearchParams(), undefined),
          ),
          { code: 'capability_unavailable' },
        );
        await assert.rejects(
          o.run(() =>
            f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
          ),
          { code: 'capability_unavailable' },
        );
      } else {
        const detail = (await o.run(() => f.invoke('get_job', { jobId: id }))) as Record<
          string,
          any
        >;
        for (const key of ['state', 'statusFacts', 'statusSource', 'statusEvidence'])
          assert.equal(Object.hasOwn(detail.job, key), false);
        const list = (await o.run(() =>
          f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
        )) as Record<string, any>;
        const job = list.jobs.find((value: Job) => value.id === id);
        assert(job);
        for (const key of ['state', 'statusFacts', 'statusSource', 'statusEvidence'])
          assert.equal(Object.hasOwn(job, key), false);
      }
      assert.equal(f.state.gotos.length, 0);
      assert.equal(f.state.checks, 0);
      assert.equal(f.state.fills, 0);
      assert.equal(f.state.saves, 0);
    } finally {
      t.mock.restoreAll();
      await f.cleanup();
    }
  }
});

test('R6 A6 App complete closed family rejects stable member account marker and budget damage across seven saved surfaces', async (t) => {
  for (const variant of [
    'wrong-member',
    'other-account',
    'partial-marker',
    'metadata-512',
    'metadata-8KiB',
    'M11',
    'ref',
    'audit',
    'ledger',
  ] as const)
    await t.test(variant, async (variantTest) => {
      const p = await a6SavedCorruptionFixture(variantTest);
      try {
        await a6SavedBaseline(p);
        const db = a6NativeDb(p.o.store),
          root = p.o.store.getJob(p.f.original.id)!;
        if (variant === 'wrong-member')
          db.prepare(
            'UPDATE creation_repair_successors SET repair_job_id=? WHERE previous_repair_job_id=?',
          ).run(root.id, p.member.id);
        else if (variant === 'other-account')
          db.prepare('UPDATE jobs SET account_id=? WHERE id=?').run(
            'synthetic-foreign-account',
            p.f.family!.jobs.at(-1)!.id,
          );
        else if (variant === 'partial-marker')
          db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
            recoveryCanonicalJson({
              ...root.metadata,
              genericShortStatus: { schema: 'fanqie-generic-short-execution/v1' },
            }),
            root.id,
          );
        else if (variant === 'metadata-512')
          db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
            recoveryCanonicalJson({ ...root.metadata, operationalLabel: 'x'.repeat(513) }),
            root.id,
          );
        else if (variant === 'metadata-8KiB') {
          const metadata = {
            ...root.metadata,
            ...Object.fromEntries(
              Array.from({ length: 20 }, (_, i) => ['operational' + i, 'x'.repeat(512)]),
            ),
          };
          assert(Buffer.byteLength(recoveryCanonicalJson(metadata)) > 8192);
          db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
            recoveryCanonicalJson(metadata),
            root.id,
          );
        } else if (variant === 'M11') {
          const malformed = { ...p.manifest, jobId: root.id };
          db.prepare('UPDATE manifests SET manifest_json=? WHERE job_id=?').run(
            recoveryCanonicalJson(malformed),
            p.readId,
          );
        } else if (variant === 'ref')
          db.prepare('UPDATE evidence SET account_id=? WHERE id=?').run(
            'synthetic-foreign-account',
            p.ref.id,
          );
        else if (variant === 'audit')
          a6RewriteSavedDocument(p, p.ref, (payload) => {
            delete payload.originalAudit.rootLink;
          });
        else
          db.prepare('UPDATE write_reconciliations SET read_job_id=? WHERE original_job_id=?').run(
            root.id,
            p.f.family!.jobs.at(-1)!.id,
          );
        await a6SavedRefuses(p, variant, variantTest);
      } finally {
        variantTest.mock.restoreAll();
        await p.f.cleanup();
      }
    });
});
