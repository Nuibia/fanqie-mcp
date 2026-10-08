import test from 'node:test';

import { draftsDiagnosticFixture } from './helpers/platform-reads-drafts-diagnostic-fixture.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import { BrowserSessionError } from '../src/platform/browser.js';

test('blocked draft unknown dynamic paths and external origins never retain lowercase title/token segments or origin values', async () => {
  const fixture = draftsDiagnosticFixture({
    blockedRequests: [
      {
        method: 'POST',
        url: `https://fanqienovel.com/api/author/chapter/private_title/${CHAPTER_ENTRY_FIXTURE_WORK}/private_token?payload=PRIVATE_BODY`,
      },
      {
        method: 'POST',
        url: 'https://private-external.invalid/api/author/book/private_lowercase_name/v9?token=PRIVATE_EXTERNAL_TOKEN',
      },
      {
        method: 'POST',
        url: 'https://fanqienovel.com/api/author/private_owner/private_title/%E7%A7%81%E5%AF%86?cookie=PRIVATE_COOKIE',
      },
    ],
  });
  const result = await fixture.diagnose();
  assert.deepEqual(result.chapterTab?.blockedRequests, {
    count: 3,
    truncated: false,
    entries: [
      {
        method: 'POST',
        resourceType: 'xhr',
        navigation: false,
        origin: 'platform',
        pathClass: 'unknown',
        pathTemplate: '/api/author/chapter/{opaque}/{opaque}/{opaque}',
        authorFamily: 'chapter',
        count: 1,
      },
      {
        method: 'POST',
        resourceType: 'xhr',
        navigation: false,
        origin: 'external',
        pathClass: 'unknown',
        pathTemplate: '/{opaque}/{opaque}/{opaque}/{opaque}/{opaque}',
        authorFamily: null,
        count: 1,
      },
      {
        method: 'POST',
        resourceType: 'xhr',
        navigation: false,
        origin: 'platform',
        pathClass: 'unknown',
        pathTemplate: '/api/author/{opaque}/{opaque}/{opaque}',
        authorFamily: null,
        count: 1,
      },
    ],
  });
  const serialized = JSON.stringify(result.chapterTab);
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    'private_title',
    'private_token',
    'private-external',
    'private_lowercase_name',
    'private_owner',
    'PRIVATE_',
    '%E7',
    'v9',
    'https://',
  ])
    assert.equal(serialized.includes(secret), false);
  assert.equal(fixture.blocked, 3);
  assert.equal(fixture.forwarded, 1);
  assert.equal(fixture.privateRequestFieldReads, 0);
  assert.equal(fixture.unknownBodyReads, 0);
  await fixture.session.close();
});

