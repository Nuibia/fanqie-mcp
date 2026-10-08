import { V1_LITERAL_ORACLES } from './helpers/short-native-metadata-v1-literal-oracles.js';

import test from 'node:test';

import { raw, request, rejected } from './helpers/short-native-metadata-raw.js';

import assert from 'node:assert/strict';

import {
  shaText,
  ORIGINAL_V1_LITERAL_GRAPHS,
  assertLiteral,
  v2Snapshot,
  v2After,
} from './helpers/short-native-metadata-assert-literal.js';

import { storedMetadataMath } from '../src/platform/short-native-legacy-codec.js';

import {
  nativeShortMetadataDesiredContentHash,
  planNativeShortMetadataUpdate,
  type NativeShortMetadataSnapshot,
  planNativeShortMetadataUpdateV2,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_WRITE_HASH_BASES_V2,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  compareNativeShortMetadataReadbackVersioned,
  compareNativeShortMetadataReadback,
  createNativeShortMetadataSnapshot,
} from '../src/platform/short-native-metadata.js';

import {
  nativeShortDesiredContentHash,
  validateNativeShortEvidenceContext,
  createNativeShortReadEvidence,
  projectNativeShortEvidence,
} from '../src/platform/short-native-metadata-proof.js';

import { canonicalJson } from '../src/runtime/store.js';

