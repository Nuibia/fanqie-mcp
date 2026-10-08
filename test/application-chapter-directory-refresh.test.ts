import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { genericDirectoryApplicationFixture } from './helpers/application-generic-directory-phase-fixture.js';

import assert from 'node:assert/strict';

import { type Job } from '../src/runtime/store.js';

import { longBookMetadataApplicationFixture } from './helpers/application-long-book-metadata-application-fixture.js';

test('generic chapter directory commits one new aggregate only after two independent complete phases in one job and FIFO slot', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-generic-directory-'));
  const fixture = await genericDirectoryApplicationFixture(directory);
  try {
    const before = await Promise.all(
      fixture.protectedScopes.map((scope) => fixture.snapshot(scope)),
    );
    const capabilityBefore = (await fixture.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    const unverified = capabilityBefore.reads.find((row: any) => row.dataset === 'chapters');
    assert(unverified);
    assert.equal(unverified.verificationStatus, 'not-verified-live');
    assert.equal(unverified.scope, 'single_work_management_and_draft_directory');
    assert.equal(unverified.available, true);
    assert.equal(unverified.atomicRevision, false);
    assert.equal(unverified.bodyIncluded, false);
    const result = await fixture.call();
    assert.equal(result.job.status, 'succeeded');
    assert.equal(result.sourceMode, 'live');
    assert.equal(result.job.operation, 'list_chapters');
    assert.equal(result.job.scope, fixture.scope);
    assert.deepEqual(result.job.datasets, ['chapters']);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].dataset, 'chapters');
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].records.length, 2);
    assert.equal(result.data[0].coverage.complete, true);
    assert.equal(result.data[0].coverage.paginationComplete, true);
    assert.deepEqual(
      result.data[0].records.map((row: Record<string, unknown>) => row.namespace),
      ['management', 'draft_list'],
    );
    assert.equal(result.data[0].directoryCoverage.atomicRevision, false);
    assert.equal(fixture.callbacks, 1);
    assert.deepEqual(fixture.events, [
      'slot_enter',
      'management_enter',
      'management_owner',
      'management_return',
      'draft_enter',
      'draft_owner',
      'draft_return',
      'slot_leave',
    ]);
    const saved = await fixture.snapshot();
    assert(saved.manifest);
    assert.equal(saved.manifest.id, result.job.result.manifest.id);
    assert.deepEqual(saved.data, result.data);
    assert.equal(saved.data[0].sourceRef, result.evidence[0].id);
    assert.equal(saved.data[0].evidenceHash, result.evidence[0].sha256);
    assert.equal(saved.data[0].evidenceCapturedAt, result.evidence[0].capturedAt);
    assert.deepEqual(
      await Promise.all(fixture.protectedScopes.map((scope) => fixture.snapshot(scope))),
      before,
    );
    const jobs = (await fixture.application.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(
      jobs.jobs.filter(
        (job: Job) => job.operation === 'list_chapters' && job.scope === fixture.scope,
      ).length,
      1,
    );
    const capabilityAfter = (await fixture.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(
      capabilityAfter.reads.find((row: any) => row.dataset === 'chapters').verificationStatus,
      'verified-live',
    );
    fixture.setMode('empty_drafts');
    const empty = await fixture.call();
    assert.equal(empty.job.status, 'succeeded');
    assert.equal(empty.data[0].records.length, 1);
    assert.equal(empty.data[0].directoryCoverage.drafts.totalRecords, 0);
    assert.equal(empty.data[0].directoryCoverage.drafts.pagesFetched, 1);
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generic chapter directory never promotes callbacks alone, partial phases, outside properties or another owner over a previous current', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-generic-directory-refusal-'));
  const fixture = await genericDirectoryApplicationFixture(directory);
  try {
    assert.equal((await fixture.call()).job.status, 'succeeded');
    const before = await fixture.snapshot();
    const protectedBefore = await Promise.all(
      fixture.protectedScopes.map((scope) => fixture.snapshot(scope)),
    );
    for (const mode of [
      'management_partial',
      'management_extra_error',
      'management_failure',
      'management_unproved',
      'draft_partial',
      'draft_failure',
      'draft_unproved',
      'draft_mismatch',
      'draft_outside_error',
    ] as const) {
      fixture.setMode(mode);
      const index = fixture.events.length;
      const result = await fixture.call();
      assert.notEqual(result.job.status, 'succeeded');
      assert.deepEqual(await fixture.snapshot(), before);
      assert.deepEqual(
        await Promise.all(fixture.protectedScopes.map((scope) => fixture.snapshot(scope))),
        protectedBefore,
      );
      assert.equal(JSON.stringify(result).includes('UNTRUSTED_GENERIC_ERROR_SENTINEL'), false);
      if (mode.startsWith('management_'))
        assert.equal(fixture.events.slice(index).includes('draft_enter'), false);
      if (
        mode.endsWith('_unproved') ||
        mode === 'draft_mismatch' ||
        mode === 'draft_outside_error'
      ) {
        assert.equal(result.evidence.length, 0);
        assert.equal(result.data.length, 0);
      }
      if (mode.endsWith('_failure')) {
        assert.equal(result.data[0].records.length, 0);
        assert.equal(result.data[0].coverage.fields.length, 0);
      }
      for (const row of result.data) {
        assert.equal(row.coverage.complete, false);
        assert.equal(row.coverage.paginationComplete, false);
      }
    }
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generic chapter directory cancellation keeps the FIFO slot until phase cleanup settles and preserves the old current', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-generic-directory-cancel-'));
  const fixture = await genericDirectoryApplicationFixture(directory);
  try {
    assert.equal((await fixture.call()).job.status, 'succeeded');
    const before = await fixture.snapshot();
    fixture.setMode('blocked_draft');
    const pending = fixture.call();
    await fixture.entered;
    const jobs = (await fixture.application.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    const running = jobs.jobs.find((job: Job) => job.status === 'running');
    assert(running);
    const cancelled = await fixture.application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_cancel_job',
      new URLSearchParams(),
      { jobId: running.id },
    );
    assert(cancelled);
    assert.equal(fixture.active, true);
    assert.equal(fixture.events.includes('draft_cleanup_settled'), false);
    fixture.release();
    const result = await pending;
    assert.equal(result.job.status, 'cancelled');
    assert.equal(result.evidence.length, 0);
    assert.equal(result.data.length, 0);
    assert.equal(fixture.active, false);
    assert.deepEqual(await fixture.snapshot(), before);
    assert(
      fixture.events.lastIndexOf('draft_cleanup_settled') <
        fixture.events.lastIndexOf('slot_leave'),
    );
  } finally {
    fixture.release();
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('long-book metadata App default gate rejects before jobs/login/pages while only metadata tools accept the strict book target and profiles do not prove live verification', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-book-app-disabled-'));
  const fixture = await longBookMetadataApplicationFixture(directory, false);
  try {
    const beforeJobs = JSON.stringify(await fixture.jobs()),
      beforeSaved = JSON.stringify(
        await Promise.all(fixture.protectedScopes.map((scope) => fixture.snapshot(scope))),
      );
    for (const call of [
      { name: 'get_editable_snapshot', args: { target: fixture.target } },
      {
        name: 'update_work_metadata',
        args: {
          idempotencyKey: 'synthetic-disabled-book',
          target: fixture.target,
          expectedContentHash: fixture.expected(),
          expectedState: 'draft',
          metadata: { description: 'Not written' },
        },
      },
      { name: 'reconcile_write', args: { jobId: '00000000-0000-4000-8000-000000000001' } },
    ])
      await assert.rejects(fixture.invoke(call.name, call.args), { code: 'writes_disabled' });
    assert.equal(JSON.stringify(await fixture.jobs()) === beforeJobs, true);
    assert.equal(
      JSON.stringify(
        await Promise.all(fixture.protectedScopes.map((scope) => fixture.snapshot(scope))),
      ) === beforeSaved,
      true,
    );
    assert.deepEqual(fixture.counts(), { loginCalls: 0, pageCalls: 0, ownCalls: 0 });
    assert.equal(fixture.page.saves, 0);
    assert.equal(fixture.page.fills.length, 0);
    const version = {
      target: fixture.target,
      expectedContentHash: fixture.expected(),
      expectedState: 'draft',
    };
    for (const call of [
      { name: 'diagnose_editor', args: { target: fixture.target } },
      {
        name: 'update_draft',
        args: {
          ...version,
          idempotencyKey: 'synthetic-invalid-book',
          content: { title: 'T', body: 'B' },
        },
      },
      { name: 'prepare_submission', args: version },
      ...['submit_short_story', 'publish_chapter'].map((name) => ({
        name,
        args: {
          ...version,
          idempotencyKey: 'synthetic-invalid-book',
          preparationJobId: '00000000-0000-4000-8000-000000000001',
          acceptPublicationTerms: true,
        },
      })),
    ]) {
      const tool = fixture.application.tools.find((item) => item.name === `fanqie_${call.name}`)!;
      assert.equal(tool.schema.safeParse(call.args).success, false);
    }
    const editable = fixture.application.tools.find(
      (item) => item.name === 'fanqie_get_editable_snapshot',
    )!;
    assert.equal(
      editable.schema.safeParse({ target: { ...fixture.target, chapterId: '7800000000000000001' } })
        .success,
      false,
    );
    assert.equal(editable.readOnly, false);
    assert.equal(fixture.application.tools.length, 40);
    const capabilities = (await fixture.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as {
      writes: {
        'long-book': {
          available: boolean;
          verification: string;
          bodyIncluded: boolean;
          createAvailable: boolean;
          submissionAvailable: boolean;
        };
      };
    };
    assert.equal(capabilities.writes['long-book'].available, true);
    assert.equal(capabilities.writes['long-book'].verification, 'not-verified-live');
    assert.equal(capabilities.writes['long-book'].bodyIncluded, false);
    assert.equal(capabilities.writes['long-book'].createAvailable, false);
    assert.equal(capabilities.writes['long-book'].submissionAvailable, false);
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
