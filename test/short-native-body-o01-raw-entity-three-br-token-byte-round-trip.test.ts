import test from 'node:test';

import {
  checkOracle,
  fixture,
  snapshot,
  request,
  rejected,
  ORACLE,
} from './helpers/short-native-body-fixture.js';

import assert from 'node:assert/strict';

import * as body from '../src/platform/short-native-body.js';

import {
  createNativeShortBodySnapshot,
  NATIVE_SHORT_BODY_HASH_BASES,
  NativeShortBodyError,
  planNativeShortBodyUpdate,
} from '../src/platform/short-native-body.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../src/platform/short-native-metadata.js';

test('O01 raw entity / three BR token byte round-trip', () => {
  checkOracle(0);
});

test('O02 literal source LF is a two-line vector', () => {
  checkOracle(1);
});

test('O03 zero terminal empty p requires explicit wire append', () => {
  checkOracle(2);
});

test('O04 one terminal empty p remains one', () => {
  checkOracle(3);
});

test('O05 many empty paragraphs and BR-only p remain distinct', () => {
  checkOracle(4);
});

test('O06 empty readable source and one explicit blank write paragraph', () => {
  checkOracle(5);
});

test('O07 300 characters = 90/60/150 set at boundary 1', () => {
  checkOracle(6);
});

test('O08 same 300 characters set at boundary 2', () => {
  checkOracle(7);
});

test('O09 preserve anchors successor despite inserted new empty paragraph', () => {
  checkOracle(8);
});

test('O10 preserve anchors successor despite deleted earlier empty paragraph', () => {
  checkOracle(9);
});

test('O11 preserve recomputes ratio after changed body', () => {
  checkOracle(10);
});

test('O12 clear and replace body compares against desired, not before', () => {
  checkOracle(11);
});

test('body domain exports only the frozen pure data and validation surface', () => {
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      'NATIVE_SHORT_BODY_HASH_BASES',
      'NATIVE_SHORT_BODY_REPRESENTATION',
      'NATIVE_SHORT_BODY_RESOURCE_LIMITS',
      'NATIVE_SHORT_BODY_SCOPE',
      'NATIVE_SHORT_BODY_COMPARISON_POLICY_V2',
      'NATIVE_SHORT_BODY_HASH_BASES_V2',
      'nativeShortBodyHashBasesForRequest',
      'upgradeNativeShortBodyExpectationForGetV2',
      'historicalBodyMath',
      'NativeShortBodyError',
      'assertNativeShortBodyPreSave',
      'compareNativeShortBodyReadback',
      'createNativeShortBodySnapshot',
      'nativeShortBodyBusinessInputHash',
      'nativeShortBodyDesiredContentHash',
      'nativeShortBodyWriteRequest',
      'planNativeShortBodyUpdate',
      'validateNativeShortBodyBusinessInput',
      'validateNativeShortBodyPlan',
      'validateNativeShortBodySnapshot',
      'validateNativeShortBodyWriteRequest',
    ].sort(),
  );
  const native = createNativeShortMetadataSnapshot(fixture('<p>甲</p>')),
    s = createNativeShortBodySnapshot(native);
  for (const k of [
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
  ] as const)
    assert.equal(s[k], native[k]);
  for (const k of ['snapshot', 'catalog', 'document', 'savedFields', 'categorySelection'] as const)
    assert.equal(NATIVE_SHORT_BODY_HASH_BASES[k], NATIVE_SHORT_HASH_BASES[k]);
  const unsafe = new NativeShortBodyError(
    'synthetic-value-not-a-code' as NativeShortBodyError['code'],
  );
  assert.equal(unsafe.code, 'json_invalid_value');
  assert.equal(unsafe.message, 'Native short body rejected: json_invalid_value');
  assert.equal(Object.hasOwn(s, 'sourceMode'), false);
  assert.equal(Object.hasOwn(s, 'authority'), false);
  assert.equal(Object.isFrozen(s.native.editData), true);
  assert.equal(Object.isFrozen(s.sourceParagraphs[0]!.lines), true);
});

