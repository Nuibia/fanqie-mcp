import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildChapterBodyReadCandidate,
  parseChapterBodyResponse,
  ChapterBodyCandidateError,
  MAX_CHAPTER_BODY_BYTES,
} from '../src/platform/chapter-body.js';

const WORK = '8100000000000000001',
  CHAPTER = '8100000000000000002',
  VOLUME = '8100000000000000003';
const expected = { workId: WORK, chapterId: CHAPTER, volumeId: VOLUME };
const context = 'https://fanqienovel.com/main/writer/chapter-manage/' + WORK;
const raw = '<p>Fixture \u5185\u5bb9\r\n</p><p></p>  ';
const response = (patch: Record<string, unknown> = {}) => ({
  code: 0,
  data: {
    book_id: WORK,
    item_id: CHAPTER,
    volume_id: VOLUME,
    title: 'Fixture chapter',
    content: raw,
    publish_status: 1,
    creation_status: 0,
    latest_version: 7,
    column_data: { book_id: WORK },
    ...patch,
  },
});
const errorCode = (code: string) => (error: unknown) =>
  error instanceof ChapterBodyCandidateError &&
  error.code === code &&
  error.message === code &&
  !Object.hasOwn(error, 'url') &&
  !Object.hasOwn(error, 'body');

test('public read candidates preserve the fixed contract and never acquire execution permission', () => {
  for (const [suffix, value] of [
    ['', '0'],
    ['?bookProblemMarkInfoType=1', '1'],
    ['?bookProblemMarkInfoType=2', '2'],
    ['?bookProblemMarkInfoType=3', '0'],
  ] as const) {
    const candidate = buildChapterBodyReadCandidate(context + suffix, expected),
      url = new URL(candidate.url);
    assert.equal(candidate.sourceBoundary, 'public_contract_api');
    assert.equal(
      url.origin === 'https://fanqienovel.com' && url.pathname === '/api/author/edit_article/v0/',
      true,
    );
    assert.equal(
      url.searchParams.get('book_id') === WORK && url.searchParams.get('item_id') === CHAPTER,
      true,
    );
    assert.equal(url.searchParams.get('from_source'), value);
    assert.deepEqual(
      [...url.searchParams.keys()],
      ['aid', 'app_name', 'book_id', 'item_id', 'from_source'],
    );
    assert.equal(
      url.searchParams.get('aid') === '2503' && url.searchParams.get('app_name') === 'muye_novel',
      true,
    );
    assert.deepEqual(Object.keys(candidate), ['sourceBoundary', 'url']);
  }
  const encoded = context + '&' + encodeURIComponent('Fixture name');
  assert.equal(
    buildChapterBodyReadCandidate(encoded, expected).url ===
      buildChapterBodyReadCandidate(context, expected).url,
    true,
  );
  assert.equal(
    buildChapterBodyReadCandidate(context + '?opaque=unchanged', expected).url ===
      buildChapterBodyReadCandidate(context, expected).url,
    true,
  );
});

test('context identity, duplicate and encoded-overlap failures are safe and cannot change the target', () => {
  const cases: Array<[string, string]> = [
    ['?book_id=' + CHAPTER, 'parent_mismatch'],
    ['?chapter_id=' + WORK, 'parent_mismatch'],
    ['?volume_id=' + WORK, 'parent_mismatch'],
    ['?book_id=' + WORK + '&book_id=' + WORK, 'ambiguous_context'],
    ['?book_id=' + WORK + '&workId=' + WORK, 'ambiguous_context'],
    ['?bookProblemMarkInfoType=1&bookProblemMarkInfoType=2', 'ambiguous_context'],
    ['?opaque=%26bookProblemMarkInfoType=1', 'ambiguous_context'],
    ['?opaque=%ZZ', 'invalid_context'],
    ['?opaque=%E0%A4%A', 'invalid_context'],
    ['?book_id=' + WORK + '&%62ook_id=' + WORK, 'ambiguous_context'],
    ['?user_id=' + WORK, 'identity_filter'],
    ['?owner=' + WORK, 'identity_filter'],
    ['?uid=' + WORK, 'identity_filter'],
    ['?id=' + WORK, 'identity_filter'],
    ['?UID=' + WORK, 'identity_filter'],
    ['?user_uid=' + WORK, 'identity_filter'],
    ['?opaque=%26uid=' + WORK, 'ambiguous_context'],
  ];
  for (const [suffix, code] of cases)
    assert.throws(() => buildChapterBodyReadCandidate(context + suffix, expected), errorCode(code));
  assert.equal(
    new URL(
      buildChapterBodyReadCandidate(context + '?bookProblemMarkInfoType=%31', expected).url,
    ).searchParams.get('from_source'),
    '1',
  );
  assert.throws(
    () =>
      buildChapterBodyReadCandidate(
        context + '&' + encodeURIComponent('bookProblemMarkInfoType=1'),
        expected,
      ),
    errorCode('ambiguous_context'),
  );
  assert.throws(
    () => buildChapterBodyReadCandidate(context.replace(WORK, CHAPTER), expected),
    errorCode('invalid_context'),
  );
  assert.throws(
    () => buildChapterBodyReadCandidate(context + '#bookProblemMarkInfoType=1', expected),
    errorCode('invalid_context'),
  );
  assert.throws(
    () => buildChapterBodyReadCandidate('https://external.invalid/' + WORK, expected),
    errorCode('invalid_context'),
  );
  assert.throws(
    () => buildChapterBodyReadCandidate(context, { ...expected, chapterId: '' }),
    errorCode('invalid_target'),
  );
});

