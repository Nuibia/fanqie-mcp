import {
  type NativeShortWriteBusinessInput,
  digest,
  NATIVE_SHORT_COMPARISON_BASIS,
} from './validate-native-short-evidence-context.js';

import {
  object,
  copyBoundedNativeJson,
  reject,
  exact,
  WORK,
  HASH,
  type StoredSnapshot,
  type NativeShortReadEvidence,
  type NativeShortProvenance,
  type Data,
  NATIVE_SHORT_ORIGIN,
  ordered,
  integer,
  time,
} from './reject.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataRequest,
  type WriteExpectation,
  nativeShortMetadataDesiredContentHash,
  type WriteComparison,
  NATIVE_SHORT_WRITE_HASH_BASES_V2,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  type NativeShortMetadataHeldBefore,
  type NativeShortMetadataApiWriteResult,
} from '../short-native-metadata-api.js';

import { storedMetadataMath } from '../short-native-legacy-codec.js';

import { resolveShortEditorStatus } from '../short-status.js';

import { type EvidenceRef } from '../../runtime/store.js';

/** Local shape validation only. Catalog membership, locks and version require a fresh held before. */
export function validateNativeShortWriteBusinessInput(
  input: unknown,
): NativeShortWriteBusinessInput {
  const data = object(
    copyBoundedNativeJson(
      input,
      NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes,
      NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth,
    ),
  );
  const required = [
    'target',
    'snapshotScope',
    'hashBasis',
    'expectedSnapshotVersionHash',
    'expectedState',
  ];
  if (
    required.some((name) => !Object.hasOwn(data, name)) ||
    Object.keys(data).some((name) => ![...required, 'title', 'metadata'].includes(name))
  )
    reject();
  const target = exact(data.target, ['kind', 'workId']);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !WORK.test(target.workId) ||
    data.snapshotScope !== NATIVE_SHORT_METADATA_SCOPE ||
    data.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
    typeof data.expectedSnapshotVersionHash !== 'string' ||
    !HASH.test(data.expectedSnapshotVersionHash) ||
    data.expectedState !== 'draft'
  )
    reject();
  if (
    Object.hasOwn(data, 'title') &&
    (typeof data.title !== 'string' ||
      !data.title.trim() ||
      /[\r\n\u0000]/u.test(data.title) ||
      Buffer.byteLength(data.title) > NATIVE_SHORT_RESOURCE_LIMITS.newTitleUtf8Bytes)
  )
    reject();
  let categories = false;
  if (Object.hasOwn(data, 'metadata')) {
    const metadata = object(data.metadata);
    if (Object.keys(metadata).some((name) => name !== 'categories')) reject();
    categories = Object.hasOwn(metadata, 'categories');
    if (
      categories &&
      (!Array.isArray(metadata.categories) ||
        !metadata.categories.length ||
        metadata.categories.length > NATIVE_SHORT_RESOURCE_LIMITS.categoryCount ||
        metadata.categories.some(
          (value) => typeof value !== 'string' || !value.trim() || /[,\r\n\u0000]/u.test(value),
        ) ||
        new Set(metadata.categories).size !== metadata.categories.length)
    )
      reject();
  }
  if (!Object.hasOwn(data, 'title') && !categories) reject();
  return data as unknown as NativeShortWriteBusinessInput;
}

export function nativeShortWriteRequest(
  input: NativeShortWriteBusinessInput,
): NativeShortMetadataRequest {
  const data = validateNativeShortWriteBusinessInput(input);
  return {
    expectedSnapshotVersionHash: data.expectedSnapshotVersionHash,
    hashBasis: data.hashBasis,
    expectedState: data.expectedState,
    ...(Object.hasOwn(data, 'title') ? { title: data.title } : {}),
    ...(Object.hasOwn(data, 'metadata') ? { metadata: data.metadata } : {}),
  };
}

export const nativeShortWriteInputHash = (input: NativeShortWriteBusinessInput) =>
  digest(validateNativeShortWriteBusinessInput(input));

export function nativeShortDesiredContentHash(expectation: WriteExpectation): string {
  return nativeShortMetadataDesiredContentHash(expectation);
}

export const NATIVE_SHORT_COMPARISON_BASIS_V2 = 'native-short-metadata-desired-and-preservation/v2';

export function carrierVersion(value: unknown, prefix: string): 1 | 2 {
  if (value === `${prefix}/v1`) return 1;
  if (value === `${prefix}/v2`) return 2;
  return reject();
}

export const carrier = (prefix: string, version: 1 | 2) => `${prefix}/v${version}`;

export const comparisonBasis = (version: 1 | 2) =>
  version === 1 ? NATIVE_SHORT_COMPARISON_BASIS : NATIVE_SHORT_COMPARISON_BASIS_V2;

export const expectationVersion = (value: WriteExpectation): 1 | 2 =>
  'version' in value && value.version === 2 ? 2 : 1;

export function observedExpectation(
  expected: WriteExpectation,
  snapshot: StoredSnapshot,
  comparison: WriteComparison,
): WriteExpectation {
  const actual = comparison.actual;
  // The server BEFORE pair and policy stay bound to the original expectation.
  return {
    ...expected,
    binding: snapshot.binding,
    expectedState: snapshot.state as 'draft',
    catalogHash: actual.catalogHash,
    documentHash: actual.documentHash,
    savedFieldsHash: actual.savedFieldsHash,
    preservationHash: actual.preservationHash,
    categorySelectionHash: actual.categorySelectionHash,
  };
}

export interface NativeShortBaselineEvidence {
  schema: 'native-short-metadata-held-before/v1' | 'native-short-metadata-held-before/v2';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  held: NativeShortMetadataHeldBefore;
  businessInput: NativeShortWriteBusinessInput;
  source: NativeShortReadEvidence['source'];
  provenance: NativeShortProvenance;
}

