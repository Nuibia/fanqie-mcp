import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectPublicActivities,
  collectWriterArticle,
  collectWriterClasses,
  type PublicFetch,
} from '../src/platform/public.js';
import { type DatasetResult } from '../src/platform/reads.js';

const CLOCK = Date.parse('2026-10-03T00:00:00.000Z');
const ARTICLE_ID = '8100000000000000001';
function ssr(route: string, value: unknown): string {
  return (
    '<script>window._ROUTER_DATA = ' +
    JSON.stringify({ loaderData: { [route]: value } }) +
    ';</script>'
  );
}
function digest(result: DatasetResult<unknown>): string {
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.paginationComplete, true);
  assert.match(result.contentFingerprint ?? '', /^[a-f0-9]{64}$/);
  return result.contentFingerprint!;
}
function activitiesFetch(reverse = false, revised = false, incomplete = false): PublicFetch {
  const values = [
    {
      title: revised ? 'Fixture activity revised' : 'Fixture activity A',
      link: '/writer/zone/fixture-a',
      introduction: ['Fixture introduction'],
      start_time: '2026-06-01',
      end_time: null,
      is_permanent: false,
    },
    {
      title: 'Fixture activity B',
      link: '/writer/zone/fixture-b',
      introduction: [],
      start_time: 0,
      end_time: '2026-07-01',
      is_permanent: true,
    },
  ];
  return async () =>
    new Response(
      ssr('solicit-activity', {
        total_count: incomplete ? 3 : 2,
        activity_list: reverse ? [...values].reverse() : values,
      }),
    );
}
function classesFetch(reverse = false, revised = false, incomplete = false): PublicFetch {
  return async (input) => {
    const url = new URL(String(input));
    const api = url.pathname === '/api/node/tutorial/list';
    const tab = Number(url.searchParams.get(api ? 'type' : 'tab'));
    assert.ok([1, 2, 3, 4, 5].includes(tab));
    const values = [
      {
        title: revised && tab === 3 ? 'Fixture class revised' : 'Fixture class A',
        link: '/writer/zone/article/' + ARTICLE_ID,
        create_time: '2026-06-01',
        is_video: false,
      },
      {
        title: 'Fixture class B',
        link: '/writer/zone/article/8100000000000000002',
        create_time: 123,
        is_video: 0,
      },
    ];
    const list = reverse ? [...values].reverse() : values;
    return api
      ? Response.json({ code: 0, data: { tutorial_list: incomplete ? [] : list } })
      : new Response(ssr('tutorial', { total_count: incomplete ? 3 : 2, tutorial_list: list }));
  };
}
function articleFetch(overrides: Record<string, unknown> = {}): PublicFetch {
  return async () =>
    new Response(
      ssr('article', {
        title: 'Fixture article',
        content: '<p>Fixture article text</p><img src="https://media.invalid/fixture.png">',
        create_time: '2026-06-01',
        ...overrides,
      }),
    );
}

test('activity content fingerprints survive capture-time and source-order changes but never complete a partial list', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const first = await collectPublicActivities(undefined, { fetchImpl: activitiesFetch() });
  const firstDigest = digest(first);
  t.mock.timers.setTime(CLOCK + 86_400_000);
  const reordered = await collectPublicActivities(undefined, { fetchImpl: activitiesFetch(true) });
  assert.notEqual(first.capturedAt, reordered.capturedAt);
  assert.notDeepEqual(first.records, reordered.records);
  assert.equal(digest(reordered), firstDigest);
  assert.equal(first.records[0]!.startTimeRaw, reordered.records[1]!.startTimeRaw);
  assert.notEqual(
    digest(await collectPublicActivities(undefined, { fetchImpl: activitiesFetch(false, true) })),
    firstDigest,
  );
  const partial = await collectPublicActivities(undefined, {
    fetchImpl: activitiesFetch(false, false, true),
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.records.length, 2);
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.contentFingerprint, null);
});

