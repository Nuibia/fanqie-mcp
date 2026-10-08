import test, { after } from 'node:test';

import {
  roots,
  HTML,
  OWNER,
  clone,
  sha,
  fixture,
} from './helpers/short-native-trial-proof-service.js';

import { rmSync } from 'node:fs';

import { makeFixture } from './helpers/short-native-trial-proof-make-fixture.js';

import * as proof from '../src/platform/short-native-trial-proof.js';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  createNativeShortTrialSnapshot,
} from '../src/platform/short-native-trial.js';

import { rejected, rehash } from './helpers/short-native-trial-proof-rejected.js';

import { type Job, canonicalJson } from '../src/runtime/store.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('trial proof rebuilds all private documents, exact desired hashes and a single fsynced attempt', () => {
  const f = makeFixture();
  f.finish();
  const projected = proof.validateNativeShortTrialEvidenceContext(f.context, 'complete');
  assert.equal(projected.validated, true);
  assert.equal(f.context.attempts.length, 1);
  assert.equal(projected.evidence.length, 6);
  const business = projected.data[0] as any,
    afterRef = f.context.refs.find(
      (ref) => ref.dataset === proof.NATIVE_SHORT_TRIAL_DATASETS.after,
    )!;
  assert.equal(business.state, 'draft');
  assert.equal(business.before.statusFacts.draftEditable, true);
  assert.equal(business.after.statusFacts.draftEditable, true);
  assert.deepEqual(business.statusSource, {
    phase: 'after',
    sourceRef: afterRef.id,
    evidenceHash: afterRef.sha256,
    evidenceCapturedAt: afterRef.capturedAt,
  });
  const canonical = proof.validateNativeShortTrialCompletion(f.context);
  assert.equal(Object.hasOwn(canonical.business, 'statusFacts'), false);
  assert.equal(Object.hasOwn(canonical.business, 'statusSource'), false);
  assert.notEqual(canonical.business, business);
  assert.notEqual(f.before.documentHash, f.after.documentHash);
  assert.notEqual(f.before.savedFieldsHash, f.after.savedFieldsHash);
  assert.equal(f.after.bodyHash, f.before.bodyHash);
  assert.equal(f.after.paragraphsHash, f.before.paragraphsHash);
  const bytes = JSON.stringify({
    projected,
    job: proof.safeNativeShortTrialJob(f.context.job, projected),
  });
  for (const secret of [HTML, OWNER, 'private-', f.context.refs[0]!.path, 'rawHtml', 'bodyText'])
    assert(!bytes.includes(secret));
  assert(Object.isFrozen(proof.validateNativeShortTrialCompletion(f.context)));
});

test('trial null after falls back to its actual persisted preSave observation and reconciliation uses its own later ref', () => {
  const f = makeFixture(false),
    raw = clone(f.raw);
  raw.snapshot = null;
  raw.snapshots.after = null;
  raw.comparison = null;
  raw.observedContentHash = null;
  f.finish(raw);
  const projected = proof.projectNativeShortTrialEvidenceContext(f.context),
    business = projected.data[0] as any,
    afterRef = f.context.refs.at(-1)!;
  assert.equal(projected.validated, true);
  assert.equal(business.after, null);
  assert.equal(business.state, 'draft');
  assert.deepEqual(business.statusSource, {
    phase: 'pre_save',
    sourceRef: afterRef.id,
    evidenceHash: afterRef.sha256,
    evidenceCapturedAt: afterRef.capturedAt,
  });
  const rc = f.reconciliationContext(),
    canonical = proof.validateNativeShortTrialReconciliationContext(rc),
    publicResult = proof.projectNativeShortTrialReconciliationContext(rc).data[0] as any;
  assert.equal(Object.hasOwn(canonical.result, 'statusFacts'), false);
  assert.deepEqual(publicResult.statusSource, {
    phase: 'later_read',
    sourceRef: rc.ref.id,
    evidenceHash: rc.ref.sha256,
    evidenceCapturedAt: rc.ref.capturedAt,
  });
  const unavailable = f.reconciliationContext(null),
    fallback = proof.projectNativeShortTrialReconciliationContext(unavailable).data[0] as any;
  assert.deepEqual(fallback.statusSource, business.statusSource);
  assert.notEqual(fallback.statusSource.sourceRef, unavailable.ref.id);
});

