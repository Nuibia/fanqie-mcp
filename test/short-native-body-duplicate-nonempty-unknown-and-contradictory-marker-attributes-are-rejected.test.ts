import test from 'node:test';

import {
  ORACLE,
  rejected,
  snapshot,
  request,
  after,
  fixture,
  GOLDEN_CANONICAL,
  GOLDEN_PRESERVATION_SHA,
} from './helpers/short-native-body-fixture.js';

import {
  validateNativeShortBodyWriteRequest,
  planNativeShortBodyUpdate,
  validateNativeShortBodySnapshot,
  createNativeShortBodySnapshot,
  compareNativeShortBodyReadback,
  validateNativeShortBodyPlan,
  type NativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  nativeShortBodyBusinessInputHash,
  nativeShortBodyWriteRequest,
  validateNativeShortBodyBusinessInput,
} from '../src/platform/short-native-body.js';

import assert from 'node:assert/strict';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

import { createHash } from 'node:crypto';

test('duplicate nonempty unknown and contradictory marker attributes are rejected', () => {
  const o = ORACLE[6]!,
    marked = o.expected.desiredHtml,
    m = o.expected.marker.rawHtml!;
  for (const bad of [
    marked.replace(m, m + m),
    marked.replace('</div>', 'x</div>'),
    marked.replace('class="fq-pay-node-animation"', 'class="foreign"'),
    marked.replace('data-percentage="0.3"', 'data-percentage="0.9"'),
    marked.replace('data-para-nums="3"', 'data-para-nums="4"'),
    marked.replace('data-min-text="200"', 'data-min-text="200" data-min-text="200"'),
    marked.replace('data-min-radio="0.3"', 'data-extra="x"'),
  ])
    rejected(() => snapshot(bad));
});

test('paragraph indices lines shapes Unicode and exact policy keys fail closed', () => {
  const before = snapshot('<p>甲</p><p>乙</p><p></p>'),
    base = request(before);
  for (const sourceIndex of [-1, -0, 0.5, NaN, Infinity, '0', undefined])
    rejected(() =>
      validateNativeShortBodyWriteRequest({
        ...base,
        paragraphs: [{ sourceIndex, lines: ['甲'] }],
      }),
    );
  for (const paragraphs of [
    [
      { sourceIndex: 0, lines: ['甲'] },
      { sourceIndex: 0, lines: ['乙'] },
    ],
    [
      { sourceIndex: 1, lines: ['乙'] },
      { sourceIndex: 0, lines: ['甲'] },
    ],
  ])
    rejected(
      () => validateNativeShortBodyWriteRequest({ ...base, paragraphs }),
      'source_index_order',
    );
  rejected(
    () =>
      planNativeShortBodyUpdate(before, {
        ...base,
        paragraphs: [{ sourceIndex: 3, lines: ['甲'] }],
      }),
    'source_index_missing',
  );
  for (const lines of [[], ['甲\n乙'], ['甲\r乙'], ['\u0000'], ['\ud800'], [3]])
    rejected(() =>
      validateNativeShortBodyWriteRequest({ ...base, paragraphs: [{ sourceIndex: null, lines }] }),
    );
  for (const trial of [
    { action: 'unknown' },
    { action: 'clear', beforeParagraph: 1 },
    { action: 'preserve', extra: true },
    { action: 'set' },
  ])
    rejected(() => validateNativeShortBodyWriteRequest({ ...base, trial }));
  for (const extra of [
    { ...base, metadata: { trial: { action: 'clear' } } },
    { ...base, idempotencyKey: 'outer' },
    { ...base, representation: 'foreign/v1' },
    { ...base, expectedState: 'published' },
    { ...base, hashBasis: 'foreign' },
  ])
    rejected(() => validateNativeShortBodyWriteRequest(extra));
});

test('every request descriptor getter is rejected without calling it', () => {
  const before = snapshot('<p>甲</p>'),
    base = request(before);
  let hits = 0;
  const getter = () => {
    hits++;
    throw new Error('synthetic-value-must-not-leak');
  };
  const top = { ...base };
  Object.defineProperty(top, 'paragraphs', { enumerable: true, get: getter });
  rejected(() => validateNativeShortBodyWriteRequest(top));
  for (const key of ['sourceIndex', 'lines']) {
    const row: Record<string, unknown> = { sourceIndex: 0, lines: ['甲'] };
    Object.defineProperty(row, key, { enumerable: true, get: getter });
    rejected(() => validateNativeShortBodyWriteRequest({ ...base, paragraphs: [row] }));
  }
  const lines = ['甲'];
  Object.defineProperty(lines, '0', { enumerable: true, get: getter });
  rejected(() =>
    validateNativeShortBodyWriteRequest({ ...base, paragraphs: [{ sourceIndex: 0, lines }] }),
  );
  const hidden = { ...base };
  Object.defineProperty(hidden, 'trial', { enumerable: false, value: { action: 'clear' } });
  rejected(() => validateNativeShortBodyWriteRequest(hidden));
  assert.equal(hits, 0);
});

