import test from 'node:test';

import {
  ORACLE,
  snapshot,
  request,
  after,
  type RawFixture,
  rejected,
} from './helpers/short-native-body-fixture.js';

import {
  planNativeShortBodyUpdate,
  compareNativeShortBodyReadback,
  createNativeShortBodySnapshot,
  assertNativeShortBodyPreSave,
  validateNativeShortBodyPlan,
  nativeShortBodyDesiredContentHash,
} from '../src/platform/short-native-body.js';

import assert from 'node:assert/strict';

test('full unknown metadata titles category cover and catalog retention is required', () => {
  const o = ORACLE[11]!,
    before = snapshot(o.sourceHtml, (raw) => {
      raw.editData.description = 'synthetic';
      raw.editData.use_ai = 2;
      raw.editData.nested = { future: [1, false, null] };
      raw.editData.thumb_url_list = [{ opaque: 'portrait' }];
    });
  const plan = planNativeShortBodyUpdate(before, request(before, o.submittedParagraphs, o.trial));
  assert.equal(
    compareNativeShortBodyReadback(plan.expectation, after(before, o.expected.desiredHtml)).matches,
    true,
  );
  const changes: ((raw: RawFixture) => void)[] = [
    (raw) => {
      raw.editData.opaque = { keep: ['changed'] };
    },
    (raw) => {
      raw.categoryData.opaque_catalog = 'changed';
    },
    (raw) => {
      raw.editData.multi_title = ['Synthetic title'];
    },
    (raw) => {
      raw.editData.thumb_uri = 'changed';
    },
    (raw) => {
      raw.editData.book_thumb_uri = 'changed';
    },
    (raw) => {
      raw.editData.thumb_url_list = [];
    },
    (raw) => {
      raw.editData.description = 'changed';
    },
    (raw) => {
      raw.editData.use_ai = 1;
    },
    (raw) => {
      raw.editData.nested = { future: [1, true, null] };
    },
    (raw) => {
      raw.editData.category = [
        { category_id: 'c1', label: 'A', name: 'First' },
        { category_id: 'c2', label: 'B', name: 'Second' },
      ];
    },
  ];
  for (const change of changes)
    assert.equal(
      compareNativeShortBodyReadback(
        plan.expectation,
        after(before, o.expected.desiredHtml, change),
      ).matches,
      false,
    );
  assert.equal(Object.hasOwn(plan.form, 'opaque'), false);
  assert.equal(Object.hasOwn(plan.form, 'use_ai'), false);
  assert.equal(Object.hasOwn(plan.form, 'description'), false);
  const uncategorized = snapshot('<p>甲</p>', (raw) => {
    raw.editData.category = [];
  });
  assert.equal(
    Object.hasOwn(
      planNativeShortBodyUpdate(uncategorized, request(uncategorized)).form,
      'category',
    ),
    false,
  );
});

test('desired body and wire are checked without claiming fresh provenance history', () => {
  const o = ORACLE[11]!,
    before = snapshot(o.sourceHtml),
    plan = planNativeShortBodyUpdate(before, request(before, o.submittedParagraphs, o.trial));
  const good = after(before, o.expected.desiredHtml);
  assert.equal(compareNativeShortBodyReadback(plan.expectation, good).reason, 'match');
  assert.notEqual(plan.expectation.bodyHash, before.bodyHash);
  assert.notEqual(plan.expectation.paragraphsHash, before.paragraphsHash);
  assert.equal(
    compareNativeShortBodyReadback(plan.expectation, after(before, before.document.markerFreeHtml))
      .matches,
    false,
  );
  assert.equal(
    compareNativeShortBodyReadback(plan.expectation, after(before, before.document.rawHtml))
      .matches,
    false,
  );
  const inserted = ORACLE[8]!,
    b = snapshot(inserted.sourceHtml),
    p = planNativeShortBodyUpdate(b, request(b, inserted.submittedParagraphs, inserted.trial)),
    a = after(b, inserted.expected.desiredHtml);
  assert.notEqual(a.sourceVectorHash, b.sourceVectorHash);
  assert.equal(compareNativeShortBodyReadback(p.expectation, a).matches, true);
  assert.equal(
    p.expectation.writeRequest.paragraphs.some((x) => x.sourceIndex === null),
    true,
  );
  assert.equal(
    a.sourceParagraphs.every((x, i) => x.sourceIndex === i),
    true,
  );
  assert.equal(Object.hasOwn(a, 'appendedWireTerminal'), false);
});

