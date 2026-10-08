import { verifySavedChapterDirectory } from './verify-saved-chapter-directory.js';
import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import * as bodyModel from '../platform/short-native-body.js';
import * as draftDirectory from '../platform/short-draft-directory.js';
import * as trialRuntime from '../platform/short-native-trial-runtime.js';
import * as coverRuntime from '../platform/short-native-cover-runtime.js';
import {
  hasReservedNativeShortSignal,
  NATIVE_SHORT_READ_DATASET,
  NATIVE_SHORT_READ_OPERATION,
} from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { Store, type Manifest, type Job } from '../runtime/store.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { datasets, record } from './shared.js';
import {
  type CapabilitiesOperation,
  type NativeBoundAccountOperation,
} from './contracts/capabilities.js';
import { type EvidenceViewOperation } from './contracts/evidence-projection.js';
import {
  type PublicJobOperation,
  type JobManifestOperation,
  type RefsForOperation,
  type IsExplicitBodyReadOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  config: Config;
  evidenceView: EvidenceViewOperation;
  publicJob: PublicJobOperation;
  nativeBoundAccount: NativeBoundAccountOperation;
  browser: BrowserSession;
  jobManifest: JobManifestOperation;
  refsFor: RefsForOperation;
  isExplicitBodyRead: IsExplicitBodyReadOperation;
  bodyExecutorEligible: boolean;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
}