test('sparse extra symbol nonplain cycles and toJSON are rejected without normalization', () => {
  const before = snapshot('<p>甲</p>'),
    base = request(before),
    sparse = new Array(2);
  sparse[1] = '甲';
  rejected(() =>
    validateNativeShortBodyWriteRequest({
      ...base,
      paragraphs: [{ sourceIndex: 0, lines: sparse }],
    }),
  );
  const extra = Object.assign(['甲'], { extra: true });
  rejected(() =>
    validateNativeShortBodyWriteRequest({
      ...base,
      paragraphs: [{ sourceIndex: 0, lines: extra }],
    }),
  );
  rejected(() => validateNativeShortBodyWriteRequest({ ...base, [Symbol('hidden')]: true }));
  rejected(() =>
    validateNativeShortBodyWriteRequest(Object.assign(Object.create({ inherited: true }), base)),
  );
  const cycle: Record<string, unknown> = { ...base };
  cycle.extra = cycle;
  rejected(() => validateNativeShortBodyWriteRequest(cycle), 'json_cycle');
  let hits = 0;
  rejected(() =>
    validateNativeShortBodyWriteRequest({
      ...base,
      toJSON: () => {
        hits++;
        return base;
      },
    }),
  );
  assert.equal(hits, 0);
  const nullProto = Object.assign(Object.create(null), base);
  assert.deepEqual(validateNativeShortBodyWriteRequest(nullProto), base);
});

test('snapshot and plan getters hash carriers namespace and source forgeries are rejected', () => {
  const before = snapshot('<p>甲</p>'),
    plan = planNativeShortBodyUpdate(before, request(before));
  let hits = 0;
  const get = () => {
    hits++;
    throw new Error('never');
  };
  for (const key of ['native', 'sourceParagraphs', 'bodyHash']) {
    const forged = { ...before };
    Object.defineProperty(forged, key, { enumerable: true, get });
    rejected(() => validateNativeShortBodySnapshot(forged));
  }
  const doc = { ...before.document };
  Object.defineProperty(doc, 'rawHtml', { enumerable: true, get });
  rejected(() => validateNativeShortBodySnapshot({ ...before, document: doc }));
  const raw = { ...before.native };
  Object.defineProperty(raw, 'editData', { enumerable: true, get });
  rejected(() => createNativeShortBodySnapshot(raw));
  const exp = { ...plan.expectation };
  Object.defineProperty(exp, 'desiredHtml', { enumerable: true, get });
  rejected(() => compareNativeShortBodyReadback(exp, after(before, '<p>甲</p><p></p>')));
  const forgedPlan = { ...plan };
  Object.defineProperty(forgedPlan, 'form', { enumerable: true, get });
  rejected(() => validateNativeShortBodyPlan(forgedPlan));
  assert.equal(hits, 0);
  for (const bad of [
    { ...before, bodyHash: '0'.repeat(64) },
    { ...before, scope: 'short-native-trial/v1' },
    { ...before, hashBases: { ...before.hashBases, body: 'foreign' } },
  ])
    rejected(() => validateNativeShortBodySnapshot(bad));
  rejected(
    () => createNativeShortBodySnapshot({ ...before.native, documentHash: '0'.repeat(64) }),
    'snapshot_source_invalid',
  );
});

