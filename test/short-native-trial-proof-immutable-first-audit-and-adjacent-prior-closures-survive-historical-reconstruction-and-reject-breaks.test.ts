import test from 'node:test';

import { makeFixture } from './helpers/short-native-trial-proof-make-fixture.js';

import * as proof from '../src/platform/short-native-trial-proof.js';

import assert from 'node:assert/strict';

import {
  clone,
  fixture,
  WORK,
  SERVICE,
  HTML,
  OWNER,
  live,
} from './helpers/short-native-trial-proof-service.js';

import { rejected, rehash } from './helpers/short-native-trial-proof-rejected.js';

import { type Job, type Manifest } from '../src/runtime/store.js';

import { type NativeShortTrialHeldIntent } from '../src/platform/short-native-trial-api.js';

test('immutable first audit and adjacent prior closures survive historical reconstruction and reject breaks', () => {
  const f = makeFixture(false);
  f.finish();
  const firstContext = f.reconciliationContext(null),
    first = proof.createNativeShortTrialClosure(firstContext, f.tick());
  f.context.job.result = first;
  f.context.job.endedAt = first.settledAt;
  f.context.job.updatedAt = first.settledAt;
  f.context.job.error = { code: 'outcome_unknown', message: 'Offline synthetic later unknown.' };
  const secondAudit = proof.createNativeShortTrialOriginalAudit(f.context, {
      firstAudit: first.originalAudit,
      previousClosure: first,
    }),
    secondContext = f.reconciliationContext(null, secondAudit),
    second = proof.createNativeShortTrialClosure(secondContext, f.tick());
  f.context.job.result = second;
  f.context.job.endedAt = second.settledAt;
  f.context.job.updatedAt = second.settledAt;
  const thirdAudit = proof.createNativeShortTrialOriginalAudit(f.context, {
      firstAudit: first.originalAudit,
      previousClosure: second,
    }),
    thirdContext = f.reconciliationContext(f.after, thirdAudit),
    third = proof.createNativeShortTrialClosure(thirdContext, f.tick());
  assert.equal(third.originalAudit.originalEndedAt, first.originalAudit.originalEndedAt);
  // The pointer contract freezes exactly these own data fields, not its object prototype.
  const pointerKeys = ['readJobId', 'evidenceId', 'evidenceHash'] as const;
  for (const pointer of [third.originalAttemptEvidence, first.originalAttemptEvidence]) {
    assert.equal(Reflect.ownKeys(pointer).length, pointerKeys.length);
    for (const key of pointerKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(pointer, key);
      assert(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable);
    }
  }
  for (const key of pointerKeys)
    assert.equal(
      Object.getOwnPropertyDescriptor(third.originalAttemptEvidence, key)!.value,
      Object.getOwnPropertyDescriptor(first.originalAttemptEvidence, key)!.value,
    );
  assert.equal(third.originalAudit.previousClosure!.evidenceHash, second.evidence.sha256);
  proof.validateNativeShortTrialClosureContext(firstContext, first, first.settledAt);
  proof.validateNativeShortTrialClosureContext(secondContext, second, second.settledAt);
  proof.validateNativeShortTrialClosureContext(thirdContext, third, third.settledAt);
  const wrongFirst = clone(first.originalAudit);
  wrongFirst.originalEndedAt = f.tick();
  rejected(() =>
    proof.createNativeShortTrialOriginalAudit(f.context, {
      firstAudit: wrongFirst,
      previousClosure: second,
    }),
  );
  const broken = clone(third);
  broken.originalAudit.previousClosure!.evidenceHash = 'f'.repeat(64);
  rejected(() =>
    proof.validateNativeShortTrialClosureContext(thirdContext, broken, third.settledAt),
  );
  const missingFirst = clone(third);
  missingFirst.originalAttemptEvidence.evidenceHash = 'f'.repeat(64);
  rejected(() =>
    proof.validateNativeShortTrialClosureContext(thirdContext, missingFirst, third.settledAt),
  );
});