export function createCapabilities(deps: Dependencies): CapabilitiesOperation {
  function capabilities() {
    return deps.store.withPublicProjectionRead(deps.config.accountId, 'capabilities', () => {
      let manifests: Manifest[] = [],
        knownJobs: Job[] = [];
      try {
        manifests = deps.store.history(deps.config.accountId);
      } catch {
        /* Unreadable history cannot verify a capability. */
      }
      try {
        knownJobs = deps.store.listJobsForPublicProjection(deps.config.accountId);
      } catch {
        /* Unreadable jobs cannot verify a capability. */
      }
      const verifiedShortDraftDirectory = manifests.some((manifest) => {
        if (manifest.scope !== draftDirectory.SHORT_DRAFT_DIRECTORY_SCOPE) return false;
        try {
          const view = deps.evidenceView(
            deps.publicJob(manifest.jobId),
            manifest,
            deps.store.listEvidence(manifest.jobId),
          );
          return 'directory' in view && view.valid && view.verifiedLive === true;
        } catch {
          return false;
        }
      });
      const verified = new Set(manifests.flatMap((manifest) => manifest.datasets));
      const verifiedChapterDirectory = manifests.some((manifest) =>
        verifySavedChapterDirectory(deps.store, manifest),
      );
      const verifiedNativeMetadata = manifests.some((manifest) => {
        if (
          manifest.operation !== NATIVE_SHORT_READ_OPERATION ||
          manifest.datasets.length !== 1 ||
          manifest.datasets[0] !== NATIVE_SHORT_READ_DATASET
        )
          return false;
        try {
          const view = deps.evidenceView(
            deps.store.getJob(manifest.jobId, deps.config.accountId),
            manifest,
            deps.store.listEvidence(manifest.jobId),
          );
          return view.native && view.valid && view.collectionMode === 'live';
        } catch {
          return false;
        }
      });
      const nativeUnavailable =
        deps.nativeBoundAccount() === null || deps.browser.hasUnsafeApiCleanup === true;
      const verifiedNativeWrite = knownJobs.some((job) => {
        if (
          job.kind !== 'write' ||
          job.status !== 'succeeded' ||
          job.operation !== 'update_work_metadata' ||
          !['native-short-metadata-write-result/v2', 'native-short-metadata-closure/v2'].includes(
            String(record(job.result).schema),
          ) ||
          !hasReservedNativeShortSignal(job)
        )
          return false;
        try {
          const current = deps.store.getJob(job.id, deps.config.accountId);
          if (!current) return false;
          const view = deps.evidenceView(current, deps.jobManifest(current), deps.refsFor(current));
          return view.native && view.valid && view.collectionMode === 'live';
        } catch {
          return false;
        }
      });
      const verifiedNativeCover = knownJobs.some((job) => {
        if (
          job.kind !== 'write' ||
          job.status !== 'succeeded' ||
          job.operation !== coverRuntime.NATIVE_SHORT_COVER_OPERATION ||
          !coverRuntime.hasReservedNativeShortCoverSignal(job)
        )
          return false;
        try {
          const current = deps.store.getJob(job.id, deps.config.accountId);
          if (!current) return false;
          const view = deps.evidenceView(current, deps.jobManifest(current), deps.refsFor(current));
          return view.native && view.valid && view.collectionMode === 'live';
        } catch {
          return false;
        }
      });
      const verifiedNativeTrial = knownJobs.some((job) => {
        if (
          job.kind !== 'write' ||
          job.status !== 'succeeded' ||
          job.operation !== trialRuntime.NATIVE_SHORT_TRIAL_OPERATION ||
          !trialRuntime.hasReservedNativeShortTrialSignal(job)
        )
          return false;
        try {
          const current = deps.store.getJob(job.id, deps.config.accountId);
          if (!current) return false;
          const view = deps.evidenceView(current, deps.jobManifest(current), deps.refsFor(current));
          return view.native && view.valid && view.collectionMode === 'live';
        } catch {
          return false;
        }
      });
      const verifiedNativeTrialRead = manifests.some((manifest) => {
        if (
          manifest.operation !== trialRuntime.NATIVE_SHORT_TRIAL_READ_OPERATION ||
          manifest.datasets.length !== 1 ||
          manifest.datasets[0] !== trialRuntime.NATIVE_SHORT_TRIAL_READ_DATASET
        )
          return false;
        try {
          const view = deps.evidenceView(
            deps.store.getJob(manifest.jobId, deps.config.accountId),
            manifest,
            deps.store.listEvidence(manifest.jobId),
          );
          return view.native && view.valid && view.collectionMode === 'live';
        } catch {
          return false;
        }
      });
      const verifiedNativeBodyRead = knownJobs.some((job) => {
        if (
          job.kind !== 'read' ||
          job.status !== 'succeeded' ||
          job.operation !== NATIVE_SHORT_READ_OPERATION ||
          !deps.isExplicitBodyRead(job) ||
          draftDirectory.hasReservedShortDraftDirectorySignal(job)
        )
          return false;
        try {
          const current = deps.store.getJob(job.id, deps.config.accountId);
          if (
            !current ||
            current.kind !== 'read' ||
            current.status !== 'succeeded' ||
            current.operation !== NATIVE_SHORT_READ_OPERATION ||
            !deps.isExplicitBodyRead(current) ||
            draftDirectory.hasReservedShortDraftDirectorySignal(current)
          )
            return false;
          const view = deps.evidenceView(current, deps.jobManifest(current), deps.refsFor(current));
          return (
            'bodyRead' in view &&
            view.bodyRead === true &&
            view.valid === true &&
            'verifiedLive' in view &&
            view.verifiedLive === true &&
            view.collectionMode === 'live'
          );
        } catch {
          return false;
        }
      });
      const verifiedNativeBody = knownJobs.some((job) => {
        if (
          job.kind !== 'write' ||
          job.status !== 'succeeded' ||
          job.operation !== bodyRuntime.NATIVE_SHORT_BODY_OPERATION
        )
          return false;
        try {
          const current = deps.store.getJob(job.id, deps.config.accountId);
          if (!current) return false;
          const view = deps.evidenceView(current, deps.jobManifest(current), deps.refsFor(current));
          return view.native && view.valid && 'verifiedLive' in view && view.verifiedLive === true;
        } catch {
          return false;
        }
      });
      const bodyWriteAvailable =
        !deps.config.writesEnabled || nativeUnavailable || !deps.bodyExecutorEligible
          ? false
          : null;
      const bodyWriteReason = !deps.config.writesEnabled
        ? 'Platform writes are disabled for this deployment'
        : !deps.bodyExecutorEligible
          ? 'An injected body browser requires its captured synthetic transport'
          : deps.nativeBoundAccount() === null
            ? 'A typed service account binding is unavailable'
            : deps.browser.hasUnsafeApiCleanup === true
              ? 'The account browser is quarantined after incomplete API cleanup'
              : 'Current API context readiness is conditional and unobserved';
      const nativeWriteAvailable = !deps.config.writesEnabled || nativeUnavailable ? false : null;
      const nativeWriteReason = !deps.config.writesEnabled
        ? 'Platform writes are disabled for this deployment'
        : deps.nativeBoundAccount() === null
          ? 'A typed service account binding is unavailable'
          : deps.browser.hasUnsafeApiCleanup === true
            ? 'The account browser is quarantined after incomplete API cleanup'
            : 'Current API context readiness is conditional and unobserved';
      return {
        service: 'fanqie-mcp',
        version: '0.1.0',
        accountId: deps.config.accountId,
        reads: [
          {
            dataset: NATIVE_SHORT_READ_DATASET,
            scope: 'own_short_story_draft_target',
            atomicRevision: false,
            bodyIncluded: false,
            implementationStatus: 'implemented',
            verificationStatus: verifiedNativeMetadata ? 'verified-live' : 'not-verified-live',
            available: nativeUnavailable ? false : null,
            availabilityStatus: nativeUnavailable ? 'unavailable' : 'conditional-unobserved',
            supportedReadFields: [
              'firstTitle',
              'currentSelection',
              'catalog',
              'nativeVersionHashes',
            ],
            metadataWritesAvailable: nativeWriteAvailable,
          },
          {
            dataset: trialRuntime.NATIVE_SHORT_TRIAL_READ_DATASET,
            snapshotScope: 'short-native-trial/v1',
            scope: 'own_short_story_draft_target',
            atomicRevision: false,
            bodyIncluded: false,
            implementationStatus: 'implemented',
            verificationStatus: verifiedNativeTrialRead ? 'verified-live' : 'not-verified-live',
            available: nativeUnavailable ? false : null,
            availabilityStatus: nativeUnavailable ? 'unavailable' : 'conditional-unobserved',
            supportedReadFields: [
              'trialBoundary',
              'paragraphCounts',
              'characterCounts',
              'nativeVersionHashes',
            ],
            trialWritesAvailable: nativeWriteAvailable,
          },
          {
            dataset: 'short_native_body_snapshot',
            snapshotScope: bodyModel.NATIVE_SHORT_BODY_SCOPE,
            scope: 'author-edit-current',
            publishedVersionVerified: false,
            atomicRevision: false,
            bodyIncluded: true,
            implementationStatus: 'implemented',
            verificationStatus: verifiedNativeBodyRead ? 'verified-live' : 'not-verified-live',
            available: nativeUnavailable ? false : null,
            availabilityStatus: nativeUnavailable ? 'unavailable' : 'conditional-unobserved',
            supportedReadFields: ['paragraphs', 'trialBoundary', 'nativeVersionHashes'],
          },
          ...datasets.map((dataset) => ({
            dataset,
            implementationStatus: 'implemented',
            verificationStatus: verified.has(dataset) ? 'verified-live' : 'not-verified-live',
            available: true,
          })),
          {
            dataset: 'chapters',
            scope: 'single_work_management_and_draft_directory',
            atomicRevision: false,
            bodyIncluded: false,
            implementationStatus: 'implemented',
            verificationStatus: verifiedChapterDirectory ? 'verified-live' : 'not-verified-live',
            available: true,
          },
          {
            dataset: 'chapter_drafts',
            scope: 'single_work_draft_directory',
            implementationStatus: 'implemented',
            verificationStatus: verified.has('chapter_drafts')
              ? 'verified-live'
              : 'not-verified-live',
            available: true,
          },
          {
            dataset: 'chapter_body',
            scope: 'single_author_edit_current_response',
            publishedVersionVerified: false,
            implementationStatus: 'implemented',
            verificationStatus: verified.has('chapter_body')
              ? 'verified-live'
              : 'not-verified-live',
            available: true,
          },
          {
            dataset: 'short_drafts',
            snapshotScope: draftDirectory.SHORT_DRAFT_DIRECTORY_SCOPE,
            scope: 'own_draft_list',
            atomicRevision: false,
            bodyIncluded: false,
            implementationStatus: 'implemented',
            verificationStatus: verifiedShortDraftDirectory ? 'verified-live' : 'not-verified-live',
            available: nativeUnavailable ? false : null,
            availabilityStatus: nativeUnavailable ? 'unavailable' : 'conditional-unobserved',
            supportedReadFields: ['id'],
            titleAvailable: false,
            publicationStatus: 'unknown',
            signingStatus: 'unknown',
          },
        ],
        writesEnabled: deps.config.writesEnabled,
        writes: {
          nativeShortSubmission: {
            implementationStatus: 'implemented',
            verificationStatus: 'not-verified-live',
            available: nativeWriteAvailable,
            availabilityStatus:
              nativeWriteAvailable === false ? 'unavailable' : 'conditional-unobserved',
            reason: nativeWriteReason,
            snapshotScope: 'short-native-submission/v1',
            atomicRevision: false,
            bodyIncluded: false,
            supportedWriteFields: ['useAi', 'acceptPublicationTerms'],
            clientFullGate: 'not_proven',
            preparation: {
              implementationStatus: 'implemented',
              readOnlyPlatformAccess: true,
              writesRequired: false,
            },
            reconciliation: {
              implementationStatus: 'implemented',
              readOnlyPlatformAccess: true,
              writesRequired: false,
            },
          },
          nativeShortBody: {
            implementationStatus: 'implemented',
            available: bodyWriteAvailable,
            availabilityStatus:
              bodyWriteAvailable === false ? 'unavailable' : 'conditional-unobserved',
            verificationStatus: verifiedNativeBody ? 'verified-live' : 'not-verified-live',
            reason: bodyWriteReason,
            atomicRevision: false,
            bodyIncluded: false,
            supportedWriteFields: ['paragraphs', 'trial'],
            reconciliation: {
              implementationStatus: 'implemented',
              readOnlyPlatformAccess: true,
              writesRequired: false,
            },
          },
          nativeShortTrial: {
            implementationStatus: 'implemented',
            available: nativeWriteAvailable,
            availabilityStatus:
              nativeWriteAvailable === false ? 'unavailable' : 'conditional-unobserved',
            verificationStatus: verifiedNativeTrial ? 'verified-live' : 'not-verified-live',
            reason: nativeWriteReason,
            atomicRevision: false,
            supportedWriteFields: ['trial'],
            bodyIncluded: false,
            reconciliation: {
              implementationStatus: 'implemented',
              readOnlyPlatformAccess: true,
              writesRequired: false,
            },
          },
          short: writes.getWriteCapabilities(deps.writeProfiles?.short),
          chapter: writes.getWriteCapabilities(deps.writeProfiles?.chapter),
          'long-book': writes.getLongBookMetadataCapabilities(deps.writeProfiles?.['long-book']),
          nativeShortMetadata: {
            implementationStatus: 'implemented',
            available: nativeWriteAvailable,
            availabilityStatus:
              nativeWriteAvailable === false ? 'unavailable' : 'conditional-unobserved',
            verificationStatus: verifiedNativeWrite ? 'verified-live' : 'not-verified-live',
            reason: nativeWriteReason,
            atomicRevision: false,
            supportedWriteFields: ['title', 'categories'],
            reconciliation: {
              implementationStatus: 'implemented',
              readOnlyPlatformAccess: true,
              writesRequired: false,
            },
          },
          nativeShortRecommendedCover: {
            implementationStatus: 'implemented',
            available: nativeWriteAvailable,
            availabilityStatus:
              nativeWriteAvailable === false ? 'unavailable' : 'conditional-unobserved',
            verificationStatus: verifiedNativeCover ? 'verified-live' : 'not-verified-live',
            reason: nativeWriteReason,
            atomicRevision: false,
            supportedWriteFields: ['recommendedCover'],
            reconciliation: {
              implementationStatus: 'implemented',
              readOnlyPlatformAccess: true,
              writesRequired: false,
            },
            uploadOutcomeRecovery: 'no-replay-no-delete-no-upload-discovery',
          },
        },
        limitations: [
          'Platform metrics retain the platform statistics cutoff',
          'Uncertain writes are reconciled before any retry',
        ],
      };
    });
  }
  return capabilities;
}
