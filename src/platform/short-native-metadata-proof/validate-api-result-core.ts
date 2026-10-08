import {
  type StoredSnapshot,
  type StoredNativeShortMetadataApiResult,
  exact,
  copyNativeShortJson,
  reject,
  time,
  integer,
  ordered,
  ACCOUNT,
  WORK,
  HASH,
  type NativeShortProvenance,
  type NativeShortReadEvidence,
  NATIVE_SHORT_READ_SCHEMA,
  NATIVE_SHORT_ORIGIN,
  type StoredReadEvidence,
  equal,
  object,
} from './reject.js';

import {
  NATIVE_SHORT_API_REASONS,
  type NativeShortMetadataApiResult,
} from '../short-native-metadata-api.js';

import { writeSnapshot, storedSnapshot } from './validate-native-short-write-business-input.js';

import { NATIVE_SHORT_METADATA_SCOPE } from '../short-native-metadata.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
} from '../../runtime/store.js';

import { hasReservedNativeShortSignal } from './validate-native-short-evidence-context.js';

/** Includes complete raw/derived snapshot equality, not just selected hashes. */
function validateApiResultCore(
  input: unknown,
  expected: { accountId: string; workId: string } | undefined,
  decode: (input: unknown) => StoredSnapshot,
): StoredNativeShortMetadataApiResult {
  const result = exact(copyNativeShortJson(input), [
    'schema',
    'status',
    'reason',
    'snapshot',
    'proof',
    'requests',
    'list',
    'cleanup',
  ]);
  if (
    result.schema !== 'native-short-metadata-api-read/v1' ||
    !['success', 'capability_unavailable'].includes(result.status as string)
  )
    reject();
  const success = result.status === 'success';
  const proof = exact(result.proof, [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'ownerCallback',
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
    'atomicRevision',
    'readStartedAt',
    'readFinishedAt',
    'proofCapturedAt',
  ]);
  for (const name of [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'ownerCallback',
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
  ]) {
    if (typeof proof[name] !== 'boolean' || (success && proof[name] !== true)) reject();
  }
  if (proof.atomicRevision !== false) reject();
  for (const name of ['readStartedAt', 'readFinishedAt', 'proofCapturedAt'])
    if (success || proof[name] !== null) time(proof[name]);
  const requests = exact(result.requests, ['own', 'list', 'edit', 'catalog']);
  const list = exact(result.list, ['pagesRead', 'rowsRead', 'totalCount']);
  const pages = integer(list.pagesRead, 10),
    rows = integer(list.rowsRead, 100);
  if (list.totalCount !== null) integer(list.totalCount, 100);
  for (const [name, max] of [
    ['own', 2],
    ['list', 10],
    ['edit', 1],
    ['catalog', 1],
  ] as const) {
    const counts = exact(requests[name], ['attempts', 'disposed']);
    const attempts = integer(counts.attempts, max),
      disposed = integer(counts.disposed, max);
    if (
      disposed > attempts ||
      (success && (attempts !== (name === 'list' ? pages : max) || disposed !== attempts))
    )
      reject();
  }
  const cleanup = exact(result.cleanup, [
    'sessionCreated',
    'sessionDisposed',
    'pendingAtEnd',
    'disposalFailures',
    'quarantined',
    'checkedAt',
  ]);
  for (const name of ['sessionCreated', 'sessionDisposed', 'quarantined'])
    if (typeof cleanup[name] !== 'boolean') reject();
  integer(cleanup.pendingAtEnd);
  integer(cleanup.disposalFailures);
  time(cleanup.checkedAt);
  if (!success) {
    if (
      result.snapshot !== null ||
      !NATIVE_SHORT_API_REASONS.includes(result.reason as (typeof NATIVE_SHORT_API_REASONS)[number])
    )
      reject();
    return result as unknown as StoredNativeShortMetadataApiResult;
  }
  if (
    result.reason !== null ||
    list.totalCount === null ||
    rows < 1 ||
    rows !== list.totalCount ||
    pages !== Math.ceil(rows / 10) ||
    pages < 1 ||
    cleanup.sessionCreated !== true ||
    cleanup.sessionDisposed !== true ||
    cleanup.pendingAtEnd !== 0 ||
    cleanup.disposalFailures !== 0 ||
    cleanup.quarantined !== false
  )
    reject();
  ordered([proof.readStartedAt, proof.readFinishedAt, cleanup.checkedAt, proof.proofCapturedAt]);
  const snapshot = decode(result.snapshot);
  const binding = exact(snapshot.binding, ['account', 'work']);
  const account = exact(binding.account, ['kind', 'id']),
    work = exact(binding.work, ['kind', 'id']);
  if (
    account.kind !== 'account_id' ||
    typeof account.id !== 'string' ||
    !ACCOUNT.test(account.id) ||
    work.kind !== 'short' ||
    typeof work.id !== 'string' ||
    !WORK.test(work.id)
  )
    reject();
  if (expected && (account.id !== expected.accountId || work.id !== expected.workId)) reject();
  for (const name of [
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
  ] as const)
    if (typeof snapshot[name] !== 'string' || !HASH.test(snapshot[name] as string)) reject();
  return result as unknown as StoredNativeShortMetadataApiResult;
}

export function validateNativeShortApiResult(
  input: unknown,
  expected?: { accountId: string; workId: string },
): NativeShortMetadataApiResult {
  return validateApiResultCore(input, expected, writeSnapshot) as NativeShortMetadataApiResult;
}

