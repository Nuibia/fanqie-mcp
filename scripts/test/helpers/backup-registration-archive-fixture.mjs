import {
  databaseFixture,
  registrationIds,
  registrationRefId,
  registrationAt,
  registrationSafeRef,
} from './backup-mock-docker.mjs';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { digest, canonical } from '../../lib/backup-core.mjs';

import { writeFile } from 'node:fs/promises';

export async function registrationArchiveFixture(root) {
  await databaseFixture(root);
  const db = new DatabaseSync(path.join(root, 'operations.sqlite'));
  const columns = [
    'kind',
    'operation',
    'scope',
    'datasets_json',
    'idempotency_key',
    'input_hash',
    'status',
    'requested_at',
    'started_at',
    'read_started_at',
    'write_started_at',
    'ended_at',
    'updated_at',
    'result_json',
    'error_json',
    'target_json',
    'metadata_json',
    'cancellation_requested_at',
    'cancellation_reason_json',
  ];
  for (const name of columns) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} TEXT`);
  const accountId = 'account-fixture',
    target = { kind: 'short-story', id: '7000000001' },
    originalInputHash = '1'.repeat(64),
    scope = `native_compensation_attestation.${digest(registrationIds.original).slice(0, 32)}`;
  const insertJob = (id, kind, operation, inputHash, storyTarget) =>
    db
      .prepare(
        'INSERT INTO jobs(id,account_id,kind,operation,input_hash,target_json,status) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        accountId,
        kind,
        operation,
        inputHash,
        storyTarget === null ? null : canonical(storyTarget),
        id === registrationIds.original ? 'failed' : 'succeeded',
      );
  insertJob(registrationIds.original, 'write', 'update_work_metadata', originalInputHash, target);
  insertJob(
    registrationIds.before,
    'read',
    'operator_short_native_title_restore_before_v1',
    '2'.repeat(64),
    null,
  );
  insertJob(
    registrationIds.operator,
    'write',
    'operator_short_native_title_restore_v1',
    '3'.repeat(64),
    target,
  );
  async function addRef(n, jobId, dataset, at) {
    const doc = {
        schemaVersion: 1,
        evidenceId: registrationRefId(n),
        accountId,
        jobId,
        dataset,
        capturedAt: at,
        collectionMode: 'live',
        evidenceKind: dataset === 'write-intent' ? 'local-intent' : 'observation',
        payload: { syntheticMarker: 'PRIVATE_ARCHIVE_LINKED_CONTENT' },
      },
      bytes = Buffer.from(`${canonical(doc)}\n`);
    const ref = {
      id: doc.evidenceId,
      accountId,
      jobId,
      dataset,
      capturedAt: at,
      path: `fixture/registration-${n}.json`,
      sha256: digest(bytes),
    };
    await writeFile(path.join(root, 'evidence', ref.path), bytes);
    db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)').run(
      ref.id,
      accountId,
      jobId,
      dataset,
      at,
      ref.path,
      ref.sha256,
    );
    return ref;
  }
  const originalRefs = [
    await addRef(1, registrationIds.original, 'short_native_metadata_baseline', registrationAt(0)),
    await addRef(2, registrationIds.original, 'write-intent', registrationAt(1)),
  ];
  const beforeRef = await addRef(
    3,
    registrationIds.before,
    'operator_title_restore_before',
    registrationAt(2),
  );
  const operatorRefs = [];
  for (const [i, dataset] of [
    'operator_title_restore_baseline',
    'write-intent',
    'operator_title_restore_native',
    'operator_title_restore_after',
  ].entries())
    operatorRefs.push(
      await addRef(4 + i, registrationIds.operator, dataset, registrationAt(3 + i)),
    );
  // Noncanonical receipt whitespace is intentional: receipt hashes seal raw bytes.
  const actor = {
      schema: 'fanqie-c3-operator-title-restoration-safe/v1',
      runId: registrationIds.run,
      operatorJobId: registrationIds.operator,
      completedAt: registrationAt(9),
      syntheticMarker: 'PRIVATE_ARCHIVE_AUTHORITY_BYTES',
    },
    actorBytes = JSON.stringify(actor, null, 2);
  const executionManifestSha256 = 'e'.repeat(64),
    controller = {
      schema: 'fanqie-c3-operator-title-restoration-controller-safe/v1',
      runId: registrationIds.run,
      operatorSafe: actor,
      operatorOutputSafe: { sha256: digest(actorBytes) },
      approvedInputs: { sourceManifest: { sha256: executionManifestSha256 } },
      completedAt: registrationAt(10),
    },
    controllerBytes = JSON.stringify(controller, null, 2);
  const inventory = Object.fromEntries(
    Array.from({ length: 35 }, (_, n) => [`src/archive-fixture-${n}.ts`, 'a'.repeat(64)]),
  );
  const authority = {
    policy: {
      basis: 'operator-title-restore-three-paths/v1',
      sha256: 'bb6e9da2aab7977aad1edfeb270da0677f4ea87062694d95fa4a2348468f373c',
    },
    source: {
      executionManifestSha256,
      executionInventory: inventory,
      registrationManifestSha256: 'f'.repeat(64),
      registrationInventory: { ...inventory },
    },
    actor: { sha256: 'd58fa26059041a7913ef5bf696064dcf66c8ea97de361814db2d149351aa1f1c' },
    controller: { sha256: '76466487dfb1fe97e3acd4b01bf9546257051715532cac6490675c87364b0e93' },
    receipts: {
      actor: { sha256: digest(actorBytes), bytes: actorBytes },
      controller: { sha256: digest(controllerBytes), bytes: controllerBytes },
    },
  };
  const authorityHash = digest(canonical(authority)),
    policyHash = digest(canonical(authority.policy));
  const payload = {
    schema: 'native-short-metadata-compensation-attestation/v1',
    accountId,
    originalJobId: registrationIds.original,
    operatorJobId: registrationIds.operator,
    operatorBeforeReadJobId: registrationIds.before,
    target,
    originalInputHash,
    originalEvidence: originalRefs.map(registrationSafeRef),
    originalAuditHash: '4'.repeat(64),
    operatorBeforeEvidence: registrationSafeRef(beforeRef),
    operatorEvidence: operatorRefs.map(registrationSafeRef),
    authority,
    authorityHash,
    policyHash,
    approvedAt: registrationAt(12),
    effectsEndedAt: registrationAt(11),
  };
  const input = {
      schema: 'native-short-metadata-compensation-registration-input/v1',
      accountId,
      originalJobId: registrationIds.original,
      operatorJobId: registrationIds.operator,
      authority,
      approvedAt: payload.approvedAt,
      effectsEndedAt: payload.effectsEndedAt,
    },
    inputHash = digest(canonical(input));
  const doc = {
      schemaVersion: 1,
      evidenceId: registrationRefId(8),
      accountId,
      jobId: registrationIds.job,
      dataset: 'native_compensation_attestation',
      capturedAt: registrationAt(15),
      collectionMode: 'live',
      evidenceKind: 'observation',
      payload,
    },
    ref = {
      id: doc.evidenceId,
      accountId,
      jobId: doc.jobId,
      dataset: doc.dataset,
      capturedAt: doc.capturedAt,
      path: 'fixture/registration-8.json',
      sha256: '',
    };
  const manifest = {
    schema: 'native-short-metadata-compensation-registration-manifest/v1',
    id: registrationIds.manifest,
    accountId,
    jobId: registrationIds.job,
    operation: 'register_native_compensation_attestation',
    scope,
    datasets: ['native_compensation_attestation'],
    inputHash,
    requestedAt: registrationAt(15),
    startedAt: registrationAt(15),
    platformReadStartedAt: null,
    platformWriteStartedAt: null,
    committedAt: registrationAt(15),
    evidence: [ref],
    authorityHash,
    policyHash,
  };
  const job = {
    kind: 'read',
    operation: manifest.operation,
    scope,
    datasets_json: canonical(manifest.datasets),
    idempotency_key: registrationIds.original,
    input_hash: inputHash,
    status: 'succeeded',
    requested_at: manifest.requestedAt,
    started_at: manifest.startedAt,
    read_started_at: null,
    write_started_at: null,
    ended_at: manifest.committedAt,
    updated_at: manifest.committedAt,
    result: { manifest },
    error_json: null,
    target_json: canonical(target),
    metadata: {
      schema: 'native-short-metadata-compensation-registration-job/v1',
      originalJobId: registrationIds.original,
      operatorJobId: registrationIds.operator,
      authorityHash,
      policyHash,
    },
    cancellation_requested_at: null,
    cancellation_reason_json: null,
  };
  db.prepare('INSERT INTO jobs(id,account_id) VALUES(?,?)').run(registrationIds.job, accountId);
  db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)').run(
    ref.id,
    accountId,
    ref.jobId,
    ref.dataset,
    ref.capturedAt,
    ref.path,
    '0'.repeat(64),
  );
  db.prepare('INSERT INTO manifests VALUES(?,?,?,?,?,?)').run(
    manifest.id,
    accountId,
    manifest.jobId,
    scope,
    manifest.committedAt,
    '{}',
  );
  db.close();
  const fixture = {
    manifest,
    payload,
    doc,
    ref,
    job,
    accountId,
    target,
    originalRefs,
    beforeRef,
    operatorRefs,
    async persist() {
      const bytes = Buffer.from(`${canonical(doc)}\n`);
      ref.sha256 = digest(bytes);
      await writeFile(path.join(root, 'evidence', ref.path), bytes);
      const connection = new DatabaseSync(path.join(root, 'operations.sqlite'));
      try {
        connection
          .prepare(
            'UPDATE evidence SET account_id=?,job_id=?,dataset=?,captured_at=?,path=?,sha256=? WHERE id=?',
          )
          .run(ref.accountId, ref.jobId, ref.dataset, ref.capturedAt, ref.path, ref.sha256, ref.id);
        connection
          .prepare(
            'UPDATE manifests SET account_id=?,job_id=?,scope=?,committed_at=?,manifest_json=? WHERE id=?',
          )
          .run(
            manifest.accountId,
            manifest.jobId,
            manifest.scope,
            manifest.committedAt,
            canonical(manifest),
            registrationIds.manifest,
          );
        const values = columns.map((key) =>
          key === 'result_json'
            ? canonical(job.result)
            : key === 'metadata_json'
              ? canonical(job.metadata)
              : job[key],
        );
        connection
          .prepare(`UPDATE jobs SET ${columns.map((key) => `${key}=?`).join(',')} WHERE id=?`)
          .run(...values, registrationIds.job);
      } finally {
        connection.close();
      }
    },
  };
  await fixture.persist();
  return fixture;
}
