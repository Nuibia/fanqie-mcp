import * as submissionRuntime from '../platform/short-native-submission-runtime.js';
import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import { projectShortWorksStatus } from '../platform/short-status.js';
import * as draftDirectory from '../platform/short-draft-directory.js';
import * as trialRuntime from '../platform/short-native-trial-runtime.js';
import * as coverRuntime from '../platform/short-native-cover-runtime.js';
import {
  hasReservedNativeShortSignal,
  projectNativeShortEvidence,
  safeNativeShortManifest,
  safeNativeShortRef,
  projectNativeShortWriteEvidence,
  safeNativeShortWriteJob,
  validateNativeShortOriginalAudit,
  validateNativeShortReconciliationContext,
  projectNativeShortReconciliationEvidenceContext,
  projectNativeShortClosure,
  safeNativeShortReconciliationJob,
  safeNativeShortReconciliationManifest,
  projectNativeShortCompensationEvidenceContext,
  projectNativeShortCompensationReadContext,
} from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import {
  Store,
  RuntimeError,
  hasGenericShortPublicationContext,
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  type Job,
} from '../runtime/store.js';
import { isMetricsDataset, projectMetricTimeContext } from '../platform/reads.js';
import { record, GenericReadPurpose } from './shared.js';
import {
  type EvidenceViewOperation,
  type DirectoryViewOperation,
} from './contracts/evidence-projection.js';
import {
  type IsExplicitBodyReadOperation,
  type ExplicitBodyReadViewOperation,
  type NativeClosureContextOperation,
  type NativeReconciliationContextOperation,
  type UnavailableNativeViewOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  isExplicitBodyRead: IsExplicitBodyReadOperation;
  explicitBodyReadView: ExplicitBodyReadViewOperation;
  config: Config;
  directoryView: DirectoryViewOperation;
  nativeClosureContext: NativeClosureContextOperation;
  nativeReconciliationContext: NativeReconciliationContextOperation;
  unavailableNativeView: UnavailableNativeViewOperation;
}

