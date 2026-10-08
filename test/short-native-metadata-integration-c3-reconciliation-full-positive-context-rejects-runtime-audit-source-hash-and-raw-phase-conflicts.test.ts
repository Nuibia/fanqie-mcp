import test from 'node:test';

import { nativeSaveFixture } from './helpers/short-native-metadata-integration-native-write-snapshot.js';

import { Store, canonicalJson } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import { persistNativeLater } from './helpers/short-native-metadata-integration-persist-native-later.js';

import {
  fixtureProvenance,
  noPrivate,
  SCOPE,
} from './helpers/short-native-metadata-integration-snapshot.js';

import assert from 'node:assert/strict';

import {
  type NativeShortReconciliationContext,
  validateNativeShortReconciliationContext,
} from '../src/platform/short-native-metadata-proof.js';

import { createHash } from 'node:crypto';

test('C3 reconciliation full positive context rejects runtime, audit, source, hash and raw phase conflicts', async (t) => {
  const f = await nativeSaveFixture('acklost'),
    store = new Store(f.storage),
    queue = new JobQueue(store);
  try {
    const positive = await persistNativeLater(f, store, queue, fixtureProvenance);
    assert.equal(positive.verified.status, 'succeeded');
    assert.equal(positive.verified.result.firstTitle, 'Changed title');
    noPrivate(positive.verified.result);
    const resign = (context: NativeShortReconciliationContext) => {
      context.ref.sha256 = createHash('sha256')
        .update(canonicalJson(context.document) + '\n')
        .digest('hex');
      context.manifest.evidence = context.manifest.evidence.map((ref) =>
        ref.id === context.ref.id ? { ...ref, sha256: context.ref.sha256 } : ref,
      );
      context.readJob.result = {
        ...(context.readJob.result as object),
        manifest: context.manifest,
      };
    };
    const mutations: [string, (c: any) => void][] = [
      [
        'job-metadata-future',
        (c) => (c.readJob.metadata = { schema: 'native-short-metadata-future/v1' }),
      ],
      [
        'original-metadata-future',
        (c) => (c.originalJob.metadata = { schema: 'native-short-metadata-future/v1' }),
      ],
      [
        'job-result-future',
        (c) => (c.readJob.result.future = { schema: 'native-short-metadata-future/v1' }),
      ],
      [
        'job-error-future',
        (c) =>
          (c.readJob.error = {
            code: 'synthetic',
            message: 'PRIVATE_HTML',
            details: { schema: 'native-short-metadata-future/v1' },
          }),
      ],
      [
        'manifest-future',
        (c) => (c.manifest.future = { schema: 'native-short-metadata-future/v1' }),
      ],
      ['ref-future', (c) => (c.ref.dataset = 'short_native_metadata_future')],
      ['document-future', (c) => (c.document.schema = 'native-short-metadata-future/v1')],
      [
        'payload-future',
        (c) => (c.document.payload.future = { schema: 'native-short-metadata-future/v1' }),
      ],
      ['matches-only', (c) => (c.document.payload.comparison = { matches: true })],
      [
        'forged-observed-composite',
        (c) => (c.document.payload.reconciliation.observedContentHash = '0'.repeat(64)),
      ],
      ['wrong-original-input', (c) => (c.originalJob.inputHash = '0'.repeat(64))],
      ['wrong-original-target', (c) => (c.originalJob.target.id = '8000000001')],
      ['wrong-read-account', (c) => (c.readJob.accountId = 'other')],
      ['wrong-read-input', (c) => (c.readJob.inputHash = '0'.repeat(64))],
      ['wrong-scope', (c) => (c.readJob.scope = SCOPE)],
      ['extra-manifest-ref', (c) => c.manifest.evidence.push(c.ref)],
      [
        'wrong-baseline-link',
        (c) => (c.document.payload.baselineEvidence.id = c.document.payload.intentEvidence.id),
      ],
      ['wrong-intent-link', (c) => (c.document.payload.intentEvidence.sha256 = '0'.repeat(64))],
      [
        'before-prior-boundary',
        (c) => (c.document.payload.result.proof.readStartedAt = c.originalJob.endedAt),
      ],
      [
        'old-original-end',
        (c) => (c.document.payload.originalAudit.originalEndedAt = '2000-01-01T00:00:00.000Z'),
      ],
      ['fake-continuation', (c) => (c.document.payload.originalAudit.phase = 'continuation')],
      [
        'prior-result-extra',
        (c) => (c.document.payload.originalAudit.originalResult.PRIVATE_HTML = 'PRIVATE_HTML'),
      ],
      [
        'forged-provenance',
        (c) => (c.document.payload.provenance.executor = 'application-default-browser/v1'),
      ],
      ['live-mode-with-fixture-executor', (c) => (c.document.payload.source.mode = 'live')],
      ['pending-cleanup', (c) => (c.document.payload.result.cleanup.pendingAtEnd = 1)],
      ['false-owner-after', (c) => (c.document.payload.result.proof.ownerAfter = false)],
      [
        'extra-POST-count',
        (c) => (c.document.payload.result.requests.post = { attempts: 1, disposed: 1 }),
      ],
      [
        'wrong-selection-hash',
        (c) => (c.document.payload.result.snapshot.categorySelectionHash = '0'.repeat(64)),
      ],
      [
        'same-ID-wrong-category-label',
        (c) => (c.document.payload.result.snapshot.editData.category[0].label = 'wrong'),
      ],
      [
        'numeric-ID-type-change',
        (c) => (c.document.payload.result.snapshot.editData.category[0].category_id = '10'),
      ],
      [
        'changed-tail-title',
        (c) => (c.document.payload.result.snapshot.editData.multi_title[1] = 'changed'),
      ],
      [
        'changed-private-URI',
        (c) => (c.document.payload.result.snapshot.editData.thumb_uri = 'changed'),
      ],
      [
        'plainHTMLstrip-basis',
        (c) => (c.document.payload.result.snapshot.hashBases.document = 'plainHTMLstrip'),
      ],
      [
        'fixture-durable-self-upgrade',
        (c) => {
          c.document.payload.source.mode = 'live';
          c.document.payload.provenance = {
            mode: 'live',
            executor: 'application-default-browser/v1',
          };
        },
      ],
    ];
    for (const [name, mutate] of mutations)
      await t.test(name, () => {
        const context = structuredClone(positive.context);
        mutate(context);
        resign(context);
        assert.throws(() => validateNativeShortReconciliationContext(context));
      });
    let getterCalls = 0;
    const getterContext = structuredClone(positive.context);
    Object.defineProperty(getterContext.document, 'payload', {
      enumerable: true,
      get() {
        getterCalls++;
        return positive.context.document.payload;
      },
    });
    assert.throws(() => validateNativeShortReconciliationContext(getterContext));
    assert.equal(getterCalls, 0);
    const oversized = structuredClone(positive.context);
    (oversized.document.payload as any).originalAudit.priorError.details = 'x'.repeat(65536);
    resign(oversized);
    assert.throws(() => validateNativeShortReconciliationContext(oversized));
  } finally {
    await queue.drainAndStop();
    store.close();
    await f.close();
  }
});
