import { durableReference, independentAudit } from './short-native-body-proof-durable-reference.js';

import {
  reference,
  DSOURCE,
  dread,
  DT,
  cleaned,
  DACCOUNT,
  physical,
  DJOB,
  DOWNER,
  dlink,
} from './short-native-body-proof-reference.js';

import { SCOPE, modernTuple4, raw, bytesHash, sha, WORK } from './short-native-body-proof-utf16.js';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { Store, canonicalJson } from '../../src/runtime/store.js';

import {
  NATIVE_SHORT_READ_OPERATION,
  nativeShortReadScope,
  NATIVE_SHORT_READ_DATASET,
  nativeShortInputHash,
  createNativeShortReadEvidence,
  type NativeShortEvidenceContext,
} from '../../src/platform/short-native-metadata-proof.js';

import { type NativeShortMetadataApiResult } from '../../src/platform/short-native-metadata-api.js';

import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

export function independentReconciliation(
  original: ReturnType<typeof durableReference>['context'],
  partial: boolean,
  audit = independentAudit(original),
  offset = 30,
) {
  const readId = `33333333-3333-4333-8333-${String(offset).padStart(12, '0')}`,
    refId = `44444444-4444-4444-8444-${String(offset).padStart(12, '0')}`;
  const base = reference(),
    payload = {
      schema: 'native-short-body-reconciliation/v1',
      scope: SCOPE,
      source: DSOURCE,
      originalAudit: audit,
      native: partial ? null : modernTuple4(raw('<p>乙</p><p></p>', 8)),
      read: dread(offset + 3, !partial),
      ownerCheckedAt: partial ? null : DT(offset + 4),
      cleanup: cleaned(DT(offset + 6)),
      comparison: partial ? null : base.comparison,
      reason: partial ? 'partial_read' : 'match',
    };
  const document = {
    schemaVersion: 1,
    evidenceId: refId,
    accountId: DACCOUNT,
    jobId: readId,
    dataset: 'short_native_body_reconciliation',
    capturedAt: DT(offset + 7),
    collectionMode: 'fixture',
    evidenceKind: 'observation',
    payload,
  };
  const ref = {
    id: refId,
    accountId: DACCOUNT,
    jobId: readId,
    dataset: 'short_native_body_reconciliation',
    capturedAt: DT(offset + 7),
    path: `/synthetic/${refId}.json`,
    sha256: bytesHash(physical(document) + '\n'),
  };
  const inputHash = sha({
      basis: 'native-short-body-get-only-reconciliation-input/v1',
      accountId: DACCOUNT,
      originalAuditHash: sha(audit),
    }),
    scope = `short_native_body_reconciliation.${DJOB}`;
  const manifest = {
    schemaVersion: 1,
    id: `55555555-5555-4555-8555-${String(offset).padStart(12, '0')}`,
    accountId: DACCOUNT,
    jobId: readId,
    operation: 'reconcile_short_body_write',
    scope,
    datasets: ['short_native_body_reconciliation'],
    requestedAt: DT(offset),
    platformReadStartedAt: DT(offset + 2),
    committedAt: DT(offset + 8),
    evidence: [ref],
  };
  const readJob = {
    id: readId,
    accountId: DACCOUNT,
    ownerId: DOWNER,
    kind: 'read',
    operation: 'reconcile_short_body_write',
    scope,
    datasets: ['short_native_body_reconciliation'],
    idempotencyKey: 'synthetic-reconcile',
    inputHash,
    status: 'succeeded',
    requestedAt: DT(offset),
    startedAt: DT(offset + 1),
    platformReadStartedAt: DT(offset + 2),
    platformWriteStartedAt: null,
    endedAt: DT(offset + 8),
    updatedAt: DT(offset + 8),
    result: { manifest },
    error: null,
    target: { kind: 'short-story', id: WORK },
    metadata: {},
    timeoutMs: 120000,
    deadlineAt: DT(offset + 120001),
    cancellationRequestedAt: null,
    cancellationReason: null,
  };
  const settlement = {
    status: partial ? 'uncertain' : 'succeeded',
    reason: partial ? 'partial_read' : 'match',
    result: {
      schema: 'native-short-body-settlement-result/v1',
      source: DSOURCE,
      originalJobId: DJOB,
      readJobId: readId,
      desiredMatched: !partial,
      bodyIncluded: false,
      verifiedLive: false,
    },
  };
  const closure = {
    schema: 'native-short-body-closure/v1',
    accountId: DACCOUNT,
    originalJobId: DJOB,
    reconciliationJobId: readId,
    evidence: dlink(ref),
    ...settlement,
    originalAudit: audit,
    settledAt: DT(offset + 9),
  };
  return { context: { original, readJob, manifest, ref, document }, payload, settlement, closure };
}

