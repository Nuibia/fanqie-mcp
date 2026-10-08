import test from 'node:test';

import { makeDataset } from '../src/platform/reads.js';

import { f03SavedFixture } from './helpers/application-a6-unclosed.js';

import assert from 'node:assert/strict';

for (const dataset of ['short_metrics', 'long_metrics'])
  test(`F03 metrics time context: legacy ${dataset} all saved outlets append reasons without altering evidence or jobs`, async () => {
    const payload = {
      ...makeDataset(dataset, null),
      statisticsThrough: '2026-10-01',
      statisticsThroughBasis: 'platform-visible-cutoff',
      limitations: ['Synthetic existing limitation', 'Synthetic existing limitation'],
    };
    delete payload.statisticsWindow;
    delete payload.statisticsTimezone;
    const f = await f03SavedFixture(payload, dataset);
    try {
      const get = () =>
        f.application.dispatch(
          'GET',
          `/api/v1/jobs/${f.job.id}`,
          new URLSearchParams(),
          undefined,
        ) as Promise<Record<string, any>>;
      const detail = await get(),
        mcp = (await f.application.tools
          .find((item) => item.name === 'fanqie_get_job')!
          .run({ jobId: f.job.id })) as Record<string, any>;
      const saved = (await f.application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: f.scope }),
        undefined,
      )) as Record<string, any>;
      const history = (await f.application.dispatch(
        'GET',
        '/api/v1/history',
        new URLSearchParams({ scope: f.scope }),
        undefined,
      )) as Record<string, any>;
      assert.deepEqual(mcp, detail);
      assert.equal(detail.sourceMode, 'saved');
      assert.equal(detail.retrievalMode, 'saved');
      for (const data of [detail.data[0], saved.data[0], history.manifests[0].data[0]]) {
        assert.equal(data.statisticsWindow.reason, 'legacy_window_not_recorded');
        assert.equal(data.statisticsTimezone.reason, 'legacy_statistics_timezone_not_recorded');
        assert.equal(data.statisticsThrough, '2026-10-01');
        assert.deepEqual(data.limitations.slice(0, 2), [
          'Synthetic existing limitation',
          'Synthetic existing limitation',
        ]);
        assert(data.limitations.some((value: string) => value.startsWith('统计窗口未知：')));
        assert(data.limitations.some((value: string) => value.startsWith('统计时区未知：')));
        assert.equal(data.sourceRef, f.ref.id);
        assert.equal(data.evidenceHash, f.ref.sha256);
        assert.equal(data.evidenceCapturedAt, f.ref.capturedAt);
        assert.equal(data.capturedAt, payload.capturedAt);
      }
      assert.equal(f.browserCalls, 0);
    } finally {
      await f.closeAndVerify();
    }
  });

test('F03 metrics time context: evidence dataset controls projection, never payload dataset', async () => {
  const payload = { ...makeDataset('short_works', null), dataset: 'short_metrics' };
  const f = await f03SavedFixture(payload, 'short_works');
  try {
    const detail = (await f.application.dispatch(
      'GET',
      `/api/v1/jobs/${f.job.id}`,
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    assert.equal(detail.data[0].statisticsWindow, undefined);
    assert.deepEqual(detail.data[0].limitations, []);
  } finally {
    await f.closeAndVerify();
  }
  const metrics = { ...makeDataset('short_metrics', null), dataset: 'short_works' };
  delete metrics.statisticsWindow;
  delete metrics.statisticsTimezone;
  const g = await f03SavedFixture(metrics);
  try {
    const detail = (await g.application.dispatch(
      'GET',
      `/api/v1/jobs/${g.job.id}`,
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    assert.equal(detail.data[0].statisticsWindow.reason, 'legacy_window_not_recorded');
    assert.equal(detail.data[0].dataset, 'short_metrics');
  } finally {
    await g.closeAndVerify();
  }
});

test('F03 metrics time context: saved malformed or forged known fields are rejected across evidence outlets', async (t) => {
  const base = makeDataset('short_metrics', null);
  const missing = { ...base };
  delete missing.statisticsTimezone;
  const candidates = [
    missing,
    { ...base, statisticsWindow: { ...base.statisticsWindow, status: 'known' } },
    { ...base, statisticsWindow: { ...base.statisticsWindow, end: '2026-10-01' } },
    { ...base, statisticsTimezone: { ...base.statisticsTimezone, value: 'PRIVATE_FAKE_TIMEZONE' } },
    {
      ...base,
      statisticsWindow: { ...base.statisticsWindow, reason: 'legacy_window_not_recorded' },
    },
    {
      ...base,
      statisticsTimezone: { ...base.statisticsTimezone, reason: 'platform_window_unverified' },
    },
    { ...base, statisticsWindow: { ...base.statisticsWindow, extra: 'PRIVATE_FAKE_FIELD' } },
  ];
  for (const [index, payload] of candidates.entries())
    await t.test(`invalid ${index}`, async () => {
      const f = await f03SavedFixture(payload);
      const refusal = {
        code: 'capability_unavailable',
        message: 'Statistics time context is unavailable.',
      };
      try {
        await assert.rejects(
          f.application.dispatch(
            'GET',
            `/api/v1/jobs/${f.job.id}`,
            new URLSearchParams(),
            undefined,
          ),
          refusal,
        );
        await assert.rejects(
          f.application.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope: f.scope }),
            undefined,
          ),
          refusal,
        );
        await assert.rejects(
          f.application.dispatch(
            'GET',
            '/api/v1/history',
            new URLSearchParams({ scope: f.scope }),
            undefined,
          ),
          refusal,
        );
        assert.equal(f.browserCalls, 0);
      } finally {
        await f.closeAndVerify();
      }
    });
});
