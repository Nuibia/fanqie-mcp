import { type DiagnosticPrivacyIdentity } from './application-diagnostic-privacy-identity.js';

import { resumeAppFixture } from './application-resume-app-fixture.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { readFileSync } from 'node:fs';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

export function completeDiagnosticPrivacyFixture(
  api: boolean,
  jobId: string,
  id: string,
  sha256: string,
  at: string,
) {
  const operation = api ? 'diagnose_short_metadata_api_schema' : 'diagnose_short_metadata_schema',
    dataset = api ? 'short_metadata_api_schema' : 'short_metadata_schema';
  const fields = [
    {
      field: 'category',
      present: true,
      type: 'array',
      arrayCount: 1,
      truncated: false,
      categorySamples: [
        {
          type: 'object',
          fields: [
            { field: 'category_id', type: 'string' },
            { field: 'label', type: 'string' },
            { field: 'name', type: 'string' },
          ],
        },
      ],
    },
    {
      field: 'thumb_uri',
      present: true,
      type: 'string',
      arrayCount: null,
      truncated: false,
      categorySamples: [],
    },
    {
      field: 'thumb_url_list',
      present: false,
      type: 'absent',
      arrayCount: null,
      truncated: false,
      categorySamples: [],
    },
    {
      field: 'book_thumb_uri',
      present: false,
      type: 'absent',
      arrayCount: null,
      truncated: false,
      categorySamples: [],
    },
    {
      field: 'book_thumb_url_list',
      present: false,
      type: 'absent',
      arrayCount: null,
      truncated: false,
      categorySamples: [],
    },
  ];
  const own = { attempts: 2, disposed: 2 };
  const data = api
    ? {
        schema: 'short-metadata-api-schema/v1',
        status: 'success',
        reason: null,
        fields,
        unknownKeyCount: 2,
        unknownKeysTruncated: false,
        own,
        proof: {
          platformStarted: true,
          ownerBefore: true,
          ownerAfter: true,
          ownerCallback: true,
          fixedSourceVerified: true,
          targetUnique: true,
          paginationComplete: true,
          atomicRevision: false,
          readStartedAt: at,
          readFinishedAt: at,
          proofCapturedAt: at,
        },
        list: { attempts: 1, disposed: 1, pagesRead: 1, rowsRead: 1, totalCount: 1 },
        transport: { redirects: 0, responseFailures: 0, oversizeResponses: 0 },
        cleanup: {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt: at,
        },
      }
    : {
        schema: 'short-metadata-schema/v1',
        status: 'success',
        reason: null,
        fields,
        unknownKeyCount: 2,
        unknownKeysTruncated: false,
        own,
        proof: {
          platformStarted: true,
          ownerBefore: true,
          ownerAfter: true,
          ownerCallback: true,
          rootCommitted: true,
          uniqueNaturalResponse: true,
          connectedBarrier: true,
          proofCapturedAt: at,
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
          checkedAt: at,
        },
      };
  const identity: DiagnosticPrivacyIdentity = {
    jobId,
    status: 'succeeded',
    operation,
    requestedAt: at,
    endedAt: at,
    refs: [{ id, sha256, dataset, capturedAt: at }],
  };
  return {
    identity,
    result: {
      job: { id: jobId, status: 'succeeded', operation, requestedAt: at, endedAt: at },
      retrievalMode: 'saved',
      sourceMode: 'saved',
      evidence: [{ id, sha256, capturedAt: at, dataset }],
      data: [data],
      reason: null,
    },
  };
}

// R6 App oracles reuse the native editor fixture and inspect only its synthetic
// SQLite rows and synthetic evidence. They do not promote an injected browser to live authority.
export function r6AppRecords(f: Awaited<ReturnType<typeof resumeAppFixture>>, operation: string) {
  const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
  try {
    const jobs = db
      .prepare('SELECT * FROM jobs WHERE account_id=? AND operation=? ORDER BY rowid')
      .all(f.config.accountId, operation);
    return jobs.map((row) => ({
      row,
      metadata: JSON.parse(String(row.metadata_json)) as Record<string, any>,
      refs: db
        .prepare('SELECT * FROM evidence WHERE job_id=? ORDER BY rowid')
        .all(row.id!)
        .map((ref) => {
          const bytes = readFileSync(
            path.join(f.config.dataDir, 'evidence', String(ref.path)),
            'utf8',
          );
          assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256);
          const document = JSON.parse(bytes) as Record<string, any>;
          assert.equal(document.jobId, row.id);
          assert.equal(document.evidenceId, ref.id);
          assert.equal(document.accountId, f.config.accountId);
          assert.equal(document.dataset, ref.dataset);
          assert.equal(document.capturedAt, ref.captured_at);
          return { ref, document };
        }),
      manifestCount: Number(
        db.prepare('SELECT COUNT(*) AS n FROM manifests WHERE job_id=?').get(row.id!)!.n,
      ),
    }));
  } finally {
    db.close();
  }
}

export function r6AssertNoPrivateStatus(value: unknown) {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    for (const [key, child] of Object.entries(item)) {
      assert(
        ![
          'genericShortStatus',
          'statusInput',
          'statusProof',
          'statusProtocol',
          'originalAudit',
          'statusSnapshot',
          'shortObservation',
        ].includes(key),
        'private status key: ' + key,
      );
      pending.push(child);
    }
  }
}

export function r6AssertActualPrefix(
  record: ReturnType<typeof r6AppRecords>[number],
  roles: readonly (readonly [string, string])[],
) {
  const witness = record.metadata.genericShortStatus;
  assert(witness);
  assert.deepEqual(
    Object.keys(witness).sort(),
    [
      'schema',
      'operation',
      'target',
      'creationContext',
      'requestBindings',
      'identityType',
      'platformOwnerId',
      'profileId',
      'profileVerifiedAt',
      'provenance',
      'startedAt',
      'stage',
      'observations',
      'failure',
    ].sort(),
  );
  const refs = record.refs.filter(
    ({ ref }) => !['write-intent', 'write-result'].includes(String(ref.dataset)),
  );
  assert.deepEqual(
    refs.map(({ ref, document }) => [
      ref.dataset,
      document.payload.phase ??
        (ref.dataset === 'creation-repair-verification' ? 'after' : 'baseline'),
    ]),
    roles,
  );
  assert.deepEqual(
    witness.observations,
    refs.map(({ ref }, i) => ({
      ordinal: i + 1,
      dataset: String(ref.dataset),
      phase: roles[i]![1],
      evidenceId: String(ref.id),
      evidenceHash: String(ref.sha256),
    })),
  );
  for (const { document } of refs) {
    assert.equal(document.collectionMode, 'fixture');
    assert.equal(document.evidenceKind, 'observation');
    const snapshot = document.payload.snapshot ?? document.payload.statusSnapshot;
    assert.equal(Object.keys(snapshot).length, 12);
    assert.equal(Object.keys(snapshot.statusProof).length, 17);
    assert.equal(snapshot.statusProof.requestCount, 1);
    assert.equal(snapshot.statusProof.responseCount, 1);
    for (const phase of ['before', 'after'])
      assert.deepEqual(
        Object.keys(snapshot.statusProof.owner[phase]).sort(),
        ['requestedAt', 'completedAt', 'checkedAt'].sort(),
      );
  }
}
