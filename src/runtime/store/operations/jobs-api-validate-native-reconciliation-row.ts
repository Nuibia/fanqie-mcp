import { type Job, type EvidenceRef, type EvidenceDocument } from '../runtime-error.js';
import {
  canonicalJson,
  nativeReconciliationUnavailable,
  sameNativeValue,
  hash,
  type NativeReconciliationRow,
  nativeUnknownError,
} from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  isCanonicalNativeTime,
  copyNativeShortJson,
  validateNativeShortReconciliationContext,
  type NativeShortClosure,
  type NativeShortOriginalAudit,
  validateNativeShortOriginalAudit,
} from '../../../platform/short-native-metadata-proof.js';
import {
  type NativeLaterReadOperation,
  type AssertNativeLiveSettlementOperation,
  type ValidateNativeReconciliationRowOperation,
  type ValidateNativeClosureOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import { type NativeReconciliationRowOperation } from '../contracts/native-compensation-validate-native-compensation-source-identity.js';
import {
  type NativeBoundedReferencesOperation,
  type NativeOriginalEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

interface ValidateNativeReconciliationRowDependencies {
  publicReads: PublicReadCoordinator;
  nativeLaterRead: NativeLaterReadOperation;
  nativeReconciliationRow: NativeReconciliationRowOperation;
  nativeBoundedReferences: NativeBoundedReferencesOperation;
  assertNativeLiveSettlement: AssertNativeLiveSettlementOperation;
}

export function createValidateNativeReconciliationRow(
  deps: ValidateNativeReconciliationRowDependencies,
): ValidateNativeReconciliationRowOperation {
  function validateNativeReconciliationRow(
    original: Job,
    refs: EvidenceRef[],
    documents: EvidenceDocument[],
    row: NativeReconciliationRow,
    first: NativeReconciliationRow,
  ): { closure: NativeShortClosure; audit: NativeShortOriginalAudit } {
    return deps.publicReads.memo(
      'store.validateNativeReconciliationRow',
      [original, refs, documents, row, first],
      () => {
        const value = copyNativeShortJson(JSON.parse(row.resultJson)) as NativeShortClosure;
        const names = [
          'schema',
          'target',
          'reconciliationJobId',
          'evidence',
          'observedStatus',
          'result',
          'originalAudit',
          'originalAttemptEvidence',
        ];
        if (
          Object.keys(value).length !== names.length ||
          Object.keys(value).some((name) => !names.includes(name)) ||
          !['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
            value.schema,
          ) ||
          row.resultJson !== canonicalJson(value) ||
          row.originalJobId !== original.id ||
          !['succeeded', 'uncertain'].includes(row.status) ||
          !isCanonicalNativeTime(row.createdAt)
        )
          return nativeReconciliationUnavailable();
        const audit = validateNativeShortOriginalAudit(value.originalAudit),
          read = deps.nativeLaterRead(original.id, row.readJobId);
        if (
          row.evidenceId !== read.ref.id ||
          value.reconciliationJobId !== read.job.id ||
          !sameNativeValue(value.evidence, read.ref) ||
          !sameNativeValue(value.target, original.target) ||
          !sameNativeValue(
            audit,
            (read.document.payload as { originalAudit?: unknown })?.originalAudit,
          )
        )
          return nativeReconciliationUnavailable();
        const stable = {
          originalJobId: original.id,
          accountId: original.accountId,
          operation: original.operation,
          scope: original.scope,
          inputHash: original.inputHash,
          target: original.target,
          datasets: original.datasets,
          requestedAt: original.requestedAt,
          startedAt: original.startedAt,
          platformReadStartedAt: original.platformReadStartedAt,
          platformWriteStartedAt: original.platformWriteStartedAt,
          status: 'uncertain',
          priorEvidence: refs,
        };
        if (
          Object.entries(stable).some(
            ([name, expected]) =>
              !sameNativeValue((audit as unknown as Record<string, unknown>)[name], expected),
          )
        )
          return nativeReconciliationUnavailable();
        const firstRead =
          row.sequence === first.sequence
            ? read
            : deps.nativeLaterRead(original.id, first.readJobId);
        const firstAudit = validateNativeShortOriginalAudit(
          (firstRead.document.payload as { originalAudit?: unknown })?.originalAudit,
        );
        const firstPointer = {
          readJobId: first.readJobId,
          evidenceId: first.evidenceId,
          evidenceHash: firstRead.ref.sha256,
        };
        if (
          firstAudit.phase !== 'initial' ||
          first.evidenceId !== firstRead.ref.id ||
          audit.originalEndedAt !== firstAudit.originalEndedAt ||
          !sameNativeValue(value.originalAttemptEvidence, firstPointer)
        )
          return nativeReconciliationUnavailable();
        // One fixed scalar predecessor lookup per selected row verifies adjacency. It never
        // loads that predecessor's proof or recursively expands its result/history.
        const predecessor = deps.nativeReconciliationRow(original.id, 'last', row.sequence);
        if (!predecessor) {
          if (
            row.sequence !== first.sequence ||
            audit.phase !== 'initial' ||
            audit.originalEndedAt !== audit.priorEndedAt ||
            !sameNativeValue(audit.originalResult, { evidence: refs }) ||
            audit.originalAttemptEvidence !== null ||
            audit.previousClosure !== null
          )
            return nativeReconciliationUnavailable();
        } else {
          if (
            audit.phase !== 'continuation' ||
            predecessor.status !== 'uncertain' ||
            audit.priorEndedAt !== predecessor.createdAt ||
            audit.priorResultHash !== hash(predecessor.resultJson) ||
            !sameNativeValue(audit.originalAttemptEvidence, firstPointer) ||
            !sameNativeValue(audit.priorError, nativeUnknownError)
          )
            return nativeReconciliationUnavailable();
          const predecessorRefs = deps.nativeBoundedReferences(predecessor.readJobId, 1);
          if (
            predecessorRefs.length !== 1 ||
            predecessorRefs[0]!.id !== predecessor.evidenceId ||
            !sameNativeValue(audit.previousClosure, {
              reconciliationJobId: predecessor.readJobId,
              evidenceId: predecessor.evidenceId,
              evidenceHash: predecessorRefs[0]!.sha256,
              resultHash: hash(predecessor.resultJson),
              settledAt: predecessor.createdAt,
            })
          )
            return nativeReconciliationUnavailable();
        }
        const checked = validateNativeShortReconciliationContext({
          accountId: original.accountId,
          originalJob: original,
          originalRefs: refs,
          originalDocuments: documents,
          readJob: read.job,
          manifest: read.manifest,
          ref: read.ref,
          document: read.document,
        });
        deps.assertNativeLiveSettlement(checked, documents, read.document);
        if (
          value.schema !==
            (checked.evidence.schema.endsWith('/v2')
              ? 'native-short-metadata-closure/v2'
              : 'native-short-metadata-closure/v1') ||
          checked.status !== row.status ||
          value.observedStatus !== checked.observedStatus ||
          !sameNativeValue(value.result, checked.result) ||
          read.job.endedAt === null ||
          read.job.endedAt > row.createdAt
        )
          return nativeReconciliationUnavailable();
        return { closure: value, audit };
      },
    );
  }
  return validateNativeReconciliationRow;
}

interface ValidateNativeClosureDependencies {
  publicReads: PublicReadCoordinator;
  nativeReconciliationRow: NativeReconciliationRowOperation;
  nativeOriginalEvidence: NativeOriginalEvidenceOperation;
  validateNativeReconciliationRow: ValidateNativeReconciliationRowOperation;
}

export function createValidateNativeClosure(
  deps: ValidateNativeClosureDependencies,
): ValidateNativeClosureOperation {
  function validateNativeClosure(original: Job): {
    firstAudit: NativeShortOriginalAudit;
    current: NativeShortClosure;
  } {
    return deps.publicReads.memo('store.validateNativeClosure', [original], () => {
      const first = deps.nativeReconciliationRow(original.id, 'first'),
        current = deps.nativeReconciliationRow(original.id, 'last');
      if (
        !first ||
        !current ||
        !['uncertain', 'succeeded'].includes(original.status) ||
        original.endedAt !== current.createdAt ||
        original.updatedAt !== current.createdAt ||
        canonicalJson(original.result) !== current.resultJson ||
        original.status !== current.status ||
        !sameNativeValue(
          original.error,
          original.status === 'succeeded' ? null : nativeUnknownError,
        )
      )
        return nativeReconciliationUnavailable();
      const { refs, documents } = deps.nativeOriginalEvidence(original);
      const initial = deps.validateNativeReconciliationRow(original, refs, documents, first, first);
      const latest =
        current.sequence === first.sequence
          ? initial
          : deps.validateNativeReconciliationRow(original, refs, documents, current, first);
      const previous = deps.nativeReconciliationRow(original.id, 'last', current.sequence);
      if (previous && previous.sequence !== first.sequence)
        deps.validateNativeReconciliationRow(original, refs, documents, previous, first);
      return { firstAudit: initial.audit, current: latest.closure };
    });
  }
  return validateNativeClosure;
}
