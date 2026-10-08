import {
  REGISTRATION_SCHEMA,
  registrationExact,
  REGISTRATION_KEYS,
  registrationString,
  REGISTRATION_UUID,
  identifier,
  REGISTRATION_OPERATION,
  registrationSame,
  REGISTRATION_DATASET,
  REGISTRATION_HASH,
  registrationCanonical,
  fail,
  REF_KEYS,
  hash,
  ATTESTATION_KEYS,
  SAFE_REF_KEYS,
  registrationTime,
  registrationOrdered,
  registrationAuthority,
  parse,
  BackupValidationError,
} from './parse.mjs';

import path from 'node:path';

import { lstatSync, readdirSync } from 'node:fs';

export function validateRegistrationManifest(
  db,
  row,
  manifest,
  jobAccounts,
  references,
  documents,
) {
  try {
    if (
      manifest.schema !== REGISTRATION_SCHEMA ||
      !registrationExact(manifest, REGISTRATION_KEYS) ||
      !registrationString(manifest.id, REGISTRATION_UUID) ||
      !registrationString(manifest.jobId, REGISTRATION_UUID) ||
      !registrationString(manifest.accountId, identifier) ||
      manifest.id !== row.id ||
      manifest.accountId !== row.account_id ||
      manifest.jobId !== row.job_id ||
      manifest.scope !== row.scope ||
      manifest.committedAt !== row.committed_at ||
      jobAccounts.get(manifest.jobId) !== manifest.accountId ||
      manifest.operation !== REGISTRATION_OPERATION ||
      !registrationSame(manifest.datasets, [REGISTRATION_DATASET]) ||
      manifest.platformReadStartedAt !== null ||
      manifest.platformWriteStartedAt !== null ||
      !registrationString(manifest.inputHash, REGISTRATION_HASH) ||
      !registrationString(manifest.authorityHash, REGISTRATION_HASH) ||
      !registrationString(manifest.policyHash, REGISTRATION_HASH) ||
      registrationCanonical(manifest) !== row.manifest_json ||
      !Array.isArray(manifest.evidence) ||
      manifest.evidence.length !== 1
    )
      fail('registration_manifest_invalid');
    const ref = manifest.evidence[0],
      stored = registrationExact(ref, REF_KEYS) ? references.get(ref.id) : undefined;
    if (
      !stored ||
      stored.accountId !== manifest.accountId ||
      stored.jobId !== manifest.jobId ||
      stored.dataset !== REGISTRATION_DATASET ||
      !registrationString(stored.id, REGISTRATION_UUID) ||
      !registrationSame(ref, stored) ||
      [...references.values()].filter((item) => item.jobId === manifest.jobId).length !== 1 ||
      Number(
        db.prepare('SELECT COUNT(*) AS count FROM manifests WHERE job_id=?').get(manifest.jobId)
          .count,
      ) !== 1
    )
      fail('registration_reference_invalid');
    const sealed = documents.get(ref.id),
      doc = sealed?.document;
    if (
      !sealed ||
      sealed.bytes.length > 64 * 1024 ||
      !registrationExact(doc, [
        'schemaVersion',
        'evidenceId',
        'accountId',
        'jobId',
        'dataset',
        'capturedAt',
        'collectionMode',
        'evidenceKind',
        'payload',
      ]) ||
      doc.collectionMode !== 'live' ||
      doc.evidenceKind !== 'observation' ||
      hash(`${registrationCanonical(doc)}\n`) !== ref.sha256
    )
      fail('registration_document_invalid');
    const payload = doc.payload;
    if (
      !registrationExact(payload, ATTESTATION_KEYS) ||
      payload.schema !== 'native-short-metadata-compensation-attestation/v1' ||
      payload.accountId !== manifest.accountId ||
      ![payload.originalJobId, payload.operatorJobId, payload.operatorBeforeReadJobId].every(
        (id) =>
          registrationString(id, REGISTRATION_UUID) && jobAccounts.get(id) === manifest.accountId,
      ) ||
      new Set([
        payload.originalJobId,
        payload.operatorJobId,
        payload.operatorBeforeReadJobId,
        manifest.jobId,
      ]).size !== 4 ||
      !registrationExact(payload.target, ['kind', 'id']) ||
      payload.target.kind !== 'short-story' ||
      !registrationString(payload.target.id, /^[1-9][0-9]{9,21}$/) ||
      !registrationString(payload.originalInputHash, REGISTRATION_HASH) ||
      !registrationString(payload.originalAuditHash, REGISTRATION_HASH) ||
      payload.authorityHash !== manifest.authorityHash ||
      payload.policyHash !== manifest.policyHash ||
      hash(registrationCanonical(payload.authority)) !== manifest.authorityHash ||
      hash(registrationCanonical(payload.authority?.policy)) !== manifest.policyHash
    )
      fail('registration_attestation_invalid');
    const scope = `${REGISTRATION_DATASET}.${hash(payload.originalJobId).slice(0, 32)}`;
    const input = {
      schema: 'native-short-metadata-compensation-registration-input/v1',
      accountId: manifest.accountId,
      originalJobId: payload.originalJobId,
      operatorJobId: payload.operatorJobId,
      authority: payload.authority,
      approvedAt: payload.approvedAt,
      effectsEndedAt: payload.effectsEndedAt,
    };
    if (manifest.scope !== scope || manifest.inputHash !== hash(registrationCanonical(input)))
      fail('registration_input_hash_invalid');
    const used = new Set([ref.id]);
    function boundRef(value, jobId, name) {
      const linked = registrationExact(value, SAFE_REF_KEYS) ? references.get(value.id) : undefined;
      if (
        !linked ||
        !registrationString(linked.id, REGISTRATION_UUID) ||
        !registrationTime(linked.capturedAt) ||
        used.has(value.id) ||
        linked.accountId !== manifest.accountId ||
        linked.jobId !== jobId ||
        linked.dataset !== name ||
        !SAFE_REF_KEYS.every((key) => value[key] === linked[key])
      )
        fail('registration_payload_reference_invalid');
      used.add(value.id);
      return linked.capturedAt;
    }
    const originalDatasets = [
      'short_native_metadata_baseline',
      'write-intent',
      'short_native_metadata_after',
      'write-result',
    ];
    if (
      !Array.isArray(payload.originalEvidence) ||
      payload.originalEvidence.length < 2 ||
      payload.originalEvidence.length > 4 ||
      !Array.isArray(payload.operatorEvidence) ||
      payload.operatorEvidence.length !== 4
    )
      fail('registration_payload_reference_invalid');
    registrationOrdered(
      payload.originalEvidence.map((value, i) =>
        boundRef(value, payload.originalJobId, originalDatasets[i]),
      ),
    );
    const beforeAt = boundRef(
      payload.operatorBeforeEvidence,
      payload.operatorBeforeReadJobId,
      'operator_title_restore_before',
    );
    const operatorDatasets = [
      'operator_title_restore_baseline',
      'write-intent',
      'operator_title_restore_native',
      'operator_title_restore_after',
    ];
    const operatorTimes = payload.operatorEvidence.map((value, i) =>
      boundRef(value, payload.operatorJobId, operatorDatasets[i]),
    );
    registrationOrdered([beforeAt, ...operatorTimes, payload.effectsEndedAt, payload.approvedAt]);
    const completedAt = registrationAuthority(payload.authority, payload.operatorJobId);
    registrationOrdered([
      completedAt,
      payload.effectsEndedAt,
      payload.approvedAt,
      manifest.requestedAt,
      manifest.startedAt,
      ref.capturedAt,
      manifest.committedAt,
    ]);
    const related = (id) =>
      db
        .prepare('SELECT id,account_id,kind,operation,input_hash,target_json FROM jobs WHERE id=?')
        .get(id);
    const original = related(payload.originalJobId),
      operator = related(payload.operatorJobId),
      before = related(payload.operatorBeforeReadJobId);
    if (
      !original ||
      original.kind !== 'write' ||
      original.operation !== 'update_work_metadata' ||
      original.input_hash !== payload.originalInputHash ||
      !registrationSame(parse(original.target_json), payload.target) ||
      !operator ||
      operator.kind !== 'write' ||
      operator.operation !== 'operator_short_native_title_restore_v1' ||
      !registrationSame(parse(operator.target_json), payload.target) ||
      !before ||
      before.kind !== 'read' ||
      before.operation !== 'operator_short_native_title_restore_before_v1' ||
      (before.target_json !== null && !registrationSame(parse(before.target_json), null))
    )
      fail('registration_related_job_invalid');
    const job = db
      .prepare(
        'SELECT kind,operation,scope,datasets_json,idempotency_key,input_hash,status,requested_at,started_at,read_started_at,write_started_at,ended_at,updated_at,result_json,error_json,target_json,metadata_json,cancellation_requested_at,cancellation_reason_json FROM jobs WHERE id=? AND account_id=?',
      )
      .get(manifest.jobId, manifest.accountId);
    const metadata = {
      schema: 'native-short-metadata-compensation-registration-job/v1',
      originalJobId: payload.originalJobId,
      operatorJobId: payload.operatorJobId,
      authorityHash: manifest.authorityHash,
      policyHash: manifest.policyHash,
    };
    if (
      !job ||
      job.kind !== 'read' ||
      job.status !== 'succeeded' ||
      job.operation !== REGISTRATION_OPERATION ||
      job.scope !== scope ||
      !registrationSame(parse(job.datasets_json), [REGISTRATION_DATASET]) ||
      job.idempotency_key !== payload.originalJobId ||
      job.input_hash !== manifest.inputHash ||
      job.requested_at !== manifest.requestedAt ||
      job.started_at !== manifest.startedAt ||
      job.ended_at !== manifest.committedAt ||
      job.updated_at !== job.ended_at ||
      job.read_started_at !== null ||
      job.write_started_at !== null ||
      job.error_json !== null ||
      job.cancellation_requested_at !== null ||
      job.cancellation_reason_json !== null ||
      !registrationSame(parse(job.target_json), payload.target) ||
      !registrationSame(parse(job.metadata_json), metadata) ||
      !registrationSame(parse(job.result_json), { manifest })
    )
      fail('registration_job_invalid');
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    fail('registration_manifest_invalid');
  }
}

export function inside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function countProfile(directory) {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    fail('profile_directory_invalid');
  const counts = { profileFiles: 0, profileLinks: 0 };
  const queue = [directory];
  let entries = 0;
  while (queue.length) {
    const current = queue.pop();
    for (const name of readdirSync(current)) {
      if (++entries > 250_000) fail('profile_entry_limit');
      const filename = path.join(current, name);
      const info = lstatSync(filename);
      if (info.isSymbolicLink()) counts.profileLinks++;
      else if (info.isDirectory()) queue.push(filename);
      else if (info.isFile()) counts.profileFiles++;
      else fail('profile_entry_type_invalid');
    }
  }
  return counts;
}
