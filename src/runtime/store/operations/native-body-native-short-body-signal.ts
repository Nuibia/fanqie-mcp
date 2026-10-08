import { type Job } from '../runtime-error.js';
import {
  bodyUnavailable,
  bodyDigest,
  sameNativeValue,
  bodyLink,
  bodyObject,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
  type PublicEvidenceFileSizeOperation,
  type GetManifestForJobOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type NativeShortBodySignalOperation,
  type NativeShortBodyContextOperation,
  type NativeShortBodyStageOperation,
  type NativeShortBodyIssuerOperation,
  type NativeShortBodyRecoveryFreshReadOperation,
  type NativeShortBodyRecoveryFromPayloadOperation,
} from '../contracts/native-body-native-short-body-signal.js';
import path from 'node:path';
import {
  type PrepareOperation,
  type AssertOwnershipOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type ListNativeShortBodyAttemptsOperation,
  type RawJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import { type Store } from '../authority.js';

import {
  type NativeShortEvidenceContext,
  NATIVE_SHORT_READ_DATASET,
} from '../../../platform/short-native-metadata-proof.js';

interface NativeShortBodySignalDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortBodySignal(
  deps: NativeShortBodySignalDependencies,
): NativeShortBodySignalOperation {
  function nativeShortBodySignal(job: Job, closureJson?: string): boolean {
    return deps.publicReads.memo('store.nativeShortBodySignal', [job, closureJson], () => {
      const refs = deps.listEvidence(job.id),
        signals: unknown[] = [job, ...refs];
      let body =
        bodyProof.hasReservedNativeShortBodySignal(signals) ||
        (typeof closureJson === 'string' && closureJson.includes('native-short-body'));
      for (const ref of refs) {
        try {
          const document = deps.readEvidence(ref);
          signals.push(document);
          body ||= bodyProof.hasReservedNativeShortBodySignal(document);
        } catch {
          if (body) return bodyUnavailable();
        }
      }
      return body || bodyProof.hasReservedNativeShortBodySignal(signals);
    });
  }
  return nativeShortBodySignal;
}

interface NativeShortBodyContextDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
  evidenceDirectory: string;
  publicEvidenceFileSize: PublicEvidenceFileSizeOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortBodyAttempts: ListNativeShortBodyAttemptsOperation;
}

export function createNativeShortBodyContext(
  deps: NativeShortBodyContextDependencies,
): NativeShortBodyContextOperation {
  function nativeShortBodyContext(job: Job): bodyProof.NativeShortBodyEvidenceContext {
    return deps.publicReads.memo('store.nativeShortBodyContext', [job], () => {
      const refs = deps.listEvidence(job.id);
      if (
        refs.length > 7 ||
        deps.prepare('SELECT 1 FROM manifests WHERE job_id=? LIMIT 1').get(job.id)
      )
        return bodyUnavailable();
      let total = 0;
      const documents = refs.map((ref) => {
        const file = path.resolve(deps.evidenceDirectory, ref.path),
          relative = path.relative(deps.evidenceDirectory, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return bodyUnavailable();
        const size = deps.publicEvidenceFileSize(ref, file);
        total += size;
        if (size > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) return bodyUnavailable();
        return deps.readEvidence(ref);
      });
      return {
        accountId: job.accountId,
        job,
        manifest: null,
        refs,
        documents,
        attempts: deps.listNativeShortBodyAttempts(job.id, job.accountId),
      };
    });
  }
  return nativeShortBodyContext;
}

interface NativeShortBodyStageDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortBodyStage(
  deps: NativeShortBodyStageDependencies,
): NativeShortBodyStageOperation {
  function nativeShortBodyStage(
    job: Job,
    kind: bodyProof.NativeShortBodyStageKind,
    payload: unknown,
    eventAt: string,
  ): bodyProof.NativeShortBodyStageEvidence {
    return deps.publicReads.memo(
      'store.nativeShortBodyStage',
      [job, kind, payload, eventAt],
      () => {
        const refs = deps.listEvidence(job.id);
        if (refs.length >= 7) return bodyUnavailable();
        const previous =
          refs.length === 0 ? null : deps.readEvidence(refs[refs.length - 1]!).payload;
        return bodyProof.createNativeShortBodyStageEvidence({
          schema: 'native-short-body-stage/v1',
          scope: 'short-native-body/v1',
          kind,
          sequence: refs.length + 1,
          eventAt,
          priorStageHash: previous === null ? null : bodyDigest(previous),
          accountId: job.accountId,
          jobId: job.id,
          inputHash: job.inputHash,
          payload,
        });
      },
    );
  }
  return nativeShortBodyStage;
}

interface NativeShortBodyIssuerDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodyStores: WeakSet<Store>;
  owner: Store;
  assertOwnership: AssertOwnershipOperation;
  evidenceMode: 'live' | 'fixture';
  nativeShortBodySource: bodyProof.NativeShortBodySource;
}

