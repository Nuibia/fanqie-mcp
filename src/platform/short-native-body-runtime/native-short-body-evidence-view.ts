import {
  Store,
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
} from '../../runtime/store.js';

import {
  type NativeShortBodyEvidenceView,
  unavailable,
  object,
  reconciliationContext,
  context,
} from './unavailable.js';

import * as proof from '../short-native-body-proof.js';

import { publicSummary, safeManifest } from './reconcile-native-short-body-write.js';

import { resolveShortEditorStatus } from '../short-status.js';

import { type NativeShortEvidenceContext } from '../short-native-metadata-proof.js';

/** Every saved/public body surface uses the same fixed, content-free projection. */
export function nativeShortBodyEvidenceView(
  store: Store,
  accountId: string,
  job: Job | null,
  manifest: Manifest | null,
  refs: EvidenceRef[],
  documents: EvidenceDocument[],
  readFailure?: unknown,
): NativeShortBodyEvidenceView {
  const safeJob = proof.safeNativeShortBodyJob(job as Job, null);
  try {
    if (!job || job.accountId !== accountId || readFailure || refs.length !== documents.length)
      unavailable();
    // Store getJob replays actual SQL rows and linked physical files before pure projection.
    const actual = store.getJob(job.id, accountId);
    if (!actual) unavailable();
    if (actual.kind === 'write') {
      const closure = object(actual.result),
        laterJob =
          ['native-short-body-closure/v1', 'native-short-body-closure/v2'].includes(
            String(closure.schema),
          ) && typeof closure.reconciliationJobId === 'string'
            ? store.getJob(closure.reconciliationJobId, accountId)
            : null;
      if (
        ['native-short-body-closure/v1', 'native-short-body-closure/v2'].includes(
          String(closure.schema),
        ) &&
        !laterJob
      )
        unavailable();
      const laterContext = laterJob
        ? reconciliationContext(store, accountId, actual, laterJob)
        : undefined;
      const projection = proof.projectNativeShortBodyEvidenceContext(
        {
          accountId,
          job: actual,
          manifest,
          refs,
          documents,
          attempts: store.listNativeShortBodyAttempts(actual.id, accountId),
        },
        store.getNativeShortBodyRecoveryContext(actual.id, accountId),
        laterContext,
      );
      if (!projection.validated) unavailable();
      return {
        native: true,
        valid: true,
        verifiedLive: projection.verifiedLive,
        evidence: projection.evidence,
        data: projection.data.map(publicSummary),
        manifest: null,
        collectionMode: projection.collectionMode,
        safeJob: proof.safeNativeShortBodyJob(actual, projection),
      };
    }
    if (
      actual.operation !== proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION ||
      refs.length !== 1 ||
      documents.length !== 1 ||
      !manifest
    )
      unavailable();
    const audit = object(documents[0]!.payload).originalAudit as proof.NativeShortBodyOriginalAudit,
      original = store.getJob(audit.originalJobId, accountId);
    if (!original) unavailable();
    const settlement = proof.validateNativeShortBodyReconciliationContext(
      reconciliationContext(store, accountId, original, actual, manifest),
    );
    const base = proof.projectNativeShortBodyEvidenceContext(
        context(store, accountId, original),
        store.getNativeShortBodyRecoveryContext(original.id, accountId),
      ),
      summary = base.data[0];
    if (!base.validated || !summary) unavailable();
    const readEvidence = documents[0]!.payload as proof.NativeShortBodyReconciliationEvidence,
      evidence = refs.map((ref) => ({
        id: ref.id,
        dataset: ref.dataset,
        sha256: ref.sha256,
        capturedAt: ref.capturedAt,
      }));
    const facts =
      readEvidence.native === null
        ? null
        : resolveShortEditorStatus(object(readEvidence.native).editData);
    const observation =
      facts === null
        ? {
            state: summary.state,
            statusFacts: summary.statusFacts,
            statusSource: summary.statusSource,
          }
        : {
            state: facts.resolvedState,
            statusFacts: facts,
            statusSource: {
              phase: 'later_read',
              sourceRef: refs[0]!.id,
              evidenceHash: refs[0]!.sha256,
              evidenceCapturedAt: refs[0]!.capturedAt,
            },
          };
    const data = [
      {
        ...summary,
        ...observation,
        status:
          settlement.status === 'succeeded'
            ? 'matched'
            : settlement.status === 'uncertain'
              ? 'unknown'
              : 'capability_unavailable',
        reason: settlement.reason,
        source: { mode: readEvidence.source.mode },
        verifiedLive: settlement.result.verifiedLive,
        durable: true,
        bodyIncluded: false,
        summaries: {
          ...object(summary.summaries),
          afterObserved: readEvidence.native !== null,
          desiredMatched: settlement.result.desiredMatched,
          pendingAtEnd: readEvidence.cleanup.pendingAtEnd,
          disposalFailures: readEvidence.cleanup.disposalFailures,
          quarantined: readEvidence.cleanup.quarantined,
        },
      },
    ];
    return {
      native: true,
      valid: true,
      verifiedLive: settlement.result.verifiedLive,
      evidence,
      data,
      manifest: safeManifest(manifest, evidence),
      collectionMode: readEvidence.source.mode,
      safeJob: proof.safeNativeShortBodyJob(actual, base),
    };
  } catch {
    return {
      native: true,
      valid: false,
      verifiedLive: false,
      evidence: [],
      data: [
        {
          schema: 'native-short-body-summary/v1',
          state: 'unknown',
          statusFacts: null,
          statusSource: null,
          status: 'capability_unavailable',
          reason: 'durability_unverified',
          source: null,
          atomicRevision: false,
          hashBasesHash: proof.nativeShortBodyHashBasesHash(),
          desiredContentHash: null,
          verifiedLive: false,
          durable: false,
          bodyIncluded: false,
          summaries: {
            stageCount: 0,
            attemptOrdinal: null,
            baselineObserved: false,
            preSaveVerified: false,
            postAttempted: false,
            acknowledged: false,
            afterObserved: false,
            desiredMatched: false,
            pendingAtEnd: 0,
            disposalFailures: 0,
            quarantined: false,
          },
        },
      ],
      manifest: null,
      collectionMode: null,
      safeJob,
    };
  }
}

/** This DTO is emitted only by the explicit authenticated body-read tool. */
export type NativeShortBodyReadProjection = proof.NativeShortBodyReadProjection;

export function projectNativeShortBodyReadContext(
  context: NativeShortEvidenceContext,
): NativeShortBodyReadProjection {
  try {
    return proof.projectNativeShortBodyReadContext(context);
  } catch {
    unavailable();
  }
}
