import test from 'node:test';

import { makeDataset, projectMetricTimeContext } from '../src/platform/reads.js';

import { f03SavedFixture } from './helpers/application-a6-unclosed.js';

import assert from 'node:assert/strict';

import { resumeAppFixture } from './helpers/application-resume-app-fixture.js';

import {
  r6AppRecords,
  r6AssertNoPrivateStatus,
} from './helpers/application-complete-diagnostic-privacy-fixture.js';

// F03 cutoff facts: immutable synthetic evidence, saved-only public projection.
for (const dataset of ['short_metrics', 'long_metrics'])
  for (const recordedContext of [false, true])
    test(`F03 cutoff facts: ${dataset} historical inferred year projects across API and MCP with context=${recordedContext}`, async () => {
      const payload = {
        ...makeDataset(dataset, null),
        statisticsThrough: '2026-09-29',
        statisticsThroughBasis: 'platform-visible-month-day;year-resolved-against-capture-date',
        statisticsCutoffRaw: '截止至09-29 24:00',
        platformUpdateSchedule: '每天12:00更新',
        records: [
          {
            statisticsBookId: '1001',
            title: 'Synthetic cutoff',
            readCount: 0,
            reportedReaderUvDaily: '--',
          },
        ],
      };
      if (!recordedContext) {
        delete payload.statisticsWindow;
        delete payload.statisticsTimezone;
      }
      const original = structuredClone(payload),
        f = await f03SavedFixture(payload, dataset);
      try {
        const apiJob = (await f.application.dispatch(
          'GET',
          `/api/v1/jobs/${f.job.id}`,
          new URLSearchParams(),
          undefined,
        )) as Record<string, any>;
        const mcpJob = (await f.application.tools
          .find((item) => item.name === 'fanqie_get_job')!
          .run({ jobId: f.job.id })) as Record<string, any>;
        const saved = (await f.application.dispatch(
          'GET',
          '/api/v1/snapshot',
          new URLSearchParams({ scope: f.scope }),
          undefined,
        )) as Record<string, any>;
        const mcpSaved = (await f.application.tools
          .find((item) => item.name === 'fanqie_get_saved_snapshot')!
          .run({ scope: f.scope })) as Record<string, any>;
        const history = (await f.application.dispatch(
          'GET',
          '/api/v1/history',
          new URLSearchParams({ scope: f.scope }),
          undefined,
        )) as Record<string, any>;
        assert.deepEqual(mcpJob, apiJob);
        assert.deepEqual(mcpSaved, saved);
        assert.deepEqual(saved.manifest, (f.job.result as Record<string, unknown>)?.manifest);
        assert.deepEqual(history.manifests[0].manifest, saved.manifest);
        assert.deepEqual(apiJob.job, f.job);
        for (const data of [
          apiJob.data[0],
          mcpJob.data[0],
          saved.data[0],
          mcpSaved.data[0],
          history.manifests[0].data[0],
        ]) {
          assert.equal(data.statisticsThrough, null);
          assert.equal(
            data.statisticsThroughBasis,
            'platform-visible-month-day;year-not-provided;legacy-inferred-year-discarded',
          );
          assert.equal(data.statisticsCutoffRaw, original.statisticsCutoffRaw);
          assert.equal(data.platformUpdateSchedule, original.platformUpdateSchedule);
          assert.deepEqual(data.records, original.records);
          assert.equal(data.sourceRef, f.ref.id);
          assert.equal(data.evidenceHash, f.ref.sha256);
          assert.equal(data.evidenceCapturedAt, f.ref.capturedAt);
          assert.equal(data.capturedAt, original.capturedAt);
          assert.equal(
            data.statisticsWindow.reason,
            recordedContext ? 'platform_window_unverified' : 'legacy_window_not_recorded',
          );
          const again = projectMetricTimeContext(data, true);
          assert.deepEqual(again, data);
          assert.equal(
            data.limitations.filter((value: string) => value.startsWith('历史截止推断已隔离：'))
              .length,
            1,
          );
        }
        assert.equal(f.browserCalls, 0);
        assert.deepEqual(payload, original);
      } finally {
        await f.closeAndVerify();
      }
    });

