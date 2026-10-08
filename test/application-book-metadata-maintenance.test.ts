import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { longBookMetadataApplicationFixture } from './helpers/application-long-book-metadata-application-fixture.js';

import assert from 'node:assert/strict';

import { type Job } from '../src/runtime/store.js';

test('long-book metadata App persists independent snapshots/intents, deduplicates/conflicts and reconciles only complete later versions without replay or changing other current scopes', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-book-app-enabled-'));
  const fixture = await longBookMetadataApplicationFixture(directory, true);
  try {
    const protectedSaved = JSON.stringify(
      await Promise.all(fixture.protectedScopes.map((scope) => fixture.snapshot(scope))),
    );
    const snapshot = await fixture.invoke('get_editable_snapshot', { target: fixture.target });
    assert.equal(snapshot.job.status, 'succeeded');
    assert.equal(snapshot.job.operation, 'long_book_metadata_snapshot');
    assert.equal(snapshot.data[0]!.dataset, 'long_book_metadata');
    assert.equal(snapshot.data[0]!.metadataHash, fixture.expected());
    assert.equal('body' in snapshot.data[0]!, false);
    assert.equal('contentHash' in snapshot.data[0]!, false);
    const saved = (await fixture.snapshot(`long_book_metadata.${fixture.target.workId}`)) as {
      manifest: { jobId: string };
    };
    assert.equal(saved.manifest.jobId, snapshot.job.id);
    let intentChecks = 0;
    fixture.page.beforeFill = async () => {
      const running = (await fixture.jobs()).jobs.find(
        (job) => job.kind === 'write' && job.status === 'running',
      );
      assert(running);
      const live = await fixture.invoke('get_job', { jobId: running.id });
      assert.equal(
        live.evidence.some((ref) => ref.dataset === 'write-intent'),
        true,
      );
      assert.equal(running.target?.kind, 'long-book');
      assert.equal(running.platformWriteStartedAt !== null, true);
      intentChecks++;
    };
    const args = {
      idempotencyKey: 'synthetic-book-update-one',
      target: fixture.target,
      expectedContentHash: fixture.expected(),
      expectedState: 'draft',
      metadata: { description: 'Changed work description' },
    };
    const first = await fixture.invoke('update_work_metadata', args);
    assert.equal(first.job.status, 'succeeded');
    assert.equal(first.job.target?.kind, 'long-book');
    assert.equal(first.data[0]!.hashBasis, 'long-book-metadata/v1');
    assert.equal(first.data[0]!.metadataHash, fixture.expected());
    assert.equal('contentHash' in first.data[0]!, false);
    assert.equal(intentChecks, 1);
    assert.equal(fixture.page.saves, 1);
    assert.deepEqual(fixture.page.fills, ['#description']);
    const repeated = await fixture.invoke('update_work_metadata', args);
    assert.equal(repeated.job.id, first.job.id);
    assert.equal(fixture.page.saves, 1);
    await assert.rejects(
      fixture.invoke('update_work_metadata', {
        ...args,
        metadata: { description: 'Different request under the same key' },
      }),
      { code: 'idempotency_conflict' },
    );
    assert.equal(fixture.page.saves, 1);
    const conflict = await fixture.invoke('update_work_metadata', {
      ...args,
      idempotencyKey: 'synthetic-book-stale-hash',
    });
    assert.equal(conflict.job.status, 'failed');
    assert.equal(conflict.job.error?.code, 'version_conflict');
    assert.equal(fixture.page.saves, 1);
    fixture.page.failAfterSave = true;
    const uncertain = await fixture.invoke('update_work_metadata', {
      ...args,
      idempotencyKey: 'synthetic-book-lost-save',
      expectedContentHash: fixture.expected(),
      metadata: { description: 'Saved despite response loss' },
    });
    assert.equal(uncertain.job.status, 'uncertain');
    assert.equal(uncertain.job.target?.kind, 'long-book');
    assert.equal(fixture.page.saves, 2);
    const blocked = await fixture.invoke('update_work_metadata', {
      ...args,
      idempotencyKey: 'synthetic-book-uncertain-barrier',
      expectedContentHash: fixture.expected(),
    });
    assert.equal(blocked.job.error?.code, 'unresolved_write');
    assert.equal(fixture.page.saves, 2);
    fixture.page.failAfterSave = false;
    fixture.page.beforeFill = undefined;
    const completeDescription = fixture.page.saved.description;
    fixture.page.saved.description = 'Unrelated currently existing work metadata';
    await new Promise((resolve) => setTimeout(resolve, 5));
    const mismatch = (await fixture.invoke('reconcile_write', {
      jobId: uncertain.job.id,
    })) as unknown as { original: { job: Job }; reconciliation: { job: Job } };
    assert.equal(mismatch.reconciliation.job.status, 'succeeded');
    assert.equal(mismatch.original.job.status, 'uncertain');
    assert.equal(fixture.page.saves, 2);
    fixture.page.saved.description = completeDescription;
    fixture.page.missing.add('#description');
    const incomplete = (await fixture.invoke('reconcile_write', {
      jobId: uncertain.job.id,
    })) as unknown as { original: { job: Job }; reconciliation: { job: Job } };
    assert.equal(incomplete.reconciliation.job.status, 'failed');
    assert.equal(incomplete.original.job.status, 'uncertain');
    assert.equal(fixture.page.saves, 2);
    fixture.page.missing.delete('#description');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const reconciled = (await fixture.invoke('reconcile_write', {
      jobId: uncertain.job.id,
    })) as unknown as { original: { job: Job }; reconciliation: { job: Job } };
    assert.equal(reconciled.reconciliation.job.status, 'succeeded');
    assert.equal(reconciled.original.job.status, 'succeeded');
    assert.equal(
      (reconciled.original.job.result as { result: { hashBasis: string } }).result.hashBasis,
      'long-book-metadata/v1',
    );
    assert.equal(
      'contentHash' in (reconciled.original.job.result as { result: object }).result,
      false,
    );
    assert.equal(fixture.page.saves, 2);
    assert.equal(
      JSON.stringify(
        await Promise.all(fixture.protectedScopes.map((scope) => fixture.snapshot(scope))),
      ) === protectedSaved,
      true,
    );
    const capabilities = (await fixture.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as { writes: { 'long-book': { verification: string } } };
    assert.equal(capabilities.writes['long-book'].verification, 'not-verified-live');
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