test('trial descriptors, mixed namespaces, unknown versions and unvalidated targets fail closed without getters', () => {
  const f = makeFixture();
  let calls = 0;
  const access = Object.defineProperty({}, 'snapshotScope', {
    enumerable: true,
    get() {
      calls++;
      return NATIVE_SHORT_TRIAL_SCOPE;
    },
  });
  assert.equal(proof.hasReservedNativeShortTrialSignal(access), true);
  rejected(() => proof.validateNativeShortTrialBusinessInput(access));
  rejected(() =>
    proof.validateNativeShortTrialBusinessInput({
      ...f.business,
      metadata: { ...f.business.metadata, title: 'illegal' },
    }),
  );
  rejected(() =>
    proof.validateNativeShortTrialBusinessInput({
      ...f.business,
      snapshotScope: 'short-native-trial/v999',
    }),
  );
  assert.equal(
    proof.hasReservedNativeShortTrialSignal({
      legacy: { result: { schema: 'native-short-trial-unknown/v99' } },
    }),
    true,
  );
  assert.equal(
    proof.hasReservedNativeShortTrialSignal({
      legacy: { snapshotScope: 'short-native-trial/v999', metadata: { trialRatio: 30 } },
    }),
    true,
  );
  assert.equal(proof.hasReservedNativeShortTrialSignal({ metadata: { trialRatio: 30 } }), true);
  assert.equal(proof.safeNativeShortTrialJob(f.context.job, null).target, null);
  proof.safeNativeShortTrialJob(access as Job, null);
  assert.equal(calls, 0);
});

test('missing ledger, second attempt, receipt substitution, raw drift, owner and cleanup tampering reject completion', () => {
  const f = makeFixture();
  f.finish();
  const intentPrefix = clone(f.context);
  intentPrefix.refs = intentPrefix.refs.slice(0, 3);
  intentPrefix.documents = intentPrefix.documents.slice(0, 3);
  intentPrefix.attempts = [];
  intentPrefix.job.platformWriteStartedAt = null;
  intentPrefix.job.status = 'running';
  intentPrefix.job.result = null;
  intentPrefix.job.endedAt = null;
  const intent = intentPrefix.documents[2]!.payload as any;
  assert.equal(
    intent.hashBasesHash,
    sha(
      canonicalJson({
        basis: 'native-short-trial-full-hash-bases/v1',
        hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
      }),
    ),
  );
  assert.equal(Object.hasOwn(intent, 'hashBases'), false);
  assert.equal(
    proof.validateNativeShortTrialEvidenceContext(intentPrefix, 'prefix').validated,
    true,
  );
  for (const mutate of [
    (payload: any) => {
      payload.hashBasesHash = 'f'.repeat(64);
    },
    (payload: any) => {
      payload.hashBases = clone(NATIVE_SHORT_TRIAL_HASH_BASES);
    },
  ]) {
    const c = clone(intentPrefix);
    mutate(c.documents[2]!.payload);
    rehash(c, 2);
    rejected(() => proof.validateNativeShortTrialEvidenceContext(c, 'prefix'));
  }
  for (const mutate of [
    (c: proof.NativeShortTrialContext) => {
      c.attempts = [];
    },
    (c: proof.NativeShortTrialContext) => {
      c.attempts.push(clone(c.attempts[0]!));
    },
    (c: proof.NativeShortTrialContext) => {
      c.attempts[0]!.eventAt = f.tick();
    },
    (c: proof.NativeShortTrialContext) => {
      (c.documents[0]!.payload as any).held.nativeSnapshot.editData.unknown.keep[2] = 'changed';
      rehash(c, 0);
    },
    (c: proof.NativeShortTrialContext) => {
      (c.documents[5]!.payload as any).result.save.attemptReceipt.evidence.id = c.refs[2]!.id;
      rehash(c, 5);
    },
    (c: proof.NativeShortTrialContext) => {
      (c.documents[5]!.payload as any).result.proof.ownerCallback = false;
      rehash(c, 5);
    },
    (c: proof.NativeShortTrialContext) => {
      (c.documents[5]!.payload as any).result.cleanup.disposalFailures = 1;
      rehash(c, 5);
    },
    (c: proof.NativeShortTrialContext) => {
      (c.documents[5]!.payload as any).result.snapshot.documentHash = 'f'.repeat(64);
      rehash(c, 5);
    },
    (c: proof.NativeShortTrialContext) => {
      (c.documents[5]!.payload as any).result.snapshot.editData.latest_version = 9;
      rehash(c, 5);
    },
  ]) {
    const c = clone(f.context);
    mutate(c);
    rejected(() => proof.validateNativeShortTrialCompletion(c));
    assert.equal(proof.projectNativeShortTrialEvidenceContext(c).validated, false);
  }
});

