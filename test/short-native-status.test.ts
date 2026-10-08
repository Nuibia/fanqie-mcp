import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createNativeShortMetadataSnapshot,
  planNativeShortMetadataUpdateV2,
  NATIVE_SHORT_HASH_BASES,
} from '../src/platform/short-native-metadata.js';
import {
  createNativeShortTrialSnapshot,
  planNativeShortTrialUpdate,
  compareNativeShortTrialReadback,
} from '../src/platform/short-native-trial.js';
import {
  createNativeShortBodySnapshot,
  planNativeShortBodyUpdate,
  validateNativeShortBodySnapshot,
  NATIVE_SHORT_BODY_REPRESENTATION,
} from '../src/platform/short-native-body.js';
import {
  createNativeShortCoverUploadIntent,
  planNativeShortCoverSave,
  nativeShortCoverImagePolicy,
} from '../src/platform/short-native-cover.js';
import {
  resolveShortEditorStatus,
  resolveShortManagementLabels,
} from '../src/platform/short-status.js';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const RAW = {
  binding: {
    account: { kind: 'account_id', id: '1001' },
    work: { kind: 'short', id: '7000000001' },
  },
  editData: {
    item_id: '7000000001',
    publish_status: 0,
    content:
      '<p>甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲</p><p></p><p>乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙</p><p>丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙丙</p>',
    multi_title: ['SYNTHETIC title', '', 'tail'],
    thumb_uri: 'synthetic/portrait',
    book_thumb_uri: 'synthetic/book',
    thumb_url_list: [{ opaque: 'synthetic/portrait-derived' }],
    book_thumb_url_list: [{ opaque: 'synthetic/book-derived' }],
    category: [{ category_id: 'c1', label: '主类', name: '都市', extra: 'preserve' }],
    sign_type: 1,
    origin_activity_flag: 0,
    category_max_count: 8,
    authorize_type: 0,
    latest_version: 7,
    modify_time: '1789450000',
    description: 'synthetic',
    use_ai: 2,
  },
  categoryData: {
    category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
    unknown: { keep: true },
  },
} as const;

