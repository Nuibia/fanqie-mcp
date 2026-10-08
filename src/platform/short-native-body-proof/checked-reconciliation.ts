import {
  type NativeShortBodyReconciliationContext,
  type NativeShortBodyReconciliationEvidence,
  type NativeShortBodySettlement,
  type NativeShortBodyClosure,
  type NativeShortBodyStatusObservation,
  type SafeBodyRef,
} from './native-short-body-attempt-row.js';

import { fail, copy, type Data, MIB, same, storedNative, exact, time, freeze } from './fail.js';

import { contextCopy, verifyBodyRef, type DurableState } from './context-copy.js';

import {
  type EvidenceDocument,
  type Job,
  type Manifest,
  type EvidenceRef,
} from '../../runtime/store.js';

import {
  recoveryContextCopy,
  checkedRecovery,
  bridgeComparison,
  sameBodySourceBridge,
} from './original-audit.js';

import {
  capturedReconciliationEvidence,
  nativeShortBodyReconciliationInputHash,
} from './create-native-short-body-owned-get-recovery-v2.js';

import {
  originalForAudit,
  settlementShape,
  closureShape,
} from './validate-native-short-body-evidence-context.js';

import { storedBodyMath, type StoredBodySnapshot } from '../short-native-legacy-codec.js';

import {
  BODY_JOB_KEYS,
  BODY_MANIFEST_KEYS,
  uuid,
  nativeShortBodyReconciliationScope,
  boundedCount,
  ordered,
  bodyRefLink,
} from './native-short-body-scope.js';

import { NATIVE_SHORT_BODY_RECONCILE_OPERATION, NATIVE_SHORT_BODY_DATASETS } from './inspect.js';

import { clean } from './same-mode.js';

import { resolveShortEditorStatus } from '../short-status.js';