export function createNativeShortBodyIssuer(
  deps: NativeShortBodyIssuerDependencies,
): NativeShortBodyIssuerOperation {
  function nativeShortBodyIssuer(): void {
    deps.publicReads.assertMutationAllowed();
    if (!deps.nativeShortBodyStores.has(deps.owner)) return bodyUnavailable();
    deps.assertOwnership();
    if (deps.evidenceMode !== deps.nativeShortBodySource.mode) return bodyUnavailable();
  }
  return nativeShortBodyIssuer;
}

interface NativeShortBodyRecoveryFreshReadDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  getManifestForJob: GetManifestForJobOperation;
  listEvidence: ListEvidenceOperation;
  listNativeShortBodyAttempts: ListNativeShortBodyAttemptsOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortBodyRecoveryFreshRead(
  deps: NativeShortBodyRecoveryFreshReadDependencies,
): NativeShortBodyRecoveryFreshReadOperation {
  function nativeShortBodyRecoveryFreshRead(
    recovery: bodyProof.NativeShortBodyOwnedGetRecoveryV2,
    accountId: string,
  ): NativeShortEvidenceContext {
    return deps.publicReads.memo(
      'store.nativeShortBodyRecoveryFreshRead',
      [recovery, accountId],
      () => {
        const job = deps.rawJob(recovery.freshReadJobId),
          manifest = deps.getManifestForJob(accountId, recovery.freshReadJobId);
        const refs = deps.listEvidence(recovery.freshReadJobId);
        if (
          !job ||
          job.accountId !== accountId ||
          !manifest ||
          manifest.id !== recovery.freshReadManifestId ||
          refs.length !== 1 ||
          refs[0]!.dataset !== NATIVE_SHORT_READ_DATASET ||
          !sameNativeValue(manifest.evidence, refs) ||
          !sameNativeValue(bodyLink(refs[0]!), recovery.freshReadEvidence) ||
          bodyProof.nativeShortBodyGraphHash(job) !== recovery.freshReadJobHash ||
          bodyProof.nativeShortBodyGraphHash(manifest) !== recovery.freshReadManifestHash ||
          deps.listNativeShortBodyAttempts(job.id, accountId).length !== 0
        )
          return bodyUnavailable();
        return { accountId, job, manifest, ref: refs[0]!, document: deps.readEvidence(refs[0]!) };
      },
    );
  }
  return nativeShortBodyRecoveryFreshRead;
}

interface NativeShortBodyRecoveryFromPayloadDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodyRecoveryFreshRead: NativeShortBodyRecoveryFreshReadOperation;
}

export function createNativeShortBodyRecoveryFromPayload(
  deps: NativeShortBodyRecoveryFromPayloadDependencies,
): NativeShortBodyRecoveryFromPayloadOperation {
  function nativeShortBodyRecoveryFromPayload(
    input: unknown,
    accountId: string,
  ): bodyProof.NativeShortBodyRecoveryContextV2 | undefined {
    return deps.publicReads.memo(
      'store.nativeShortBodyRecoveryFromPayload',
      [input, accountId],
      () => {
        const payload = bodyObject(input);
        if (
          payload.schema !== 'native-short-body-closure/v2' &&
          payload.schema !== 'native-short-body-reconciliation/v2'
        )
          return undefined;
        if (payload.comparisonPolicy !== 'native-short-body-derived-word-number/v2')
          return bodyUnavailable();
        if (payload.recovery === null) return undefined;
        const recovery = bodyObject(payload.recovery, [
          'schema',
          'originalOwnerId',
          'leaseOwnerId',
          'freshReadJobId',
          'freshReadJobHash',
          'freshReadManifestId',
          'freshReadManifestHash',
          'freshReadEvidence',
          'leaseCheckedAt',
          'leaseExpiresAt',
        ]) as unknown as bodyProof.NativeShortBodyOwnedGetRecoveryV2;
        return { recovery, freshRead: deps.nativeShortBodyRecoveryFreshRead(recovery, accountId) };
      },
    );
  }
  return nativeShortBodyRecoveryFromPayload;
}
