import test from 'node:test';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

import { diagnosticRouteTemplate } from '../src/platform/browser.js';

test('chapter entry uses the observed ID/title binding and one actual read button, emitting no private values or guessed chapter schema', async () => {
  const fixture = chapterEntryFixture();
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.status, 'success');
  assert.equal(result.chapterEntry?.status, 'opened');
  assert.equal(result.chapterEntry?.routeObservation, 'landed');
  assert.ok(result.chapterEntry?.targetRef);
  assert.equal(fixture.clickCount, 1);
  assert.equal(fixture.routeInstalled, false);
  assert.equal(result.sourceUrl, 'https://fanqienovel.com/main/writer/chapter-manage/{workId}');
  assert.ok(result.getResponses.some((row) => row.pathTemplate.includes('/fixture-directory/')));
  assert.equal(
    result.readResponseStructure?.some((row) => row.pathTemplate.includes('/fixture-directory/')),
    false,
  );
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    'PRIVATE_OWNER_NAME',
    'PRIVATE_SOURCE_NONCE',
    'PRIVATE_DIRECTORY_NONCE',
    'PRIVATE_CHAPTER_BODY',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  const next = await fixture.session.diagnoseReadPage(
    `diagnostic:${result.chapterEntry!.targetRef}`,
  );
  assert.equal(next.status, 'success');
  await fixture.session.close();
});

test('chapter navigation option is rejected outside the book-management base or with an invalid target before any navigation', async () => {
  const fixture = chapterEntryFixture();
  fixture.page.goto = (async () => {
    throw new Error('Must not navigate');
  }) as Page['goto'];
  for (const [sourceUrl, workId] of [
    ['https://fanqienovel.com/main/writer/short-manage', CHAPTER_ENTRY_FIXTURE_WORK],
    ['https://fanqienovel.com/main/writer/book-manage', 'not-a-stable-id'],
  ])
    await assert.rejects(
      fixture.session.diagnoseReadPage(sourceUrl!, { openChaptersForWorkId: workId }),
      { code: 'invalid_chapter_diagnostic_target' },
    );
  await fixture.session.close();
});

test('chapter entry cannot select a missing/numeric target ID, a same-name work or ambiguous visible cards', async () => {
  for (const options of [
    { rows: [] },
    { rows: [{ book_id: 7600000000000000001, book_name: CHAPTER_ENTRY_FIXTURE_TITLE }] },
    { rows: [{ book_id: '7600000000000000002', book_name: CHAPTER_ENTRY_FIXTURE_TITLE }] },
    {
      rows: [
        { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
        { book_id: '7600000000000000002', book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
      ],
    },
    { titles: [CHAPTER_ENTRY_FIXTURE_TITLE, CHAPTER_ENTRY_FIXTURE_TITLE] },
    { titles: ['PRIVATE_OTHER_TITLE'] },
  ]) {
    const fixture = chapterEntryFixture(options);
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.status, 'unavailable');
    assert.equal(fixture.clickCount, 0);
    assert.equal(result.chapterEntry?.targetRef, null);
    await fixture.session.close();
  }
});

test('only the unique visible chapter-management button with verified type/class can be clicked', async () => {
  for (const buttons of [
    [{ label: '编辑' }],
    [{ label: '章节管理', type: 'submit' }],
    [{ label: '章节管理', className: 'write-btn' }],
    [{ label: '章节管理', disabled: true }],
    [{ label: '章节管理' }, { label: '章节管理' }],
  ]) {
    const fixture = chapterEntryFixture({ buttons });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(fixture.clickCount, 0);
    await fixture.session.close();
  }
});

test('POST-only or previous-document management responses cannot establish the chapter target binding', async () => {
  for (const options of [{ method: 'POST' }, { oldRequest: true }]) {
    const fixture = chapterEntryFixture(options);
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.chapterEntry?.reason, 'chapter_manager_list_source_missing');
    assert.equal(fixture.clickCount, 0);
    await fixture.session.close();
  }
});

test('chapter entry blocks POST side effects and edit/create navigation before forwarding the request', async () => {
  for (const options of [
    { postOnClick: true },
    {
      destination: `https://fanqienovel.com/main/writer/publish-chapter/${CHAPTER_ENTRY_FIXTURE_WORK}`,
    },
    { destination: 'https://fanqienovel.com/main/writer/create-book' },
  ]) {
    const fixture = chapterEntryFixture(options);
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.blockedCount, 1);
    assert.equal(fixture.forwardCount, 0);
    assert.equal(fixture.routeInstalled, false);
    await fixture.session.close();
  }
});

