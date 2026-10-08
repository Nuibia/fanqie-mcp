import test from 'node:test';

import { makeFixture } from './helpers/short-native-cover-proof-make-fixture.js';

import * as proof from '../src/platform/short-native-cover-proof.js';

import assert from 'node:assert/strict';

import {
  HTML,
  URI,
  URL,
  WORK,
  clone,
  sha,
  fixtureProvenance,
} from './helpers/short-native-cover-proof-work.js';

import { rejected, rehash } from './helpers/short-native-cover-proof-rejected.js';

import { type Job, canonicalJson } from '../src/runtime/store.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

test('complete private chain independently rebuilds full source, six receipts, two ledger attempts and safe public DTO', () => {
  const f = makeFixture();
  f.finish();
  const projection = proof.validateNativeShortCoverEvidenceContext(f.context, 'complete');
  assert.equal(projection.validated, true);
  assert.equal(f.context.attempts.length, 2);
  assert.notEqual(f.context.attempts[0]!.eventAt, f.context.attempts[1]!.eventAt);
  assert.equal(projection.data[0]!.status, 'succeeded');
  assert.equal(projection.evidence.length, 8);
  const business = projection.data[0] as any,
    afterRef = f.context.refs.find(
      (ref) => ref.dataset === proof.NATIVE_SHORT_COVER_DATASETS.after,
    )!;
  assert.equal(business.state, 'draft');
  assert.equal(business.statusFacts.draftEditable, true);
  assert.deepEqual(business.statusSource, {
    phase: 'after',
    sourceRef: afterRef.id,
    evidenceHash: afterRef.sha256,
    evidenceCapturedAt: afterRef.capturedAt,
  });
  const canonical = proof.validateNativeShortCoverCompletion(f.context);
  assert.equal(Object.hasOwn(canonical.business, 'statusFacts'), false);
  assert.equal(Object.hasOwn(canonical.business, 'statusSource'), false);
  assert.notEqual(canonical.business, business);
  const publicBytes = JSON.stringify({
    projection,
    job: proof.safeNativeShortCoverJob(f.context.job, projection),
  });
  for (const secret of [
    HTML,
    URI,
    URL,
    'synthetic-private-path',
    'synthetic-private-head',
    f.business.cover.uploadPath,
  ])
    assert(!publicBytes.includes(secret));
  assert(Object.isFrozen(proof.validateNativeShortCoverCompletion(f.context)));
});

test('descriptor namespace recognition and business validation never execute getters or coercion', () => {
  const f = makeFixture();
  let calls = 0;
  const bad = {
    ...f.business,
    cover: {
      ...f.business.cover,
      fit: {
        toString() {
          calls++;
          return 'cover';
        },
      },
    },
  };
  rejected(() => proof.validateNativeShortCoverBusinessInput(bad));
  const signal = Object.defineProperty({ body: HTML }, 'scope', {
    enumerable: true,
    get() {
      calls++;
      return proof.nativeShortCoverScope(WORK);
    },
  });
  assert.equal(proof.hasReservedNativeShortCoverSignal(signal), true);
  assert.equal(calls, 0);
  const dto = JSON.stringify(proof.safeNativeShortCoverJob(signal as unknown as Job, null));
  assert(!dto.includes(HTML));
  assert.equal(calls, 0);
  assert.notEqual(
    proof.nativeShortCoverBusinessInputHash(f.business),
    proof.nativeShortCoverBusinessInputHash({
      ...f.business,
      cover: { ...f.business.cover, fit: 'cover' },
    }),
  );
  rejected(() =>
    proof.validateNativeShortCoverBusinessInput({
      ...f.business,
      metadata: { cover: f.business.cover },
    }),
  );
});

