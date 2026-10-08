import {
  type CurrentChapterObservedReason,
  type CurrentChapterCanonicalBootstrapDiagnostic,
  type CurrentChapterSourceObservation,
  type DatasetStatus,
  type DatasetCoverage,
  type DatasetError,
  type ChapterVolumeRefreshDiagnostic,
} from './fanqie-origin.js';

import { PlatformReadError, parseVisibleStatistics } from './make-dataset.js';

/** Failure-stage observations from this collection call only; never source or coverage proof. */
export interface CurrentChapterCollectionFailureDiagnostic {
  kind: 'current_chapter_collection_failure';
  /** The code stage which observed failure, not an inferred root cause. */
  failedStage:
    | 'manager_entry'
    | 'pre_context_identity'
    | 'target_owner_binding'
    | 'canonical_bootstrap'
    | 'fresh_own_before'
    | 'volume_get'
    | 'directory_read'
    | 'fresh_own_after'
    | 'owner_callback'
    | 'cleanup';
  initialState: 'authenticated' | 'login_required' | 'challenge_required' | 'unknown' | null;
  identityTypes: {
    initialAuthenticated: boolean | null;
    initialAccountIdPresent: boolean | null;
    initialAuthorIdPresent: boolean | null;
    bindingAccountKind: boolean | null;
    bindingAuthorKind: boolean | null;
    expectedAccountKind: boolean;
    expectedAuthorKind: boolean;
    beforeParsedAccountIdPresent: boolean | null;
    beforeAccepted: boolean | null;
    afterParsedAccountIdPresent: boolean | null;
    afterAccepted: boolean | null;
  };
  ownAccountContext: {
    attempts: 0 | 1 | 2;
    disposed: 0 | 1 | 2;
    responseBefore:
      | 'not_observed'
      | 'success'
      | 'unauthorized'
      | 'forbidden'
      | 'redirect'
      | 'client_error'
      | 'server_error'
      | 'other';
    responseAfter:
      | 'not_observed'
      | 'success'
      | 'unauthorized'
      | 'forbidden'
      | 'redirect'
      | 'client_error'
      | 'server_error'
      | 'other';
  };
  callback: { entered: boolean; succeeded: boolean };
  /** First failure observation only; cleanup cannot overwrite it. Never copied from an error. */
  observedReason: CurrentChapterObservedReason;
  canonicalBootstrap: CurrentChapterCanonicalBootstrapDiagnostic | null;
  /** Only current collection failures; null when its private source bracket was not entered. */
  sourceObservation: CurrentChapterSourceObservation | null;
}

/** This named management scope excludes the independently unverified draft list. */
export interface ChapterManagementCoverage {
  scope: 'management_all_statuses';
  status: 'complete' | 'partial' | 'unverified';
  draftsCovered: false;
  inventoryVolumes: number;
  matchedVolumes: number;
  completedVolumes: number;
  pagesFetched: number;
  recordsFetched: number;
  allStatusObserved: boolean;
  inventoryReconciled: boolean;
  reasons: Array<
    | 'management_ui_unverified'
    | 'volume_options_unbound'
    | 'volume_inventory_unreconciled'
    | 'volume_option_changed'
    | 'pagination_query_unverified'
    | 'next_unavailable'
    | 'view_source_missing'
    | 'view_source_ambiguous'
    | 'read_budget_exceeded'
    | 'volume_count_mismatch'
  >;
}

/** Historical known-control counts only. This optional field never establishes coverage. */
export interface ChapterManagementControlObservation {
  kind: 'management_next_control_observation';
  rootCount: number;
  rawKnownNextCount: number;
  eligibleNextCount: number;
  tags: {
    button: number;
    li: number;
    div: number;
    a: number;
    span: number;
    input: number;
    other: number;
  };
  roleButtonCount: number;
  disabledCount: number;
  visibleCount: number;
  truncated: boolean;
}

