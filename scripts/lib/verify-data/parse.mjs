import { createHash } from 'node:crypto';

export class BackupValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const fail = (code) => {
  throw new BackupValidationError(code);
};

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

export const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export const dataset = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail('invalid_json');
  }
}

// Sealed local administration is a separate archive shape, never a platform read.
export const REGISTRATION_SCHEMA = 'native-short-metadata-compensation-registration-manifest/v1';

export const REGISTRATION_OPERATION = 'register_native_compensation_attestation';

export const REGISTRATION_DATASET = 'native_compensation_attestation';

const registrationScope = (value) =>
  typeof value === 'string' &&
  (value === REGISTRATION_DATASET || value.startsWith(`${REGISTRATION_DATASET}.`));

export const registrationSignal = (manifest, row, registrationJobs) =>
  registrationJobs.has(String(row.job_id)) ||
  registrationScope(row.scope) ||
  (plain(manifest) &&
    (manifest.schema === REGISTRATION_SCHEMA ||
      manifest.operation === REGISTRATION_OPERATION ||
      registrationScope(manifest.scope) ||
      (Array.isArray(manifest.datasets) && manifest.datasets.includes(REGISTRATION_DATASET)) ||
      (Array.isArray(manifest.evidence) &&
        manifest.evidence.some((ref) => plain(ref) && ref.dataset === REGISTRATION_DATASET))));

export const REGISTRATION_KEYS = [
  'schema',
  'id',
  'accountId',
  'jobId',
  'operation',
  'scope',
  'datasets',
  'inputHash',
  'requestedAt',
  'startedAt',
  'platformReadStartedAt',
  'platformWriteStartedAt',
  'committedAt',
  'evidence',
  'authorityHash',
  'policyHash',
];

export const ATTESTATION_KEYS = [
  'schema',
  'accountId',
  'originalJobId',
  'operatorJobId',
  'operatorBeforeReadJobId',
  'target',
  'originalInputHash',
  'originalEvidence',
  'originalAuditHash',
  'operatorBeforeEvidence',
  'operatorEvidence',
  'authority',
  'authorityHash',
  'policyHash',
  'approvedAt',
  'effectsEndedAt',
];

export const REF_KEYS = ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256'];

export const SAFE_REF_KEYS = REF_KEYS.filter((key) => key !== 'path');

export const REGISTRATION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export const REGISTRATION_HASH = /^[a-f0-9]{64}$/;

export const registrationExact = (value, keys) =>
  plain(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export const registrationString = (value, pattern) =>
  typeof value === 'string' && pattern.exec(value)?.[0] === value;

export const registrationTime = (value) =>
  timestamp(value) && new Date(value).toISOString() === value;

export function registrationCanonical(value) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 12000 || depth > 24) fail('registration_resource_invalid');
    if (Array.isArray(item)) return `[${item.map((child) => visit(child, depth + 1)).join(',')}]`;
    if (plain(item))
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(item[key], depth + 1)}`)
        .join(',')}}`;
    if (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      return JSON.stringify(item);
    fail('registration_json_invalid');
  }
  const encoded = visit(value, 0);
  if (Buffer.byteLength(encoded) > 64 * 1024) fail('registration_resource_invalid');
  return encoded;
}

export const registrationSame = (left, right) =>
  registrationCanonical(left) === registrationCanonical(right);

export function registrationOrdered(values) {
  if (
    values.some((value) => !registrationTime(value)) ||
    values.some((value, i) => i > 0 && value < values[i - 1])
  )
    fail('registration_times_invalid');
}

// Core bounds parsed receipt JSON; whitespace remains covered by its raw-byte hash.
function registrationBoundReceipt(value) {
  let nodes = 0,
    stringBytes = 0;
  function string(item, validate = true) {
    if (
      (validate &&
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(item)) ||
      (stringBytes += Buffer.byteLength(item)) > 32 * 1024
    )
      fail('registration_resource_invalid');
  }
  function visit(item, depth) {
    if (++nodes > 8192 || depth > 24) fail('registration_resource_invalid');
    if (typeof item === 'string') string(item);
    else if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) fail('registration_json_invalid');
    } else if (item !== null && typeof item === 'object')
      for (const name of Object.keys(item)) {
        string(name, false);
        visit(item[name], depth + 1);
      }
  }
  visit(value, 0);
  if (Buffer.byteLength(registrationCanonical(value)) > 32 * 1024)
    fail('registration_resource_invalid');
}

