import { type TestContext } from 'node:test';

import { resumeAppFixture } from './application-resume-app-fixture.js';

import { a6Observe, a6Details, a6OwnJob } from './application-a6-observe.js';

import assert from 'node:assert/strict';

import {
  type Job,
  Store as CreationRecoveryStore,
  canonicalJson as recoveryCanonicalJson,
} from '../../src/runtime/store.js';

import { r6AssertNoPrivateStatus } from './application-complete-diagnostic-privacy-fixture.js';

import { createHash } from 'node:crypto';

import { a6NativeDb } from './application-long-book-metadata-application-fixture.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

// A6.3: these are actual App saved-route oracles, after complete family/read
// baselines. Fixture preparation may read the synthetic editor; measured saved
// surfaces have zero additional editor/identity GET, fill/save or native change.
export async function a6SavedCorruptionFixture(t: TestContext) {
  const f = await resumeAppFixture(undefined, {
      recovery: 'unknown',
      repairCount: 2,
      final: 'reconciled',
    }),
    o = a6Observe(t, f);
  assert(f.family);
  await a6Details(f, o, f.family.jobs);
  const before = structuredClone(f.state),
    reply = (await o.run(
      () => f.invoke('reconcile_write', { jobId: f.original.id }),
      false,
    )) as Record<string, any>;
  assert.equal(reply.original.job.status, 'succeeded');
  assert.equal(reply.reconciliation.job.status, 'succeeded');
  assert.equal(Object.hasOwn(reply, 'settlement'), false);
  assert.equal(f.state.fills, before.fills);
  assert.equal(f.state.saves, before.saves);
  assert.equal(f.state.newEntries, before.newEntries);
  assert.equal(f.state.gotos.length, before.gotos.length + 1);
  const readId = String(reply.reconciliation.job.id),
    manifest = o.store.getManifestForJob(f.config.accountId, readId);
  assert(manifest);
  const ref = o.store.listEvidence(readId)[0]!;
  assert.deepEqual(manifest.evidence, [ref]);
  const document = o.store.readEvidence(ref),
    payload = document.payload as Record<string, any>;
  assert.equal(document.collectionMode, 'fixture');
  assert.equal(payload.originalAudit.schema, 'generic-short-terminal-publication-bridge/v1');
  assert.equal(payload.originalAudit.mode, 'observation-only');
  assert.equal(payload.reconciliation.observedStatus, 'unknown');
  const row = o.records('reconcile_write').find((value) => value.row.id === readId);
  assert(row);
  assert.equal(row.metadata.genericShortStatus.stage, 'completed');
  assert.equal(row.metadata.genericShortStatus.failure, null);
  assert.equal(row.metadata.genericShortStatus.observations.length, 1);
  const member = f.family.jobs[2]!;
  assert.equal(member.status, 'failed');
  assert.equal(member.error?.code, 'superseded_by_verified_repair');
  return { f, o, readId, manifest, ref, payload, member };
}

type A6CorruptionFixture = Awaited<ReturnType<typeof a6SavedCorruptionFixture>>;

export function a6SavedSurfaces(p: A6CorruptionFixture, manifest = p.manifest) {
  const { f, member } = p;
  return [
    { name: 'MCP get_job', run: () => f.invoke('get_job', { jobId: member.id }) },
    {
      name: 'HTTP get_job',
      run: () =>
        f.application.dispatch(
          'GET',
          '/api/v1/jobs/' + member.id,
          new URLSearchParams(),
          undefined,
        ),
    },
    {
      name: 'HTTP listing',
      run: () => f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
    },
    {
      name: 'MCP snapshot',
      run: () => f.invoke('get_saved_snapshot', { scope: 'reconciliation' }),
    },
    {
      name: 'HTTP snapshot',
      run: () =>
        f.application.dispatch(
          'GET',
          '/api/v1/snapshot',
          new URLSearchParams({ scope: 'reconciliation' }),
          undefined,
        ),
    },
    { name: 'MCP history', run: () => f.invoke('list_saved_history', { manifestId: manifest.id }) },
    {
      name: 'HTTP history',
      run: () =>
        f.application.dispatch(
          'GET',
          '/api/v1/history',
          new URLSearchParams({ manifestId: manifest.id }),
          undefined,
        ),
    },
  ];
}

export async function a6SavedBaseline(p: A6CorruptionFixture, manifest = p.manifest) {
  const values: Record<string, any> = {};
  for (const surface of a6SavedSurfaces(p, manifest))
    values[surface.name] = await p.o.run(surface.run);
  assert.deepEqual(values['MCP get_job'], values['HTTP get_job']);
  a6OwnJob(values['MCP get_job'].job, p.member);
  const listed = values['HTTP listing'].jobs.find((job: Job) => job.id === p.member.id);
  assert(listed);
  a6OwnJob(listed, p.member);
  assert.deepEqual(values['MCP snapshot'], values['HTTP snapshot']);
  assert.deepEqual(values['MCP snapshot'].manifest, manifest);
  assert.deepEqual(values['MCP history'], values['HTTP history']);
  const entry = values['MCP history'].manifests[0];
  assert.equal(values['MCP history'].manifests.length, 1);
  assert.deepEqual(entry.manifest, manifest);
  const refs = p.o.store.listEvidence(manifest.jobId);
  assert.deepEqual(refs, manifest.evidence);
  for (const carrier of [values['MCP snapshot'], entry])
    for (const row of carrier.data) {
      const ref = refs.find((value) => value.id === row.sourceRef);
      assert(ref);
      assert.equal(row.evidenceHash, ref.sha256);
      assert.equal(row.evidenceCapturedAt, ref.capturedAt);
    }
  assert.deepEqual(
    entry.data,
    values['MCP snapshot'].data.map(
      ({ dataset: _dataset, ...row }: Record<string, unknown>) => row,
    ),
  );
  r6AssertNoPrivateStatus(values);
  return values;
}