test('R6 native standalone App HTTP and MCP carriers have exact public keys and no private status witnesses', async () => {
  const f = await resumeAppFixture();
  try {
    f.state.published = true;
    f.state.displayStatus = 4;
    const live = (await f.invoke('get_editable_snapshot', {
      target: { kind: 'short', workId: '1234567890123456789' },
    })) as Record<string, any>;
    assert.deepEqual(
      Object.keys(live).sort(),
      ['job', 'retrievalMode', 'sourceMode', 'evidence', 'data'].sort(),
    );
    assert.equal(live.job.status, 'succeeded');
    assert.equal(live.job.state, 'reviewing');
    assert.equal(live.retrievalMode, 'live');
    const expectedFacts = {
      schema: 'fanqie-short-status-facts/v1',
      source: 'editor_edit_v1',
      basis: 'editor-publish-and-display/v1',
      editor: { namespace: 'publish_status', raw: 1, presence: 'observed', branch: 'non_draft' },
      management: {
        namespace: 'display_status',
        raw: 4,
        presence: 'observed',
        label: '审核中',
        state: 'reviewing',
        basis: 'observed_code',
      },
      resolvedState: 'reviewing',
      draftEditable: false,
      conflict: false,
      reasons: [],
    };
    assert.deepEqual(live.job.statusFacts, expectedFacts);
    assert.deepEqual(live.data[0].statusFacts, expectedFacts);
    assert.deepEqual(
      Object.keys(live.job).sort(),
      [
        'id',
        'accountId',
        'ownerId',
        'kind',
        'operation',
        'scope',
        'datasets',
        'idempotencyKey',
        'inputHash',
        'status',
        'requestedAt',
        'startedAt',
        'platformReadStartedAt',
        'platformWriteStartedAt',
        'endedAt',
        'updatedAt',
        'result',
        'error',
        'target',
        'metadata',
        'timeoutMs',
        'deadlineAt',
        'cancellationRequestedAt',
        'cancellationReason',
        'state',
        'statusFacts',
        'statusSource',
        'statusEvidence',
      ].sort(),
    );
    assert.deepEqual(
      Object.keys(live.data[0]).sort(),
      [
        'title',
        'body',
        'metadata',
        'accountId',
        'target',
        'state',
        'contentHash',
        'sourceUrl',
        'platformReadAt',
        'statusFacts',
        'source',
        'sourceRef',
        'evidenceHash',
        'evidenceCapturedAt',
        'dataset',
        'statusSource',
      ].sort(),
    );
    const records = r6AppRecords(f, 'editable_snapshot');
    assert.equal(records.length, 1);
    const saved = records[0]!,
      ref = saved.refs[0]!.ref;
    assert.equal(saved.manifestCount, 1);
    assert.equal(saved.metadata.genericShortStatus.stage, 'completed');
    assert.deepEqual(saved.metadata.genericShortStatus.provenance, {
      mode: 'fixture',
      executor: 'dependency-injected-browser/v1',
    });
    assert.equal(saved.refs[0]!.document.collectionMode, 'fixture');
    assert.equal(saved.refs[0]!.document.payload.phase, 'snapshot_read');
    assert.deepEqual(live.job.statusSource, {
      phase: 'snapshot_read',
      sourceRef: ref.id,
      evidenceHash: ref.sha256,
      evidenceCapturedAt: ref.captured_at,
    });
    assert.deepEqual(live.job.statusEvidence, {
      id: ref.id,
      jobId: live.job.id,
      dataset: 'editable_snapshot',
      sha256: ref.sha256,
      capturedAt: ref.captured_at,
    });
    const before = { ...f.state, gotos: [...f.state.gotos] };
    const detail = (await f.application.dispatch(
      'GET',
      '/api/v1/jobs/' + live.job.id,
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    const mcp = await f.application.tools
      .find((tool) => tool.name === 'fanqie_get_job')!
      .run({ jobId: live.job.id });
    assert.deepEqual(mcp, detail);
    const snapshot = (await f.application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: 'editable_snapshot' }),
      undefined,
    )) as Record<string, any>;
    const history = (await f.application.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams({ scope: 'editable_snapshot' }),
      undefined,
    )) as Record<string, any>;
    const jobs = (await f.application.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    assert.deepEqual(
      Object.keys(snapshot).sort(),
      [
        'sourceMode',
        'manifest',
        'data',
        'state',
        'statusFacts',
        'statusSource',
        'statusEvidence',
      ].sort(),
    );
    for (const carrier of [
      detail.job,
      snapshot,
      history.manifests[0],
      jobs.jobs.find((job: Record<string, unknown>) => job.id === live.job.id),
    ]) {
      assert.equal(carrier.state, 'reviewing');
      assert.deepEqual(carrier.statusFacts, expectedFacts);
      assert.deepEqual(carrier.statusSource, live.job.statusSource);
      assert.deepEqual(carrier.statusEvidence, live.job.statusEvidence);
    }
    assert.equal(Object.hasOwn(history.manifests[0].data[0], 'dataset'), false);
    r6AssertNoPrivateStatus({ live, detail, mcp, snapshot, history, jobs });
    assert.deepEqual(f.state, before);
    assert.equal(f.state.saves, 0);
    assert.equal(f.state.fills, 0);
  } finally {
    await f.cleanup();
  }
});
