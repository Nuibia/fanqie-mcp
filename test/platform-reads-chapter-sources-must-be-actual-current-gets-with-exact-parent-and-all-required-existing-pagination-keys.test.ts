import test from 'node:test';

import {
  chapterCoreFixture,
  CHAPTER_CORE_WORK,
  CHAPTER_CORE_PLAN,
} from './helpers/platform-reads-chapter-core-row.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

test('chapter sources must be actual current GETs with exact parent and all required existing pagination keys', async () => {
  const base = chapterCoreFixture();
  for (const [sources, code] of [
    [
      [
        base.volumeUrl.replace(CHAPTER_CORE_WORK, '7600000000000000999'),
        base.bookUrl,
        base.chapterUrl,
      ],
      'chapter_source_parent_mismatch',
    ],
    [
      [base.volumeUrl, base.bookUrl, base.chapterUrl.replace('&page_count=2', '')],
      'chapter_query_template_unverified',
    ],
    [
      [base.volumeUrl, base.bookUrl, `${base.chapterUrl}&book_id=${CHAPTER_CORE_WORK}`],
      'chapter_source_parent_mismatch',
    ],
    [
      [base.volumeUrl, base.bookUrl, base.chapterUrl.replace('&page_index=0', '')],
      'chapter_query_template_unverified',
    ],
  ] as const) {
    const result = await chapterCoreFixture({ sources: [...sources] }).collect();
    assert.equal(result.status, 'capability_unavailable');
    assert.ok(
      result.errors.some((error) => error.code === code),
      code,
    );
  }
  for (const options of [{ oldSources: true }, { sourceMethod: 'POST' }, { sources: [] }]) {
    const fixture = chapterCoreFixture(options);
    const result = await fixture.collect();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(fixture.calls.length, 0);
    assert.equal(result.records.length, 0);
  }
});

test('each chapter GET family rejects identity filters, multiple parents, missing/foreign parents and duplicate keys before its own replay', async () => {
  const base = chapterCoreFixture();
  const sourceUrls = [base.volumeUrl, base.bookUrl, base.chapterUrl];
  const identityKeys = [
    'author',
    'author_id',
    'authorId',
    'writer',
    'writer_id',
    'writerId',
    'user',
    'user_id',
    'userId',
    'target',
    'target_id',
    'targetId',
    'account',
    'account_id',
    'accountId',
    'owner',
    'owner_id',
    'ownerId',
    'uid',
    'id',
    'OWNER',
    'accountID',
    'Uid',
  ];
  const parentAliases = ['bookId', 'work_id', 'workId'];
  const otherWork = CHAPTER_CORE_WORK.slice(0, -1) + '9';
  for (const [family, original] of sourceUrls.entries()) {
    const invalid: URL[] = [];
    for (const key of identityKeys) {
      const url = new URL(original);
      url.searchParams.set(key, 'PRIVATE_IDENTITY_FILTER');
      invalid.push(url);
    }
    for (const key of parentAliases) {
      for (const value of [CHAPTER_CORE_WORK, otherWork]) {
        const url = new URL(original);
        url.searchParams.set(key, value);
        invalid.push(url);
      }
      const aliasOnly = new URL(original);
      aliasOnly.searchParams.delete('book_id');
      aliasOnly.searchParams.set(key, CHAPTER_CORE_WORK);
      invalid.push(aliasOnly);
    }
    const missing = new URL(original);
    missing.searchParams.delete('book_id');
    invalid.push(missing);
    const foreign = new URL(original);
    foreign.searchParams.set('book_id', otherWork);
    invalid.push(foreign);
    for (const value of [CHAPTER_CORE_WORK, otherWork]) {
      const duplicate = new URL(original);
      duplicate.searchParams.append('book_id', value);
      invalid.push(duplicate);
    }
    const duplicateOpaque = new URL(original);
    duplicateOpaque.searchParams.append('opaque', 'PRIVATE_DUPLICATE');
    duplicateOpaque.searchParams.append('opaque', 'PRIVATE_DUPLICATE');
    invalid.push(duplicateOpaque);
    for (const invalidUrl of invalid) {
      const sources = [...sourceUrls];
      sources[family] = invalidUrl.toString();
      const fixture = chapterCoreFixture({ sources });
      const result = await fixture.collect();
      assert.equal(result.status, 'capability_unavailable');
      assert.equal(result.coverage.complete, false);
      assert.equal(result.records.length, 0);
      assert.ok(result.errors.some((error) => error.code === 'chapter_source_parent_mismatch'));
      assert.equal(
        fixture.calls.some((raw) => new URL(raw).pathname === invalidUrl.pathname),
        false,
        'The unsafe family must not be replayed',
      );
      if (family === 2)
        assert.ok(
          fixture.calls.some((raw) => new URL(raw).pathname === new URL(base.bookUrl).pathname),
          'Safe earlier families remain independently readable',
        );
    }
  }
});

