import test from 'node:test';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

import {
  fixture,
  HTML,
  snapshot,
  request,
  after,
  rejected,
  binding,
} from './helpers/short-native-trial-fixture.js';

import {
  createNativeShortTrialSnapshot,
  NATIVE_SHORT_TRIAL_SCOPE,
  planNativeShortTrialUpdate,
  compareNativeShortTrialReadback,
  nativeShortTrialDesiredContentHash,
  assertNativeShortTrialPreSave,
  parseNativeShortTrialDocument,
  officialNativeShortTrialCharacterCount,
  validateNativeShortTrialBusinessInput,
  nativeShortTrialWriteRequest,
  nativeShortTrialBusinessInputHash,
  validateNativeShortTrialWriteRequest,
} from '../src/platform/short-native-trial.js';

import assert from 'node:assert/strict';

test('trial read wraps the unchanged five native C2 hash algorithms and preserves the complete raw document', () => {
  const old = createNativeShortMetadataSnapshot(fixture()),
    trial = createNativeShortTrialSnapshot(old);
  for (const name of [
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
  ] as const)
    assert.equal(trial[name], old[name]);
  assert.equal(trial.scope, NATIVE_SHORT_TRIAL_SCOPE);
  assert.equal(trial.hashBases.document, 'exact-html-utf8/v1');
  assert.equal(trial.document.markerCount, 0);
  assert.equal(trial.document.markerFreeHtml, HTML);
  assert.equal(trial.document.paragraphCount, 4);
  assert.equal(trial.document.eligibleParagraphCount, 3);
  assert.equal(trial.document.characterCount, 300);
  assert.equal(trial.document.paragraphs[1]!.text, '');
  assert.equal(
    trial.document.bodyText,
    `${'甲'.repeat(90)}\n\n${'乙'.repeat(60)}\n${'丙'.repeat(150)}`,
  );
  assert.equal(Object.isFrozen(trial.native.editData), true);
  assert.equal(Object.isFrozen(trial.document.paragraphs), true);
});

test('canonical set inserts before the all-p index and preserves every original wire field', () => {
  const before = snapshot(),
    plan = planNativeShortTrialUpdate(before, request(before));
  const expectedMarker =
    '<div data-percentage="0.5" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class="fq-pay-node-animation"></div>';
  assert.equal(
    plan.form.content,
    before.document.paragraphs
      .slice(0, 3)
      .map((p) => p.rawHtml)
      .join('') +
      expectedMarker +
      before.document.paragraphs[3]!.rawHtml,
  );
  assert.equal(plan.form.multi_title, JSON.stringify(before.native.savedFields.multi_title));
  assert.equal(plan.form.thumb_uri, before.native.savedFields.thumb_uri);
  assert.equal(plan.form.book_thumb_uri, before.native.savedFields.book_thumb_uri);
  assert.equal(plan.form.category, 'c1');
  assert.equal(plan.form.item_version, '-1');
  assert.equal(plan.atomicRevision, false);
  assert.equal(new URLSearchParams(plan.request.body).get('content'), plan.form.content);
  const observed = after(before, plan.form.content!),
    comparison = compareNativeShortTrialReadback(
      JSON.parse(JSON.stringify(plan.expectation)),
      observed,
    );
  assert.equal(comparison.matches, true);
  assert.equal(observed.document.boundary, 3);
  assert.equal(observed.document.displayPercent, 50);
  assert.equal(observed.document.markerFreeHtml, HTML);
  assert.equal(observed.bodyHash, before.bodyHash);
  assert.equal(observed.paragraphsHash, before.paragraphsHash);
  assert.equal(observed.documentHash, plan.expectation.expectedDocumentHash);
  assert.equal(observed.savedFieldsHash, plan.expectation.expectedSavedFieldsHash);
  assert.notEqual(observed.documentHash, before.documentHash);
  assert.notEqual(observed.savedFieldsHash, before.savedFieldsHash);
  assert.notEqual(observed.snapshotVersionHash, before.snapshotVersionHash);
  assert.equal(observed.catalogHash, before.catalogHash);
  assert.equal(plan.desiredContentHash, nativeShortTrialDesiredContentHash(plan.expectation));
  assertNativeShortTrialPreSave(before, plan.expectation);
});

test('fresh clear restores original HTML and content hashes while its full revision-bearing snapshot stays new', () => {
  const original = snapshot(),
    set = planNativeShortTrialUpdate(original, request(original)),
    marked = after(original, set.form.content!);
  const clear = planNativeShortTrialUpdate(marked, request(marked, { action: 'clear' }));
  const restored = after(marked, clear.form.content!);
  assert.equal(compareNativeShortTrialReadback(clear.expectation, restored).matches, true);
  assert.equal(restored.document.rawHtml, HTML);
  assert.equal(restored.documentHash, original.documentHash);
  assert.equal(restored.savedFieldsHash, original.savedFieldsHash);
  assert.equal(restored.trialDocumentHash, original.trialDocumentHash);
  assert.notEqual(restored.snapshotVersionHash, original.snapshotVersionHash);
  rejected(
    () => planNativeShortTrialUpdate(marked, request(original, { action: 'clear' })),
    'source_version_mismatch',
  );
});