export interface StatisticsWindowUnknown {
  status: 'unknown';
  start: null;
  end: null;
  reason: 'platform_window_unverified' | 'legacy_window_not_recorded';
}

export interface StatisticsTimezoneUnknown {
  status: 'unknown';
  value: null;
  reason: 'platform_statistics_timezone_unverified' | 'legacy_statistics_timezone_not_recorded';
}

export function isMetricsDataset(dataset: string): boolean {
  return dataset === 'short_metrics' || dataset === 'long_metrics';
}

export function metricTimeContext(legacy = false) {
  return {
    statisticsWindow: {
      status: 'unknown',
      start: null,
      end: null,
      reason: legacy ? 'legacy_window_not_recorded' : 'platform_window_unverified',
    } as StatisticsWindowUnknown,
    statisticsTimezone: {
      status: 'unknown',
      value: null,
      reason: legacy
        ? 'legacy_statistics_timezone_not_recorded'
        : 'platform_statistics_timezone_unverified',
    } as StatisticsTimezoneUnknown,
    limitations: legacy
      ? [
          '统计窗口未知：这份历史结果未记录统计窗口。',
          '统计时区未知：这份历史结果未记录平台统计时区。',
        ]
      : [
          '统计窗口未知：当前已核来源未建立统计起止范围。',
          '统计时区未知：当前已核来源未建立平台统计时区。',
        ],
  };
}

export const MISSING_CUTOFF_YEAR_BASIS = 'platform-visible-month-day;year-not-provided';

const LEGACY_INFERRED_CUTOFF_YEAR_BASIS =
  'platform-visible-month-day;year-resolved-against-capture-date';

const PROJECTED_LEGACY_CUTOFF_YEAR_BASIS =
  'platform-visible-month-day;year-not-provided;legacy-inferred-year-discarded';

const MISSING_CUTOFF_YEAR_LIMITATION = '统计截止年份未知：来源页面仅提供月日，完整统计日期未知。';

const LEGACY_CUTOFF_YEAR_LIMITATION =
  '历史截止推断已隔离：原结果曾按采集日期补年，公开投影不将该推断视为平台完整日期。';

