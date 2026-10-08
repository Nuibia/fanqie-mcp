import test from 'node:test';

import {
  makeDataset,
  parseVisibleStatistics,
  projectMetricTimeContext,
} from '../src/platform/reads.js';

import assert from 'node:assert/strict';

test('F03 cutoff facts: fresh missing-year facts are accepted, old inferred basis and accessor DTOs are refused', () => {
  const fresh = {
    ...makeDataset('long_metrics', null),
    ...parseVisibleStatistics('截至02-29 24:00', '2026-10-06T00:00:00Z'),
  };
  const projected = projectMetricTimeContext(fresh, false);
  assert.equal(projected.statisticsThrough, null);
  assert.equal(projected.statisticsThroughBasis, 'platform-visible-month-day;year-not-provided');
  assert.deepEqual(projectMetricTimeContext(projected, false), projected);
  const old = {
    ...fresh,
    statisticsThrough: '2024-02-29',
    statisticsThroughBasis: 'platform-visible-month-day;year-resolved-against-capture-date',
  };
  assert.throws(() => projectMetricTimeContext(old, false), {
    code: 'metric_time_context_unverified',
  });
  for (const key of [
    'statisticsThroughBasis',
    'statisticsThrough',
    'statisticsCutoffRaw',
    'capturedAt',
    'statisticsWindow',
  ]) {
    let called = 0;
    const accessor = Object.defineProperty({ ...old }, key, {
      get() {
        called++;
        throw Error('Must not execute cutoff accessor');
      },
      enumerable: true,
    });
    assert.throws(() => projectMetricTimeContext(accessor, true), {
      code: 'metric_time_context_unverified',
    });
    assert.equal(called, 0);
  }
  let limitsGetterCalls = 0;
  const accessorLimits = Object.defineProperty(['Synthetic limitation'], '0', {
    get() {
      limitsGetterCalls++;
      throw Error('Must not execute limitation accessor');
    },
    enumerable: true,
  });
  assert.throws(() => projectMetricTimeContext({ ...old, limitations: accessorLimits }, true), {
    code: 'metric_time_context_unverified',
  });
  assert.equal(limitsGetterCalls, 0);
  for (const changed of [
    { statisticsCutoffRaw: '截至2024-02-29' },
    { statisticsThrough: 'PRIVATE_DATE' },
    { statisticsThrough: '2026-02-29' },
  ])
    assert.throws(() => projectMetricTimeContext({ ...old, ...changed }, true), {
      code: 'metric_time_context_unverified',
    });
});