test('only attempt builder accepts an actual firstmark transition and rejects a fabricated second time', () => {
  const f = makeFixture(),
    c = clone(f.context);
  c.refs = c.refs.slice(0, 3);
  c.documents = c.documents.slice(0, 3);
  c.attempts = [];
  const actual = c.job.platformWriteStartedAt!;
  rejected(() => proof.validateNativeShortTrialEvidenceContext(c));
  rejected(() => proof.createNativeShortTrialStageEvidence('attempt', { eventAt: f.tick() }, c));
  const built = proof.createNativeShortTrialStageEvidence('attempt', { eventAt: actual }, c);
  assert.equal(built.eventAt, actual);
  assert.equal(built.ordinal, 1);
});

test('lost original ACK with matching same-write after stays unknown, later matching C1 closes without claiming ACK', () => {
  const f = makeFixture(false);
  f.finish();
  const prefix = proof.validateNativeShortTrialEvidenceContext(f.context);
  assert.equal(prefix.data[0]!.originalAcknowledged, false);
  assert.equal(prefix.data[0]!.originalOutcome, 'unknown');
  rejected(() => proof.validateNativeShortTrialCompletion(f.context));
  const rc = f.reconciliationContext(),
    verified = proof.validateNativeShortTrialReconciliationContext(rc);
  assert.equal(verified.status, 'succeeded');
  assert.equal(verified.result.reason, 'saved_by_later_read');
  assert.equal(verified.result.originalSaveAcknowledged, false);
  assert.equal(verified.result.originalSaveDurableAcknowledged, false);
  assert.equal(verified.result.originalOutcome, 'unknown');
  const closure = proof.createNativeShortTrialClosure(rc, f.tick());
  proof.validateNativeShortTrialClosureContext(rc, closure, closure.settledAt);
  const bytes = JSON.stringify(proof.projectNativeShortTrialReconciliationContext(rc));
  for (const secret of [HTML, OWNER, 'private-', rc.ref.path]) assert(!bytes.includes(secret));
  const forged = clone(f.context);
  (forged.documents.at(-1)!.payload as any).result.status = 'success';
  rehash(forged, forged.documents.length - 1);
  rejected(() => proof.validateNativeShortTrialEvidenceContext(forged));
});

test('partial and multiple-revision later reads remain uncertain and fixture producers cannot settle live sources', () => {
  const f = makeFixture(false);
  f.finish();
  const partial = proof.validateNativeShortTrialReconciliationContext(
    f.reconciliationContext(null),
  );
  assert.equal(partial.status, 'uncertain');
  assert.equal(partial.result.reason, 'outcome_unknown');
  const twoVersions = createNativeShortTrialSnapshot(
    createNativeShortMetadataSnapshot({
      binding: f.after.native.binding,
      editData: { ...f.after.native.editData, latest_version: 9 },
      categoryData: f.after.native.categoryData,
    }),
  );
  assert.equal(
    proof.validateNativeShortTrialReconciliationContext(f.reconciliationContext(twoVersions))
      .status,
    'uncertain',
  );
  const rc = f.reconciliationContext();
  rejected(() =>
    proof.createNativeShortTrialReconciliationEvidence(
      (rc.document.payload as proof.NativeShortTrialReconciliationEvidence).result,
      f.context,
      fixture,
    ),
  );
  const injected = makeFixture(false, 'fixture');
  injected.finish();
  const projection = proof.projectNativeShortTrialReconciliationContext(
    injected.reconciliationContext(),
  );
  assert.equal(projection.collectionMode, 'fixture');
  assert.equal(projection.data[0]!.reason, 'fixture_only');
});