export function registrationAuthority(value, operatorId) {
  if (
    !registrationExact(value, ['policy', 'source', 'actor', 'controller', 'receipts']) ||
    !registrationExact(value.policy, ['basis', 'sha256']) ||
    value.policy.basis !== 'operator-title-restore-three-paths/v1' ||
    value.policy.sha256 !== 'bb6e9da2aab7977aad1edfeb270da0677f4ea87062694d95fa4a2348468f373c' ||
    !registrationExact(value.actor, ['sha256']) ||
    value.actor.sha256 !== 'd58fa26059041a7913ef5bf696064dcf66c8ea97de361814db2d149351aa1f1c' ||
    !registrationExact(value.controller, ['sha256']) ||
    value.controller.sha256 !== '76466487dfb1fe97e3acd4b01bf9546257051715532cac6490675c87364b0e93'
  )
    fail('registration_authority_invalid');
  const source = value.source;
  if (
    !registrationExact(source, [
      'executionManifestSha256',
      'executionInventory',
      'registrationManifestSha256',
      'registrationInventory',
    ]) ||
    !registrationString(source.executionManifestSha256, REGISTRATION_HASH) ||
    !registrationString(source.registrationManifestSha256, REGISTRATION_HASH)
  )
    fail('registration_authority_invalid');
  for (const key of ['executionInventory', 'registrationInventory']) {
    if (!plain(source[key])) fail('registration_authority_invalid');
    const entries = Object.entries(source[key]);
    if (
      entries.length !== 35 ||
      entries.some(
        ([name, sha256]) =>
          !registrationString(name, /^(src|test)\/[a-z0-9/.-]+\.ts$/) ||
          name.includes('..') ||
          !registrationString(sha256, REGISTRATION_HASH),
      ) ||
      !registrationSame(
        entries.map(([name]) => name).sort(),
        Object.keys(source.executionInventory).sort(),
      )
    )
      fail('registration_authority_invalid');
  }
  if (!registrationExact(value.receipts, ['actor', 'controller']))
    fail('registration_authority_invalid');
  const receipts = {};
  for (const key of ['actor', 'controller']) {
    const descriptor = value.receipts[key];
    if (
      !registrationExact(descriptor, ['sha256', 'bytes']) ||
      !registrationString(descriptor.sha256, REGISTRATION_HASH) ||
      typeof descriptor.bytes !== 'string' ||
      hash(descriptor.bytes) !== descriptor.sha256
    )
      fail('registration_receipt_hash_invalid');
    receipts[key] = parse(descriptor.bytes);
    if (!plain(receipts[key])) fail('registration_authority_invalid');
    registrationBoundReceipt(receipts[key]);
  }
  const actor = receipts.actor,
    controller = receipts.controller;
  if (
    actor.schema !== 'fanqie-c3-operator-title-restoration-safe/v1' ||
    controller.schema !== 'fanqie-c3-operator-title-restoration-controller-safe/v1' ||
    actor.operatorJobId !== operatorId ||
    !registrationString(actor.runId, REGISTRATION_UUID) ||
    controller.runId !== actor.runId ||
    !registrationSame(controller.operatorSafe, actor) ||
    controller.operatorOutputSafe?.sha256 !== value.receipts.actor.sha256 ||
    controller.approvedInputs?.sourceManifest?.sha256 !== source.executionManifestSha256
  )
    fail('registration_authority_invalid');
  // Receipt hashes/links and time are archive integrity checks, not ACK replay.
  registrationOrdered([actor.completedAt, controller.completedAt]);
  return controller.completedAt;
}
