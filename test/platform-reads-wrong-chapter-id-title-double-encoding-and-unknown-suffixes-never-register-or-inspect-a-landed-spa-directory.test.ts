import test from 'node:test';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import assert from 'node:assert/strict';

test('wrong chapter ID/title, double encoding and unknown suffixes never register or inspect a landed SPA directory', async () => {
  const title = '合成私有章书名（测试）';
  const encoded = encodeURIComponent(title);
  for (const [destination, reason] of [
    [
      `https://fanqienovel.com/main/writer/chapter-manage/7600000000000000002&${encoded}`,
      'chapter_manager_route_id_mismatch',
    ],
    [
      `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent('合成其它书名')}`,
      'chapter_manager_route_title_mismatch',
    ],
    [
      `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(encoded)}`,
      'chapter_manager_route_title_mismatch',
    ],
    [
      `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}_${encoded}`,
      'chapter_manager_route_shape_unrecognized',
    ],
    [
      `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&%E0%A4%A`,
      'chapter_manager_route_encoding_malformed',
    ],
  ]) {
    const fixture = chapterEntryFixture({
      rows: [{ book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: title }],
      titles: [title],
      destination: destination!,
      spa: true,
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.reason, reason);
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(result.chapterEntry?.routeObservation, 'landed');
    assert.equal(fixture.diagnosticDomReads, 0);
    for (const secret of [
      title,
      encoded,
      encodeURIComponent(encoded),
      CHAPTER_ENTRY_FIXTURE_WORK,
      '合成其它书名',
      encodeURIComponent('合成其它书名'),
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    await fixture.session.close();
  }
});

test('chapter destination classification distinguishes a matching title with noncanonical encoding without relaxing acceptance', async () => {
  const title = CHAPTER_ENTRY_FIXTURE_TITLE;
  // Encoding a URI-safe letter decodes to the exact bound name but fails the existing canonical rule.
  const noncanonical = `%50${title.slice(1)}`;
  for (const spa of [false, true]) {
    const fixture = chapterEntryFixture({
      destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${noncanonical}`,
      spa,
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.reason, 'chapter_manager_route_encoding_noncanonical');
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.diagnosticDomReads, 0);
    assert.equal(result.chapterEntry?.routeObservation, spa ? 'landed' : 'navigation-request');
    for (const secret of [title, noncanonical, CHAPTER_ENTRY_FIXTURE_WORK])
      assert.equal(JSON.stringify(result).includes(secret), false);
    await fixture.session.close();
  }
  const titleWithHex = '合成编码测试';
  const accepted = chapterEntryFixture({
    rows: [{ book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: titleWithHex }],
    titles: [titleWithHex],
    destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(titleWithHex).toLowerCase()}`,
    spa: true,
  });
  const result = await accepted.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.status, 'success');
  assert.equal(result.chapterEntry?.status, 'opened');
  await accepted.session.close();
});

test('chapter destination origin, fragment, query and query ID failures emit fixed reasons only', async () => {
  const shaped = `/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}`;
  const cases = [
    [`https://external.invalid${shaped}`, 'chapter_manager_route_origin_invalid'],
    [
      `https://PRIVATE_USERNAME:PRIVATE_PASSWORD@fanqienovel.com${shaped}`,
      'chapter_manager_route_origin_invalid',
    ],
    [`https://fanqienovel.com${shaped}#PRIVATE_FRAGMENT`, 'chapter_manager_route_fragment_invalid'],
    [`https://fanqienovel.com${shaped}?nonce=PRIVATE_TOKEN`, 'chapter_manager_route_query_invalid'],
    [
      `https://fanqienovel.com${shaped}?book_id=PRIVATE_NONNUMERIC_ID`,
      'chapter_manager_route_query_invalid',
    ],
    [
      `https://fanqienovel.com${shaped}?bookId=7600000000000000002`,
      'chapter_manager_route_id_mismatch',
    ],
    [
      `https://fanqienovel.com/main/writer/unknown-directory/${CHAPTER_ENTRY_FIXTURE_WORK}`,
      'chapter_manager_route_shape_unrecognized',
    ],
  ] as const;
  for (const [destination, reason] of cases) {
    const fixture = chapterEntryFixture({ destination, spa: true });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.reason, reason);
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.diagnosticDomReads, 0);
    for (const secret of [
      CHAPTER_ENTRY_FIXTURE_TITLE,
      CHAPTER_ENTRY_FIXTURE_WORK,
      'PRIVATE_USERNAME',
      'PRIVATE_PASSWORD',
      'PRIVATE_FRAGMENT',
      'PRIVATE_TOKEN',
      'PRIVATE_NONNUMERIC_ID',
      '7600000000000000002',
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    await fixture.session.close();
  }
});

test('chapter query diagnostic reports fixed empty/numeric shapes without admitting unsupported keys or skipping query-first rejection', async () => {
  const destination = `https://fanqienovel.com/main/writer/chapter-manage/7600000000000000002&PRIVATE_DIFFERENT_TITLE?tab=&source=PRIVATE_QUERY_VALUE&bookId=${CHAPTER_ENTRY_FIXTURE_WORK}`;
  for (const spa of [false, true]) {
    const fixture = chapterEntryFixture({ destination, spa });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.reason, 'chapter_manager_route_query_invalid');
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.diagnosticDomReads, 0);
    assert.deepEqual(result.chapterEntry?.querySchema, {
      entries: [
        { key: 'tab', valueShape: 'empty', allowedReadKey: true, rejection: 'value_not_numeric' },
        { key: 'source', valueShape: 'other', allowedReadKey: false, rejection: 'unsupported_key' },
        { key: 'bookId', valueShape: 'numeric', allowedReadKey: true, rejection: null },
      ],
      truncated: false,
    });
    if (!spa) {
      assert.equal(fixture.blockedCount, 1);
      assert.equal(fixture.forwardCount, 0);
    }
    for (const secret of [
      'PRIVATE_DIFFERENT_TITLE',
      'PRIVATE_QUERY_VALUE',
      CHAPTER_ENTRY_FIXTURE_TITLE,
      CHAPTER_ENTRY_FIXTURE_WORK,
      '7600000000000000002',
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    await fixture.session.close();
  }
});

test('chapter query schemas redact private/dynamic/credential keys and all values while retaining limited static field names', async () => {
  const title = '合成私有标题';
  const query = new URLSearchParams([
    ['source', CHAPTER_ENTRY_FIXTURE_WORK],
    ['bookName', title],
    ['page_count', '1'.repeat(31)],
    ['nonce', 'PRIVATE_NONCE'],
    ['token', 'PRIVATE_TOKEN'],
    ['3001', 'PRIVATE_OWNER_VALUE'],
    [title, 'PRIVATE_DYNAMIC_VALUE'],
    [encodeURIComponent(title), 'PRIVATE_DOUBLE_VALUE'],
    [CHAPTER_ENTRY_FIXTURE_TITLE.toLowerCase(), 'PRIVATE_TITLE_KEY_VALUE'],
    ['PRIVATE_OWNER_NAME', 'PRIVATE_DISPLAY_VALUE'],
  ]);
  const fixture = chapterEntryFixture({
    rows: [
      { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: title },
      { book_id: '7600000000000000002', book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
    ],
    titles: [title],
    destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(title)}?${query}`,
    spa: true,
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.chapterEntry?.reason, 'chapter_manager_route_query_invalid');
  assert.equal(result.chapterEntry?.targetRef, null);
  assert.equal(fixture.diagnosticDomReads, 0);
  const entries = result.chapterEntry!.querySchema!.entries;
  assert.deepEqual(entries.slice(0, 3), [
    { key: 'source', valueShape: 'numeric', allowedReadKey: false, rejection: 'unsupported_key' },
    { key: 'bookName', valueShape: 'other', allowedReadKey: false, rejection: 'unsupported_key' },
    {
      key: 'page_count',
      valueShape: 'numeric_out_of_range',
      allowedReadKey: true,
      rejection: 'value_not_numeric',
    },
  ]);
  assert.ok(
    entries.slice(3).every((row) => row.key === '{opaque}' && row.rejection === 'unsupported_key'),
  );
  assert.equal(result.chapterEntry!.querySchema!.truncated, false);
  for (const secret of [
    title,
    encodeURIComponent(title),
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE.toLowerCase(),
    'PRIVATE_OWNER_NAME',
    'PRIVATE_NONCE',
    'PRIVATE_TOKEN',
    'PRIVATE_OWNER_VALUE',
    'PRIVATE_DYNAMIC_VALUE',
    'PRIVATE_DOUBLE_VALUE',
    'PRIVATE_TITLE_KEY_VALUE',
    'PRIVATE_DISPLAY_VALUE',
    '3001',
    '1'.repeat(31),
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  await fixture.session.close();
});

test('chapter query schema is bounded and excludes query metadata from an untrusted origin', async () => {
  const params = new URLSearchParams(
    Array.from({ length: 24 }, (_value, index) => [
      `field_${String.fromCharCode(97 + index)}`,
      'PRIVATE_VALUE',
    ]),
  );
  const fixture = chapterEntryFixture({
    destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${CHAPTER_ENTRY_FIXTURE_TITLE}?${params}`,
    spa: true,
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.chapterEntry?.reason, 'chapter_manager_route_query_invalid');
  assert.equal(result.chapterEntry!.querySchema!.entries.length, 16);
  assert.equal(result.chapterEntry!.querySchema!.truncated, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE_VALUE'), false);
  await fixture.session.close();
  const external = chapterEntryFixture({
    destination: `https://external.invalid/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${CHAPTER_ENTRY_FIXTURE_TITLE}?privateField=PRIVATE_VALUE`,
    spa: true,
  });
  const denied = await external.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(denied.chapterEntry?.reason, 'chapter_manager_route_origin_invalid');
  assert.equal(denied.chapterEntry?.querySchema, undefined);
  await external.session.close();
});