test('missing/forged ledger, full-source drift, receipt ref substitution and missing owner/cleanup cannot complete', () => {
  const f = makeFixture();
  f.finish();
  for (const mutate of [
    (c: proof.NativeShortCoverEvidenceContext) => {
      c.attempts.pop();
    },
    (c: proof.NativeShortCoverEvidenceContext) => {
      c.attempts[1]!.eventAt = c.attempts[0]!.eventAt;
    },
    (c: proof.NativeShortCoverEvidenceContext) => {
      const p = c.documents[0]!.payload as any;
      p.held.snapshot.editData.unknown.keep[2] = 'drift';
      rehash(c, 0);
    },
    (c: proof.NativeShortCoverEvidenceContext) => {
      const p = c.documents[8]!.payload as any;
      p.result.upload.attemptReceipt.evidence.id = c.refs[6]!.id;
      rehash(c, 8);
    },
    (c: proof.NativeShortCoverEvidenceContext) => {
      const p = c.documents[8]!.payload as any;
      p.result.proof.ownerCallback = false;
      rehash(c, 8);
    },
    (c: proof.NativeShortCoverEvidenceContext) => {
      const p = c.documents[8]!.payload as any;
      p.result.cleanup.pendingAtEnd = 1;
      rehash(c, 8);
    },
  ]) {
    const c = clone(f.context);
    mutate(c);
    rejected(() => proof.validateNativeShortCoverCompletion(c));
    assert.equal(proof.projectNativeShortCoverEvidenceContext(c).validated, false);
  }
});

test('partial after observations preserve disposal failure and preSave drift without acquiring durable save ACK', () => {
  const f = makeFixture('uploaded');
  const raw = clone(f.raw);
  raw.reason = 'cleanup_failed';
  raw.cleanup.disposalFailures = 1;
  raw.cleanup.quarantined = true;
  raw.phases.preSave = {
    ...clone(raw.phases.before),
    proof: {
      ...clone(raw.phases.before.proof),
      readStartedAt: f.tick(),
      readFinishedAt: f.tick(),
      proofCapturedAt: f.tick(),
    },
  };
  raw.snapshots.preSave = createNativeShortMetadataSnapshot({
    binding: f.before.binding,
    editData: { ...f.before.editData, unknown: { drift: true } },
    categoryData: f.before.categoryData,
  });
  raw.cleanup.checkedAt = f.tick();
  f.finish(raw);
  const p = proof.validateNativeShortCoverEvidenceContext(f.context, 'prefix');
  assert.equal(p.validated, true);
  const afterRef = f.context.refs.at(-1)!,
    status = p.data[0] as any;
  assert.deepEqual(status.statusSource, {
    phase: 'pre_save',
    sourceRef: afterRef.id,
    evidenceHash: afterRef.sha256,
    evidenceCapturedAt: afterRef.capturedAt,
  });
  assert.equal(status.statusFacts.draftEditable, true);
  const after = f.context.documents.at(-1)!.payload as any;
  assert.equal(
    canonicalJson(after.result.observedPreSaveSnapshot),
    canonicalJson(raw.snapshots.preSave),
  );
  assert.equal((p.data[0]!.save as any).durableAcknowledged, false);
  rejected(() => proof.validateNativeShortCoverCompletion(f.context));
});

test('fresh C1 resolves only upload ACK/no-save failure or save-attempt strict match; missing upload ACK remains unknown', () => {
  for (const [stop, status, reason] of [
    ['upload_unknown', 'uncertain', 'outcome_unknown'],
    ['uploaded', 'failed', 'save_not_attempted'],
    ['save_unknown', 'succeeded', 'saved_by_later_read'],
  ] as const) {
    const f = makeFixture(stop);
    f.finish();
    const rc = f.reconciliationContext(),
      verified = proof.validateNativeShortCoverReconciliationContext(rc);
    assert.equal(verified.status, status);
    assert.equal(verified.result.reason, reason);
    assert.equal(verified.result.originalSaveAcknowledged, false);
    assert.equal(verified.result.originalSaveDurableAcknowledged, false);
    assert.equal(Object.hasOwn(verified.result, 'statusFacts'), false);
    const publicBusiness = proof.projectNativeShortCoverReconciliationContext(rc).data[0] as any;
    assert.deepEqual(publicBusiness.statusSource, {
      phase: 'later_read',
      sourceRef: rc.ref.id,
      evidenceHash: rc.ref.sha256,
      evidenceCapturedAt: rc.ref.capturedAt,
    });
    assert.equal(publicBusiness.state, 'draft');
    const closure = proof.createNativeShortCoverClosure(rc, f.tick());
    proof.validateNativeShortCoverClosureContext(rc, closure, closure.settledAt);
    const publicBytes = JSON.stringify(proof.projectNativeShortCoverReconciliationContext(rc));
    for (const secret of [HTML, URI, URL, 'synthetic-private'])
      assert(!publicBytes.includes(secret));
    if (stop === 'save_unknown') {
      const drift = createNativeShortMetadataSnapshot({
        binding: f.after.binding,
        editData: { ...f.after.editData, multi_title: ['unrelated title', 'Preserved tail'] },
        categoryData: f.after.categoryData,
      });
      assert.equal(
        proof.validateNativeShortCoverReconciliationContext(f.reconciliationContext(drift)).status,
        'uncertain',
      );
    }
  }
});

