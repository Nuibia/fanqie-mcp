import { type Page } from 'playwright';

import { type ProfileReadOptions } from './discard-changed-document.js';

import { type DatasetResult } from './is-metrics-dataset.js';

import { collectWithProfile } from './collect-with-profile.js';

import { collectLongMetricsApi } from './collect-long-metrics-api.js';

export function collectLongMetrics(
  page: Page,
  options: ProfileReadOptions = {},
): Promise<DatasetResult> {
  return options.profile
    ? collectWithProfile(page, 'long_metrics', options)
    : collectLongMetricsApi(page, options);
}