for (const oracle of V1_LITERAL_ORACLES)
  test(`literal legacy ${oracle.name} preserves snapshot expectation intent and C2 byte hashes`, () => {
    const input = raw();
    if (oracle.withServer) {
      input.editData.latest_version = 7;
      input.editData.modify_time = '0000000123';
    }
    assert.equal(shaText(JSON.stringify(input)), oracle.rawJsonSha256);
    const original = ORIGINAL_V1_LITERAL_GRAPHS.find((graph) => graph.name === oracle.name)!;
    const decoded = storedMetadataMath.decodeSnapshot(original.before);
    assert.equal(decoded.mode, 'legacy');
    const before = decoded.snapshot,
      plan = storedMetadataMath.planUpdate(decoded, oracle.request);
    assertLiteral(before, oracle.expected.snapshot);
    assertLiteral(plan.expectation, oracle.expected.expectation);
    assert.equal(
      nativeShortMetadataDesiredContentHash(plan.expectation),
      oracle.desiredContentHash,
    );
    assert.equal(nativeShortDesiredContentHash(plan.expectation), oracle.desiredContentHash);
    assertLiteral(original.baseline, oracle.expected.baseline);
    assert.equal(
      canonicalJson(original.baseline.held.expectation),
      canonicalJson(plan.expectation),
    );
    assertLiteral(original.intent, oracle.expected.intent);
    assert.equal(canonicalJson(original.intent.expectation), canonicalJson(plan.expectation));
    const wrapper = validateNativeShortEvidenceContext(original.wrapper, original.context);
    assert.equal(canonicalJson(wrapper), canonicalJson(original.wrapper));
    assert.throws(() =>
      createNativeShortReadEvidence(original.wrapper.result, original.wrapper.provenance),
    );
    assert.throws(() =>
      planNativeShortMetadataUpdate(before as NativeShortMetadataSnapshot, oracle.request),
    );
    assertLiteral(original.business, oracle.expected.c2BusinessProjection);
    const projected = projectNativeShortEvidence(original.wrapper, original.context);
    assert.equal(projected.state, 'draft');
    assert.equal((projected.statusFacts as any).resolvedState, 'draft');
    assert.deepEqual(projected.statusSource, {
      phase: 'read',
      sourceRef: original.context.ref.id,
      evidenceHash: original.context.ref.sha256,
      evidenceCapturedAt: original.context.ref.capturedAt,
    });
    const fields = [
      'scope',
      'hashBases',
      'snapshotVersionHash',
      'catalogHash',
      'documentHash',
      'savedFieldsHash',
      'categorySelectionHash',
      'state',
      'firstTitle',
      'currentSelection',
      'catalog',
      'categoryMaximum',
      'tailTitles',
      'covers',
    ];
    assertLiteral(
      Object.fromEntries(fields.map((key) => [key, projected[key]])),
      oracle.expected.c2SnapshotBusiness,
    );
    if (oracle.withServer) {
      // Original frozen producer negative after; Root actual92ece3 exit0,
      // ORIGINAL-METADATA-NEGATIVE-GOLDEN SHA6820ba038318a9f4ddc987251d116157073db95ce4ec6613d1080785f1b395d4.
      // Raw mutation remains only first title + latest_version=8; opaque modify_time is unchanged.
      const after = storedMetadataMath.decodeSnapshot(
        JSON.parse(
          String.raw`{"scope":"short-native-metadata/v1","hashBases":{"snapshot":"full-edit-catalog-and-typed-binding/v1","catalog":"full-category-data-json/v1","document":"exact-html-utf8/v1","savedFields":"cover-v0-reconstructible-fields/v1","categorySelection":"ordered-raw-category-id-label-name/v1","preservation":"full-source-except-requested-first-title-and-category/v1"},"binding":{"account":{"kind":"account_id","id":"1001"},"work":{"kind":"short","id":"7000000001"}},"editData":{"item_id":"7000000001","publish_status":0,"content":"<section style=\"color:red\" data-x=\"a&amp;b\"><p>合成 &amp; + %</p><pay_tag data-ratio=\"40\"></pay_tag><img src=\"synthetic://image\" alt=\"图\"/><p></p></section>","multi_title":["新&+%合成标题","","副标题&+%","第三标题"],"thumb_uri":"synthetic/portrait&+%","book_thumb_uri":"synthetic/book-cover","category":[{"category_id":10,"label":"主类","name":"主甲","legacy":["keep"]},{"category_id":"r1","label":"角色","name":"角色甲"}],"sign_type":1,"origin_activity_flag":0,"authorize_type":0,"category_max_count":4,"thumb_url_list":[{"main_url":"https://example.invalid/one?Expires=123","extra":null}],"book_thumb_url_list":[{"main_url":"https://example.invalid/two?Expires=456"}],"unknown_metadata":{"nested":[null,false,3,"",{"preserve":true}],"timestamp":"synthetic-time"},"description":"合成未请求字段","use_ai":2,"title_problem":null,"latest_version":8,"modify_time":"0000000123"},"categoryData":{"category_list":[{"category_id":10,"label":"主类","name":"主甲","source":{"a":1}},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"},{"category_id":"r2","label":"角色","name":"角色乙"},{"category_id":30,"label":"主题","name":"主题甲"}],"unknown_catalog":{"revision":1,"URLs":["https://example.invalid/catalog?a=1"]}},"responseBinding":"exact","state":"draft","catalog":[{"category_id":10,"label":"主类","name":"主甲"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"},{"category_id":"r2","label":"角色","name":"角色乙"},{"category_id":30,"label":"主题","name":"主题甲"}],"savedFields":{"item_id":"7000000001","content":"<section style=\"color:red\" data-x=\"a&amp;b\"><p>合成 &amp; + %</p><pay_tag data-ratio=\"40\"></pay_tag><img src=\"synthetic://image\" alt=\"图\"/><p></p></section>","multi_title":["新&+%合成标题","","副标题&+%","第三标题"],"thumb_uri":"synthetic/portrait&+%","book_thumb_uri":"synthetic/book-cover","category":[10,"r1"],"sign_type":1,"activity_flag":0},"snapshotVersionHash":"5b70e1f3e2115cf68a2054ab660afb0d6319889cdf50ac63d3f6727146bad14d","catalogHash":"e35b389f6c29d58e7c2ca2a1293e071f23ead3a261a5e8b299e2f252a965ee62","documentHash":"748cd01ad0adae9602b57b1a5e4ecd7123df34c757aed51679343e92a2b929b4","savedFieldsHash":"de5a1972b9b20f1953948bc17074d22524762fe5ab5571e1ed637de145c47062","categorySelectionHash":"7e642f88c6aa29b17178302b659d79bf9178840283fb53b2c9b5a9ffbbee1b3b"}`,
        ),
      );
      assert.equal(after.mode, 'legacy');
      assert.equal(after.snapshot.editData.latest_version, 8);
      assert.equal(after.snapshot.editData.modify_time, before.editData.modify_time);
      assert.equal(after.snapshot.savedFields.multi_title[0], oracle.businessInput.title);
      assert.equal(
        storedMetadataMath.compareReadbackVersioned(plan.expectation, after).reason,
        'preservation_not_proven',
      );
    }
  });