test('reconciliation rejects forged C1, wrong owner, stale boundary and self asserted ACK; fixture cannot settle live source', () => {
  const f = makeFixture('save_unknown');
  f.finish();
  const rc = f.reconciliationContext();
  for (const mutate of [
    (c: proof.NativeShortCoverReconciliationContext) => {
      (c.document.payload as any).result.proof.ownerCallback = false;
    },
    (c: proof.NativeShortCoverReconciliationContext) => {
      (c.document.payload as any).result.snapshot.binding.account.id = '9999';
    },
    (c: proof.NativeShortCoverReconciliationContext) => {
      (c.document.payload as any).result.proof.readStartedAt = f.context.job.endedAt;
    },
    (c: proof.NativeShortCoverReconciliationContext) => {
      (c.document.payload as any).reconciliation.originalSaveAcknowledged = true;
    },
  ]) {
    const c = clone(rc);
    mutate(c);
    c.ref.sha256 = sha(`${canonicalJson(c.document)}\n`);
    c.manifest.evidence = [c.ref];
    c.readJob.result = { manifest: c.manifest };
    rejected(() => proof.validateNativeShortCoverReconciliationContext(c));
  }
  const raw = clone((rc.document.payload as proof.NativeShortCoverReconciliationEvidence).result);
  rejected(() =>
    proof.createNativeShortCoverReconciliationEvidence(raw, f.context, fixtureProvenance),
  );
  const fixture = makeFixture('save_unknown', 'fixture');
  fixture.finish();
  assert.equal(
    proof.validateNativeShortCoverReconciliationContext(fixture.reconciliationContext()).result
      .reason,
    'fixture_only',
  );
});

test('continuation freezes original end and first read pointer; historical reads remain valid after later settlement', () => {
  const f = makeFixture('upload_unknown');
  f.finish();
  const firstContext = f.reconciliationContext(),
    first = proof.createNativeShortCoverClosure(firstContext, f.tick());
  f.context.job.result = first;
  f.context.job.endedAt = first.settledAt;
  f.context.job.updatedAt = first.settledAt;
  f.context.job.error = { code: 'outcome_unknown', message: 'Synthetic later unknown.' };
  const audit = proof.createNativeShortCoverOriginalAudit(f.context, {
    firstAudit: first.originalAudit,
    previousClosure: first,
  });
  const secondContext = f.reconciliationContext(f.after, audit),
    second = proof.createNativeShortCoverClosure(secondContext, f.tick());
  f.context.job.result = second;
  f.context.job.endedAt = second.settledAt;
  f.context.job.updatedAt = second.settledAt;
  assert.equal(second.originalAudit.originalEndedAt, first.originalAudit.originalEndedAt);
  assert.equal(
    canonicalJson(second.originalAttemptEvidence),
    canonicalJson(first.originalAttemptEvidence),
  );
  proof.validateNativeShortCoverClosureContext(firstContext, first, first.settledAt);
  proof.validateNativeShortCoverClosureContext(secondContext, second, second.settledAt);
  const bad = clone(audit);
  bad.previousClosure!.evidenceHash = 'f'.repeat(64);
  rejected(() =>
    proof.createNativeShortCoverOriginalAudit(f.context, {
      firstAudit: first.originalAudit,
      previousClosure: { ...second, originalAudit: bad },
    }),
  );
});