test('raw author-edit responses preserve exact content and versions without publishing or leaking unknown fields', () => {
  let unknownRead = false;
  const source = response();
  Object.defineProperty(source.data, 'private_unrecognised', {
    get() {
      unknownRead = true;
      throw new Error('fixture private sentinel');
    },
  });
  const first = parseChapterBodyResponse(source, expected),
    second = parseChapterBodyResponse(response({ content: raw.replace(/\r\n/g, '\n') }), expected);
  assert.equal(first.rawContent === raw && first.title === source.data.title, true);
  assert.equal(first.rawContentSha256, createHash('sha256').update(raw, 'utf8').digest('hex'));
  assert.notEqual(first.rawContentSha256, second.rawContentSha256);
  assert.equal(first.rawContentBytes, Buffer.byteLength(raw, 'utf8'));
  assert.equal(first.sourceBoundary, 'public_contract_api');
  assert.equal(first.representation, 'author_edit_current');
  assert.equal(first.publishedVersionVerified, false);
  assert.deepEqual(
    [first.rawPublishStatus, first.rawCreationStatus, first.rawLatestVersion],
    [1, 0, 7],
  );
  assert.equal(unknownRead, false);
  assert.equal(Object.hasOwn(first, 'private_unrecognised'), false);
  assert.equal(
    Object.hasOwn(first, 'complete') ||
      Object.hasOwn(first, 'ownerVerified') ||
      Object.hasOwn(first, 'sourceProof'),
    false,
  );
  const empty = parseChapterBodyResponse(response({ content: '' }), expected);
  assert.equal(empty.rawContentBytes, 0);
  assert.equal(empty.publishedVersionVerified, false);
  const emoji = '\uD83D\uDE42';
  assert.equal(
    parseChapterBodyResponse(response({ content: emoji }), expected).rawContentSha256,
    createHash('sha256').update(emoji, 'utf8').digest('hex'),
  );
});

test('wrong response parents, noncanonical content, missing fields and unsafe extent fail closed with fixed errors', () => {
  for (const key of ['book_id', 'item_id', 'volume_id'] as const)
    assert.throws(
      () => parseChapterBodyResponse(response({ [key]: '8100000000000000009' }), expected),
      errorCode('parent_mismatch'),
    );
  assert.throws(
    () => parseChapterBodyResponse(response({ column_data: { book_id: CHAPTER } }), expected),
    errorCode('parent_mismatch'),
  );
  assert.throws(
    () => parseChapterBodyResponse(response({ bookID: WORK }), expected),
    errorCode('invalid_response'),
  );
  assert.throws(
    () => parseChapterBodyResponse(response(), { workId: WORK, chapterId: CHAPTER }),
    errorCode('parent_mismatch'),
  );
  for (const content of [undefined, null, 7, {}, ['fixture'], '\uD800'])
    assert.throws(
      () => parseChapterBodyResponse(response({ content }), expected),
      errorCode('invalid_content'),
    );
  for (const patch of [
    { publish_status: '1' },
    { creation_status: -1 },
    { latest_version: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(
      () => parseChapterBodyResponse(response(patch), expected),
      errorCode('invalid_version'),
    );
  assert.throws(
    () => parseChapterBodyResponse({ code: 1, data: response().data }, expected),
    errorCode('invalid_response'),
  );
  const accessor = response();
  Object.defineProperty(accessor.data, 'content', {
    get() {
      throw new Error('fixture private sentinel');
    },
  });
  assert.throws(() => parseChapterBodyResponse(accessor, expected), errorCode('invalid_response'));
  assert.throws(
    () =>
      parseChapterBodyResponse(
        { code: 0, data: { ...response().data, content: undefined, body: raw } },
        expected,
      ),
    errorCode('invalid_content'),
  );
  const boundary = parseChapterBodyResponse(
    response({ content: 'x'.repeat(MAX_CHAPTER_BODY_BYTES) }),
    expected,
  );
  assert.equal(boundary.rawContentBytes, MAX_CHAPTER_BODY_BYTES);
  assert.throws(
    () =>
      parseChapterBodyResponse(
        response({ content: 'x'.repeat(MAX_CHAPTER_BODY_BYTES + 1) }),
        expected,
      ),
    errorCode('content_extent'),
  );
  assert.throws(
    () => parseChapterBodyResponse(response({ content: '\u4e2d'.repeat(1_000_001) }), expected),
    errorCode('content_extent'),
  );
});