export function checkedReconciliation(input: unknown): {
  context: NativeShortBodyReconciliationContext;
  evidence: NativeShortBodyReconciliationEvidence;
  settlement: NativeShortBodySettlement;
} {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    fail('invalid_shape');
  const desc = Object.getOwnPropertyDescriptors(input),
    keys = [
      'original',
      'readJob',
      'manifest',
      'ref',
      'document',
      ...(Object.hasOwn(input, 'recoveryContext') ? ['recoveryContext'] : []),
    ];
  if (
    Object.keys(desc).length !== keys.length ||
    keys.some((k) => !desc[k]?.enumerable || !Object.hasOwn(desc[k]!, 'value'))
  )
    fail('invalid_shape');
  const original = contextCopy(desc.original!.value),
    meta = copy(
      { readJob: desc.readJob!.value, manifest: desc.manifest!.value, ref: desc.ref!.value },
      512 * 1024,
      24,
      12000,
    ) as Data,
    document = copy(desc.document!.value, 16 * MIB) as unknown as EvidenceDocument;
  const recoveryContext = desc.recoveryContext
    ? recoveryContextCopy(desc.recoveryContext.value)
    : undefined;
  const c = {
      original,
      ...(recoveryContext ? { recoveryContext } : {}),
      readJob: meta.readJob as unknown as Job,
      manifest: meta.manifest as unknown as Manifest,
      ref: meta.ref as unknown as EvidenceRef,
      document,
    },
    { readJob: j, manifest: m, ref } = c;
  const evidence = capturedReconciliationEvidence(document.payload),
    a = evidence.originalAudit,
    v2 = evidence.schema === 'native-short-body-reconciliation/v2';
  if (
    (!v2 && recoveryContext) ||
    (v2 &&
      evidence.recovery !== null &&
      (!recoveryContext || !same(evidence.recovery, recoveryContext.recovery))) ||
    (v2 && evidence.recovery === null && recoveryContext)
  )
    fail('source_mismatch');
  const state = originalForAudit(original, a, v2 ? recoveryContext : undefined);
  if (v2 && recoveryContext) checkedRecovery(state, a, recoveryContext);
  const expectation = v2
    ? storedBodyMath.upgradeExpectationForGetV2(state.baseline!, state.plan!)
    : state.plan!.expectation;
  if (evidence.native !== null) {
    const later = storedNative(evidence.native);
    if (
      later.mode !== state.baseline!.mode &&
      !(state.baseline!.mode === 'legacy' && later.mode === 'modern')
    )
      fail('source_mismatch');
  }
  verifyBodyRef(ref, document, original.accountId, j.id);
  exact(j, BODY_JOB_KEYS);
  exact(m, BODY_MANIFEST_KEYS);
  uuid(j.id);
  uuid(j.ownerId);
  uuid(m.id);
  if (
    j.id === original.job.id ||
    j.accountId !== original.accountId ||
    j.kind !== 'read' ||
    j.operation !== NATIVE_SHORT_BODY_RECONCILE_OPERATION ||
    j.scope !== nativeShortBodyReconciliationScope(original.job.id) ||
    !same(j.datasets, [NATIVE_SHORT_BODY_DATASETS.reconciliation]) ||
    j.status !== 'succeeded' ||
    j.inputHash !==
      nativeShortBodyReconciliationInputHash(
        original.accountId,
        a,
        v2 ? evidence.recovery : undefined,
        v2 ? evidence.comparisonPolicy : undefined,
      ) ||
    j.error !== null ||
    j.cancellationRequestedAt !== null ||
    j.cancellationReason !== null ||
    j.platformWriteStartedAt !== null ||
    !same(j.target, a.target) ||
    !same(j.metadata, {}) ||
    boundedCount(j.timeoutMs, 2_147_483_647) < 1 ||
    j.endedAt === null ||
    j.updatedAt !== j.endedAt
  )
    fail('source_mismatch');
  if (
    j.idempotencyKey !== null &&
    (typeof j.idempotencyKey !== 'string' ||
      !j.idempotencyKey.length ||
      Buffer.byteLength(j.idempotencyKey, 'utf8') > 256)
  )
    fail('invalid_shape');
  if (
    m.schemaVersion !== 1 ||
    m.accountId !== j.accountId ||
    m.jobId !== j.id ||
    m.operation !== j.operation ||
    m.scope !== j.scope ||
    !same(m.datasets, j.datasets) ||
    m.requestedAt !== j.requestedAt ||
    m.platformReadStartedAt !== j.platformReadStartedAt ||
    m.committedAt !== j.endedAt ||
    !same(m.evidence, [ref]) ||
    !same(j.result, { manifest: m }) ||
    ref.dataset !== NATIVE_SHORT_BODY_DATASETS.reconciliation ||
    document.collectionMode !== evidence.source.mode
  )
    fail('source_mismatch');
  if (j.platformReadStartedAt === null || j.platformReadStartedAt <= a.priorEndedAt)
    fail('invalid_trace');
  if (
    v2 &&
    evidence.recovery !== null &&
    (j.ownerId !== evidence.recovery!.leaseOwnerId ||
      j.requestedAt < evidence.recovery!.leaseCheckedAt ||
      j.platformReadStartedAt < evidence.recovery!.leaseCheckedAt)
  )
    fail('source_mismatch');
  ordered([
    j.requestedAt,
    j.startedAt,
    j.platformReadStartedAt,
    evidence.read.proof.readStartedAt,
    ...[evidence.read.proof.readFinishedAt, evidence.read.proof.proofCapturedAt].filter(
      (v) => v !== null,
    ),
    evidence.cleanup.checkedAt,
    ref.capturedAt,
    m.committedAt,
  ]);
  if (j.deadlineAt !== null) {
    time(j.deadlineAt);
    if (j.startedAt === null || j.deadlineAt < j.startedAt) fail('invalid_trace');
  }
  let desiredMatched = false,
    status: NativeShortBodySettlement['status'] = 'uncertain',
    reason: NativeShortBodySettlement['reason'] = 'partial_read';
  if (!same(evidence.source, state.source)) reason = 'reconciliation_not_live';
  else if (
    evidence.native !== null &&
    clean(evidence.cleanup) &&
    evidence.ownerCheckedAt !== null
  ) {
    const observed = storedNative(evidence.native),
      comparison = bridgeComparison(state, expectation, observed);
    if (!same(evidence.comparison, comparison)) fail('source_mismatch');
    desiredMatched = comparison.matches;
    if (desiredMatched) {
      status = 'succeeded';
      reason = 'match';
    } else if (sameBodySourceBridge(observed, state.baseline!)) {
      status = 'failed';
      reason = 'not_applied';
    } else reason = 'readback_mismatch';
  } else if (evidence.native !== null) {
    const comparison = bridgeComparison(state, expectation, storedNative(evidence.native));
    if (!same(evidence.comparison, comparison)) fail('source_mismatch');
  }
  if (evidence.reason !== reason) fail('source_mismatch');
  const settlement = settlementShape({
    status,
    reason,
    result: {
      schema: 'native-short-body-settlement-result/v1',
      source: evidence.source,
      originalJobId: original.job.id,
      readJobId: j.id,
      desiredMatched,
      bodyIncluded: false,
      verifiedLive: status === 'succeeded' && evidence.source.mode === 'live',
    },
  });
  return { context: c, evidence, settlement: freeze(settlement) };
}

