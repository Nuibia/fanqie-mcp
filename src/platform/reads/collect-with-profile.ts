import { type Page } from 'playwright';

import { type ProfileReadOptions, validateReadProfile } from './discard-changed-document.js';

import { type DatasetResult } from './is-metrics-dataset.js';

import {
  makeDataset,
  identifierOrNull,
  PlatformReadError,
  parseVisibleStatistics,
  numberOrNull,
} from './make-dataset.js';

import {
  navigate,
  pageLimit,
  inspectPageAccess,
  allowedUrl,
} from './project-read-response-fields.js';

export async function collectWithProfile(
  page: Page,
  dataset: string,
  options: ProfileReadOptions,
): Promise<DatasetResult> {
  const result = makeDataset(dataset, options.profile?.sourceUrl ?? null);
  const profile = options.profile;
  if (!profile) {
    result.limitations.push(
      'This authenticated page and its field/pagination selectors have not been verified. Supply an operator-verified read profile.',
    );
    return result;
  }
  try {
    validateReadProfile(profile);
    if (profile.sourceUrl.includes('{workId}') && !identifierOrNull(options.workId))
      throw new PlatformReadError('invalid_work_id', 'A stable work ID is required');
    const sourceUrl = profile.sourceUrl.replaceAll('{workId}', options.workId ?? '');
    result.sourceUrl = sourceUrl;
    await navigate(page, sourceUrl, options.timeoutMs);
    const seen = new Set<string>();
    let previous = '';
    for (let index = 1; index <= pageLimit(options); index += 1) {
      const access = await inspectPageAccess(page);
      if (access.loginRequired) {
        result.status = 'login_required';
        result.records = [];
        result.coverage.recordsFetched = 0;
        return result;
      }
      if (profile.statisticsSelector)
        Object.assign(
          result,
          parseVisibleStatistics(
            await page.locator(profile.statisticsSelector).innerText(),
            result.capturedAt,
          ),
        );
      const snapshot = await page.evaluate((profile) => {
        const rows = [...document.querySelectorAll(profile.rowSelector)].map((row) =>
          Object.fromEntries(
            Object.entries(profile.fields).map(([key, field]) => {
              const element = field.selector ? row.querySelector(field.selector) : row;
              let value = field.attribute
                ? (element?.getAttribute(field.attribute) ?? '')
                : (element?.textContent?.trim() ?? '');
              if (field.pattern) value = value.match(new RegExp(field.pattern))?.[1] ?? '';
              return [key, value];
            }),
          ),
        );
        const emptyElement = profile.emptySelector
          ? document.querySelector(profile.emptySelector)
          : null;
        const empty = Boolean(
          emptyElement && (emptyElement as HTMLElement).getBoundingClientRect().height > 0,
        );
        const next = profile.pagination
          ? document.querySelector(profile.pagination.nextSelector)
          : null;
        const disabled = Boolean(
          profile.pagination && document.querySelector(profile.pagination.disabledSelector),
        );
        return { rows, empty, hasNext: Boolean(next), nextDisabled: disabled };
      }, profile);
      if (!snapshot.rows.length && !snapshot.empty) {
        result.errors.push({ code: 'collection_dom_unrecognized', scope: dataset, page: index });
        break;
      }
      const signature = snapshot.rows.map((row) => row[profile.idField]).join(',');
      if (index > 1 && signature === previous) {
        result.errors.push({ code: 'pagination_not_advancing', scope: dataset, page: index });
        break;
      }
      previous = signature;
      result.coverage.pagesFetched += 1;
      for (const raw of snapshot.rows) {
        const record: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(profile.fields)) {
          const value = raw[key] ?? '';
          record[key] =
            field.type === 'number'
              ? numberOrNull(value)
              : field.type === 'identifier'
                ? identifierOrNull(value)
                : value || null;
          if (field.type === 'url' && value) {
            try {
              record[key] = allowedUrl(value).toString();
            } catch {
              record[key] = null;
            }
          }
        }
        const id = record[profile.idField];
        if (typeof id !== 'string' || !id || seen.has(id)) {
          result.errors.push({
            code: 'missing_or_duplicate_record_id',
            scope: dataset,
            page: index,
          });
          continue;
        }
        seen.add(id);
        result.records.push(record);
      }
      if (snapshot.empty || (profile.pagination && snapshot.nextDisabled)) {
        result.coverage.paginationComplete = true;
        break;
      }
      if (!profile.pagination) {
        result.limitations.push(
          'No verified pagination controls were configured; only the visible page was read.',
        );
        break;
      }
      if (!snapshot.hasNext) {
        result.errors.push({ code: 'pagination_control_missing', scope: dataset, page: index });
        break;
      }
      if (index === pageLimit(options)) {
        result.errors.push({ code: 'pagination_limit_reached', scope: dataset });
        break;
      }
      const oldRows = signature;
      await page.locator(profile.pagination.nextSelector).click();
      try {
        await page.waitForFunction(
          ({ profile, oldRows }) => {
            const signature = [...document.querySelectorAll(profile.rowSelector)]
              .map((row) => {
                const field = profile.fields[profile.idField]!;
                const element = field.selector ? row.querySelector(field.selector) : row;
                const value = field.attribute
                  ? (element?.getAttribute(field.attribute) ?? '')
                  : (element?.textContent?.trim() ?? '');
                return field.pattern ? (value.match(new RegExp(field.pattern))?.[1] ?? '') : value;
              })
              .join(',');
            return signature.length > 0 && signature !== oldRows;
          },
          { profile, oldRows },
          { timeout: options.timeoutMs ?? 8_000 },
        );
      } catch {
        result.errors.push({ code: 'pagination_switch_timeout', scope: dataset, page: index + 1 });
        break;
      }
    }
    result.coverage.recordsFetched = result.records.length;
    result.coverage.fields = Object.keys(profile.fields);
    result.coverage.complete = result.coverage.paginationComplete && result.errors.length === 0;
    result.status = result.coverage.complete
      ? 'success'
      : result.records.length
        ? 'partial'
        : 'capability_unavailable';
    result.limitations.push(
      `Selectors were configured from operator evidence verified at ${profile.verifiedAt}; unsupported fields are not synthesized.`,
    );
  } catch (error) {
    result.errors.push({
      code: error instanceof PlatformReadError ? error.code : 'read_failed',
      scope: dataset,
    });
    result.status = result.records.length ? 'partial' : 'capability_unavailable';
  }
  return result;
}

export interface LongWork extends Record<string, unknown> {
  workId: string;
  title: string;
  statusCode: number | null;
  category: string | null;
  createdAtRaw: string | null;
  wordCount: number | null;
  managementReadCount: number | null;
  creationStatusCode: number | null;
  lastChapterAtRaw: string | null;
  lastChapterId: string | null;
  chapterCount: number | null;
  contractStatusCode: number | null;
}