export type EvidenceLink = { id: string; sha256: string };

export interface NativeShortWriteIntent {
  schema: 'native-short-metadata-intent/v1' | 'native-short-metadata-intent/v2';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  hashBases: typeof NATIVE_SHORT_HASH_BASES | typeof NATIVE_SHORT_WRITE_HASH_BASES_V2;
  binding: NativeShortMetadataSnapshot['binding'];
  target: { kind: 'short-story'; id: string };
  expectedSnapshotVersionHash: string;
  expectation: WriteExpectation;
  baselineEvidence: EvidenceLink;
  comparisonBasis: typeof NATIVE_SHORT_COMPARISON_BASIS | typeof NATIVE_SHORT_COMPARISON_BASIS_V2;
  desiredContentHash: string;
  expectedStates: ['draft_saved'];
}

export interface NativeShortCleanAfterEvidence {
  schema: 'native-short-metadata-clean-after/v1' | 'native-short-metadata-clean-after/v2';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  result: Omit<NativeShortMetadataApiWriteResult, 'held'>;
  baselineEvidence: EvidenceLink;
  intentEvidence: EvidenceLink;
  source: NativeShortReadEvidence['source'];
  provenance: NativeShortProvenance;
}

export interface NativeShortWriteResultEvidence {
  schema: 'native-short-metadata-write-result/v1' | 'native-short-metadata-write-result/v2';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  baselineEvidence: EvidenceLink;
  intentEvidence: EvidenceLink;
  afterEvidence: EvidenceLink;
  business: Record<string, unknown>;
}

export function provenanceFields(data: Data) {
  const source = exact(data.source, ['origin', 'mode']),
    provenance = exact(data.provenance, ['executor', 'mode']);
  if (
    source.origin !== NATIVE_SHORT_ORIGIN ||
    !['live', 'fixture'].includes(source.mode as string) ||
    source.mode !== provenance.mode ||
    provenance.executor !==
      (source.mode === 'live' ? 'application-default-browser/v1' : 'dependency-injected-browser/v1')
  )
    reject();
  return {
    source: source as NativeShortReadEvidence['source'],
    provenance: provenance as NativeShortProvenance,
  };
}

export function storedSnapshot(value: unknown): StoredSnapshot {
  try {
    return storedMetadataMath.decodeSnapshot(value).snapshot;
  } catch {
    return reject();
  }
}

export function writeSnapshot(value: unknown): NativeShortMetadataSnapshot {
  try {
    const d = storedMetadataMath.decodeSnapshot(value);
    if (d.mode !== 'modern') reject();
    return d.snapshot;
  } catch {
    return reject();
  }
}

export function compareStored(
  expected: WriteExpectation,
  snapshot: StoredSnapshot,
): WriteComparison {
  try {
    return storedMetadataMath.compareReadbackVersioned(
      expected,
      storedMetadataMath.decodeSnapshot(snapshot),
    );
  } catch {
    return reject();
  }
}

export function snapshotStatus(snapshot: StoredSnapshot) {
  const facts = resolveShortEditorStatus(snapshot.editData);
  return { state: facts.resolvedState, statusFacts: facts };
}

export function statusProjection(
  snapshot: StoredSnapshot,
  ref: EvidenceRef,
  phase: 'read' | 'baseline' | 'pre_save' | 'after' | 'later_read' | 'compensation_read',
) {
  return {
    ...snapshotStatus(snapshot),
    statusSource: {
      phase,
      sourceRef: ref.id,
      evidenceHash: ref.sha256,
      evidenceCapturedAt: ref.capturedAt,
    },
  };
}

export function writeReadPhase(value: unknown) {
  const phase = exact(value, ['proof', 'requests', 'list']);
  const proof = exact(phase.proof, [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
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
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
  ])
    if (proof[name] !== true) reject();
  if (proof.atomicRevision !== false) reject();
  ordered([proof.readStartedAt, proof.readFinishedAt, proof.proofCapturedAt]);
  const list = exact(phase.list, ['pagesRead', 'rowsRead', 'totalCount']);
  const pages = integer(list.pagesRead, 10),
    rows = integer(list.rowsRead, 100);
  if (
    rows < 1 ||
    rows !== integer(list.totalCount, 100) ||
    pages < 1 ||
    pages !== Math.ceil(rows / 10)
  )
    reject();
  const requests = exact(phase.requests, ['own', 'list', 'edit', 'catalog']);
  for (const [name, expected] of [
    ['own', 2],
    ['list', pages],
    ['edit', 1],
    ['catalog', 1],
  ] as const) {
    const counts = exact(requests[name], ['attempts', 'disposed']);
    if (integer(counts.attempts, 10) !== expected || integer(counts.disposed, 10) !== expected)
      reject();
  }
  return { phase, proof, requests, list };
}

export function writeCleanup(value: unknown, disposed: boolean) {
  const cleanup = exact(value, [
    'sessionCreated',
    'sessionDisposed',
    'pendingAtEnd',
    'disposalFailures',
    'quarantined',
    'checkedAt',
  ]);
  if (
    cleanup.sessionCreated !== true ||
    cleanup.sessionDisposed !== disposed ||
    cleanup.pendingAtEnd !== 0 ||
    cleanup.disposalFailures !== 0 ||
    cleanup.quarantined !== false
  )
    reject();
  time(cleanup.checkedAt);
  return cleanup;
}

export const evidenceLink = (ref: EvidenceRef): EvidenceLink => ({
  id: ref.id,
  sha256: ref.sha256,
});