test('wrong-work, external or unverified directory destinations cannot become registered stable targets', async () => {
  for (const destination of [
    `https://fanqienovel.com/main/writer/chapter-manage/7600000000000000002`,
    `https://fanqienovel.com/main/writer/unknown-directory/${CHAPTER_ENTRY_FIXTURE_WORK}`,
    'https://external.invalid/PRIVATE_NONCE_PATH?token=PRIVATE_TOKEN',
  ]) {
    const fixture = chapterEntryFixture({ destination });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.blockedCount, 1);
    assert.equal(fixture.forwardCount, 0);
    assert.equal(result.chapterEntry?.routeObservation, 'navigation-request');
    assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_NONCE_PATH'), false);
    await fixture.session.close();
  }
});

test('chapter entry freshly verifies the same owner after transition and refuses late binding replay across navigation', async () => {
  const switched = chapterEntryFixture({ changedOwner: true });
  const result = await switched.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.chapterEntry?.reason, 'chapter_manager_identity_changed');
  assert.equal(result.chapterEntry?.targetRef, null);
  assert.equal(switched.routeInstalled, false);
  await switched.session.close();
  const stale = chapterEntryFixture({ navigateDuringReplay: true });
  await assert.rejects(
    stale.session.diagnoseReadPage('https://fanqienovel.com/main/writer/book-manage', {
      openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
    }),
    { code: 'read_diagnostic_stale' },
  );
  assert.equal(stale.clickCount, 0);
  await stale.session.close();
});

test('chapter route templates redact raw, encoded, double-encoded and malformed title suffixes', () => {
  const title = '合成私有章书名（测试）';
  const encoded = encodeURIComponent(title);
  const doubled = encodeURIComponent(encoded);
  const prefix = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}`;
  for (const suffix of [title, encoded, doubled, CHAPTER_ENTRY_FIXTURE_TITLE, '%E0%A4%A']) {
    const template = diagnosticRouteTemplate(
      `${prefix}&${suffix}?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&token=PRIVATE_TOKEN#PRIVATE_NONCE`,
    );
    assert.equal(
      template,
      'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}?book_id={workId}',
    );
    for (const secret of [
      title,
      encoded,
      doubled,
      CHAPTER_ENTRY_FIXTURE_TITLE,
      CHAPTER_ENTRY_FIXTURE_WORK,
      'PRIVATE_TOKEN',
      'PRIVATE_NONCE',
    ])
      assert.equal(template.includes(secret), false);
  }
  for (const suffix of [
    `_${encoded}`,
    `-PRIVATE_OTHER_SUFFIX`,
    `/${encoded}`,
    `&${encoded}/PRIVATE_TRAILING_BODY`,
  ]) {
    const template = diagnosticRouteTemplate(`${prefix}${suffix}`);
    for (const secret of [
      title,
      encoded,
      CHAPTER_ENTRY_FIXTURE_WORK,
      'PRIVATE_OTHER_SUFFIX',
      'PRIVATE_TRAILING_BODY',
    ])
      assert.equal(template.includes(secret), false);
  }
  const apiTemplate = diagnosticRouteTemplate(
    `https://fanqienovel.com/api/author/chapter/fixture/${CHAPTER_ENTRY_FIXTURE_WORK}&${doubled}/v0/?nonce=PRIVATE_TOKEN`,
  );
  for (const secret of [title, encoded, doubled, CHAPTER_ENTRY_FIXTURE_WORK, 'PRIVATE_TOKEN'])
    assert.equal(apiTemplate.includes(secret), false);
});

test('the actually observed encoded-title SPA chapter route opens only with the current real book ID/name binding', async () => {
  for (const title of ['合成私有章书名（测试）', CHAPTER_ENTRY_FIXTURE_TITLE]) {
    const destination = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(title)}`;
    const fixture = chapterEntryFixture({
      rows: [{ book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: title }],
      titles: [title],
      destination,
      spa: true,
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'success');
    assert.equal(result.chapterEntry?.status, 'opened');
    assert.equal(result.chapterEntry?.routeObservation, 'landed');
    assert.equal(
      result.sourceUrl,
      'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}',
    );
    assert.match(result.chapterEntry!.targetRef!, /^[a-f0-9]{24}$/);
    assert.equal(fixture.diagnosticDomReads, 1);
    for (const secret of [
      title,
      encodeURIComponent(title),
      CHAPTER_ENTRY_FIXTURE_WORK,
      'PRIVATE_DIRECTORY_NONCE',
      'PRIVATE_CHAPTER_BODY',
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    const unproved = chapterEntryFixture();
    await assert.rejects(unproved.session.diagnoseReadPage(destination), {
      code: 'invalid_diagnostic_route',
    });
    await unproved.session.close();
    const next = await fixture.session.diagnoseReadPage(
      `diagnostic:${result.chapterEntry!.targetRef}`,
    );
    assert.equal(next.status, 'success');
    assert.equal(next.sourceUrl, result.sourceUrl);
    await fixture.session.close();
  }
});
