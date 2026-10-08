import {
  type NativeShortEvidenceContext,
  createNativeShortReadEvidence,
  NATIVE_SHORT_READ_DATASET,
  NATIVE_SHORT_READ_OPERATION,
  nativeShortReadScope,
  nativeShortInputHash,
} from '../../src/platform/short-native-metadata-proof.js';

import { type NativeShortMetadataApiResult } from '../../src/platform/short-native-metadata-api.js';

import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import {
  raw,
  phase,
  T,
  clean,
  ACCOUNT,
  READ,
  hashBytes,
  MANIFEST,
  WORK,
  OWNER,
  data,
} from './short-native-body-word-number-phase.js';

import {
  type EvidenceDocument,
  canonicalJson,
  type Manifest,
  type Job,
} from '../../src/runtime/store.js';

import * as proof from '../../src/platform/short-native-body-proof.js';

export function fresh(): NativeShortEvidenceContext {
  const n = 40,
    result: NativeShortMetadataApiResult = {
      schema: 'native-short-metadata-api-read/v1',
      status: 'success',
      reason: null,
      snapshot: createNativeShortMetadataSnapshot(raw(600, 8)),
      proof: { ...phase(n + 3).proof, proofCapturedAt: T(n + 6), ownerCallback: true },
      requests: phase(n + 3).requests,
      list: phase(n + 3).list,
      cleanup: clean(n + 6),
    };
  const payload = createNativeShortReadEvidence(result, {
      executor: 'dependency-injected-browser/v1',
      mode: 'fixture',
    }),
    id = '44444444-4444-4444-8444-444444444444';
  const document = {
    schemaVersion: 1,
    evidenceId: id,
    accountId: ACCOUNT,
    jobId: READ,
    dataset: NATIVE_SHORT_READ_DATASET,
    capturedAt: T(n + 7),
    collectionMode: 'fixture',
    evidenceKind: 'observation',
    payload,
  } as EvidenceDocument;
  const ref = {
    id,
    accountId: ACCOUNT,
    jobId: READ,
    dataset: NATIVE_SHORT_READ_DATASET,
    capturedAt: T(n + 7),
    path: `synthetic/${id}.json`,
    sha256: hashBytes(canonicalJson(document) + '\n'),
  };
  const manifest = {
    schemaVersion: 1,
    id: MANIFEST,
    accountId: ACCOUNT,
    jobId: READ,
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: nativeShortReadScope(WORK),
    datasets: [NATIVE_SHORT_READ_DATASET],
    requestedAt: T(n),
    platformReadStartedAt: T(n + 2),
    committedAt: T(n + 8),
    evidence: [ref],
  } as Manifest;
  const job = {
    id: READ,
    accountId: ACCOUNT,
    ownerId: OWNER,
    kind: 'read',
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: manifest.scope,
    datasets: manifest.datasets,
    idempotencyKey: 'explicit_body_read.synthetic',
    inputHash: nativeShortInputHash(WORK),
    status: 'succeeded',
    requestedAt: T(n),
    startedAt: T(n + 1),
    platformReadStartedAt: T(n + 2),
    platformWriteStartedAt: null,
    endedAt: T(n + 8),
    updatedAt: T(n + 8),
    result: { manifest },
    error: null,
    target: { kind: 'short-story', id: WORK },
    metadata: { explicitBodyRead: true },
    timeoutMs: 120000,
    deadlineAt: T(n + 120001),
    cancellationRequestedAt: null,
    cancellationReason: null,
  } as Job;
  return { accountId: ACCOUNT, job, manifest, ref, document };
}

export const lease = { ownerId: OWNER, checkedAt: T(49), expiresAt: T(1000) };

export function reseal(c: proof.NativeShortBodyEvidenceContext) {
  for (let i = 0; i < c.documents.length; i++) {
    const stage = data(c.documents[i]!.payload);
    stage.priorStageHash = i ? proof.nativeShortBodyGraphHash(c.documents[i - 1]!.payload) : null;
    c.refs[i]!.sha256 = hashBytes(canonicalJson(c.documents[i]) + '\n');
  }
}
