import {
  type DiagnosticPrivacyIdentity,
  diagnosticPrivacyTree,
  diagnosticPrivacyExact,
  diagnosticPrivacyTime,
  DIAGNOSTIC_PRIVACY_FIELDS,
} from './application-diagnostic-privacy-identity.js';

import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';

/** Independently checks both complete successful fixture DTOs before normalizing exactly three opaque slots. */
export function diagnosticPrivacyScan(
  input: unknown,
  identity: DiagnosticPrivacyIdentity,
  privateMarkers: string[],
): void {
  diagnosticPrivacyTree(input);
  const root = diagnosticPrivacyExact(input, [
    'data',
    'evidence',
    'job',
    'reason',
    'retrievalMode',
    'sourceMode',
  ]);
  const job = diagnosticPrivacyExact(root.job, [
    'endedAt',
    'id',
    'operation',
    'requestedAt',
    'status',
  ]);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    digest = /^[a-f0-9]{64}$/;
  assert(typeof job.id === 'string');
  assert(uuid.test(job.id));
  assert.deepEqual(job, {
    id: identity.jobId,
    status: identity.status,
    operation: identity.operation,
    requestedAt: identity.requestedAt,
    endedAt: identity.endedAt,
  });
  assert.equal(job.status, 'succeeded');
  assert(
    job.operation === 'diagnose_short_metadata_schema' ||
      job.operation === 'diagnose_short_metadata_api_schema',
  );
  const api = job.operation === 'diagnose_short_metadata_api_schema',
    dataset = api ? 'short_metadata_api_schema' : 'short_metadata_schema';
  const requestedAt = diagnosticPrivacyTime(job.requestedAt),
    endedAt = diagnosticPrivacyTime(job.endedAt);
  assert(requestedAt <= endedAt);
  assert(root.retrievalMode === 'live' || root.retrievalMode === 'saved');
  assert.equal(root.sourceMode, root.retrievalMode);
  assert.equal(root.reason, null);
  assert(Array.isArray(root.evidence));
  assert.equal(root.evidence.length, 1);
  assert.equal(identity.refs.length, 1);
  const evidence = root.evidence.map((item: unknown, index: number) => {
    const ref = diagnosticPrivacyExact(item, ['capturedAt', 'dataset', 'id', 'sha256']),
      expected = identity.refs[index];
    assert(expected);
    assert(typeof ref.id === 'string' && uuid.test(ref.id));
    assert(typeof ref.sha256 === 'string' && digest.test(ref.sha256));
    const capturedAt = diagnosticPrivacyTime(ref.capturedAt);
    assert(requestedAt <= capturedAt && capturedAt <= endedAt);
    assert.deepEqual(ref, {
      id: expected.id,
      sha256: expected.sha256,
      capturedAt: expected.capturedAt,
      dataset: expected.dataset,
    });
    assert.equal(ref.dataset, dataset);
    return { ...ref, id: '<opaque-evidence-uuid>', sha256: '<opaque-evidence-sha256>' };
  });
  assert(Array.isArray(root.data));
  assert.equal(root.data.length, 1);
  const commonKeys = [
    'schema',
    'status',
    'reason',
    'fields',
    'unknownKeyCount',
    'unknownKeysTruncated',
    'proof',
    'own',
    'cleanup',
  ];
  const data = diagnosticPrivacyExact(root.data[0], [
    ...commonKeys,
    ...(api ? ['list', 'transport'] : ['blocked']),
  ]);
  const proofKeys = [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'ownerCallback',
    'atomicRevision',
    'proofCapturedAt',
  ];
  const proof = diagnosticPrivacyExact(data.proof, [
    ...proofKeys,
    ...(api
      ? [
          'fixedSourceVerified',
          'targetUnique',
          'paginationComplete',
          'readStartedAt',
          'readFinishedAt',
        ]
      : ['rootCommitted', 'uniqueNaturalResponse', 'connectedBarrier']),
  ]);
  const cleanup = diagnosticPrivacyExact(
    data.cleanup,
    api
      ? [
          'sessionCreated',
          'sessionDisposed',
          'pendingAtEnd',
          'disposalFailures',
          'quarantined',
          'checkedAt',
        ]
      : ['contextCreated', 'contextClosed', 'apiDisposed', 'pendingAtEnd', 'checkedAt'],
  );
  diagnosticPrivacyExact(data.own, ['attempts', 'disposed']);
  const proofAt = diagnosticPrivacyTime(proof.proofCapturedAt),
    cleanupAt = diagnosticPrivacyTime(cleanup.checkedAt),
    capturedAt = diagnosticPrivacyTime(identity.refs[0]!.capturedAt);
  assert(requestedAt <= proofAt && proofAt <= capturedAt);
  assert(requestedAt <= cleanupAt && cleanupAt <= capturedAt);
  // These complete literals are independent of both production projectors and preserve every nested slot.
  const common = {
    status: 'success',
    reason: null,
    fields: DIAGNOSTIC_PRIVACY_FIELDS,
    unknownKeyCount: 2,
    unknownKeysTruncated: false,
    own: { attempts: 2, disposed: 2 },
  };
  if (api) {
    diagnosticPrivacyExact(data.list, [
      'attempts',
      'disposed',
      'pagesRead',
      'rowsRead',
      'totalCount',
    ]);
    diagnosticPrivacyExact(data.transport, ['redirects', 'responseFailures', 'oversizeResponses']);
    const readStartedAt = diagnosticPrivacyTime(proof.readStartedAt),
      readFinishedAt = diagnosticPrivacyTime(proof.readFinishedAt);
    assert(
      requestedAt <= readStartedAt &&
        readStartedAt <= readFinishedAt &&
        readFinishedAt <= cleanupAt &&
        cleanupAt <= proofAt,
    );
    assert.deepEqual(data, {
      ...common,
      schema: 'short-metadata-api-schema/v1',
      proof: {
        platformStarted: true,
        ownerBefore: true,
        ownerAfter: true,
        ownerCallback: true,
        fixedSourceVerified: true,
        targetUnique: true,
        paginationComplete: true,
        atomicRevision: false,
        readStartedAt,
        readFinishedAt,
        proofCapturedAt: proofAt,
      },
      list: { attempts: 1, disposed: 1, pagesRead: 1, rowsRead: 1, totalCount: 1 },
      transport: { redirects: 0, responseFailures: 0, oversizeResponses: 0 },
      cleanup: {
        sessionCreated: true,
        sessionDisposed: true,
        pendingAtEnd: 0,
        disposalFailures: 0,
        quarantined: false,
        checkedAt: cleanupAt,
      },
    });
  } else {
    diagnosticPrivacyExact(data.blocked, [
      'nonGet',
      'unknownGet',
      'foreignFrame',
      'webSocket',
      'serviceWorker',
      'redirect',
      'protocolFailure',
    ]);
    assert(proofAt <= cleanupAt);
    assert.deepEqual(data, {
      ...common,
      schema: 'short-metadata-schema/v1',
      proof: {
        platformStarted: true,
        ownerBefore: true,
        ownerAfter: true,
        ownerCallback: true,
        rootCommitted: true,
        uniqueNaturalResponse: true,
        connectedBarrier: true,
        proofCapturedAt: proofAt,
        atomicRevision: false,
      },
      blocked: {
        nonGet: 0,
        unknownGet: 0,
        foreignFrame: 0,
        webSocket: 0,
        serviceWorker: 0,
        redirect: 0,
        protocolFailure: 0,
      },
      cleanup: {
        contextCreated: true,
        contextClosed: true,
        apiDisposed: true,
        pendingAtEnd: 0,
        checkedAt: cleanupAt,
      },
    });
  }
  const serialized = JSON.stringify({
    ...root,
    job: { ...job, id: '<opaque-job-uuid>' },
    evidence,
  });
  for (const marker of privateMarkers) assert.equal(serialized.includes(marker), false, marker);
}

export function actualDiagnosticIdentity(
  databasePath: string,
  accountId: string,
  jobId: string,
): DiagnosticPrivacyIdentity {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db
      .prepare(
        'SELECT id,status,operation,requested_at,ended_at FROM jobs WHERE id=? AND account_id=?',
      )
      .get(jobId, accountId);
    assert(row);
    return {
      jobId: String(row.id),
      status: String(row.status),
      operation: String(row.operation),
      requestedAt: String(row.requested_at),
      endedAt: row.ended_at === null ? null : String(row.ended_at),
      refs: db
        .prepare(
          'SELECT id,sha256,dataset,captured_at FROM evidence WHERE job_id=? AND account_id=? ORDER BY rowid',
        )
        .all(jobId, accountId)
        .map((ref) => ({
          id: String(ref.id),
          sha256: String(ref.sha256),
          dataset: String(ref.dataset),
          capturedAt: String(ref.captured_at),
        })),
    };
  } finally {
    db.close();
  }
}
