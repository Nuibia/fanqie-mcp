import { type TestContext } from 'node:test';

import { resumeAppFixture } from './application-resume-app-fixture.js';

import { Store as CreationRecoveryStore, type Job } from '../../src/runtime/store.js';

import {
  a6RawRows,
  a6EvidenceFiles,
  a6NativeDb,
  type A6FamilyPlan,
} from './application-long-book-metadata-application-fixture.js';

import assert from 'node:assert/strict';

import path from 'node:path';

import { readFileSync } from 'node:fs';

import { createHash } from 'node:crypto';

import { r6AssertNoPrivateStatus } from './application-complete-diagnostic-privacy-fixture.js';

import { hashDraftContent as recoveryContentHash } from '../../src/platform/writes.js';

export function a6Observe(t: TestContext, f: Awaited<ReturnType<typeof resumeAppFixture>>) {
  let store: CreationRecoveryStore | null = null,
    armed = false,
    beforeRaw: ReturnType<typeof a6RawRows> | null = null;
  const original = CreationRecoveryStore.prototype.getJob;
  t.mock.method(
    CreationRecoveryStore.prototype,
    'getJob',
    function (this: CreationRecoveryStore, ...args: Parameters<CreationRecoveryStore['getJob']>) {
      if (armed) {
        store = this;
        beforeRaw = a6RawRows(this);
        armed = false;
      }
      return original.apply(this, args);
    },
  );
  const bound = () => {
    assert(
      store,
      'The measured App request must reach its actual Store before the oracle can compare.',
    );
    return store;
  };
  return {
    get store() {
      return bound();
    },
    async run<T>(action: () => Promise<T>, unchanged = true): Promise<T> {
      const state = structuredClone(f.state),
        files = a6EvidenceFiles(path.join(f.config.dataDir, 'evidence'));
      if (store) {
        beforeRaw = a6RawRows(store);
        armed = false;
      } else {
        beforeRaw = null;
        armed = true;
      }
      try {
        return await action();
      } finally {
        const actual = bound();
        assert(beforeRaw, 'Native before capture must occur before original getJob execution.');
        if (unchanged) {
          assert.deepEqual(f.state, state);
          assert.deepEqual(a6RawRows(actual), beforeRaw);
          assert.deepEqual(a6EvidenceFiles(path.join(f.config.dataDir, 'evidence')), files);
        }
        armed = false;
      }
    },
    records(operation: string) {
      const db = a6NativeDb(bound());
      return db
        .prepare('SELECT * FROM jobs WHERE account_id=? AND operation=? ORDER BY rowid')
        .all(f.config.accountId, operation)
        .map((row) => ({
          row,
          metadata: JSON.parse(String(row.metadata_json)) as Record<string, any>,
          refs: db
            .prepare('SELECT * FROM evidence WHERE job_id=? ORDER BY rowid')
            .all(row.id!)
            .map((ref) => {
              const bytes = readFileSync(
                path.join(f.config.dataDir, 'evidence', String(ref.path)),
                'utf8',
              );
              assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256);
              const document = JSON.parse(bytes) as Record<string, any>;
              assert.equal(document.jobId, row.id);
              assert.equal(document.evidenceId, ref.id);
              assert.equal(document.accountId, f.config.accountId);
              assert.equal(document.dataset, ref.dataset);
              assert.equal(document.capturedAt, ref.captured_at);
              return { ref, document };
            }),
          manifestCount: Number(
            db.prepare('SELECT COUNT(*) AS n FROM manifests WHERE job_id=?').get(row.id!)!.n,
          ),
        }));
    },
  };
}

export type A6Observer = ReturnType<typeof a6Observe>;

export function a6OwnJob(publicJob: Record<string, any>, saved: Job) {
  assert.deepEqual(
    Object.keys(publicJob).sort(),
    [...Object.keys(saved), 'state', 'statusFacts', 'statusSource', 'statusEvidence'].sort(),
  );
  assert.deepEqual(
    Object.fromEntries(Object.keys(saved).map((key) => [key, publicJob[key]])),
    saved,
  );
  assert.equal(publicJob.state, 'unknown');
  for (const key of ['statusFacts', 'statusSource', 'statusEvidence'])
    assert.equal(publicJob[key], null);
  r6AssertNoPrivateStatus(publicJob);
}