test('draft rejection metadata does not relax write-path, external GET or other-parent GET guards', async () => {
  for (const [input, reason, origin, family] of [
    [
      {
        method: 'GET',
        url: `https://fanqienovel.com/api/author/chapter/save/PRIVATE_TITLE?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
      },
      'chapter_drafts_write_route_blocked',
      'platform',
      'chapter',
    ],
    [
      {
        method: 'GET',
        url: 'https://private-external.invalid/api/author/chapter/list?token=PRIVATE_TOKEN',
      },
      'chapter_drafts_get_parent_mismatch',
      'external',
      null,
    ],
    [
      {
        method: 'GET',
        url: 'https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=7600000000000000999',
      },
      'chapter_drafts_get_parent_mismatch',
      'platform',
      'chapter',
    ],
  ] as const) {
    const fixture = draftsDiagnosticFixture({ blockedRequests: [input] });
    const result = await fixture.diagnose();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterTab?.reason, reason);
    assert.equal(result.chapterTab?.blockedRequests?.count, 1);
    assert.equal(result.chapterTab?.blockedRequests?.entries[0]?.method, 'GET');
    assert.equal(result.chapterTab?.blockedRequests?.entries[0]?.origin, origin);
    assert.equal(result.chapterTab?.blockedRequests?.entries[0]?.authorFamily, family);
    assert.equal(fixture.blocked, 1);
    assert.equal(fixture.forwarded, 1);
    assert.equal(fixture.clicked, 1);
    assert.equal(fixture.privateRequestFieldReads, 0);
    assert.equal(fixture.unknownBodyReads, 0);
    assert.equal(fixture.guardInstalled, false);
    for (const secret of [
      'PRIVATE_',
      '7600000000000000999',
      CHAPTER_ENTRY_FIXTURE_WORK,
      'https://',
      '?',
    ])
      assert.equal(JSON.stringify(result.chapterTab).includes(secret), false);
    await fixture.session.close();
  }
});

test('blocked draft invalid source and unknown methods are fixed enums without raw exceptions or method text', async () => {
  const fixture = draftsDiagnosticFixture({
    blockedRequests: [
      { method: 'PRIVATE_METHOD', url: 'not a URL PRIVATE_SOURCE' },
      {
        method: 'POST',
        url: 'https://PRIVATE_USER:PRIVATE_PASSWORD@fanqienovel.com/api/author/chapter/chapter_list/v1',
      },
      { method: 'GET', url: 'PRIVATE_INVALID_SOURCE' },
    ],
  });
  const result = await fixture.diagnose();
  assert.deepEqual(result.chapterTab?.blockedRequests, {
    count: 3,
    truncated: false,
    entries: [
      {
        method: 'OTHER',
        resourceType: 'xhr',
        navigation: false,
        origin: 'invalid',
        pathClass: 'invalid',
        pathTemplate: '/{invalid}',
        authorFamily: null,
        count: 1,
      },
      {
        method: 'POST',
        resourceType: 'xhr',
        navigation: false,
        origin: 'invalid',
        pathClass: 'invalid',
        pathTemplate: '/{invalid}',
        authorFamily: null,
        count: 1,
      },
      {
        method: 'GET',
        resourceType: 'xhr',
        navigation: false,
        origin: 'invalid',
        pathClass: 'invalid',
        pathTemplate: '/{invalid}',
        authorFamily: null,
        count: 1,
      },
    ],
  });
  assert.equal(result.chapterTab?.reason, 'chapter_drafts_request_unverified');
  assert.equal(JSON.stringify(result.chapterTab).includes('PRIVATE_'), false);
  assert.equal(fixture.blocked, 3);
  assert.equal(fixture.forwarded, 1);
  assert.equal(fixture.privateRequestFieldReads, 0);
  await fixture.session.close();
});

test('blocked draft metadata caps grouped entries, total counts and path depth while every rejected request is still aborted', async () => {
  const paths = [
    '/api/author/chapter/chapter_list/v1',
    '/api/author/volume/volume_list/v1',
    '/api/author/book/book_detail/v0/',
    '/api/author/account/info/v0/',
  ];
  const distinct = draftsDiagnosticFixture({
    blockedRequests: paths.flatMap((url) =>
      ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => ({
        method,
        url: `https://fanqienovel.com${url}?token=PRIVATE_TOKEN`,
      })),
    ),
  });
  const many = await distinct.diagnose();
  assert.equal(many.chapterTab?.blockedRequests?.count, 20);
  assert.equal(many.chapterTab?.blockedRequests?.entries.length, 16);
  assert.equal(many.chapterTab?.blockedRequests?.truncated, true);
  assert.equal(distinct.blocked, 20);
  assert.equal(distinct.forwarded, 1);
  await distinct.session.close();
  const repeated = draftsDiagnosticFixture({
    blockedRequests: Array.from({ length: 111 }, () => ({
      method: 'POST',
      url: 'https://fanqienovel.com/api/author/chapter/chapter_list/v1?token=PRIVATE_TOKEN',
    })),
  });
  const total = await repeated.diagnose();
  assert.equal(total.chapterTab?.blockedRequests?.count, 100);
  assert.equal(total.chapterTab?.blockedRequests?.entries[0]?.count, 100);
  assert.equal(total.chapterTab?.blockedRequests?.truncated, true);
  assert.equal(repeated.blocked, 111);
  assert.equal(repeated.forwarded, 1);
  assert.equal(repeated.privateRequestFieldReads, 0);
  await repeated.session.close();
  const deep = draftsDiagnosticFixture({
    blockedRequests: [
      {
        method: 'POST',
        url:
          'https://fanqienovel.com/api/author/chapter/' +
          Array.from({ length: 100 }, () => 'private_token').join('/'),
      },
    ],
  });
  const depth = await deep.diagnose();
  const template = depth.chapterTab?.blockedRequests?.entries[0]?.pathTemplate ?? '';
  assert.ok(template.endsWith('/{truncated}'));
  assert.ok(template.length < 160);
  assert.equal(template.includes('private_token'), false);
  assert.equal(depth.chapterTab?.blockedRequests?.truncated, true);
  assert.equal(deep.blocked, 1);
  await deep.session.close();
});

test('draft success and pre-click unavailability do not invent blocked request evidence', async () => {
  for (const options of [{ alreadyActive: true }, { noBookSource: true }]) {
    const fixture = draftsDiagnosticFixture(options);
    const result = await fixture.diagnose();
    assert.equal(result.chapterTab?.blockedRequests, undefined);
    assert.equal(fixture.blocked, 0);
    assert.equal(fixture.unknownBodyReads, 0);
    assert.equal(fixture.privateRequestFieldReads, 0);
    await fixture.session.close();
  }
});

test('a current volume request URL drift remains unavailable even when an old exact-template response arrives, with no URL value emitted', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [{ ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!, oldRequest: true }],
    freshVolumeUrlDrift: true,
    oldVolumeResponseDuringFresh: true,
  });
  let failure: unknown;
  try {
    await fixture.session.withPage((page) =>
      fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof BrowserSessionError);
  assert.equal(failure.code, 'chapter_volume_refresh_request_template_changed');
  assert.equal(fixture.directoryFetchCount, 1);
  assert.equal(fixture.volumeResponseWaits, 0);
  for (const secret of ['PRIVATE_', 'opaque_drift', '?book_id', CHAPTER_ENTRY_FIXTURE_WORK])
    assert.equal(failure.message.includes(secret), false);
  await fixture.session.close();
});