test('all-category catalog fingerprints preserve normalized content across SSR/API ordering and timestamps', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const first = await collectWriterClasses(undefined, { fetchImpl: classesFetch() });
  const firstDigest = digest(first);
  assert.equal(first.records.length, 10);
  assert.equal(first.coverage.pagesFetched, 10);
  assert.deepEqual([...new Set(first.records.map((row) => row.tab))], [1, 2, 3, 4, 5]);
  t.mock.timers.setTime(CLOCK + 86_400_000);
  const reordered = await collectWriterClasses(undefined, { fetchImpl: classesFetch(true) });
  assert.notEqual(first.capturedAt, reordered.capturedAt);
  assert.notDeepEqual(first.records, reordered.records);
  assert.equal(digest(reordered), firstDigest);
  assert.notEqual(
    digest(await collectWriterClasses(undefined, { fetchImpl: classesFetch(false, true) })),
    firstDigest,
  );
  const partial = await collectWriterClasses(undefined, {
    fetchImpl: classesFetch(false, false, true),
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.records.length, 10);
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.contentFingerprint, null);
});

test('article fingerprints cover returned text, image URLs, title and raw date, while failed reads remain null', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const first = await collectWriterArticle(ARTICLE_ID, { fetchImpl: articleFetch() });
  const firstDigest = digest(first);
  t.mock.timers.setTime(CLOCK + 86_400_000);
  const later = await collectWriterArticle(ARTICLE_ID, { fetchImpl: articleFetch() });
  assert.notEqual(first.capturedAt, later.capturedAt);
  assert.deepEqual(first.records, later.records);
  assert.equal(digest(later), firstDigest);
  for (const overrides of [
    { title: 'Fixture article revised' },
    { create_time: '2026-06-02' },
    { content: '<p>Fixture revised text</p><img src="https://media.invalid/fixture.png">' },
    { content: '<p>Fixture article text</p><img src="https://media.invalid/revised.png">' },
  ])
    assert.notEqual(
      digest(await collectWriterArticle(ARTICLE_ID, { fetchImpl: articleFetch(overrides) })),
      firstDigest,
    );
  const hidden = await collectWriterArticle(ARTICLE_ID, {
    fetchImpl: articleFetch({
      content:
        '<p>Fixture article text</p><img src="https://media.invalid/fixture.png"><script>fixtureOnly()</script><video src="https://media.invalid/clip.mp4"></video>',
    }),
  });
  assert.equal(digest(hidden), firstDigest);
  const failed = await collectWriterArticle(ARTICLE_ID, {
    fetchImpl: async () => new Response('Fixture unavailable', { status: 503 }),
  });
  assert.equal(failed.status, 'capability_unavailable');
  assert.equal(failed.records.length, 0);
  assert.equal(failed.coverage.complete, false);
  assert.equal(failed.contentFingerprint, null);
  const invalid = await collectWriterArticle('invalid', {
    fetchImpl: async () => {
      throw Error('An invalid ID cannot request a source');
    },
  });
  assert.equal(invalid.contentFingerprint, null);
});

test('activity publication dates stay explicitly unavailable without substituting schedule or capture dates', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const fetchImpl: PublicFetch = async () =>
    new Response(
      ssr('solicit-activity', {
        total_count: 3,
        activity_list: [
          {
            title: 'Fixture schedule',
            link: '/writer/zone/date-fixture-a',
            start_time: '2026-10-01',
            end_time: '2026-10-31',
          },
          { title: 'Fixture missing schedule', link: '/writer/zone/date-fixture-b' },
          {
            title: 'Fixture unverified date key',
            link: '/writer/zone/date-fixture-c',
            create_time: '2026-10-02',
            publish_time: '2026-10-03',
          },
        ],
      }),
    );
  const first = await collectPublicActivities(undefined, { fetchImpl });
  assert.equal(first.status, 'success');
  for (const row of first.records) {
    assert.equal(row.publishedAtRaw, null);
    assert.equal(row.publicationDateUnavailableReason, 'activity_card_publication_date_unverified');
  }
  assert.equal(first.records[0]!.startTimeRaw, '2026-10-01');
  assert.equal(first.records[0]!.endTimeRaw, '2026-10-31');
  assert.ok(first.coverage.fields.includes('publishedAtRaw'));
  assert.ok(first.coverage.fields.includes('publicationDateUnavailableReason'));
  assert.ok(
    first.limitations.some((x) => x.includes('capturedAt do not establish publication dates')),
  );
  t.mock.timers.setTime(CLOCK + 86_400_000);
  const later = await collectPublicActivities(undefined, { fetchImpl });
  assert.notEqual(first.capturedAt, later.capturedAt);
  assert.deepEqual(first.records, later.records);
  assert.equal(digest(first), digest(later));
});