test('input source HTML account and derived carrier budgets stay independent', () => {
  const before = snapshot('<p>甲</p>'),
    base = request(before);
  rejected(
    () =>
      validateNativeShortBodyWriteRequest({
        ...base,
        paragraphs: [{ sourceIndex: null, lines: ['甲'.repeat(1_048_577)] }],
      }),
    'json_extent_limit',
  );
  rejected(
    () =>
      validateNativeShortBodyWriteRequest({
        ...base,
        paragraphs: [{ sourceIndex: null, lines: Array(100_001).fill('') }],
      }),
    'json_resource_limit',
  );
  let depth: unknown = 0;
  for (let i = 0; i < 66; i++) depth = { child: depth };
  rejected(
    () => validateNativeShortBodyWriteRequest({ ...base, extra: depth }),
    'json_resource_limit',
  );
  const native = createNativeShortMetadataSnapshot(fixture('<p>甲</p>'));
  rejected(
    () =>
      createNativeShortBodySnapshot({
        ...native,
        editData: { ...native.editData, content: 'x'.repeat(3 * 1024 * 1024 + 1) },
      }),
    'snapshot_source_invalid',
  );
  const many = snapshot('<p>a</p>'.repeat(18_000) + '<p></p>');
  assert.equal(many.sourceParagraphs.length, 18_001);
  assert.equal(validateNativeShortBodySnapshot(many).document.paragraphCount, 18_001);
  rejected(() => planNativeShortBodyUpdate(many, request(many)), 'no_change');
});

test('new canonical hashes use lexical integer keys and UTF16 Unicode ordering', () => {
  assert.equal(
    createHash('sha256').update(GOLDEN_CANONICAL, 'utf8').digest('hex'),
    GOLDEN_PRESERVATION_SHA,
  );
  const opaque = { '2': 2, '10': 10, é: 4, é: 3, '😀': 5, '': 6, '𐀀': 7 };
  const before = snapshot('<p>甲</p>', (raw) => {
    raw.editData.opaque = opaque;
  });
  const plan = planNativeShortBodyUpdate(before, request(before));
  assert.equal(plan.expectation.preservationHash, GOLDEN_PRESERVATION_SHA);
  const reordered = snapshot('<p>甲</p>', (raw) => {
    raw.editData.opaque = { '𐀀': 7, '': 6, '😀': 5, é: 3, é: 4, '10': 10, '2': 2 };
  });
  assert.equal(
    planNativeShortBodyUpdate(reordered, request(reordered)).expectation.preservationHash,
    GOLDEN_PRESERVATION_SHA,
  );
  const swapped = snapshot('<p>甲</p>', (raw) => {
    raw.editData.opaque = { ...opaque, '2': 10, '10': 2 };
  });
  assert.notEqual(
    planNativeShortBodyUpdate(swapped, request(swapped)).expectation.preservationHash,
    GOLDEN_PRESERVATION_SHA,
  );
  const normalized = snapshot('<p>甲</p>', (raw) => {
    raw.editData.opaque = { '2': 2, '10': 10, é: 3, '😀': 5, '': 6, '𐀀': 7 };
  });
  assert.notEqual(
    planNativeShortBodyUpdate(normalized, request(normalized)).expectation.preservationHash,
    GOLDEN_PRESERVATION_SHA,
  );
});

test('business hash binds configured owner account target provenance policy lines and version', () => {
  const before = snapshot('<p>甲</p>'),
    r = request(before),
    business: NativeShortBodyBusinessInput = {
      ...r,
      target: { kind: 'short', workId: '7000000001' },
      snapshotScope: NATIVE_SHORT_BODY_SCOPE,
    };
  const h = nativeShortBodyBusinessInputHash('owner', business);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(nativeShortBodyBusinessInputHash('owner', JSON.parse(JSON.stringify(business))), h);
  assert.deepEqual(nativeShortBodyWriteRequest(business), r);
  assert.notEqual(nativeShortBodyBusinessInputHash('9001', business), h);
  for (const changed of [
    { ...business, target: { kind: 'short' as const, workId: '7000000002' } },
    { ...business, paragraphs: [{ sourceIndex: null, lines: ['甲'] }] },
    { ...business, paragraphs: [{ sourceIndex: 0, lines: ['乙'] }] },
    { ...business, trial: { action: 'clear' as const } },
    { ...business, expectedSnapshotVersionHash: '0'.repeat(64) },
  ])
    assert.notEqual(nativeShortBodyBusinessInputHash('owner', changed), h);
  for (const account of ['', 'owner\n', 'owner\r', '\u0000', '\ud800', 'é'.repeat(513)])
    rejected(() => nativeShortBodyBusinessInputHash(account, business), 'account_id_invalid');
  assert.match(nativeShortBodyBusinessInputHash('é'.repeat(512), business), /^[a-f0-9]{64}$/);
  for (const bad of [
    { ...business, idempotencyKey: 'outer-a' },
    { ...business, snapshotScope: 'short-native-trial/v1' },
    { ...business, target: { kind: 'short', workId: '0' } },
  ])
    rejected(() => validateNativeShortBodyBusinessInput(bad));
});