test('set moves the sole marker, clear none and identical set reject no-op before a wire save', () => {
  const before = snapshot(),
    plan = planNativeShortTrialUpdate(before, request(before)),
    marked = after(before, plan.form.content!);
  rejected(
    () => planNativeShortTrialUpdate(before, request(before, { action: 'clear' })),
    'no_change',
  );
  rejected(() => planNativeShortTrialUpdate(marked, request(marked)), 'no_change');
  const moved = planNativeShortTrialUpdate(
    marked,
    request(marked, { action: 'set', beforeParagraph: 1 }),
  );
  assert.equal(parseNativeShortTrialDocument(moved.form.content!).markerCount, 1);
  assert.equal(parseNativeShortTrialDocument(moved.form.content!).boundary, 1);
  assert.equal(parseNativeShortTrialDocument(moved.form.content!).markerFreeHtml, HTML);
});

test('official tU exact whitelist differs from nonempty Unicode characters and tF uses trimmed paragraphs', () => {
  assert.equal(officialNativeShortTrialCharacterCount('汉A0!。’￥ 😀𠀀é\n\t\u00a0'), 7);
  const raw = `<p>${'甲'.repeat(100)}&amp;&#x1F600;<br/>甲<br />乙<br>丙</p><p>&nbsp;\t</p><p>${'乙'.repeat(100)}</p><p>${'丙'.repeat(100)}</p>`;
  const parsed = parseNativeShortTrialDocument(raw);
  assert.equal(parsed.eligibleParagraphCount, 3);
  assert.equal(parsed.paragraphCount, 4);
  assert.equal(parsed.characterCount, 304);
  assert.equal(parsed.paragraphs[0]!.text, `${'甲'.repeat(100)}&😀\n甲\n乙\n丙`);
  const before = snapshot(raw),
    plan = planNativeShortTrialUpdate(
      before,
      request(before, { action: 'set', beforeParagraph: 2 }),
    );
  assert.equal(parseNativeShortTrialDocument(plan.form.content!).markerFreeHtml, raw);
  assert.deepEqual(
    parseNativeShortTrialDocument(plan.form.content!).paragraphs.map((p) => p.rawHtml),
    parsed.paragraphs.map((p) => p.rawHtml),
  );
});

test('named and legal scalar numeric entities decode only for semantic comparison, never for wire serialization', () => {
  const raw = `<p>${'甲'.repeat(100)}&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;&#x20000;&#10;</p><p>${'乙'.repeat(100)}</p><p>${'丙'.repeat(100)}</p>`;
  const before = snapshot(raw),
    plan = planNativeShortTrialUpdate(
      before,
      request(before, { action: 'set', beforeParagraph: 1 }),
    );
  assert(plan.form.content!.includes('&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;&#x20000;&#10;'));
  assert.equal(after(before, plan.form.content!).bodyHash, before.bodyHash);
  const legacy = parseNativeShortTrialDocument(
    '<p>&#128;&#133;&#145;&#146;&#147;&#148;&#151;&#X41;</p>',
  );
  assert.equal(legacy.paragraphs[0]!.text, '€…‘’“”—A');
  assert.equal(legacy.characterCount, 7);
  assert.equal(legacy.markerFreeHtml, '<p>&#128;&#133;&#145;&#146;&#147;&#148;&#151;&#X41;</p>');
});

test('complete grammar rejects unsupported or repaired nodes, CR/NUL/Unicode and unknown entities', async (t) => {
  for (const raw of [
    '<p x="1">x</p>',
    '<p><strong>x</strong></p>',
    '<p>x',
    '<P>x</P>',
    '<p>x</p> ',
    '<p><br x="1"></p>',
    '<p>a\rb</p>',
    '<p>\0</p>',
    '<p>\ud800</p>',
    '<p>&madeup;</p>',
    '<p>&constructor;</p>',
    '<p>&toString;</p>',
    '<p>&__proto__;</p>',
    '<p>&amp</p>',
    '<p>&#0;</p>',
    '<p>&#xD800;</p>',
    '<p>&#x110000;</p>',
    '<p>&#13;</p>',
  ])
    await t.test(JSON.stringify(raw), () => rejected(() => parseNativeShortTrialDocument(raw)));
});