export function validateNativeShortBodyReconciliationContext(
  input: unknown,
): NativeShortBodySettlement {
  return checkedReconciliation(input).settlement;
}

export function createNativeShortBodyClosure(
  context: unknown,
  settledAt: string,
): NativeShortBodyClosure {
  const checked = checkedReconciliation(context),
    { context: c, evidence, settlement } = checked;
  ordered([c.manifest.committedAt, settledAt]);
  return freeze(
    closureShape({
      schema:
        evidence.schema === 'native-short-body-reconciliation/v2'
          ? 'native-short-body-closure/v2'
          : 'native-short-body-closure/v1',
      ...(evidence.schema === 'native-short-body-reconciliation/v2'
        ? { comparisonPolicy: evidence.comparisonPolicy, recovery: evidence.recovery }
        : {}),
      accountId: c.original.accountId,
      originalJobId: c.original.job.id,
      reconciliationJobId: c.readJob.id,
      evidence: bodyRefLink(c.ref),
      status: settlement.status,
      reason: settlement.reason,
      result: settlement.result,
      originalAudit: evidence.originalAudit,
      settledAt,
    }),
  );
}

export function validateNativeShortBodyClosureContext(
  context: unknown,
  closure: unknown,
  settledAt: string,
): NativeShortBodySettlement {
  const actual = closureShape(closure),
    expected = createNativeShortBodyClosure(context, settledAt);
  if (!same(actual, expected)) fail('source_mismatch');
  return validateNativeShortBodyReconciliationContext(context);
}

export function statusObservation(
  snapshot: StoredBodySnapshot | null,
  phase: NonNullable<NativeShortBodyStatusObservation['statusSource']>['phase'],
  ref: EvidenceRef | null,
): NativeShortBodyStatusObservation {
  if (snapshot === null || ref === null)
    return freeze({ state: 'unknown', statusFacts: null, statusSource: null });
  const decoded = storedBodyMath.decodeSnapshot(snapshot.snapshot),
    facts = resolveShortEditorStatus(decoded.snapshot.native.editData);
  return freeze({
    state: facts.resolvedState,
    statusFacts: facts,
    statusSource: {
      phase,
      sourceRef: ref.id,
      evidenceHash: ref.sha256,
      evidenceCapturedAt: ref.capturedAt,
    },
  });
}

export function originalStatusObservation(state: DurableState): NativeShortBodyStatusObservation {
  for (const [kind, phase] of [
    ['after', 'after'],
    ['preSave', 'pre_save'],
    ['baseline', 'baseline'],
  ] as const) {
    const index = state.stages.findIndex((stage) => stage.kind === kind);
    if (index < 0) continue;
    const raw = state.stages[index]!.payload.native;
    if (raw === null) continue;
    return statusObservation(storedNative(raw), phase, state.context.refs[index]!);
  }
  return statusObservation(null, 'baseline', null);
}

export function safeBodyRef(ref: EvidenceRef): SafeBodyRef {
  return { id: ref.id, dataset: ref.dataset, sha256: ref.sha256, capturedAt: ref.capturedAt };
}