/** @internal Stored proof only: exact old/new full shape, independently reconstructed. */
export function validateStoredNativeShortApiResult(
  input: unknown,
  expected?: { accountId: string; workId: string },
): StoredNativeShortMetadataApiResult {
  return validateApiResultCore(input, expected, storedSnapshot);
}

export function createNativeShortReadEvidence(
  result: NativeShortMetadataApiResult,
  provenance: NativeShortProvenance,
): NativeShortReadEvidence {
  return validateNativeShortReadEvidence({
    schema: NATIVE_SHORT_READ_SCHEMA,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    result,
    source: { origin: NATIVE_SHORT_ORIGIN, mode: provenance.mode },
    provenance,
  });
}

function validateReadEvidenceCore(
  input: unknown,
  validate: (input: unknown) => StoredNativeShortMetadataApiResult,
): StoredReadEvidence {
  const wrapper = exact(copyNativeShortJson(input), [
    'schema',
    'scope',
    'result',
    'source',
    'provenance',
  ]);
  if (wrapper.schema !== NATIVE_SHORT_READ_SCHEMA || wrapper.scope !== NATIVE_SHORT_METADATA_SCOPE)
    reject();
  const source = exact(wrapper.source, ['origin', 'mode']),
    provenance = exact(wrapper.provenance, ['executor', 'mode']);
  if (
    source.origin !== NATIVE_SHORT_ORIGIN ||
    !['live', 'fixture'].includes(source.mode as string) ||
    source.mode !== provenance.mode ||
    provenance.executor !==
      (source.mode === 'live' ? 'application-default-browser/v1' : 'dependency-injected-browser/v1')
  )
    reject();
  const result = validate(wrapper.result);
  if (result.status !== 'success') reject();
  return {
    schema: NATIVE_SHORT_READ_SCHEMA,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    result,
    source: source as NativeShortReadEvidence['source'],
    provenance: provenance as NativeShortProvenance,
  };
}

export function validateNativeShortReadEvidence(input: unknown): NativeShortReadEvidence {
  return validateReadEvidenceCore(input, validateNativeShortApiResult) as NativeShortReadEvidence;
}

export function validateStoredReadEvidence(input: unknown): StoredReadEvidence {
  return validateReadEvidenceCore(input, validateStoredNativeShortApiResult);
}

export interface NativeShortEvidenceContext {
  accountId: string;
  job: Job | null;
  manifest: Manifest | null;
  ref: EvidenceRef;
  document: EvidenceDocument;
}

/** A reserved value is valid only in an explicitly owned position of this read. */
export function rejectAdditionalNativeSignals(
  input: unknown,
  allowed: Map<string, unknown>,
  opaque: readonly string[] = [],
) {
  const pending: { value: unknown; path: string[] }[] = [{ value: input, path: [] }];
  while (pending.length) {
    const { value, path } = pending.pop()!;
    if (value === null || typeof value !== 'object' || opaque.includes(JSON.stringify(path)))
      continue;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (name === 'length' && Array.isArray(value)) continue;
      if (!Object.hasOwn(descriptor, 'value')) reject();
      const child = descriptor.value,
        childPath = [...path, name],
        key = JSON.stringify(childPath);
      if (
        ['schema', 'scope', 'operation', 'dataset', 'datasets'].includes(name) &&
        hasReservedNativeShortSignal({ [name]: child })
      ) {
        if (!allowed.has(key) || !equal(child, allowed.get(key))) reject();
      }
      pending.push({ value: child, path: childPath });
    }
  }
}

export function contextEnvelope(context: NativeShortEvidenceContext) {
  // Payload has its own full C1 resource/depth gate. Copy the remaining runtime
  // envelope separately so duplicate paths don't tighten that raw-data budget.
  if (
    context === null ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context)) ||
    Object.getOwnPropertySymbols(context).length
  )
    reject();
  const contextDescriptors = Object.getOwnPropertyDescriptors(context),
    contextFields = ['accountId', 'job', 'manifest', 'ref', 'document'];
  if (
    Object.keys(contextDescriptors).length !== contextFields.length ||
    contextFields.some(
      (name) =>
        !contextDescriptors[name] ||
        !contextDescriptors[name]!.enumerable ||
        !Object.hasOwn(contextDescriptors[name]!, 'value'),
    )
  )
    reject();
  const document = contextDescriptors.document!.value;
  if (
    document === null ||
    typeof document !== 'object' ||
    Array.isArray(document) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(document)) ||
    Object.getOwnPropertySymbols(document).length
  )
    reject();
  const descriptors = Object.getOwnPropertyDescriptors(document);
  const fields = [
    'schemaVersion',
    'evidenceId',
    'accountId',
    'jobId',
    'dataset',
    'capturedAt',
    'collectionMode',
    'evidenceKind',
    'payload',
  ];
  if (
    Object.keys(descriptors).length !== fields.length ||
    fields.some(
      (name) =>
        !descriptors[name] ||
        !descriptors[name]!.enumerable ||
        !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject();
  const head = Object.fromEntries(
    fields.filter((name) => name !== 'payload').map((name) => [name, descriptors[name]!.value]),
  );
  const envelope = object(
    copyNativeShortJson({
      accountId: contextDescriptors.accountId!.value,
      job: contextDescriptors.job!.value,
      manifest: contextDescriptors.manifest!.value,
      ref: contextDescriptors.ref!.value,
      document: head,
    }),
  );
  return { envelope, payload: descriptors.payload!.value as unknown };
}