test('marker parsing rejects duplicate, nested, extra, missing, stale threshold and false derived attributes', async (t) => {
  const before = snapshot(),
    html = planNativeShortTrialUpdate(before, request(before)).form.content!;
  const cases = [
    html.replace('data-percentage="0.5"', 'data-percentage="0.7"'),
    html.replace('data-para-nums="3"', 'data-para-nums="4"'),
    html.replace('data-min-text="200"', 'data-min-text="2000"'),
    html.replace(' data-min-radio="0.3"', ''),
    html.replace('class="fq-pay-node-animation"', 'class="unknown"'),
    html.replace(
      ' data-fanqie-type="pay_tag"',
      ' data-fanqie-type="pay_tag" data-fanqie-type="pay_tag"',
    ),
    html.replace('<div ', '<div onclick="x" '),
    html.replace('</div>', 'x</div>'),
    html.replace('</div>', '<div></div></div>'),
    html + html.match(/<div[^>]*><\/div>/)![0],
    html.replace('<div ', "<div data-extra='x' "),
  ];
  for (const [index, raw] of cases.entries())
    await t.test(String(index), () => rejected(() => parseNativeShortTrialDocument(raw)));
});

test('boundary requires exact 200 characters, three nonempty paragraphs, at least 30 percent and remaining text', () => {
  const valid = snapshot(
    `<p>${'甲'.repeat(60)}</p><p>${'乙'.repeat(70)}</p><p>${'丙'.repeat(70)}</p>`,
  );
  assert.equal(
    parseNativeShortTrialDocument(
      planNativeShortTrialUpdate(valid, request(valid, { action: 'set', beforeParagraph: 1 })).form
        .content!,
    ).displayPercent,
    30,
  );
  const belowRatio = snapshot(
    `<p>${'甲'.repeat(59)}</p><p>${'乙'.repeat(71)}</p><p>${'丙'.repeat(70)}</p>`,
  );
  rejected(
    () =>
      planNativeShortTrialUpdate(
        belowRatio,
        request(belowRatio, { action: 'set', beforeParagraph: 1 }),
      ),
    'trial_ratio',
  );
  const belowText = snapshot(
    `<p>${'甲'.repeat(60)}</p><p>${'乙'.repeat(70)}</p><p>${'丙'.repeat(69)}</p>`,
  );
  rejected(
    () =>
      planNativeShortTrialUpdate(
        belowText,
        request(belowText, { action: 'set', beforeParagraph: 1 }),
      ),
    'trial_min_text',
  );
  const two = snapshot(`<p>${'甲'.repeat(100)}</p><p></p><p>${'乙'.repeat(100)}</p>`);
  rejected(
    () => planNativeShortTrialUpdate(two, request(two, { action: 'set', beforeParagraph: 1 })),
    'trial_min_paragraphs',
  );
  for (const boundary of [0, 4, 100, 1.5, -0])
    rejected(() =>
      planNativeShortTrialUpdate(
        snapshot(),
        request(snapshot(), { action: 'set', beforeParagraph: boundary }),
      ),
    );
  const tailEmpty = snapshot(HTML + '<p></p>');
  rejected(
    () =>
      planNativeShortTrialUpdate(
        tailEmpty,
        request(tailEmpty, { action: 'set', beforeParagraph: 4 }),
      ),
    'trial_boundary',
  );
});

test('business descriptor validation rejects mixed namespace/fields/getters/symbols and binds its own deterministic hash', () => {
  const before = snapshot(),
    business = {
      target: { kind: 'short' as const, workId: binding.work.id },
      snapshotScope: NATIVE_SHORT_TRIAL_SCOPE,
      ...request(before),
    };
  const valid = validateNativeShortTrialBusinessInput(business);
  assert.deepEqual(nativeShortTrialWriteRequest(valid), request(before));
  assert.equal(
    nativeShortTrialBusinessInputHash(valid),
    nativeShortTrialBusinessInputHash(JSON.parse(JSON.stringify(business))),
  );
  let calls = 0;
  const unsafe: unknown[] = [
    { ...business, idempotencyKey: 'outer-only' },
    { ...business, title: '混写' },
    { ...business, snapshotScope: 'short-native-trial/v2' },
    { ...business, metadata: { trial: { action: 'clear', beforeParagraph: 2 } } },
    { ...business, metadata: { trial: { action: 'set', beforeParagraph: -0 } } },
    { ...business, metadata: { trial: { action: 'set', beforeParagraph: 1 }, cover: {} } },
    { ...business, metadata: { trial: { action: 'set', percentage: 30 } } },
    {
      ...business,
      get metadata() {
        calls++;
        return business.metadata;
      },
    },
    { ...business, [Symbol('secret')]: true },
  ];
  for (const value of unsafe) rejected(() => validateNativeShortTrialBusinessInput(value));
  assert.equal(calls, 0);
  rejected(() => validateNativeShortTrialWriteRequest({ ...request(before), body: '<p>禁止</p>' }));
});