function a6SavedResponseSummary(input: unknown) {
  // Report only public discriminator fields. Never include evidence/body/paths.
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const job =
    value.job && typeof value.job === 'object' ? (value.job as Record<string, unknown>) : null;
  return {
    sourceMode: value.sourceMode ?? null,
    state: value.state ?? null,
    jobStatus: job?.status ?? null,
    jobState: job?.state ?? null,
    hasManifest: value.manifest !== null && value.manifest !== undefined,
    manifestCount: Array.isArray(value.manifests) ? value.manifests.length : null,
    jobCount: Array.isArray(value.jobs) ? value.jobs.length : null,
    factsNull: value.statusFacts === null,
    sourceNull: value.statusSource === null,
  };
}

export async function a6SavedRefuses(
  p: A6CorruptionFixture,
  variant: string,
  t: TestContext,
  manifest = p.manifest,
) {
  for (const surface of a6SavedSurfaces(p, manifest))
    await t.test(variant + ' / ' + surface.name, async (surfaceTest) => {
      // getCurrent reads the old manifest ref before generic projection: a changed
      // durable account in this one vector keeps the original binding error code.
      const expected =
        variant === 'ref' && ['MCP snapshot', 'HTTP snapshot'].includes(surface.name)
          ? 'evidence_binding_invalid'
          : 'capability_unavailable';
      await assert.rejects(
        p.o.run(surface.run).then((value) => {
          surfaceTest.diagnostic(
            'UNEXPECTED_SUCCESS ' + JSON.stringify(a6SavedResponseSummary(value)),
          );
          return value;
        }),
        (error: unknown) => {
          assert(error && typeof error === 'object');
          assert.equal(
            (error as { code?: unknown }).code,
            expected,
            variant + ' / ' + surface.name,
          );
          const serialized = JSON.stringify(error);
          assert.equal(typeof serialized, 'string');
          assert(serialized !== undefined);
          for (const secret of [
            p.f.directory,
            p.f.input.content.body,
            'resume-private-synthetic-token',
          ])
            assert.equal(
              serialized.includes(secret),
              false,
              surface.name + ' must not leak private fixture values',
            );
          return true;
        },
        variant + ' / ' + surface.name + ' must reject with ' + expected,
      );
    });
}

export function a6RewriteSavedDocument(
  p: A6CorruptionFixture,
  ref: ReturnType<CreationRecoveryStore['listEvidence']>[number],
  mutate: (payload: Record<string, any>) => void,
) {
  const document = p.o.store.readEvidence(ref),
    job = p.o.store.getJob(ref.jobId)!,
    manifest = p.o.store.getManifestForJob(ref.accountId, ref.jobId);
  assert(manifest);
  mutate(document.payload as Record<string, any>);
  const bytes = JSON.stringify(document),
    sha256 = createHash('sha256').update(bytes).digest('hex'),
    changedRef = { ...ref, sha256 };
  const changedManifest = {
      ...manifest,
      evidence: manifest.evidence.map((value) => (value.id === ref.id ? changedRef : value)),
    },
    metadata = structuredClone(job.metadata),
    witness = metadata.genericShortStatus as {
      observations: Array<{ evidenceId: string; evidenceHash: string }>;
    };
  witness.observations = witness.observations.map((value) =>
    value.evidenceId === ref.id ? { ...value, evidenceHash: sha256 } : value,
  );
  const db = a6NativeDb(p.o.store);
  writeFileSync(path.join(p.f.config.dataDir, 'evidence', ref.path), bytes);
  db.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(sha256, ref.id);
  db.prepare('UPDATE manifests SET manifest_json=? WHERE job_id=?').run(
    recoveryCanonicalJson(changedManifest),
    ref.jobId,
  );
  db.prepare('UPDATE jobs SET metadata_json=?,result_json=? WHERE id=?').run(
    recoveryCanonicalJson(metadata),
    recoveryCanonicalJson({ manifest: changedManifest }),
    ref.jobId,
  );
  // Hash/ref/witness/M11/result bindings remain internally complete. Only the
  // specified audit slot is damaged, so a hash mismatch cannot mask this oracle.
  assert.equal(p.o.store.readEvidence(changedRef).evidenceId, ref.id);
  assert.deepEqual(p.o.store.listEvidence(ref.jobId), changedManifest.evidence);
}