// Dedicated read projection uses actual Store SQL rows and physical files. The transport observation is synthetic.
export function physicalReadFixture(
  content = '<p>PRIVATE_LINE&amp;甲<br>乙</p><p></p>',
  publishStatus = 0,
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-explicit-read-proof-'));
  const store = new Store({
    databasePath: path.join(dir, 'operations.sqlite'),
    evidenceDirectory: path.join(dir, 'evidence'),
    evidenceMode: 'fixture',
  });
  const runtimeAccount = 'body-read-runtime-owner';
  const source = raw(content, 7, {
    publish_status: publishStatus,
    multi_title: ['PRIVATE_TITLE', 'PRIVATE_TAIL'],
    thumb_uri: 'PRIVATE_HEAD_URI',
    book_thumb_uri: 'PRIVATE_COVER_URI',
    opaque: { cookie: 'PRIVATE_OPAQUE_COOKIE', header: 'PRIVATE_OPAQUE_HEADER' },
  });
  const job = store.createJob({
    accountId: runtimeAccount,
    kind: 'read',
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: nativeShortReadScope(WORK),
    datasets: [NATIVE_SHORT_READ_DATASET],
    inputHash: nativeShortInputHash(WORK),
  }).job;
  store.startJob(job.id);
  store.markPlatformReadStarted(job.id);
  store.recordTarget(job.id, { kind: 'short-story', id: WORK });
  const stamp = new Date().toISOString();
  const result: NativeShortMetadataApiResult = {
    schema: 'native-short-metadata-api-read/v1',
    status: 'success',
    reason: null,
    snapshot: createNativeShortMetadataSnapshot(source),
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
      ownerCallback: true,
      fixedSourceVerified: true,
      targetUnique: true,
      paginationComplete: true,
      atomicRevision: false,
      readStartedAt: stamp,
      readFinishedAt: stamp,
      proofCapturedAt: stamp,
    },
    requests: {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 1, disposed: 1 },
      edit: { attempts: 1, disposed: 1 },
      catalog: { attempts: 1, disposed: 1 },
    },
    list: { pagesRead: 1, rowsRead: 1, totalCount: 1 },
    cleanup: {
      sessionCreated: true,
      sessionDisposed: true,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: stamp,
    },
  };
  const wrapper = createNativeShortReadEvidence(result, {
    executor: 'dependency-injected-browser/v1',
    mode: 'fixture',
  });
  const ref = store.saveEvidence(job.id, NATIVE_SHORT_READ_DATASET, wrapper);
  store.completeReadJob(job.id, [ref]);
  const context = (): NativeShortEvidenceContext => ({
    accountId: runtimeAccount,
    job: store.getJob(job.id, runtimeAccount),
    manifest: store.getManifestForJob(runtimeAccount, job.id),
    ref: store.listEvidence(job.id)[0]!,
    document: store.readEvidence(ref),
  });
  return {
    dir,
    store,
    ref,
    job,
    source,
    context,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function sealBodyReadContext(context: NativeShortEvidenceContext): void {
  context.ref.sha256 = bytesHash(canonicalJson(context.document) + '\n');
  assert(context.manifest);
  context.manifest.evidence = [context.ref];
  assert(context.job);
  context.job.result = { manifest: context.manifest };
}