export async function a6Details(
  f: Awaited<ReturnType<typeof resumeAppFixture>>,
  o: A6Observer,
  jobs: Job[],
) {
  for (const saved of jobs) {
    const mcp = (await o.run(() => f.invoke('get_job', { jobId: saved.id }))) as Record<
      string,
      any
    >;
    const http = (await o.run(() =>
      f.application.dispatch('GET', '/api/v1/jobs/' + saved.id, new URLSearchParams(), undefined),
    )) as Record<string, any>;
    assert.deepEqual(mcp, http);
    a6OwnJob(http.job, saved);
    assert.equal(http.retrievalMode, 'saved');
    assert.equal(http.sourceMode, saved.status === 'succeeded' ? 'saved' : 'incomplete');
    assert.deepEqual(http.evidence, o.store.listEvidence(saved.id));
    const refs: ReturnType<CreationRecoveryStore['listEvidence']> = http.evidence;
    for (const row of http.data) {
      const ref: ReturnType<CreationRecoveryStore['listEvidence']>[number] | undefined = refs.find(
        (value) => value.id === row.sourceRef,
      );
      assert(ref);
      assert.equal(row.evidenceHash, ref.sha256);
      assert.equal(row.evidenceCapturedAt, ref.capturedAt);
    }
  }
}

async function a6ReadSurfaces(f: Awaited<ReturnType<typeof resumeAppFixture>>, o: A6Observer) {
  for (const read of f.family!.reads) {
    const detail = (await o.run(() => f.invoke('get_job', { jobId: read.job.id }))) as Record<
      string,
      any
    >;
    const saved = (await o.run(() =>
      f.invoke('get_saved_snapshot', { scope: 'reconciliation' }),
    )) as Record<string, any>;
    const http = (await o.run(() =>
      f.application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: 'reconciliation' }),
        undefined,
      ),
    )) as Record<string, any>;
    assert.deepEqual(http, saved);
    assert.deepEqual(saved.manifest, read.manifest);
    assert.deepEqual(saved.data, detail.data);
    const history = (await o.run(() =>
      f.invoke('list_saved_history', { manifestId: read.manifest.id }),
    )) as Record<string, any>;
    const httpHistory = (await o.run(() =>
      f.application.dispatch(
        'GET',
        '/api/v1/history',
        new URLSearchParams({ manifestId: read.manifest.id }),
        undefined,
      ),
    )) as Record<string, any>;
    assert.deepEqual(history, httpHistory);
    assert.equal(history.manifests.length, 1);
    const entry = history.manifests[0];
    assert.equal(entry.manifest.id, read.manifest.id);
    assert.equal(entry.manifest.jobId, read.job.id);
    assert.equal(entry.manifest.committedAt, read.manifest.committedAt);
    assert.deepEqual(entry.manifest.evidence, read.manifest.evidence);
    assert.deepEqual(
      entry.data,
      detail.data.map(({ dataset: _dataset, ...row }: Record<string, unknown>) => row),
    );
    for (const carrier of [saved, entry]) {
      assert.equal(carrier.state, 'unknown');
      for (const key of ['statusFacts', 'statusSource', 'statusEvidence'])
        assert.equal(carrier[key], null);
    }
    assert.deepEqual(detail.evidence, read.manifest.evidence);
    for (const row of detail.data) {
      assert.equal(row.sourceRef, read.manifest.evidence[0]!.id);
      assert.equal(row.evidenceHash, read.manifest.evidence[0]!.sha256);
      assert.equal(row.evidenceCapturedAt, read.manifest.evidence[0]!.capturedAt);
    }
    r6AssertNoPrivateStatus({ detail, saved, entry });
  }
}