test('v2 title-only planning keeps payload/full snapshot v1 and proves exactly one revision with equal or increasing opaque token', () => {
  const before = v2Snapshot(),
    old = planNativeShortMetadataUpdate(before, request(before)),
    plan = planNativeShortMetadataUpdateV2(before, request(before));
  assert.deepEqual(plan.form, old.form);
  assert.deepEqual(plan.request, old.request);
  assert.deepEqual(before.hashBases, NATIVE_SHORT_HASH_BASES);
  assert.equal(plan.expectation.version, 2);
  assert.deepEqual(plan.expectation.hashBases, NATIVE_SHORT_WRITE_HASH_BASES_V2);
  assert.equal(plan.expectation.serverRevisionPolicy, NATIVE_SHORT_SERVER_REVISION_POLICY_V2);
  assert.deepEqual(plan.expectation.serverRevisionBefore, {
    latestVersion: 7,
    modifyTime: '0000000123',
  });
  assert.notEqual(
    nativeShortMetadataDesiredContentHash(plan.expectation),
    nativeShortMetadataDesiredContentHash(old.expectation),
  );
  for (const token of ['0000000123', '0000000124']) {
    const after = v2After(before, '新合成标题', (edit) => {
        edit.modify_time = token;
      }),
      compared = compareNativeShortMetadataReadbackVersioned(plan.expectation, after);
    assert.equal(compared.matches, true);
    assert.equal(compared.reason, 'match');
    assert('version' in compared && compared.version === 2);
    assert.deepEqual(
      { ...compared.actual.serverRevisionBefore },
      { ...plan.expectation.serverRevisionBefore },
    );
    assert.deepEqual(compared.actual.serverRevisionAfter, { latestVersion: 8, modifyTime: token });
    const observed = nativeShortMetadataDesiredContentHash({
      ...plan.expectation,
      binding: after.binding,
      expectedState: 'draft',
      catalogHash: compared.actual.catalogHash,
      documentHash: compared.actual.documentHash,
      savedFieldsHash: compared.actual.savedFieldsHash,
      categorySelectionHash: compared.actual.categorySelectionHash,
      preservationHash: compared.actual.preservationHash,
    });
    assert.equal(observed, nativeShortMetadataDesiredContentHash(plan.expectation));
    assert.notEqual(after.snapshotVersionHash, before.snapshotVersionHash);
    assert.equal(compareNativeShortMetadataReadback(old.expectation, after).matches, false);
  }
  assert(Object.isFrozen(plan.expectation.serverRevisionBefore));
});

for (const [name, change] of [
  [
    'missing revision',
    (edit: Record<string, unknown>) => {
      delete edit.latest_version;
    },
  ],
  [
    'missing token',
    (edit: Record<string, unknown>) => {
      delete edit.modify_time;
    },
  ],
  [
    'coerced revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = '7';
    },
  ],
  [
    'null revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = null;
    },
  ],
  [
    'negative revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = -1;
    },
  ],
  [
    'negative zero',
    (edit: Record<string, unknown>) => {
      edit.latest_version = -0;
    },
  ],
  [
    'fraction revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = 7.5;
    },
  ],
  [
    'unsafe revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'no increment room',
    (edit: Record<string, unknown>) => {
      edit.latest_version = Number.MAX_SAFE_INTEGER;
    },
  ],
  [
    'numeric token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = 123;
    },
  ],
  [
    'null token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = null;
    },
  ],
  [
    'short token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '000000123';
    },
  ],
  [
    'long token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '00000000123';
    },
  ],
  [
    'nonASCII token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '０００００００１２３';
    },
  ],
  [
    'signed token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '+000000123';
    },
  ],
  [
    'trailing newline token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '0000000123\n';
    },
  ],
] as const)
  test(`v2 illegal ${name} before rejects without producing a plan`, () => {
    rejected(() => {
      const before = v2Snapshot((input) => change(input.editData));
      planNativeShortMetadataUpdateV2(before, request(before));
    });
  });

test('v2 own data revision requirements reject getters symbols and prototypes without evaluating getters', () => {
  let calls = 0;
  for (const mode of ['getter', 'inherited', 'symbol', 'nonenumerable']) {
    rejected(() => {
      const input = raw();
      input.editData.latest_version = 7;
      input.editData.modify_time = '0000000123';
      if (mode === 'getter')
        Object.defineProperty(input.editData, 'latest_version', {
          enumerable: true,
          get() {
            calls++;
            return 7;
          },
        });
      if (mode === 'inherited') {
        delete input.editData.latest_version;
        Object.setPrototypeOf(input.editData, { latest_version: 7 });
      }
      if (mode === 'symbol')
        Object.defineProperty(input.editData, Symbol('revision'), { value: 7, enumerable: true });
      if (mode === 'nonenumerable')
        Object.defineProperty(input.editData, 'latest_version', { value: 7, enumerable: false });
      const before = createNativeShortMetadataSnapshot(input);
      planNativeShortMetadataUpdateV2(before, request(before));
    });
  }
  assert.equal(calls, 0);
});