test('configured chapter parent keys count alongside canonical aliases and reject ambiguous sources before replay', async () => {
  const base = chapterCoreFixture();
  const original = [base.volumeUrl, base.bookUrl, base.chapterUrl];
  const plan = {
    ...CHAPTER_CORE_PLAN,
    parentQueryKeys: {
      volumes: 'catalog_parent',
      chapters: 'catalog_parent',
      book: 'catalog_parent',
    },
  };
  const sources = original.map((raw) => {
    const url = new URL(raw);
    url.searchParams.delete('book_id');
    url.searchParams.set('catalog_parent', CHAPTER_CORE_WORK);
    return url.toString();
  });
  const valid = chapterCoreFixture({ sources, plan });
  assert.equal((await valid.collect()).status, 'success');
  for (const [family, raw] of sources.entries()) {
    for (const alias of ['book_id', 'bookId', 'work_id', 'workId']) {
      const invalid = new URL(raw);
      invalid.searchParams.set(alias, CHAPTER_CORE_WORK);
      const ambiguous = [...sources];
      ambiguous[family] = invalid.toString();
      const fixture = chapterCoreFixture({ sources: ambiguous, plan });
      const result = await fixture.collect();
      assert.ok(result.errors.some((error) => error.code === 'chapter_source_parent_mismatch'));
      assert.equal(
        fixture.calls.some((source) => new URL(source).pathname === invalid.pathname),
        false,
      );
    }
  }
});

test('chapter binding preserves actual opaque and authentication query fields without promoting unverified all-state coverage', async () => {
  const base = chapterCoreFixture();
  const sources = [base.volumeUrl, base.bookUrl, base.chapterUrl].map((raw) => {
    const url = new URL(raw);
    url.searchParams.set('auth', 'PRIVATE_ACTUAL_AUTH');
    url.searchParams.set('token', 'PRIVATE_ACTUAL_TOKEN');
    url.searchParams.set('opaque_custom', 'PRIVATE_ACTUAL_QUERY');
    return url.toString();
  });
  for (const verified of [true, false]) {
    const plan = {
      ...CHAPTER_CORE_PLAN,
      allStatesEvidence: verified ? CHAPTER_CORE_PLAN.allStatesEvidence : '',
    };
    const fixture = chapterCoreFixture({ sources, plan });
    const result = await fixture.collect();
    assert.equal(result.status, verified ? 'success' : 'partial');
    assert.equal(result.coverage.complete, verified);
    assert.equal(result.records.length, 1);
    assert.equal(
      result.errors.some((error) => error.code === 'chapter_all_states_unverified'),
      !verified,
    );
    for (const raw of sources)
      assert.ok(
        fixture.calls.includes(raw),
        'Actual safe templates retain every opaque query value',
      );
    assert.ok(
      fixture.calls.every((raw) => {
        const url = new URL(raw);
        return (
          url.searchParams.get('auth') === 'PRIVATE_ACTUAL_AUTH' &&
          url.searchParams.get('token') === 'PRIVATE_ACTUAL_TOKEN' &&
          url.searchParams.get('opaque_custom') === 'PRIVATE_ACTUAL_QUERY'
        );
      }),
    );
  }
});

test('late book/chapter source discovery remains allowed on the frozen directory document', async () => {
  const base = chapterCoreFixture();
  for (const lateSource of [base.bookUrl, base.chapterUrl]) {
    const sources = [base.volumeUrl, base.bookUrl, base.chapterUrl].filter(
      (raw) => raw !== lateSource,
    );
    const fixture = chapterCoreFixture({ sources });
    let waits = 0;
    fixture.page.waitForResponse = (async (predicate: (value: unknown) => boolean) => {
      waits += 1;
      const response = fixture.emitResponse(lateSource);
      assert.equal(predicate(response), true);
      return response;
    }) as unknown as Page['waitForResponse'];
    const result = await fixture.collect();
    assert.equal(result.status, 'success');
    assert.equal(result.coverage.complete, true);
    assert.equal(waits, 1);
    assert.ok(fixture.calls.includes(lateSource));
  }
});

test('late book discovery discards query/navigation/leave-return changes before replay even when valid current-work sources arrive', async () => {
  const base = chapterCoreFixture();
  for (const mode of [
    'query',
    'foreign_parent',
    'identity_filter',
    'navigation',
    'reload_start',
    'leave_return',
  ] as const) {
    const fixture = chapterCoreFixture({ sources: [base.volumeUrl, base.chapterUrl] });
    let waits = 0;
    fixture.page.waitForResponse = (async () => {
      waits += 1;
      const original = fixture.page.url();
      const target = new URL(original);
      if (mode === 'query') target.searchParams.set('type', '1');
      if (mode === 'foreign_parent')
        target.searchParams.set('work_id', CHAPTER_CORE_WORK.slice(0, -1) + '9');
      if (mode === 'identity_filter') target.searchParams.set('owner_id', 'PRIVATE_OTHER_OWNER');
      if (mode === 'navigation') target.pathname = '/main/writer/book-manage';
      if (mode === 'reload_start')
        fixture.emitEvent('request', {
          method: () => 'GET',
          isNavigationRequest: () => true,
          frame: () => null,
        });
      else {
        if (mode === 'leave_return')
          target.searchParams.set('work_id', CHAPTER_CORE_WORK.slice(0, -1) + '9');
        fixture.setUrl(target.toString());
        fixture.emitEvent('framenavigated', null);
        if (mode === 'leave_return') {
          fixture.setUrl(original);
          fixture.emitEvent('framenavigated', null);
        }
      }
      return fixture.emitResponse(base.bookUrl);
    }) as unknown as Page['waitForResponse'];
    const result = await fixture.collect();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.sourceUrl, null);
    assert.equal(fixture.calls.length, 0);
    assert.equal(waits, 1);
    assert.ok(result.errors.some((error) => error.code === 'read_document_changed'));
  }
});
