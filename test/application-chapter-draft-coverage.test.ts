import test from 'node:test';

import { mkdtempSync, rmSync, readdirSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { draftDirectoryApplicationFixture } from './helpers/application-builtin-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import {
  chapterBodyApplicationFixture,
  editorDefaultGateApplicationFixture,
} from './helpers/application-chapter-body-application-fixture.js';

import { type Job } from '../src/runtime/store.js';

test('chapter draft partial and late failure attempts cannot replace the complete draft manifest and exact empty scope can complete', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-draft-attempt-'));
  const fixture = draftDirectoryApplicationFixture(directory);
  try {
    await fixture.call();
    const baseline = await fixture.snapshot();
    for (const mode of ['partial', 'late_failure'] as const) {
      fixture.setMode(mode);
      const attempt = await fixture.call();
      assert.equal(attempt.job.status, 'partial');
      assert.equal(attempt.job.error.code, 'capability_unavailable');
      assert.equal(attempt.evidence.length, 1);
      assert.equal(attempt.evidence[0].dataset, 'chapter_drafts');
      assert.equal(attempt.data[0].coverage.complete, false);
      assert.deepEqual(await fixture.snapshot(), baseline);
      if (mode === 'partial') assert.equal(attempt.data[0].records.length, 1);
      else {
        assert.deepEqual(attempt.data[0].records, []);
        assert.equal(attempt.data[0].coverage.pagesFetched, 0);
      }
    }
    fixture.setMode('empty');
    const empty = await fixture.call();
    assert.equal(empty.job.status, 'succeeded');
    assert.equal(empty.data[0].coverage.totalRecords, 0);
    assert.equal(empty.data[0].coverage.pagesFetched, 1);
    assert.deepEqual(empty.data[0].records, []);
    assert.notEqual((await fixture.snapshot()).manifest.id, baseline.manifest.id);
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('chapter draft tool rejects unobserved or wrong typed owner, outside error proof and nonstrict inputs before evidence/promotion', async () => {
  for (const mode of ['unproved', 'mismatch', 'outside_error'] as const) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-draft-binding-'));
    const fixture = draftDirectoryApplicationFixture(directory);
    fixture.setMode(mode);
    try {
      const result = await fixture.call();
      assert.equal(result.job.status, 'failed');
      assert.deepEqual(result.data, []);
      assert.deepEqual(result.evidence, []);
      assert.equal((await fixture.snapshot()).manifest, null);
      assert.equal(JSON.stringify(result).includes('PRIVATE_DRAFT_EXTERNAL_ERROR'), false);
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-draft-input-'));
  const fixture = draftDirectoryApplicationFixture(directory);
  try {
    for (const args of [
      { workId: '1' },
      { workId: 1234567890 },
      { workId: '7600000000000000001', verified: true },
      { workId: '7600000000000000001', url: 'https://external.invalid' },
    ])
      await assert.rejects(
        fixture.application.dispatch(
          'POST',
          '/api/v1/tools/fanqie_list_chapter_drafts',
          new URLSearchParams(),
          args,
        ),
      );
    assert.equal(fixture.collections, 0);
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('chapter body tool commits only its single author-edit namespace with immutable exact content evidence and never replaces it on failed attempts', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-body-namespace-'));
  const fixture = chapterBodyApplicationFixture(directory);
  try {
    const tool = fixture.application.tools.find((item) => item.name === 'fanqie_get_chapter');
    assert(tool);
    assert.equal(tool.readOnly, true);
    assert.equal(fixture.application.tools.length, 40);
    const live = await fixture.call();
    assert.equal(live.job.status, 'succeeded');
    assert.equal(live.job.operation, 'get_chapter');
    assert.equal(live.job.scope, fixture.scope);
    assert.deepEqual(live.job.datasets, ['chapter_body']);
    assert.equal(live.data[0].records[0].publishedVersionVerified, false);
    assert.equal(live.data[0].records[0].rawContent === fixture.rawContent, true);
    const saved = await fixture.snapshot();
    assert(saved.manifest);
    assert.equal(JSON.stringify(saved.data) === JSON.stringify(live.data), true);
    assert.equal(saved.manifest.id, live.job.result.manifest.id);
    assert.equal(saved.data[0].evidenceHash, live.evidence[0].sha256);
    assert.equal(saved.data[0].evidenceCapturedAt, live.evidence[0].capturedAt);
    for (const scope of [
      'account',
      'chapters.7600000000000000001',
      'chapter_drafts.7600000000000000001',
    ])
      assert.equal(
        (
          (await fixture.application.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope }),
            undefined,
          )) as any
        ).manifest,
        null,
      );
    fixture.setMode('failure');
    const failed = await fixture.call();
    assert.equal(failed.job.status, 'partial');
    assert.equal(failed.data[0].coverage.complete, false);
    assert.equal(failed.data[0].records.length, 0);
    assert.equal(failed.evidence.length, 1);
    assert.equal(JSON.stringify(await fixture.snapshot()) === JSON.stringify(saved), true);
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('chapter body tool refuses unobserved wrong-owner outside proof and caller URL or capability fields without exposing body errors', async () => {
  for (const mode of ['unproved', 'mismatch', 'outside_error'] as const) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-body-binding-'));
    const fixture = chapterBodyApplicationFixture(directory);
    fixture.setMode(mode);
    try {
      const result = await fixture.call();
      assert.equal(result.job.status, 'failed');
      assert.equal(result.data.length, 0);
      assert.equal(result.evidence.length, 0);
      assert.equal((await fixture.snapshot()).manifest, null);
      assert.equal(
        JSON.stringify(result).includes('PRIVATE_BODY_EXTERNAL_PROOF') ||
          JSON.stringify(result).includes(fixture.rawContent),
        false,
      );
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-body-input-'));
  const fixture = chapterBodyApplicationFixture(directory);
  try {
    for (const args of [
      { workId: '7600000000000000001', chapterId: '1' },
      {
        workId: '7600000000000000001',
        chapterId: '7800000000000000001',
        sourceUrl: 'https://external.invalid',
      },
      { workId: '7600000000000000001', chapterId: '7800000000000000001', verified: true },
      { workId: '0000000000000000000', chapterId: '7800000000000000001' },
    ])
      await assert.rejects(
        fixture.application.dispatch(
          'POST',
          '/api/v1/tools/fanqie_get_chapter',
          new URLSearchParams(),
          args,
        ),
      );
    assert.equal(fixture.collections, 0);
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('editor default guard rejects four valid editor-backed tools before login, queue or navigation and preserves complete saved scopes', async () => {
  for (const configuredProfile of [false, true]) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-editor-default-guard-'));
    const fixture = await editorDefaultGateApplicationFixture(directory, false, configuredProfile);
    try {
      const jobs = JSON.stringify(await fixture.jobs()),
        snapshots = await Promise.all(fixture.scopes.map((scope) => fixture.snapshot(scope)));
      assert.equal(
        snapshots.every((value) => (value as { manifest?: unknown }).manifest != null),
        true,
      );
      for (const call of fixture.calls) {
        const tool = fixture.application.tools.find((item) => item.name === call.name);
        assert(tool);
        await assert.rejects(tool.run(call.args), { code: 'writes_disabled' });
        await assert.rejects(
          fixture.application.dispatch(
            'POST',
            `/api/v1/tools/${call.name}`,
            new URLSearchParams(),
            call.args,
          ),
          { code: 'writes_disabled' },
        );
        assert.equal(JSON.stringify(await fixture.jobs()) === jobs, true);
        assert.equal(
          JSON.stringify(
            await Promise.all(fixture.scopes.map((scope) => fixture.snapshot(scope))),
          ) === JSON.stringify(snapshots),
          true,
        );
        assert.deepEqual(fixture.counts(), { loginCalls: 0, pageCalls: 0, editorNavigations: 0 });
      }
      const short = fixture.application.tools.find(
        (item) => item.name === 'fanqie_diagnose_editor',
      );
      assert(short);
      await assert.rejects(short.run({ target: { kind: 'short', workId: fixture.workId } }), {
        code: 'writes_disabled',
      });
      assert.equal(readdirSync(fixture.config.dataDir).includes('account-binding.json'), false);
      assert.equal(
        (await fixture.jobs()).jobs.find((job) => job.id === fixture.original.id)?.status,
        'uncertain',
      );
      assert.equal(JSON.stringify(await fixture.jobs()) === jobs, true);
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('editor default guard advertises editor side effects while retaining builtin body and directory read permissions and schemas', async () => {
  for (const enabled of [false, true]) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-editor-hints-'));
    const fixture = await editorDefaultGateApplicationFixture(directory, enabled);
    try {
      for (const call of fixture.calls) {
        const tool = fixture.application.tools.find((item) => item.name === call.name);
        assert(tool);
        assert.equal(tool.readOnly, false);
        assert.equal(tool.schema.safeParse(call.args).success, true);
        assert.equal(tool.description.includes('自动保存'), true);
      }
      for (const name of [
        'fanqie_get_chapter',
        'fanqie_list_chapters',
        'fanqie_list_chapter_drafts',
        'fanqie_diagnose_current_login',
        'fanqie_diagnose_read_page',
        'fanqie_get_saved_snapshot',
      ]) {
        const tool = fixture.application.tools.find((item) => item.name === name);
        assert(tool);
        assert.equal(tool.readOnly, true);
      }
      assert.equal(fixture.application.tools.length, 40);
      assert.deepEqual(fixture.counts(), { loginCalls: 0, pageCalls: 0, editorNavigations: 0 });
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('editor default guard leaves the original executeWrite disabled gate and enabled editor validation in place without claiming side-effect isolation', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-editor-existing-write-gate-'));
  const disabled = await editorDefaultGateApplicationFixture(directory);
  try {
    const before = JSON.stringify(await disabled.jobs());
    await assert.rejects(
      disabled.application.dispatch(
        'POST',
        '/api/v1/tools/fanqie_create_draft',
        new URLSearchParams(),
        {
          idempotencyKey: 'synthetic-disabled-write',
          clientReference: 'synthetic-not-created',
          content: { title: 'Synthetic title', body: 'Synthetic fixture only' },
        },
      ),
      { code: 'writes_disabled' },
    );
    assert.equal(JSON.stringify(await disabled.jobs()) === before, true);
    assert.deepEqual(disabled.counts(), { loginCalls: 0, pageCalls: 0, editorNavigations: 0 });
  } finally {
    await disabled.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
  const enabledDirectory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-editor-enabled-validation-'));
  const enabled = await editorDefaultGateApplicationFixture(enabledDirectory, true);
  try {
    const tool = enabled.application.tools.find(
      (item) => item.name === 'fanqie_get_editable_snapshot',
    );
    assert(tool);
    const result = (await tool.run(enabled.calls[1]!.args)) as { job: Job; data: unknown[] };
    assert.equal(result.job.status, 'failed');
    assert.equal(result.job.error?.code, 'capability_unavailable');
    assert.equal(result.data.length, 0);
    assert.deepEqual(enabled.counts(), { loginCalls: 1, pageCalls: 1, editorNavigations: 0 });
    assert.equal(tool.readOnly, false);
    assert.equal(
      (await enabled.jobs()).jobs.find((job) => job.id === enabled.original.id)?.status,
      'uncertain',
    );
  } finally {
    await enabled.application.close();
    rmSync(enabledDirectory, { recursive: true, force: true });
  }
});