test('strict server revision binding state and unmasked failure remain explicit', () => {
  const before = snapshot('<p>甲</p>'),
    plan = planNativeShortBodyUpdate(before, request(before));
  for (const latest of [7, 9, '8', -1, Number.MAX_SAFE_INTEGER]) {
    const a = after(before, '<p>甲</p><p></p>', (raw) => {
      raw.editData.latest_version = latest;
    });
    assert.equal(
      compareNativeShortBodyReadback(plan.expectation, a).reason,
      'server_revision_not_proven',
    );
  }
  rejected(
    () =>
      createNativeShortBodySnapshot({
        ...before.native,
        editData: { ...before.native.editData, latest_version: -0 },
      }),
    'snapshot_source_invalid',
  );
  for (const time of ['1789449999', 'not-a-time', '17894500001', '１７８９４５０００１'])
    assert.equal(
      compareNativeShortBodyReadback(
        plan.expectation,
        after(before, '<p>甲</p><p></p>', (raw) => {
          raw.editData.modify_time = time;
        }),
      ).reason,
      'server_revision_not_proven',
    );
  const sameTime = after(before, '<p>甲</p><p></p>', (raw) => {
    raw.editData.modify_time = '1789450000';
  });
  assert.equal(compareNativeShortBodyReadback(plan.expectation, sameTime).reason, 'match');
  const invalid = compareNativeShortBodyReadback(
    plan.expectation,
    after(before, '<p>甲</p><p></p>', (raw) => {
      raw.editData.latest_version = 7;
    }),
  );
  assert.notEqual(invalid.actual.preservationHash, plan.expectation.preservationHash);
  assert.equal(
    compareNativeShortBodyReadback(
      plan.expectation,
      after(before, '<p>甲</p><p></p>', (raw) => {
        raw.binding = { account: { kind: 'account_id', id: '9002' }, work: before.binding.work };
      }),
    ).reason,
    'binding_changed',
  );
  assert.equal(
    compareNativeShortBodyReadback(
      plan.expectation,
      after(before, '<p>甲</p><p></p>', (raw) => {
        raw.editData.publish_status = 1;
      }),
    ).reason,
    'state_not_draft',
  );
  for (const mutate of [
    (raw: RawFixture) => {
      raw.editData.latest_version = Number.MAX_SAFE_INTEGER;
    },
    (raw: RawFixture) => {
      raw.editData.sign_type = 0;
    },
    (raw: RawFixture) => {
      raw.editData.origin_activity_flag = 2;
    },
  ]) {
    const b = snapshot('<p>甲</p>', mutate);
    rejected(() => planNativeShortBodyUpdate(b, request(b)));
  }
});

test('preSave rederives full before plan and forged portable plans do not confer authority', () => {
  const before = snapshot('<p>甲</p>'),
    plan = planNativeShortBodyUpdate(before, request(before));
  assertNativeShortBodyPreSave(before, plan);
  const changed = snapshot('<p>甲</p>', (raw) => {
    raw.editData.opaque = { changed: true };
  });
  rejected(() => assertNativeShortBodyPreSave(changed, plan), 'source_version_mismatch');
  for (const bad of [
    { ...plan, desiredContentHash: '0'.repeat(64) },
    { ...plan, request: { ...plan.request, url: 'https://foreign.invalid' } },
    { ...plan, form: { ...plan.form, use_ai: '1' } },
    { ...plan, expectation: { ...plan.expectation, bodyHash: '0'.repeat(64) } },
  ])
    rejected(() => validateNativeShortBodyPlan(bad));
  const forged = { ...plan, form: { ...plan.form, multi_title: '["Foreign title"]' } };
  const digest = nativeShortBodyDesiredContentHash({
    expectation: forged.expectation,
    form: forged.form,
  });
  const portable = {
    ...forged,
    desiredContentHash: digest,
    request: { ...forged.request, body: new URLSearchParams(forged.form).toString() },
  };
  validateNativeShortBodyPlan(portable);
  rejected(() => assertNativeShortBodyPreSave(before, portable), 'expectation_source_mismatch');
  assert.equal(Object.hasOwn(portable, 'authority'), false);
  assert.equal(Object.hasOwn(portable, 'verifiedLive'), false);
});
