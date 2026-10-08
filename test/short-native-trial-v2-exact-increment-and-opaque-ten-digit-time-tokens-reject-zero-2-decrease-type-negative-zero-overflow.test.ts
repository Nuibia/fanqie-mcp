import test from 'node:test';

import {
  snapshot,
  request,
  after,
  HTML,
  rejected,
  fixture,
} from './helpers/short-native-trial-fixture.js';

import {
  planNativeShortTrialUpdate,
  compareNativeShortTrialReadback,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  assertNativeShortTrialPreSave,
  parseNativeShortTrialDocument,
  validateNativeShortTrialSnapshot,
  type NativeShortTrialSnapshot,
} from '../src/platform/short-native-trial.js';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

test('V2 exact increment and opaque ten digit time tokens reject zero/+2/decrease/type/negative-zero/overflow', async (t) => {
  const before = snapshot(),
    plan = planNativeShortTrialUpdate(before, request(before));
  for (const [version, modified] of [
    [7, '1789450001'],
    [9, '1789450001'],
    [8, '1789449999'],
    [8, 1789450001],
    [8, '178945000'],
    [-0, '1789450001'],
  ] as const)
    await t.test(`${version}:${modified}`, () => {
      if (Object.is(version, -0))
        assert.throws(() =>
          after(before, plan.form.content!, (raw) => {
            raw.editData.latest_version = version;
            raw.editData.modify_time = modified;
          }),
        );
      else
        assert.equal(
          compareNativeShortTrialReadback(
            plan.expectation,
            after(before, plan.form.content!, (raw) => {
              raw.editData.latest_version = version;
              raw.editData.modify_time = modified;
            }),
          ).reason,
          'server_revision_not_proven',
        );
    });
  const equalToken = after(before, plan.form.content!, (raw) => {
    raw.editData.modify_time = before.native.editData.modify_time;
  });
  assert.equal(compareNativeShortTrialReadback(plan.expectation, equalToken).matches, true);
  const overflow = snapshot(HTML, (raw) => {
    raw.editData.latest_version = Number.MAX_SAFE_INTEGER;
  });
  rejected(() => planNativeShortTrialUpdate(overflow, request(overflow)), 'server_revision_shape');
});

test('non-requested title/category/cover/catalog/unknown/tail changes fail complete raw preservation', async (t) => {
  const before = snapshot(),
    plan = planNativeShortTrialUpdate(before, request(before));
  const changes: Array<(raw: ReturnType<typeof fixture>) => void> = [
    (raw) => {
      raw.editData.multi_title = ['改变', '', '保全尾标题'];
    },
    (raw) => {
      raw.editData.multi_title = ['合成主标题&+%', '', '变尾标题'];
    },
    (raw) => {
      raw.editData.thumb_uri = 'fixture/changed';
    },
    (raw) => {
      raw.editData.book_thumb_url_list = [{ opaque: 'changed' }];
    },
    (raw) => {
      raw.editData.category = [
        { category_id: 'c1', label: '变化', name: '都市', extra: 'preserve' },
      ];
    },
    (raw) => {
      raw.editData.unknown = { changed: true };
    },
    (raw) => {
      raw.categoryData.unknown = { keep: false };
    },
    (raw) => {
      delete raw.editData.description;
    },
  ];
  for (const [index, mutate] of changes.entries())
    await t.test(String(index), () =>
      assert.equal(
        compareNativeShortTrialReadback(plan.expectation, after(before, plan.form.content!, mutate))
          .matches,
        false,
      ),
    );
});

test('same semantic text with re-encoded entity or removed empty p is rejected by raw and paragraph hashes', () => {
  const raw = HTML.replace('甲', '&#x7532;'),
    before = snapshot(raw),
    plan = planNativeShortTrialUpdate(before, request(before));
  const reencoded = after(before, plan.form.content!.replace('&#x7532;', '甲'));
  assert.equal(reencoded.bodyHash, before.bodyHash);
  assert.notEqual(reencoded.paragraphsHash, before.paragraphsHash);
  assert.equal(compareNativeShortTrialReadback(plan.expectation, reencoded).matches, false);
  assert.equal(
    createHash('sha256').update(plan.form.content!).digest('hex'),
    plan.expectation.expectedDocumentHash,
  );
  const wrongBasis = {
    ...plan.expectation,
    hashBases: { ...NATIVE_SHORT_TRIAL_HASH_BASES, preservation: 'old-policy' },
  };
  rejected(
    () =>
      compareNativeShortTrialReadback(
        wrongBasis as unknown as typeof plan.expectation,
        after(before, plan.form.content!),
      ),
    'expectation_scope',
  );
});

test('preSave exact snapshot binding rejects any intervening revision or unrelated field drift', () => {
  const before = snapshot(),
    plan = planNativeShortTrialUpdate(before, request(before));
  rejected(
    () => assertNativeShortTrialPreSave(after(before, HTML), plan.expectation),
    'source_version_mismatch',
  );
  const drift = snapshot(HTML, (raw) => {
    raw.editData.unknown = { drift: true };
  });
  rejected(() => assertNativeShortTrialPreSave(drift, plan.expectation), 'source_version_mismatch');
});

