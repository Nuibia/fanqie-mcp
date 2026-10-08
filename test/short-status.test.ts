import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveShortEditorStatus,
  resolveShortManagementLabels,
  validateShortStatusFacts,
  validateShortStatusRow,
  projectShortWorksStatus,
} from '../src/platform/short-status.js';

test('editor and management zero namespaces retain only the narrow draft branch', () => {
  for (const input of [{ publish_status: 0 }, { publish_status: 0, display_status: 0 }]) {
    const facts = resolveShortEditorStatus(input);
    assert.equal(facts.resolvedState, 'draft');
    assert.equal(facts.draftEditable, true);
    assert.equal(facts.management.state, 'unknown');
    validateShortStatusFacts(facts);
  }
  for (const display of [1, 4, 5, 7, 10, 12, 999, null, '0']) {
    const facts = resolveShortEditorStatus({ publish_status: 0, display_status: display });
    assert.equal(facts.resolvedState, 'unknown');
    assert.equal(facts.draftEditable, false);
    assert.equal(facts.conflict, [1, 4, 5, 7, 10, 12].includes(display as number));
    validateShortStatusFacts(facts);
  }
});
test('editor1 is not publication proof; only same-response display codes establish state', () => {
  const expected = {
    1: 'published',
    4: 'reviewing',
    5: 'reviewing',
    7: 'rejected',
    10: 'waiting_publication',
    12: 'distribution_stopped',
  };
  for (const [display, state] of Object.entries(expected)) {
    const facts = resolveShortEditorStatus({ publish_status: 1, display_status: Number(display) });
    assert.equal(facts.resolvedState, state);
    assert.equal(facts.draftEditable, false);
    validateShortStatusFacts(facts);
  }
  for (const input of [
    { publish_status: 1 },
    { publish_status: 1, display_status: 0 },
    { publish_status: 2, display_status: 1 },
    { display_status: 1 },
  ]) {
    const f = resolveShortEditorStatus(input);
    assert.equal(f.resolvedState, 'unknown');
    validateShortStatusFacts(f);
  }
  assert.equal(
    resolveShortEditorStatus({ publish_status: 1, display_status: 12 }).management.label,
    '已停止推荐/分发',
  );
});
test('whole management labels separate publication/signing, mask and conflicting labels', () => {
  for (const [tags, state] of [
    [['已签约', '审核不通过'], 'rejected'],
    [['待发表'], 'waiting_publication'],
    [['已停止推荐/分发'], 'distribution_stopped'],
    [['已发布', '已发布'], 'published'],
    [['签约审核中'], 'unknown'],
    [['未审核不通过'], 'unknown'],
    [['已发布', '审核中'], 'unknown'],
    [['问题标注中', '已发布'], 'unknown'],
  ] as const) {
    const f = resolveShortManagementLabels([...tags]);
    assert.equal(f.resolvedState, state);
    assert.equal(f.editor.raw, null);
    assert.equal(f.management.raw, null);
    assert.equal(f.draftEditable, false);
    validateShortStatusFacts(f);
  }
});
test('descriptors reject accessors, coercion, symbols, sparse arrays without evaluation', () => {
  let invoked = 0;
  const getter = {
    get publish_status() {
      invoked++;
      return 0;
    },
  };
  const tags = ['已发布'];
  Object.defineProperty(tags, '0', {
    get() {
      invoked++;
      return '已发布';
    },
    enumerable: true,
  });
  for (const input of [
    getter,
    { publish_status: 0, [Symbol('hidden')]: 1 },
    Object.create({ publish_status: 0 }),
  ])
    assert.throws(() => resolveShortEditorStatus(input), /invalid_short_status/);
  for (const input of [tags, new Array(1), ['已发布', undefined]])
    assert.throws(() => resolveShortManagementLabels(input), /invalid_short_status/);
  const f = structuredClone(resolveShortEditorStatus({ publish_status: 0 }));
  Object.defineProperty(f.editor, 'presence', {
    value: {
      toString() {
        invoked++;
        return 'missing';
      },
    },
    enumerable: true,
  });
  assert.throws(() => validateShortStatusFacts(f), /invalid_short_status/);
  assert.equal(invoked, 0);
});
test('historical records preserve source tags/other fields, recompute caches, and remain idempotent', () => {
  const original = {
    dataset: 'short_works',
    capturedAt: '2026-10-05T00:00:00Z',
    records: [
      {
        workId: '1000000000000',
        title: 'synthetic',
        statusTags: ['已签约', '审核不通过', '审核不通过'],
        publicationStatus: 'published',
        signingStatus: 'signed',
        readCount: 1,
      },
      { workId: '1000000000001', publicationStatus: 'published' },
    ],
  };
  const bytes = JSON.stringify(original),
    first = projectShortWorksStatus(original);
  assert.equal(JSON.stringify(original), bytes);
  const rows = first.records as Record<string, unknown>[];
  assert.equal(rows[0]!.publicationStatus, 'rejected');
  assert.equal(rows[0]!.signingStatus, 'signed');
  assert.deepEqual(rows[0]!.statusTags, original.records[0]!.statusTags);
  assert.equal(rows[1]!.publicationStatus, 'unknown');
  assert.deepEqual(projectShortWorksStatus(first), first);
  const invalid = structuredClone(first);
  (invalid.records as Record<string, any>[])[0]!.statusFacts.extra = true;
  assert.throws(() => projectShortWorksStatus(invalid), /invalid_short_status/);
  const mismatch = structuredClone(first);
  (mismatch.records as Record<string, unknown>[])[0]!.publicationStatus = 'published';
  assert.throws(
    () => validateShortStatusRow((mismatch.records as unknown[])[0]),
    /invalid_short_status/,
  );
});