test('canonical escaped literal text differs from raw entity decoding', () => {
  const before = snapshot(''),
    p = planNativeShortBodyUpdate(
      before,
      request(before, [{ sourceIndex: null, lines: ['<>&', '尾'] }]),
    );
  assert.equal(p.form.content, '<p>&lt;&gt;&amp;<br>尾</p><p></p>');
  assert.deepEqual(
    p.expectation.effectiveWireParagraphs.map((x) => x.lines),
    [['<>&', '尾'], ['']],
  );
  const amp = planNativeShortBodyUpdate(
    before,
    request(before, [{ sourceIndex: null, lines: ['&amp;'] }]),
  );
  assert.equal(amp.form.content, '<p>&amp;amp;</p><p></p>');
  const lf = snapshot('<p>甲\n乙</p><p></p>');
  const changed = planNativeShortBodyUpdate(
    lf,
    request(lf, [
      { sourceIndex: 0, lines: ['甲', '丙'] },
      { sourceIndex: 1, lines: [''] },
    ]),
  );
  assert.equal(changed.form.content, '<p>甲<br>丙</p><p></p>');
  assert.equal(changed.expectation.appendedWireTerminal, false);
});

test('BR-only and wire empties retain exact separate paragraph roles', () => {
  const before = snapshot('<p><br /></p>'),
    p = planNativeShortBodyUpdate(before, request(before));
  assert.equal(p.form.content, '<p><br /></p><p></p>');
  assert.equal(p.expectation.appendedWireTerminal, true);
  assert.deepEqual(
    p.expectation.effectiveWireParagraphs.map((x) => x.lines),
    [['', ''], ['']],
  );
  const blank = snapshot('<p></p><p></p><p><br></p><p></p>');
  rejected(() => planNativeShortBodyUpdate(blank, request(blank)), 'no_change');
  rejected(
    () => planNativeShortBodyUpdate(snapshot(''), request(snapshot(''), [])),
    'paragraph_shape',
  );
});

test('exact wire equality throws no_change despite different provenance and unsupported save fields', () => {
  const before = snapshot('<p>甲</p><p></p>', (raw) => {
    raw.editData.sign_type = null;
    raw.editData.latest_version = 'not-a-revision';
  });
  const r = request(before, [
    { sourceIndex: null, lines: ['甲'] },
    { sourceIndex: null, lines: [''] },
  ]);
  rejected(() => planNativeShortBodyUpdate(before, r), 'no_change');
  const shortened = snapshot('<p>甲</p>');
  assert.equal(
    planNativeShortBodyUpdate(shortened, request(shortened)).form.content,
    '<p>甲</p><p></p>',
  );
});

test('preserve rejects deleted successor even when a replacement has identical text', () => {
  const o = ORACLE[8]!,
    before = snapshot(o.sourceHtml);
  const submitted = o.submittedParagraphs.map((p) =>
    p.sourceIndex === 1 ? { sourceIndex: null, lines: p.lines } : p,
  );
  rejected(
    () => planNativeShortBodyUpdate(before, request(before, submitted, { action: 'preserve' })),
    'trial_anchor_missing',
  );
  const clear = planNativeShortBodyUpdate(before, request(before, submitted, { action: 'clear' }));
  assert.equal(clear.expectation.marker.rawHtml, null);
  const content = clear.form.content;
  assert.ok(typeof content === 'string');
  assert.equal(content.includes('pay_tag'), false);
});

test('preserve keeps unchanged marker attribute bytes and canonicalizes only changed derived values', () => {
  const reverse =
    '<div class="" data-para-nums="3" data-min-radio="0.3" data-min-paragraphs="3" data-min-text="200" data-fanqie-type="pay_tag" data-percentage="0.3"></div>';
  const source = `<p>${'甲'.repeat(90)}</p>${reverse}<p>${'乙'.repeat(60)}</p><p>${'丙'.repeat(150)}</p><p></p>`,
    before = snapshot(source);
  const rows = [
    { sourceIndex: null, lines: [''] },
    ...before.sourceParagraphs.map((p) => ({ sourceIndex: p.sourceIndex, lines: p.lines })),
  ];
  const inserted = planNativeShortBodyUpdate(before, request(before, rows));
  assert.equal(inserted.expectation.marker.rawHtml, reverse);
  const changed = rows.map((p) => (p.sourceIndex === 0 ? { ...p, lines: ['甲'.repeat(180)] } : p));
  const rebuilt = planNativeShortBodyUpdate(before, request(before, changed));
  assert.equal(
    rebuilt.expectation.marker.rawHtml,
    '<div data-percentage="0.46153846153846156" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class=""></div>',
  );
});