test('original empty category selection is omitted from the save form and is preserved in all raw hashes', () => {
  const before = snapshot(HTML, (raw) => {
      raw.editData.category = [];
    }),
    plan = planNativeShortTrialUpdate(before, request(before));
  assert.equal(Object.hasOwn(plan.form, 'category'), false);
  assert.equal(new URLSearchParams(plan.request.body).has('category'), false);
  assert.equal(
    compareNativeShortTrialReadback(plan.expectation, after(before, plan.form.content!)).matches,
    true,
  );
});

test('supported paragraph upper bound reads and plans without applying the source JSON node budget to repeated derived projections', () => {
  for (const count of [20_000, 100_000]) {
    const raw = `<p>${'甲'.repeat(100)}</p>${'<p></p>'.repeat(count - 3)}<p>${'乙'.repeat(100)}</p><p>${'丙'.repeat(100)}</p>`;
    const before = snapshot(raw);
    assert.equal(before.document.paragraphCount, count);
    assert.equal(before.document.eligibleParagraphCount, 3);
    const plan = planNativeShortTrialUpdate(
      before,
      request(before, { action: 'set', beforeParagraph: count - 2 }),
    );
    const observed = after(before, plan.form.content!);
    assert.equal(compareNativeShortTrialReadback(plan.expectation, observed).matches, true);
    assert.equal(observed.document.markerFreeHtml, raw);
    assert.equal(observed.paragraphsHash, before.paragraphsHash);
    // 20k isolates the prior read-success/planner-copy failure; 100k reaches
    // the parser's unchanged bound without adding a derived hash-node budget.
    if (count === 100_000)
      rejected(() => parseNativeShortTrialDocument(raw + '<p></p>'), 'document_resource_limit');
  }
});

test('independent snapshot rebuild rejects derived accessor/symbol/sparse/negative-zero/unknown/Unicode/cycle tampering', () => {
  const before = snapshot();
  assert.equal(
    validateNativeShortTrialSnapshot(before).snapshotVersionHash,
    before.snapshotVersionHash,
  );
  let getters = 0;
  const accessor = structuredClone(before);
  Object.defineProperty(accessor.document.paragraphs[0]!, 'text', {
    enumerable: true,
    get() {
      getters++;
      return 'untrusted';
    },
  });
  const symbol = structuredClone(before);
  Object.defineProperty(symbol.document, Symbol('extra'), { value: true, enumerable: true });
  const sparse = structuredClone(before);
  delete (sparse.document.paragraphs as unknown[])[1];
  const negativeZero = structuredClone(before);
  (negativeZero.document as unknown as Record<string, unknown>).prefixCharacterCount = -0;
  const unknown = structuredClone(before);
  (unknown.native.savedFields as unknown as Record<string, unknown>).extra = true;
  const unicode = structuredClone(before);
  (unicode.document as unknown as Record<string, unknown>).bodyText = '\ud800';
  const cycle = structuredClone(before);
  (cycle.document.paragraphs[0] as unknown as Record<string, unknown>).text = cycle.document;
  for (const value of [accessor, symbol, sparse, negativeZero, unknown, unicode, cycle])
    rejected(() => validateNativeShortTrialSnapshot(value));
  assert.equal(getters, 0);
  const sourceCycle = structuredClone(before);
  (sourceCycle.native.editData as unknown as Record<string, unknown>).cycle =
    sourceCycle.native.editData;
  assert.throws(() => validateNativeShortTrialSnapshot(sourceCycle));
});

test('trial readers carry modern facts while every non-draft observation vetoes planning and after verification', () => {
  const base = snapshot(),
    plan = planNativeShortTrialUpdate(base, request(base));
  for (const [publish, display, state] of [
    [1, 1, 'published'],
    [1, 4, 'reviewing'],
    [1, 7, 'rejected'],
    [1, 10, 'waiting_publication'],
    [1, 12, 'distribution_stopped'],
    [1, undefined, 'unknown'],
    [0, 1, 'unknown'],
    ['0', undefined, 'unknown'],
  ] as const) {
    const before = snapshot(HTML, (raw) => {
      raw.editData.publish_status = publish;
      if (display !== undefined) raw.editData.display_status = display;
    });
    assert.equal(before.native.state, state);
    assert.equal(before.native.statusFacts.draftEditable, false);
    rejected(() => planNativeShortTrialUpdate(before, request(before)), 'state_not_draft');
    const observed = after(base, plan.form.content!, (raw) => {
      raw.editData.publish_status = publish;
      if (display !== undefined) raw.editData.display_status = display;
    });
    assert.equal(
      compareNativeShortTrialReadback(plan.expectation, observed).reason,
      'state_not_draft',
    );
  }
  const missingMarker = structuredClone(base) as unknown as Record<string, any>;
  delete missingMarker.native.statusFacts;
  rejected(() => validateNativeShortTrialSnapshot(missingMarker));
  const forged = structuredClone(base) as unknown as Record<string, any>;
  forged.native.statusFacts.draftEditable = false;
  rejected(() => planNativeShortTrialUpdate(forged as NativeShortTrialSnapshot, request(base)));
});
