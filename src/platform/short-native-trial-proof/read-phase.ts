import { type NativeShortMetadataWriteReadPhase } from '../short-native-metadata-api.js';

import {
  exact,
  fail,
  time,
  order,
  integer,
  UUID,
  HASH,
  bytesHash,
  type NativeShortTrialEvidenceContext,
  copy,
  type NativeShortTrialBusinessInput,
  WORK,
  freeze,
  hash,
  NATIVE_SHORT_TRIAL_OPERATION,
  NATIVE_SHORT_TRIAL_READ_OPERATION,
  type Data,
} from './fail.js';

import { type EvidenceRef, type EvidenceDocument, canonicalJson } from '../../runtime/store.js';

import {
  NATIVE_SHORT_TRIAL_SCOPE,
  type NativeShortTrialWriteRequest,
  type NativeShortTrialSnapshot,
  validateNativeShortTrialSnapshot,
} from '../short-native-trial.js';

import { captureNativeShortTrialWriteRequest } from '../short-native-trial-api.js';

import { type StoredTrialSnapshot, storedTrialMath } from '../short-native-legacy-codec.js';

/** Held reads are intermediate fixed reads, never fabricated closed C1 reads. */
export function readPhase(input: unknown, complete: boolean): NativeShortMetadataWriteReadPhase {
  const d = exact(input, ['proof', 'requests', 'list']),
    p = exact(d.proof, [
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
  if (p.atomicRevision !== false) fail();
  for (const k of [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
  ])
    if (typeof p[k] !== 'boolean' || (complete && !p[k])) fail();
  for (const k of ['readStartedAt', 'readFinishedAt', 'proofCapturedAt'])
    if (p[k] !== null || complete) time(p[k]);
  if (complete) order([p.readStartedAt, p.readFinishedAt, p.proofCapturedAt]);
  const list = exact(d.list, ['pagesRead', 'rowsRead', 'totalCount']),
    pages = integer(list.pagesRead, 10),
    rows = integer(list.rowsRead, 100);
  if (list.totalCount !== null) integer(list.totalCount, 100);
  if (complete && (rows < 1 || rows !== list.totalCount || pages !== Math.ceil(rows / 10))) fail();
  const requests = exact(d.requests, ['own', 'list', 'edit', 'catalog']);
  for (const [k, max] of [
    ['own', 2],
    ['list', 10],
    ['edit', 1],
    ['catalog', 1],
  ] as const) {
    const c = exact(requests[k], ['attempts', 'disposed']);
    integer(c.attempts, max);
    integer(c.disposed, max);
    if (
      c.disposed > c.attempts ||
      (complete && (c.attempts !== (k === 'list' ? pages : max) || c.disposed !== c.attempts))
    )
      fail();
  }
  return d as NativeShortMetadataWriteReadPhase;
}

export function verifyRef(
  ref: EvidenceRef,
  document: EvidenceDocument,
  accountId: string,
  jobId: string,
): void {
  exact(ref, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
  exact(document, [
    'schemaVersion',
    'evidenceId',
    'accountId',
    'jobId',
    'dataset',
    'capturedAt',
    'collectionMode',
    'evidenceKind',
    'payload',
  ]);
  if (
    !UUID.test(ref.id) ||
    !HASH.test(ref.sha256) ||
    typeof ref.path !== 'string' ||
    ref.accountId !== accountId ||
    ref.jobId !== jobId ||
    document.schemaVersion !== 1 ||
    document.evidenceId !== ref.id ||
    document.accountId !== accountId ||
    document.jobId !== jobId ||
    document.dataset !== ref.dataset ||
    document.capturedAt !== ref.capturedAt ||
    !['live', 'fixture'].includes(document.collectionMode) ||
    document.evidenceKind !== (ref.dataset === 'write-intent' ? 'local-intent' : 'observation')
  )
    fail();
  time(ref.capturedAt);
  if (
    ref.capturedAt > new Date().toISOString() ||
    bytesHash(`${canonicalJson(document)}\n`) !== ref.sha256
  )
    fail();
}

export function checkedContext(input: unknown): NativeShortTrialEvidenceContext {
  // Individual documents own their resource budget; duplicate source snapshots do not reduce it.
  const descriptors = Object.getOwnPropertyDescriptors(input),
    keys = ['accountId', 'job', 'manifest', 'refs', 'documents', 'attempts'];
  if (
    !input ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length ||
    Object.keys(descriptors).length !== keys.length ||
    keys.some((k) => !descriptors[k]?.enumerable || !Object.hasOwn(descriptors[k]!, 'value'))
  )
    fail();
  const docs = descriptors.documents!.value;
  if (!Array.isArray(docs)) fail();
  const d = Object.getOwnPropertyDescriptors(docs) as Record<string, PropertyDescriptor>,
    names = Object.keys(d).filter((k) => k !== 'length');
  if (
    Object.getPrototypeOf(docs) !== Array.prototype ||
    Object.getOwnPropertySymbols(docs).length ||
    names.length !== d.length!.value ||
    names.some((k, i) => k !== String(i) || !d[k]!.enumerable || !Object.hasOwn(d[k]!, 'value')) ||
    names.length > 7
  )
    fail();
  const envelope = copy(
    {
      accountId: descriptors.accountId!.value,
      job: descriptors.job!.value,
      manifest: descriptors.manifest!.value,
      refs: descriptors.refs!.value,
      attempts: descriptors.attempts!.value,
    },
    512 * 1024,
  );
  return { ...envelope, documents: names.map((k) => copy(d[k]!.value, 32 * 1024 * 1024)) };
}

export function validateNativeShortTrialBusinessInput(
  input: unknown,
): NativeShortTrialBusinessInput {
  const d = exact(copy(input, 16_384), [
      'target',
      'snapshotScope',
      'hashBasis',
      'expectedSnapshotVersionHash',
      'expectedState',
      'metadata',
    ]),
    target = exact(d.target, ['kind', 'workId']);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !WORK.test(target.workId) ||
    d.snapshotScope !== NATIVE_SHORT_TRIAL_SCOPE
  )
    fail();
  const request = captureNativeShortTrialWriteRequest({
    expectedSnapshotVersionHash: d.expectedSnapshotVersionHash,
    hashBasis: d.hashBasis,
    expectedState: d.expectedState,
    metadata: d.metadata,
  });
  if (!request) fail();
  return freeze<NativeShortTrialBusinessInput>({
    target: { kind: 'short', workId: target.workId },
    snapshotScope: NATIVE_SHORT_TRIAL_SCOPE,
    ...request,
  });
}

export const nativeShortTrialBusinessInputHash = (input: NativeShortTrialBusinessInput): string =>
  hash({
    basis: 'native-short-trial-business-input/v1',
    business: validateNativeShortTrialBusinessInput(input),
  });

export function nativeShortTrialWriteRequest(
  input: NativeShortTrialBusinessInput,
): NativeShortTrialWriteRequest {
  const {
    target: _target,
    snapshotScope: _scope,
    ...request
  } = validateNativeShortTrialBusinessInput(input);
  return freeze(request);
}

/** Descriptor scanning reserves even unknown versions, mixed envelopes and inaccessible accessors. */
export function hasReservedNativeShortTrialSignal(input: unknown): boolean {
  const pending: unknown[] = [input],
    seen = new Set<object>();
  let nodes = 0;
  const reserved = (s: unknown) =>
    typeof s === 'string' &&
    (s.startsWith('native-short-trial') ||
      s.startsWith('fanqie-short-native-trial') ||
      s.startsWith('short_native_trial') ||
      s.startsWith('short-native-trial/') ||
      s === NATIVE_SHORT_TRIAL_OPERATION ||
      s === NATIVE_SHORT_TRIAL_READ_OPERATION);
  try {
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (++nodes > 200_000) return true;
      seen.add(value);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (
          ['schema', 'scope', 'snapshotScope', 'operation', 'dataset', 'datasets'].includes(key) &&
          !Object.hasOwn(descriptor, 'value')
        )
          return true;
        if (!Object.hasOwn(descriptor, 'value')) continue;
        const child = descriptor.value;
        if (
          ['schema', 'scope', 'snapshotScope', 'operation', 'dataset', 'datasets'].includes(key) &&
          (reserved(child) ||
            (Array.isArray(child) &&
              Object.values(Object.getOwnPropertyDescriptors(child)).some(
                (d) => Object.hasOwn(d, 'value') && reserved(d.value),
              )))
        )
          return true;
        if (key === 'trial' || key === 'trialRatio') return true;
        if (child && typeof child === 'object') pending.push(child);
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function sourceFields(input: unknown, keys: readonly string[]): Data {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    fail();
  const d = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(d).length !== keys.length ||
    keys.some((k) => !d[k]?.enumerable || !Object.hasOwn(d[k]!, 'value'))
  )
    fail();
  return Object.fromEntries(keys.map((k) => [k, d[k]!.value]));
}

export function assertExpected(input: unknown, expected: unknown): void {
  const active = new Set<object>();
  function visit(value: unknown, wanted: unknown): void {
    if (wanted === null || typeof wanted !== 'object') {
      if (!Object.is(value, wanted)) fail();
      return;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      active.has(value) ||
      Object.getOwnPropertySymbols(value).length
    )
      fail();
    const array = Array.isArray(wanted),
      proto = Object.getPrototypeOf(value);
    if (
      Array.isArray(value) !== array ||
      (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    )
      fail();
    const descriptors = Object.getOwnPropertyDescriptors(value),
      keys = Object.keys(wanted);
    const actual = Object.keys(descriptors).filter((k) => !array || k !== 'length');
    if (
      actual.length !== keys.length ||
      (array && descriptors.length?.value !== (wanted as unknown[]).length) ||
      actual.some((k, i) => array && k !== String(i)) ||
      keys.some((k) => !descriptors[k]?.enumerable || !Object.hasOwn(descriptors[k]!, 'value'))
    )
      fail();
    active.add(value);
    for (const k of keys) visit(descriptors[k]!.value, (wanted as Data)[k]);
    active.delete(value);
  }
  visit(input, expected);
}

export function trialSnapshot(value: unknown): NativeShortTrialSnapshot {
  try {
    return validateNativeShortTrialSnapshot(value);
  } catch {
    fail();
  }
}

export function storedSnapshot(
  value: unknown,
  mode?: StoredTrialSnapshot['mode'] | null,
): StoredTrialSnapshot {
  try {
    const decoded = storedTrialMath.decodeSnapshot(value);
    if (mode && decoded.mode !== mode) fail();
    return decoded;
  } catch {
    fail();
  }
}