export function createEvidenceView(deps: Dependencies): EvidenceViewOperation {
  function evidenceView(
    job: Job | null,
    manifest: Manifest | null,
    refs: EvidenceRef[],
    includeDataset = true,
    legacyRefs = refs,
    purpose: GenericReadPurpose = 'current',
  ) {
    return deps.store.memoPublicProjection(
      'evidenceView',
      [job, manifest, refs, includeDataset, legacyRefs, purpose],
      () => {
        const documents = new Map<string, EvidenceDocument>();
        let readFailure: unknown;
        for (const ref of refs) {
          // Intent payloads participate in signal detection but never in output.
          try {
            documents.set(ref.id, deps.store.readEvidence(ref));
          } catch (error) {
            readFailure = error;
          }
        }
        if (deps.isExplicitBodyRead(job))
          return deps.explicitBodyReadView(job, manifest, refs, documents, readFailure);
        // Shared short_drafts and mixed reserved signals must never reach legacy spread.
        const signals = [
          job,
          job?.result,
          job?.metadata,
          manifest,
          ...refs,
          ...documents.values(),
          ...[...documents.values()].map((document) => document.payload),
        ];
        if (signals.some(submissionRuntime.hasReservedNativeShortSubmissionSignal))
          return submissionRuntime.nativeShortSubmissionEvidenceView(
            deps.store,
            deps.config.accountId,
            job,
            manifest,
            refs,
            refs.map((ref) => documents.get(ref.id)!).filter(Boolean),
            readFailure,
          );
        if (signals.some(bodyRuntime.hasReservedNativeShortBodySignal))
          return bodyRuntime.nativeShortBodyEvidenceView(
            deps.store,
            deps.config.accountId,
            job,
            manifest,
            refs,
            refs.map((ref) => documents.get(ref.id)!).filter(Boolean),
            readFailure,
          );
        if (signals.some(draftDirectory.hasReservedShortDraftDirectorySignal))
          return deps.directoryView(
            job,
            manifest,
            refs,
            refs.map((ref) => documents.get(ref.id)!).filter(Boolean),
            readFailure,
          );
        const trial = [
          job,
          job?.result,
          job?.metadata,
          manifest,
          ...refs,
          ...documents.values(),
          ...[...documents.values()].map((document) => document.payload),
        ].some(trialRuntime.hasReservedNativeShortTrialSignal);
        if (trial)
          return trialRuntime.nativeShortTrialEvidenceView(
            deps.store,
            deps.config.accountId,
            job,
            manifest,
            refs,
            refs.map((ref) => documents.get(ref.id)!).filter(Boolean),
            readFailure,
          );
        const cover = [
          job,
          job?.result,
          job?.metadata,
          manifest,
          ...refs,
          ...documents.values(),
          ...[...documents.values()].map((document) => document.payload),
        ].some(coverRuntime.hasReservedNativeShortCoverSignal);
        if (cover)
          return coverRuntime.nativeShortCoverEvidenceView(
            deps.store,
            deps.config.accountId,
            job,
            manifest,
            refs,
            refs.map((ref) => documents.get(ref.id)!).filter(Boolean),
            readFailure,
          );
        const native = [
          job,
          job?.result,
          job?.metadata,
          manifest,
          ...refs,
          ...documents.values(),
          ...[...documents.values()].map((document) => document.payload),
        ].some(hasReservedNativeShortSignal);
        if (native) {
          try {
            if (job?.kind === 'write') {
              if (readFailure) throw new Error('Invalid native write evidence');
              if (manifest !== null) throw new Error('Native write cannot carry a read manifest');
              const terminal =
                record(job.result).schema === 'native-short-metadata-compensated-closure/v1';
              const compensation = terminal
                ? deps.store.getNativeCompensationContext(job.id)
                : null;
              if (terminal && (!compensation || !compensation.history.current))
                throw new Error('Missing native compensation source');
              const projection = terminal
                ? projectNativeShortCompensationEvidenceContext(
                    compensation!,
                    compensation!.history.current!.read,
                  )
                : ['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
                      String(record(job.result).schema),
                    )
                  ? projectNativeShortClosure(deps.nativeClosureContext(job))
                  : projectNativeShortWriteEvidence({
                      accountId: deps.config.accountId,
                      job,
                      manifest,
                      refs,
                      documents: refs.map((ref) => documents.get(ref.id)!),
                    });
              return {
                native: true,
                valid: projection.validated,
                evidence: projection.evidence,
                data: projection.data,
                manifest: null,
                collectionMode: projection.collectionMode,
                safeJob: safeNativeShortWriteJob(job, projection),
              };
            }
            if (readFailure || !job || !manifest || refs.length !== 1 || documents.size !== 1)
              throw new Error('Invalid native context');
            const ref = refs[0]!,
              document = documents.get(ref.id)!;
            if (job.operation === 'reconcile_write') {
              const compensationPayload =
                record(document.payload).schema ===
                'native-short-metadata-compensation-reconciliation/v1';
              if (compensationPayload) {
                const originalId = record(record(document.payload).originalAudit).originalJobId;
                const source =
                  typeof originalId === 'string'
                    ? deps.store.getNativeCompensationContext(originalId)
                    : null;
                if (!source) throw new Error('Missing native compensation source');
                const publicResult = projectNativeShortCompensationReadContext({
                  source,
                  readJob: job,
                  manifest,
                  ref,
                  document,
                });
                return {
                  native: true,
                  valid: true,
                  evidence: [safeNativeShortRef(ref)],
                  data: [publicResult],
                  manifest: safeNativeShortReconciliationManifest(manifest),
                  collectionMode: 'live',
                  safeJob: safeNativeShortReconciliationJob(
                    job,
                    manifest,
                    source.original.job.target as { kind: 'short-story'; id: string },
                  ),
                };
              }
              const audit = validateNativeShortOriginalAudit(
                  record(document.payload).originalAudit,
                ),
                original = deps.store.getJob(audit.originalJobId, deps.config.accountId);
              if (!original || original.accountId !== deps.config.accountId)
                throw new Error('Missing native original');
              const context = deps.nativeReconciliationContext(original, job, manifest, refs, [
                  document,
                ]),
                verified = validateNativeShortReconciliationContext(context),
                publicResult = projectNativeShortReconciliationEvidenceContext(context);
              return {
                native: true,
                valid: true,
                evidence: [
                  {
                    id: ref.id,
                    accountId: ref.accountId,
                    jobId: ref.jobId,
                    dataset: ref.dataset,
                    capturedAt: ref.capturedAt,
                    sha256: ref.sha256,
                  },
                ],
                data: [publicResult],
                manifest: safeNativeShortReconciliationManifest(manifest),
                collectionMode: verified.evidence.source.mode,
                safeJob: safeNativeShortReconciliationJob(job, manifest, audit.target),
              };
            }
            const data = projectNativeShortEvidence(document.payload, {
              accountId: deps.config.accountId,
              job,
              manifest,
              ref,
              document,
            });
            return {
              native: true,
              valid: true,
              evidence: [safeNativeShortRef(ref)],
              data: [data],
              manifest: safeNativeShortManifest(manifest),
              collectionMode: record(data.source).mode,
            };
          } catch {
            return {
              native: true,
              valid: false,
              evidence: [],
              data: [deps.unavailableNativeView()],
              manifest: null,
              collectionMode: null,
              ...(job?.kind === 'write'
                ? { safeJob: safeNativeShortWriteJob(job, null) }
                : job?.operation === 'reconcile_write'
                  ? { safeJob: safeNativeShortReconciliationJob(job, null) }
                  : {}),
            };
          }
        }
        const genericShort = hasGenericShortPublicationContext(
          job,
          refs,
          [...documents.values()],
          manifest,
        );
        if (genericShort) {
          if (readFailure)
            throw new RuntimeError(
              'capability_unavailable',
              'Generic short publication status is unavailable.',
            );
          const projection =
            purpose === 'creation-event'
              ? deps.store.genericShortCreationEventProjection(
                  job!.id,
                  deps.config.accountId,
                  includeDataset,
                )
              : deps.store.genericShortProjection(job!.id, deps.config.accountId, includeDataset);
          return {
            native: false,
            generic: true,
            valid: true,
            evidence: projection.evidence,
            manifest: projection.manifest,
            data: projection.data,
            collectionMode: null,
            safeJob: projection.job,
            tuple: projection.tuple,
          };
        }
        if (readFailure) {
          if (readFailure instanceof RuntimeError) throw readFailure;
          throw new RuntimeError('capability_unavailable', 'Saved data is unavailable.');
        }
        return {
          native: false,
          valid: true,
          evidence: refs,
          manifest,
          collectionMode: null,
          data: legacyRefs
            .filter((ref) => ref.dataset !== 'write-intent')
            .map((ref): Record<string, unknown> => {
              const payload = record(documents.get(ref.id)!.payload);
              let projected = payload;
              if (ref.dataset === 'short_works') {
                try {
                  projected = projectShortWorksStatus(payload);
                } catch {
                  throw new RuntimeError(
                    'capability_unavailable',
                    'Short management status facts are unavailable.',
                  );
                }
              }
              if (isMetricsDataset(ref.dataset)) {
                try {
                  projected = projectMetricTimeContext(payload, true);
                } catch {
                  throw new RuntimeError(
                    'capability_unavailable',
                    'Statistics time context is unavailable.',
                  );
                }
              }
              return {
                ...projected,
                sourceRef: ref.id,
                evidenceHash: ref.sha256,
                ...(includeDataset ? { dataset: ref.dataset } : {}),
                evidenceCapturedAt: ref.capturedAt,
              };
            }),
        };
      },
    );
  }
  return evidenceView;
}