function raw(editor: unknown, display?: unknown): any {
  const v: any = structuredClone(RAW);
  if (editor === undefined) delete v.editData.publish_status;
  else v.editData.publish_status = editor;
  if (display === undefined) delete v.editData.display_status;
  else v.editData.display_status = display;
  return v;
}
function writers(input: any) {
  const native = createNativeShortMetadataSnapshot(input),
    trial = createNativeShortTrialSnapshot(native),
    body = createNativeShortBodySnapshot(native);
  const shared = {
    expectedSnapshotVersionHash: native.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft' as const,
  };
  const asset = {
    sourceSha256: sha('synthetic-source'),
    sourceSize: 1234,
    sourceMimeType: 'image/png' as const,
    sourceWidth: 1200,
    sourceHeight: 900,
    preparedSha256: sha('synthetic-prepared-jpeg'),
    preparedSize: 987,
    policy: nativeShortCoverImagePolicy('cover'),
  };
  return {
    native,
    trial,
    body,
    planners: [
      () => planNativeShortMetadataUpdateV2(native, { ...shared, title: 'SYNTHETIC changed' }),
      () =>
        planNativeShortTrialUpdate(trial, {
          ...shared,
          metadata: { trial: { action: 'set', beforeParagraph: 3 } },
        }),
      () =>
        planNativeShortBodyUpdate(body, {
          ...shared,
          representation: NATIVE_SHORT_BODY_REPRESENTATION,
          paragraphs: [
            { sourceIndex: null, lines: ['丁'.repeat(95)] },
            ...body.sourceParagraphs
              .slice(1)
              .map((p) => ({ sourceIndex: p.sourceIndex, lines: p.lines })),
          ],
          trial: { action: 'preserve' },
        }),
      () => createNativeShortCoverUploadIntent(native, { ...shared, asset }),
    ],
  };
}
const states: readonly (readonly [number, string])[] = [
  [1, 'published'],
  [4, 'reviewing'],
  [5, 'reviewing'],
  [7, 'rejected'],
  [10, 'waiting_publication'],
  [12, 'distribution_stopped'],
];
test('F02: all four modern writers require a proven draft across both official namespaces', () => {
  for (const [editor, display, state, editable] of [
    [0, undefined, 'draft', true],
    [0, 0, 'draft', true],
    ...states.map(([code, state]) => [1, code, state, false]),
    ...states.map(([code]) => [0, code, 'unknown', false]),
    [1, undefined, 'unknown', false],
    [1, 0, 'unknown', false],
    [0, 8, 'unknown', false],
    [0, 11, 'unknown', false],
    [0, 999, 'unknown', false],
    [4, 4, 'unknown', false],
    [undefined, 1, 'unknown', false],
    [0, null, 'unknown', false],
    [null, 1, 'unknown', false],
  ] as const) {
    const input = raw(editor, display),
      views = writers(input);
    assert.equal(views.native.state, state, JSON.stringify([editor, display]));
    assert.equal(views.native.statusFacts.draftEditable, editable);
    assert.deepEqual(views.native.statusFacts, resolveShortEditorStatus(input.editData));
    assert.equal(Object.keys(views.native).length, 15);
    assert.deepEqual(views.trial.native, views.native);
    assert.deepEqual(views.body.native, views.native);
    for (const plan of views.planners)
      if (editable) assert.doesNotThrow(plan);
      else assert.throws(plan, (e: any) => e.code === 'state_not_draft');
  }
});
test('F02: stopped distribution uses its official label and editor 1 alone is no publication proof', () => {
  assert.equal(writers(raw(1, 12)).native.statusFacts.management.label, '已停止推荐/分发');
  assert.equal(writers(raw(1)).native.state, 'unknown');
  assert(writers(raw(1)).native.statusFacts.reasons.includes('editor_not_publication_proof'));
});
test('F02: signing and other status namespaces never substitute draft/publication proof', () => {
  for (const sign of [0, 1, 2, 4, 8, 99]) {
    const value = raw(1);
    value.editData.sign_type = sign;
    assert.equal(writers(value).native.state, 'unknown');
  }
  assert.equal(resolveShortManagementLabels(['已签约']).resolvedState, 'unknown');
  assert.equal(resolveShortManagementLabels(['问题标注中', '已签约']).resolvedState, 'unknown');
});
test('F02: facts are mandatory authenticated data in modern sources, not a permissive hint', () => {
  const good = writers(raw(0)),
    shared = {
      expectedSnapshotVersionHash: good.native.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft' as const,
      title: 'changed',
    };
  const cases: any[] = [];
  const absent: any = structuredClone(good.native);
  delete absent.statusFacts;
  cases.push(absent);
  for (const facts of [
    undefined,
    null,
    {},
    { ...good.native.statusFacts, draftEditable: false },
    resolveShortManagementLabels(['已发布']),
  ])
    cases.push({ ...good.native, statusFacts: facts });
  cases.push({ ...good.native, extra: 'forbidden' });
  cases.push({
    ...good.native,
    statusFacts: { ...good.native.statusFacts, privateRaw: 'forbidden' },
  });
  for (const bad of cases) {
    assert.throws(() => planNativeShortMetadataUpdateV2(bad, shared));
    assert.throws(() => createNativeShortTrialSnapshot(bad));
    assert.throws(() => createNativeShortBodySnapshot(bad));
    assert.throws(() => createNativeShortCoverUploadIntent(bad, { ...shared, asset: {} } as any));
  }
  assert.throws(() =>
    createNativeShortMetadataSnapshot({ ...raw(0), statusFacts: good.native.statusFacts }),
  );
});
test('F02: descriptor traps in raw/facts never execute user code before rejection', () => {
  let calls = 0;
  const bad = raw(0);
  Object.defineProperty(bad.editData, 'display_status', {
    enumerable: true,
    get() {
      calls++;
      return 0;
    },
  });
  assert.throws(() => createNativeShortMetadataSnapshot(bad));
  const good = writers(raw(0));
  const fake: any = structuredClone(good.native);
  Object.defineProperty(fake, 'statusFacts', {
    enumerable: true,
    get() {
      calls++;
      return good.native.statusFacts;
    },
  });
  assert.throws(() => createNativeShortTrialSnapshot(fake));
  assert.throws(() => createNativeShortBodySnapshot(fake));
  const body: any = structuredClone(good.body);
  Object.defineProperty(body.native.statusFacts.reasons, '0', {
    enumerable: true,
    get() {
      calls++;
      return 'status_not_observed';
    },
  });
  assert.throws(() => validateNativeShortBodySnapshot(body));
  assert.equal(calls, 0);
});
test('F02: trial comparison preserves state_not_draft when the after observation is reviewing', () => {
  const before = writers(raw(0)),
    plan = planNativeShortTrialUpdate(before.trial, {
      expectedSnapshotVersionHash: before.native.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft',
      metadata: { trial: { action: 'set', beforeParagraph: 3 } },
    });
  assert.equal(
    compareNativeShortTrialReadback(plan.expectation, writers(raw(1, 4)).trial).reason,
    'state_not_draft',
  );
});