test('read snapshot authenticates saved manifest and safe projection while rejecting wrong account or raw hash', () => {
  const f = makeFixture(false);
  f.finish();
  const raw = f.later(f.before);
  raw.proof.proofCapturedAt = f.tick();
  const payload = proof.createNativeShortTrialReadEvidence(raw, fixture),
    id = '00000000-0000-4000-8000-111111111111',
    durable = f.writeDocument(id, proof.NATIVE_SHORT_TRIAL_READ_DATASET, payload),
    committedAt = f.tick();
  const job: Job = {
    ...f.context.job,
    id,
    kind: 'read',
    operation: proof.NATIVE_SHORT_TRIAL_READ_OPERATION,
    datasets: [proof.NATIVE_SHORT_TRIAL_READ_DATASET],
    idempotencyKey: null,
    inputHash: proof.nativeShortTrialReadInputHash(WORK),
    status: 'succeeded',
    platformWriteStartedAt: null,
    endedAt: committedAt,
    updatedAt: committedAt,
    error: null,
    result: null,
  };
  const manifest: Manifest = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-222222222222',
    accountId: SERVICE,
    jobId: id,
    operation: job.operation,
    scope: job.scope,
    datasets: job.datasets,
    requestedAt: job.requestedAt,
    platformReadStartedAt: job.platformReadStartedAt!,
    committedAt,
    evidence: [durable.ref],
  };
  job.result = { manifest };
  const context: proof.NativeShortTrialContext = {
    accountId: SERVICE,
    job,
    manifest,
    refs: [durable.ref],
    documents: [durable.document],
    attempts: [],
  };
  proof.validateNativeShortTrialReadContext(context);
  const projection = proof.projectNativeShortTrialReadContext(context);
  assert.equal(projection.collectionMode, 'fixture');
  assert.equal(projection.data[0]!.bodyIncluded, false);
  assert.deepEqual(projection.data[0]!.statusSource, {
    phase: 'read',
    sourceRef: durable.ref.id,
    evidenceHash: durable.ref.sha256,
    evidenceCapturedAt: durable.ref.capturedAt,
  });
  assert.equal((projection.data[0]!.statusFacts as any).draftEditable, true);
  const bytes = JSON.stringify(projection);
  for (const secret of [HTML, OWNER, 'private-', durable.ref.path]) assert(!bytes.includes(secret));
  const wrong = clone(context);
  wrong.accountId = 'foreign';
  rejected(() => proof.validateNativeShortTrialReadContext(wrong));
  const changed = clone(context);
  (changed.documents[0]!.payload as any).snapshot.paragraphCount++;
  rehash(changed, 0);
  rejected(() => proof.validateNativeShortTrialReadContext(changed));
});

test('stage descriptors compare only independently rebuilt shapes and never evaluate derived getters', () => {
  const f = makeFixture();
  const empty = clone(f.context);
  empty.refs = [];
  empty.documents = [];
  empty.attempts = [];
  empty.job.platformWriteStartedAt = null;
  let calls = 0;
  const baseline: NativeShortTrialHeldIntent = {
    schema: 'native-short-trial-held-intent/v1',
    snapshot: f.before,
    beforeSnapshot: f.before,
    businessRequest: proof.nativeShortTrialWriteRequest(f.business),
    plan: f.plan,
    expectation: f.plan.expectation,
    desiredContentHash: f.plan.desiredContentHash,
    read: f.raw.phases.before,
    checkedAt: (f.context.documents[0]!.payload as any).held.checkedAt,
  };
  const plan = Object.defineProperty({ ...f.plan }, 'form', {
    enumerable: true,
    get() {
      calls++;
      return f.plan.form;
    },
  });
  rejected(() =>
    proof.createNativeShortTrialStageEvidence(
      'baseline',
      { held: { ...baseline, plan }, business: f.business, provenance: live },
      empty,
    ),
  );
  const intentContext = clone(f.context);
  intentContext.refs = intentContext.refs.slice(0, 2);
  intentContext.documents = intentContext.documents.slice(0, 2);
  intentContext.attempts = [];
  intentContext.job.platformWriteStartedAt = null;
  const intentHeld = Object.defineProperty({ ...f.raw.save.held! }, 'plan', {
    enumerable: true,
    get() {
      calls++;
      return f.plan;
    },
  });
  rejected(() =>
    proof.createNativeShortTrialStageEvidence('intent', { held: intentHeld }, intentContext),
  );
  const raw = Object.defineProperty({ ...f.raw }, 'proof', {
    enumerable: true,
    get() {
      calls++;
      return f.raw.proof;
    },
  });
  rejected(() => proof.createNativeShortTrialStageEvidence('after', { result: raw }, f.context));
  assert.equal(calls, 0);
  const malformed = clone(baseline);
  (malformed.plan as any).unknown = 'private-field';
  rejected(() =>
    proof.createNativeShortTrialStageEvidence(
      'baseline',
      { held: malformed, business: f.business, provenance: live },
      empty,
    ),
  );
});