export async function a6Closed(t: TestContext, plan: A6FamilyPlan, body?: string) {
  const f = await resumeAppFixture(body, plan),
    o = a6Observe(t, f);
  assert(f.family);
  const family = f.family;
  try {
    const isRepair = family.repairArgs.length > 0,
      args = isRepair ? family.repairArgs.at(-1)! : family.resumeArgs,
      operation = isRepair ? 'repair_created_draft' : 'resume_create_draft';
    const response = (await o.run(() => f.invoke(operation, args))) as Record<string, any>,
      latest = family.jobs.at(-1)!;
    assert.equal(response.job.id, latest.id);
    assert.equal(response.job.status, 'succeeded');
    assert.equal(response.original.job.status, 'succeeded');
    a6OwnJob(response.job, latest);
    a6OwnJob(response.original.job, family.jobs[0]!);
    if (isRepair) {
      assert.equal(response.recovered.job.status, 'failed');
      assert.equal(response.recovered.job.error.code, 'superseded_by_verified_repair');
      assert.equal(response.recovered.job.endedAt, family.recoveryBefore.endedAt);
      a6OwnJob(response.recovered.job, family.jobs[1]!);
    }
    const duplicate = (await o.run(() => f.invoke(operation, args))) as typeof response;
    assert.deepEqual(duplicate, response);
    const parent = response.original.job.result;
    assert.deepEqual(parent.prior, {
      status: family.originalBefore.status,
      error: family.originalBefore.error,
      result: family.originalBefore.result,
      target: family.originalBefore.target,
      endedAt: family.originalBefore.endedAt,
      intentRefs: o.store.listEvidence(f.original.id),
    });
    if (isRepair) {
      for (const [index, oldArgs] of family.repairArgs.entries())
        if (index < family.repairArgs.length - 1) {
          const prior = family.repairsBefore[index]!,
            saved = (await o.run(() => f.invoke('repair_created_draft', oldArgs))) as Record<
              string,
              any
            >;
          assert.equal(saved.job.id, prior.id);
          assert.equal(saved.job.status, 'failed');
          assert.equal(saved.job.error.code, 'superseded_by_verified_repair');
          assert.equal(saved.job.endedAt, prior.endedAt);
          assert.deepEqual(saved.job.result.prior, {
            id: prior.id,
            status: prior.status,
            error: prior.error,
            result: prior.result,
            target: prior.target,
            endedAt: prior.endedAt,
            evidence: o.store.listEvidence(prior.id),
            metadata: prior.metadata,
          });
        }
      const old = (await o.run(() => f.invoke('resume_create_draft', family.resumeArgs))) as Record<
        string,
        any
      >;
      assert.equal(old.job.id, family.recoveryBefore.id);
      assert.equal(old.job.status, 'failed');
      assert.equal(old.job.error.code, 'superseded_by_verified_repair');
      assert.equal(old.job.endedAt, family.recoveryBefore.endedAt);
      assert.deepEqual(old.job.result.prior, {
        status: family.recoveryBefore.status,
        error: family.recoveryBefore.error,
        result: family.recoveryBefore.result,
        target: family.recoveryBefore.target,
        endedAt: family.recoveryBefore.endedAt,
        evidence: o.store.listEvidence(old.job.id),
        metadata: family.recoveryBefore.metadata,
      });
      await assert.rejects(
        o.run(() =>
          f.invoke('repair_created_draft', { ...args, idempotencyKey: 'different-repair-key' }),
        ),
        { code: 'creation_repair_conflict' },
      );
      for (const member of family.jobs.slice(1, -1)) {
        await assert.rejects(
          o.run(() => f.invoke('reconcile_write', { jobId: member.id })),
          { code: 'creation_repair_conflict' },
        );
        assert.throws(() => o.store.genericShortProjection(member.id, f.config.accountId), {
          code: 'creation_repair_conflict',
        });
      }
    } else
      await assert.rejects(
        o.run(() =>
          f.invoke('resume_create_draft', {
            ...family.resumeArgs,
            idempotencyKey: 'changed-resume-key',
          }),
        ),
        { code: 'creation_recovery_conflict' },
      );
    await a6Details(f, o, family.jobs);
    await a6ReadSurfaces(f, o);
    assert.equal(f.state.fills, 0);
    assert.equal(f.state.saves, 0);
    assert.equal(f.state.newEntries, 0);
    assert.equal(f.state.gotos.length, 0);
    assert.equal(f.state.checks, 0);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
}

export function a6OpenRepairArgs(
  f: Awaited<ReturnType<typeof resumeAppFixture>>,
  key: string,
  previous?: Job,
) {
  assert(f.family);
  return {
    ...f.args,
    recoveryJobId: f.family.recoveryBefore.id,
    idempotencyKey: key,
    expectedState: 'draft',
    expectedContentHash: recoveryContentHash({ title: f.state.title, body: f.state.body }),
    ...(previous ? { previousRepairJobId: previous.id } : {}),
  };
}
