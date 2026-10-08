import test from 'node:test';

import {
  type ModernShortSnapshot,
  validateGenericShortSnapshot,
  readWriteSnapshot,
  hashDraftContent,
  type GenericShortObservation,
  updateDraft,
} from '../src/platform/writes.js';

import {
  NativeShortFixturePage,
  nativeShortProfile,
} from './helpers/platform-writes-native-short-fixture-page.js';

import { accountId, target, rejectsCode } from './helpers/platform-writes-fixture-page.js';

import {
  nativeOptions,
  nativeContent,
  nativeUpdateInput,
} from './helpers/platform-writes-fixture-template-document.js';

import assert from 'node:assert/strict';

// R6 independent raw/facts oracle: expected values are fixed here, not produced by the resolver.
test('R6 native generic read preserves the exact same-GET raw matrix and full eight-state facts', async () => {
  const cases: Array<{
    raw: Record<string, unknown>;
    state: ModernShortSnapshot['state'];
    editorRaw: number | null;
    editorPresence: string;
    branch: string;
    displayRaw: number | null;
    displayPresence: string;
    label: string | null;
    management: string;
    reasons: string[];
    conflict?: boolean;
  }> = [
    {
      raw: { publish_status: 0 },
      state: 'draft',
      editorRaw: 0,
      editorPresence: 'observed',
      branch: 'draft',
      displayRaw: null,
      displayPresence: 'missing',
      label: null,
      management: 'unknown',
      reasons: ['status_not_observed'],
    },
    {
      raw: { publish_status: 0, display_status: 0 },
      state: 'draft',
      editorRaw: 0,
      editorPresence: 'observed',
      branch: 'draft',
      displayRaw: 0,
      displayPresence: 'observed',
      label: null,
      management: 'unknown',
      reasons: ['display_code_unmapped'],
    },
    ...(
      [
        [1, 'published', '已发布'],
        [4, 'reviewing', '审核中'],
        [5, 'reviewing', '修改审核中'],
        [7, 'rejected', '审核不通过'],
        [10, 'waiting_publication', '待发表'],
        [12, 'distribution_stopped', '已停止推荐/分发'],
      ] as const
    ).map(([display, state, label]) => ({
      raw: { publish_status: 1, display_status: display },
      state,
      editorRaw: 1,
      editorPresence: 'observed',
      branch: 'non_draft',
      displayRaw: display,
      displayPresence: 'observed',
      label,
      management: state,
      reasons: [],
    })),
    {
      raw: { publish_status: 1 },
      state: 'unknown',
      editorRaw: 1,
      editorPresence: 'observed',
      branch: 'non_draft',
      displayRaw: null,
      displayPresence: 'missing',
      label: null,
      management: 'unknown',
      reasons: ['status_not_observed', 'editor_not_publication_proof'],
    },
    {
      raw: { publish_status: 1, display_status: 0 },
      state: 'unknown',
      editorRaw: 1,
      editorPresence: 'observed',
      branch: 'non_draft',
      displayRaw: 0,
      displayPresence: 'observed',
      label: null,
      management: 'unknown',
      reasons: ['display_code_unmapped', 'editor_not_publication_proof'],
    },
    {
      raw: { publish_status: 1, display_status: 999 },
      state: 'unknown',
      editorRaw: 1,
      editorPresence: 'observed',
      branch: 'non_draft',
      displayRaw: 999,
      displayPresence: 'observed',
      label: null,
      management: 'unknown',
      reasons: ['display_code_unmapped', 'editor_not_publication_proof'],
    },
    {
      raw: {},
      state: 'unknown',
      editorRaw: null,
      editorPresence: 'missing',
      branch: 'unknown',
      displayRaw: null,
      displayPresence: 'missing',
      label: null,
      management: 'unknown',
      reasons: ['status_not_observed'],
    },
    {
      raw: { publish_status: '0', display_status: 1 },
      state: 'unknown',
      editorRaw: null,
      editorPresence: 'invalid',
      branch: 'unknown',
      displayRaw: 1,
      displayPresence: 'observed',
      label: '已发布',
      management: 'published',
      reasons: ['editor_field_invalid'],
    },
    {
      raw: { publish_status: 2, display_status: 12 },
      state: 'unknown',
      editorRaw: 2,
      editorPresence: 'observed',
      branch: 'unknown',
      displayRaw: 12,
      displayPresence: 'observed',
      label: '已停止推荐/分发',
      management: 'distribution_stopped',
      reasons: ['editor_code_unmapped'],
    },
    {
      raw: { publish_status: 0, display_status: { invalid: ['raw', null, true] } },
      state: 'unknown',
      editorRaw: 0,
      editorPresence: 'observed',
      branch: 'draft',
      displayRaw: null,
      displayPresence: 'invalid',
      label: null,
      management: 'unknown',
      reasons: ['display_field_invalid'],
    },
    {
      raw: { publish_status: 0, display_status: 1 },
      state: 'unknown',
      editorRaw: 0,
      editorPresence: 'observed',
      branch: 'draft',
      displayRaw: 1,
      displayPresence: 'observed',
      label: '已发布',
      management: 'published',
      reasons: ['editor_display_conflict'],
      conflict: true,
    },
  ];
  for (const row of cases) {
    const page = new NativeShortFixturePage();
    page.rawResponseTransform = (value) => {
      const raw = value as { data: Record<string, unknown> };
      delete raw.data.publish_status;
      delete raw.data.display_status;
      Object.assign(raw.data, row.raw);
      return raw;
    };
    const result = validateGenericShortSnapshot(
      await readWriteSnapshot(page.asPage(), accountId, target, {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
      }),
    );
    assert.deepEqual(
      Object.keys(result).sort(),
      [
        'title',
        'body',
        'metadata',
        'accountId',
        'target',
        'state',
        'contentHash',
        'sourceUrl',
        'platformReadAt',
        'statusInput',
        'statusFacts',
        'statusProof',
      ].sort(),
    );
    assert.deepEqual(result.statusInput, row.raw);
    assert.deepEqual(result.statusFacts, {
      schema: 'fanqie-short-status-facts/v1',
      source: 'editor_edit_v1',
      basis: 'editor-publish-and-display/v1',
      editor: {
        namespace: 'publish_status',
        raw: row.editorRaw,
        presence: row.editorPresence,
        branch: row.branch,
      },
      management: {
        namespace: 'display_status',
        raw: row.displayRaw,
        presence: row.displayPresence,
        label: row.label,
        state: row.management,
        basis: row.label === null ? 'unknown' : 'observed_code',
      },
      resolvedState: row.state,
      draftEditable: row.state === 'draft',
      conflict: row.conflict ?? false,
      reasons: row.reasons,
    });
    assert.equal(result.state, row.state);
    assert.deepEqual(result.metadata, {});
    assert.equal(result.contentHash, hashDraftContent(nativeContent));
    assert.equal(result.statusProof.requestCount, 1);
    assert.equal(result.statusProof.responseCount, 1);
    assert.equal(page.gotoCalls.length, 1);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
    page.cleanup();
  }
});