test('set and preserve revalidate official text eligible paragraphs ratio and suffix', () => {
  for (const boundary of [0, -0, -1, 3, 4, 0.5, NaN, Infinity]) {
    const before = snapshot(ORACLE[6]!.sourceHtml);
    rejected(() =>
      planNativeShortBodyUpdate(
        before,
        request(before, undefined, { action: 'set', beforeParagraph: boundary }),
      ),
    );
  }
  const text199 = snapshot(
    `<p>${'甲'.repeat(99)}</p><p>${'乙'.repeat(50)}</p><p>${'丙'.repeat(50)}</p>`,
  );
  rejected(
    () =>
      planNativeShortBodyUpdate(
        text199,
        request(text199, undefined, { action: 'set', beforeParagraph: 1 }),
      ),
    'trial_min_text',
  );
  const two = snapshot(`<p>${'甲'.repeat(100)}</p><p>${'乙'.repeat(100)}</p><p></p>`);
  rejected(
    () =>
      planNativeShortBodyUpdate(
        two,
        request(two, undefined, { action: 'set', beforeParagraph: 1 }),
      ),
    'trial_min_paragraphs',
  );
  const low = snapshot(`<p>甲</p><p>${'乙'.repeat(199)}</p><p>丙</p>`);
  rejected(
    () =>
      planNativeShortBodyUpdate(
        low,
        request(low, undefined, { action: 'set', beforeParagraph: 1 }),
      ),
    'trial_ratio',
  );
  const all = snapshot(`<p>${'甲'.repeat(100)}</p><p>${'乙'.repeat(100)}</p><p>😀𠀀</p>`);
  rejected(
    () =>
      planNativeShortBodyUpdate(
        all,
        request(all, undefined, { action: 'set', beforeParagraph: 2 }),
      ),
    'trial_ratio',
  );
  const before = snapshot(ORACLE[8]!.sourceHtml),
    rows = before.sourceParagraphs.map((p) => ({
      sourceIndex: p.sourceIndex,
      lines: p.sourceIndex === 0 ? ['甲'.repeat(60)] : p.lines,
    }));
  rejected(() => planNativeShortBodyUpdate(before, request(before, rows)), 'trial_ratio');
  assert.equal(snapshot('<p>汉A0!。’￥ 😀𠀀é\n	&nbsp;</p>').document.characterCount, 7);
});

test('source grammar entities and invalid scalars fail with bounded safe reasons', () => {
  for (const html of [
    '<p x="1">甲</p>',
    '<p><strong>甲</strong></p>',
    '<P>甲</P>',
    '<br>',
    '<p>甲',
    '<p>甲</p> ',
    '<p>\u0000</p>',
    '<p>甲\r乙</p>',
  ])
    rejected(() => snapshot(html));
  const native = createNativeShortMetadataSnapshot(fixture('<p>甲</p>'));
  rejected(
    () =>
      createNativeShortBodySnapshot({
        ...native,
        editData: { ...native.editData, content: '<p>\ud800</p>' },
      }),
    'snapshot_source_invalid',
  );
  for (const html of ['<p>&unknown;</p>', '<p>&constructor;</p>', '<p>&amp</p>'])
    rejected(() => snapshot(html), 'unsupported_entity');
  for (const html of ['<p>&#0;</p>', '<p>&#13;</p>', '<p>&#xD800;</p>', '<p>&#x110000;</p>'])
    rejected(() => snapshot(html), 'invalid_entity_scalar');
  const legal = snapshot('<p>&#10;</p><p></p>');
  assert.deepEqual(legal.sourceParagraphs[0]!.lines, ['', '']);
  rejected(() => planNativeShortBodyUpdate(legal, request(legal)), 'no_change');
});
