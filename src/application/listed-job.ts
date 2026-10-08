import * as submissionRuntime from '../platform/short-native-submission-runtime.js';
import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import * as draftDirectory from '../platform/short-draft-directory.js';
import * as trialRuntime from '../platform/short-native-trial-runtime.js';
import * as coverRuntime from '../platform/short-native-cover-runtime.js';
import {
  hasReservedNativeShortSignal,
  safeNativeShortJob,
} from '../platform/short-native-metadata-proof.js';
import {
  Store,
  RuntimeError,
  hasGenericShortPublicationContext,
  type EvidenceDocument,
  type Job,
} from '../runtime/store.js';
import {
  type ListedJobOperation,
  type OutputJobOperation,
  type EvidenceViewOperation,
} from './contracts/evidence-projection.js';
import {
  type PublicJobOperation,
  type JobManifestOperation,
  type RefsForOperation,
  type IsExplicitBodyReadOperation,
  type ExplicitBodyReadViewOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  publicJob: PublicJobOperation;
  jobManifest: JobManifestOperation;
  refsFor: RefsForOperation;
  outputJob: OutputJobOperation;
  evidenceView: EvidenceViewOperation;
  isExplicitBodyRead: IsExplicitBodyReadOperation;
  explicitBodyReadView: ExplicitBodyReadViewOperation;
}

export function createListedJob(deps: Dependencies): ListedJobOperation {
  function listedJob(job: Job) {
    return deps.store.memoPublicProjection('listedJob', [job, 'creation-event'], () => {
      let generic = false;
      // Listing durable task state remains available when a legacy observation is
      // missing. Evidence-bearing get_job/saved views retain their integrity gate.
      try {
        job = deps.publicJob(job.id) ?? job;
        const manifest = deps.jobManifest(job),
          refs = deps.refsFor(job);
        let submission = [job, manifest, ...refs].some(
          submissionRuntime.hasReservedNativeShortSubmissionSignal,
        );
        let body = [job, manifest, ...refs].some(bodyRuntime.hasReservedNativeShortBodySignal);
        let directory = [job, manifest, ...refs].some(
          draftDirectory.hasReservedShortDraftDirectorySignal,
        );
        let trial = [job, manifest, ...refs].some(trialRuntime.hasReservedNativeShortTrialSignal);
        let cover = [job, manifest, ...refs].some(coverRuntime.hasReservedNativeShortCoverSignal);
        let native = [job, manifest, ...refs].some(hasReservedNativeShortSignal);
        const documents: EvidenceDocument[] = [];
        for (const ref of refs) {
          try {
            const document = deps.store.readEvidence(ref);
            documents.push(document);
            submission ||= submissionRuntime.hasReservedNativeShortSubmissionSignal(document);
            body ||= bodyRuntime.hasReservedNativeShortBodySignal(document);
            directory ||= draftDirectory.hasReservedShortDraftDirectorySignal(document);
            trial ||= trialRuntime.hasReservedNativeShortTrialSignal(document);
            cover ||= coverRuntime.hasReservedNativeShortCoverSignal(document);
            native ||= hasReservedNativeShortSignal(document);
          } catch (error) {
            // Known durable file failures are legacy listing compatibility cases;
            // any other inability to classify must fail closed as a safe Job.
            if (
              !(error instanceof RuntimeError) ||
              ![
                'evidence_missing',
                'evidence_hash_invalid',
                'evidence_binding_invalid',
                'evidence_path_invalid',
              ].includes(error.code)
            )
              native = true;
          }
        }
        if (!submission && !body && !native && !cover && !trial && !directory) {
          generic = hasGenericShortPublicationContext(job, refs, documents, manifest);
          if (generic) return deps.outputJob(job, 'creation-event');
          return job;
        }
        const view = deps.evidenceView(job, manifest, refs);
        return view.safeJob ?? safeNativeShortJob(job, view.valid ? manifest : null);
      } catch (error) {
        if (
          !submissionRuntime.hasReservedNativeShortSubmissionSignal(job) &&
          !deps.isExplicitBodyRead(job) &&
          !bodyRuntime.hasReservedNativeShortBodySignal(job) &&
          !draftDirectory.hasReservedShortDraftDirectorySignal(job) &&
          !trialRuntime.hasReservedNativeShortTrialSignal(job) &&
          !coverRuntime.hasReservedNativeShortCoverSignal(job) &&
          !hasReservedNativeShortSignal(job) &&
          (generic || hasGenericShortPublicationContext(job, [], []))
        )
          throw error;
        return submissionRuntime.hasReservedNativeShortSubmissionSignal(job)
          ? submissionRuntime.safeNativeShortSubmissionJob(job, null)
          : deps.isExplicitBodyRead(job)
            ? deps.explicitBodyReadView(job, null, [], new Map(), true).safeJob
            : bodyRuntime.hasReservedNativeShortBodySignal(job)
              ? bodyRuntime.safeNativeShortBodyJob(job, null)
              : draftDirectory.hasReservedShortDraftDirectorySignal(job)
                ? draftDirectory.safeShortDraftDirectoryJob(job, null)
                : trialRuntime.hasReservedNativeShortTrialSignal(job)
                  ? trialRuntime.safeNativeShortTrialJob(job, null)
                  : coverRuntime.hasReservedNativeShortCoverSignal(job)
                    ? coverRuntime.safeNativeShortCoverJob(job, null)
                    : safeNativeShortJob(job, null);
      }
    });
  }
  return listedJob;
}