test('R6 noneditable raw statuses retain a baseline observation but never authorize an intent, fill or save', async () => {
  for (const raw of [
    { publish_status: 1, display_status: 1 },
    { publish_status: 1, display_status: 4 },
    { publish_status: 1, display_status: 5 },
    { publish_status: 1, display_status: 7 },
    { publish_status: 1, display_status: 10 },
    { publish_status: 1, display_status: 12 },
    { publish_status: 0, display_status: 1 },
    { publish_status: 0, display_status: null },
    { publish_status: 1, display_status: 0 },
    { publish_status: 2 },
    { publish_status: null },
    { publish_status: '0' },
    { publish_status: 0.5 },
    {},
  ]) {
    const page = new NativeShortFixturePage(),
      observations: GenericShortObservation[] = [];
    let intents = 0;
    page.rawResponseTransform = (value) => {
      const response = value as { data: Record<string, unknown> };
      delete response.data.publish_status;
      delete response.data.display_status;
      Object.assign(response.data, raw);
      return response;
    };
    await assert.rejects(
      updateDraft(page.asPage(), nativeUpdateInput(), {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 100,
        onShortObservation: async (value) => {
          observations.push(value);
        },
        beforeSideEffect: async () => {
          intents++;
        },
      }),
      rejectsCode('version_conflict'),
    );
    assert.equal(observations.length, 1);
    assert.equal(observations[0]!.phase, 'baseline');
    assert.deepEqual(observations[0]!.snapshot.statusInput, raw);
    assert.equal(observations[0]!.snapshot.statusFacts.draftEditable, false);
    assert.equal(intents, 0);
    assert.equal(page.gotoCalls.length, 1);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
    page.cleanup();
  }
});