/** Historical projection changes the public view only; new collections cannot carry inferred cutoff years. */
export function projectMetricTimeContext<T extends object>(
  payload: T,
  allowLegacy: boolean,
): T & ReturnType<typeof metricTimeContext> {
  const fail = () => {
    throw new PlatformReadError(
      'metric_time_context_unverified',
      'Statistics time context is unavailable.',
    );
  };
  if (
    !payload ||
    Array.isArray(payload) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(payload))
  )
    return fail();
  const descriptors = Object.getOwnPropertyDescriptors(payload);
  // Do not execute accessors while examining or copying an evidence-bearing DTO.
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => !Object.hasOwn(Reflect.get(descriptors, key), 'value'),
    )
  )
    return fail();
  const window = descriptors.statisticsWindow,
    timezone = descriptors.statisticsTimezone;
  const absent = !window && !timezone;
  if (absent && !allowLegacy) return fail();
  const exact = (descriptor: PropertyDescriptor | undefined, required: object) => {
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    const value = descriptor.value;
    if (
      !value ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return false;
    const fields = Object.getOwnPropertyDescriptors(value);
    return (
      Reflect.ownKeys(value).length === Object.keys(required).length &&
      Object.entries(required).every(
        ([key, field]) =>
          fields[key] && Object.hasOwn(fields[key]!, 'value') && fields[key]!.value === field,
      )
    );
  };
  let expected = metricTimeContext(absent);
  if (
    !absent &&
    (!exact(window, expected.statisticsWindow) || !exact(timezone, expected.statisticsTimezone))
  ) {
    const historical = metricTimeContext(true);
    if (
      !allowLegacy ||
      !exact(window, historical.statisticsWindow) ||
      !exact(timezone, historical.statisticsTimezone)
    )
      return fail();
    expected = historical;
  }
  const limits = descriptors.limitations;
  if (!limits || !Object.hasOwn(limits, 'value') || !Array.isArray(limits.value)) return fail();
  const limitFields = Object.getOwnPropertyDescriptors(limits.value as object);
  const storedLimits: string[] = [];
  if (Reflect.ownKeys(limitFields).length !== limitFields.length!.value + 1) return fail();
  for (let index = 0; index < limitFields.length!.value; index += 1) {
    const field = limitFields[String(index)];
    if (!field || !Object.hasOwn(field, 'value') || typeof field.value !== 'string') return fail();
    storedLimits.push(field.value);
  }
  const basis = descriptors.statisticsThroughBasis?.value;
  const projectedLegacy = basis === PROJECTED_LEGACY_CUTOFF_YEAR_BASIS;
  const inferredLegacy = basis === LEGACY_INFERRED_CUTOFF_YEAR_BASIS;
  const missingYear = basis === MISSING_CUTOFF_YEAR_BASIS || inferredLegacy || projectedLegacy;
  let cutoffProjection: { statisticsThrough: null; statisticsThroughBasis: string } | undefined;
  if (missingYear) {
    if ((inferredLegacy || projectedLegacy) && !allowLegacy) return fail();
    const raw = descriptors.statisticsCutoffRaw?.value;
    if (
      typeof raw !== 'string' ||
      parseVisibleStatistics(raw, '').statisticsThroughBasis !== MISSING_CUTOFF_YEAR_BASIS
    )
      return fail();
    if (!inferredLegacy && descriptors.statisticsThrough?.value !== null) return fail();
    if (inferredLegacy) {
      const date = descriptors.statisticsThrough?.value;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail();
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
        return fail();
    }
    cutoffProjection = {
      statisticsThrough: null,
      statisticsThroughBasis:
        inferredLegacy || projectedLegacy
          ? PROJECTED_LEGACY_CUTOFF_YEAR_BASIS
          : MISSING_CUTOFF_YEAR_BASIS,
    };
  }
  const reasons = [
    ...expected.limitations,
    ...(missingYear ? [MISSING_CUTOFF_YEAR_LIMITATION] : []),
    ...(inferredLegacy || projectedLegacy ? [LEGACY_CUTOFF_YEAR_LIMITATION] : []),
  ];
  return {
    ...payload,
    ...cutoffProjection,
    statisticsWindow: expected.statisticsWindow,
    statisticsTimezone: expected.statisticsTimezone,
    limitations: [...storedLimits, ...reasons.filter((value) => !storedLimits.includes(value))],
  };
}

export interface DatasetResult<T = Record<string, unknown>> {
  status: DatasetStatus;
  dataset: string;
  records: T[];
  coverage: DatasetCoverage;
  sourceUrl: string | null;
  capturedAt: string;
  /** Complete returned public-record content only; excludes capture time and embedded media pixels/transcription. */
  contentFingerprint?: string | null;
  /** Per-job management-only coverage. Never promotes the generic chapter snapshot. */
  managementCoverage?: ChapterManagementCoverage;
  /** Valid incomplete manager attempt only, after final proof and cleanup. Not present on stale/failure. */
  managementControlObservation?: ChapterManagementControlObservation;
  statisticsThrough: string | null;
  statisticsThroughBasis: string | null;
  statisticsCutoffRaw: string | null;
  platformUpdateSchedule: string | null;
  statisticsWindow?: StatisticsWindowUnknown;
  statisticsTimezone?: StatisticsTimezoneUnknown;
  limitations: string[];
  errors: DatasetError[];
  /** Debug metadata only, retained solely for an incomplete chapter attempt. */
  readDiagnostics?: {
    chapterVolumeRefresh?: ChapterVolumeRefreshDiagnostic;
    currentChapterCollection?: CurrentChapterCollectionFailureDiagnostic;
  };
}
