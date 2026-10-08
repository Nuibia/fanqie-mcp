import test from 'node:test';

import { nativeSaveFixture } from './helpers/short-native-metadata-integration-native-write-snapshot.js';

import {
  type NativeShortWriteEvidenceContext,
  projectNativeShortWriteEvidence,
} from '../src/platform/short-native-metadata-proof.js';

import { createHash } from 'node:crypto';

import { canonicalJson } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import { createApplication } from '../src/application.js';

import { noPrivate, SCOPE } from './helpers/short-native-metadata-integration-snapshot.js';

test('C3 valid private payload hashes do not bypass phase schema, full snapshot or cleanup checks', async (t) => {
  const f = await nativeSaveFixture();
  try {
    const afterContext = () => structuredClone(f.context);
    const rehash = (ctx: NativeShortWriteEvidenceContext, index: number) => {
      ctx.refs[index]!.sha256 = createHash('sha256')
        .update(`${canonicalJson(ctx.documents[index])}\n`)
        .digest('hex');
    };
    // Use failed/uncertain with after persisted: no successful result DTO equality
    // can mask whether the after schema itself really rejects each mutation.
    const base = afterContext();
    base.refs.pop();
    base.documents.pop();
    base.job.status = 'uncertain';
    base.job.error = { code: 'outcome_unknown', message: 'Safe synthetic failure' };
    base.job.result = { evidence: base.refs };
    const uncertain = projectNativeShortWriteEvidence(base).data[0]!;
    assert.equal(uncertain.status, 'uncertain');
    // Nested snapshot facts are qualified by the parent's authenticated refs;
    // the one status source belongs to the root row, not either snapshot.
    const nestedKeys = [
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
      'statusFacts',
    ].sort();
    for (const nested of [uncertain.baseline, uncertain.after] as any[]) {
      assert.deepEqual(Object.keys(nested).sort(), nestedKeys);
      assert.equal(nested.state, nested.statusFacts.resolvedState);
      assert.equal(Object.hasOwn(nested, 'statusSource'), false);
    }
    assert.deepEqual(uncertain.statusSource, {
      phase: 'after',
      sourceRef: base.refs[2]!.id,
      evidenceHash: base.refs[2]!.sha256,
      evidenceCapturedAt: base.refs[2]!.capturedAt,
    });
    for (const [name, mutate] of [
      ['cleanup', (p: any) => (p.result.cleanup.pendingAtEnd = 1)],
      ['post-count', (p: any) => (p.result.post.attempts = 2)],
      [
        'raw-category-selection-label',
        (p: any) => (p.result.snapshot.editData.category[0].name = 'Wrong label'),
      ],
      [
        'opaque-field-preservation',
        (p: any) => (p.result.snapshot.editData.PRIVATE_UNKNOWN_KEY = 'changed'),
      ],
      [
        'unknown-phase-schema',
        (p: any) => (p.result.phases.after.schema = 'native-short-metadata-reconciliation/v2'),
      ],
      ['extra-cleanup-private', (p: any) => (p.result.cleanup.raw = 'PRIVATE_HTML')],
      [
        'future-proof-time',
        (p: any) => (p.result.proof.proofCapturedAt = '2040-01-01T00:00:00.000Z'),
      ],
      [
        'extra-result-runtime-schema',
        (p: any) => (p.result.extra = { schema: 'native-short-metadata-future/v1' }),
      ],
    ] as const)
      await t.test(name, () => {
        const ctx = structuredClone(base);
        mutate(ctx.documents[2]!.payload);
        rehash(ctx, 2);
        ctx.job.result = { evidence: ctx.refs };
        assert.throws(() => projectNativeShortWriteEvidence(ctx));
      });
    const accessor = afterContext();
    let accesses = 0;
    Object.defineProperty(accessor.documents, '0', {
      enumerable: true,
      get() {
        accesses++;
        return f.documents[0];
      },
    });
    assert.throws(() => projectNativeShortWriteEvidence(accessor));
    assert.equal(accesses, 0);
  } finally {
    await f.close();
  }
});

test('C3 reconcile minimal ACK-lost uses fresh native read with default writes=false; injected fixture cannot settle', async () => {
  const f = await nativeSaveFixture('acklost');
  const app = createApplication(f.config, { browser: f.createBrowser() });
  try {
    assert.equal(f.job.status, 'uncertain');
    assert.equal(f.postCount, 1);
    assert.equal(f.getCount, 5);
    const priorEnd = f.job.endedAt;
    const viewed = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_reconcile_write',
      new URLSearchParams(),
      { jobId: f.job.id },
    )) as any;
    assert.equal(viewed.reconciliation.job.status, 'succeeded', JSON.stringify(viewed));
    assert.equal(viewed.reconciliation.job.operation, 'reconcile_write');
    assert.equal(viewed.reconciliation.data[0].status, 'succeeded');
    assert.equal(viewed.reconciliation.data[0].firstTitle, 'Changed title');
    assert.equal(viewed.reconciliation.sourceMode, 'fixture');
    assert.equal(viewed.original.job.status, 'uncertain');
    assert.equal(viewed.original.job.endedAt, priorEnd);
    assert.equal(viewed.settlement.reason, 'reconciliation_not_live');
    assert.equal(f.getCount, 10);
    assert.equal(f.postCount, 1);
    noPrivate(viewed);
    const saved = (await app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: 'reconciliation' }),
      undefined,
    )) as any;
    assert.deepEqual(saved.data, viewed.reconciliation.data);
    noPrivate(saved);
    const history = (await app.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams({ scope: 'reconciliation' }),
      undefined,
    )) as any;
    assert.equal(history.manifests.length, 1);
    assert.deepEqual(history.manifests[0].data, saved.data);
    noPrivate(history);
    for (const name of ['get_job', 'cancel_job']) {
      const output = (await app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_' + name,
        new URLSearchParams(),
        { jobId: viewed.reconciliation.job.id },
      )) as any;
      assert.deepEqual(output.data, saved.data);
      noPrivate(output);
    }
    noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    for (const scope of [SCOPE, 'account', 'short_works'])
      assert.equal(
        (
          (await app.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope }),
            undefined,
          )) as any
        ).manifest,
        null,
      );
    const cap = (await app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.reads[0].verificationStatus, 'not-verified-live');
    assert.equal(cap.writes.nativeShortMetadata.implementationStatus, 'implemented');
    assert.equal(cap.writes.nativeShortMetadata.verificationStatus, 'not-verified-live');
    assert.equal(cap.writes.nativeShortMetadata.available, false);
    assert.match(cap.writes.nativeShortMetadata.reason, /disabled/);
    assert.equal(app.tools.find((tool) => tool.name === 'fanqie_reconcile_write')!.readOnly, false);
    assert.equal(app.tools.length, 40);
    assert.equal(f.getCount, 10);
  } finally {
    await app.close();
    await f.close();
  }
});
