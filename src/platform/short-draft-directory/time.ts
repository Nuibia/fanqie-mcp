import {
  isShortDraftDirectoryTime,
  invalid,
  type ShortDraftDirectoryReason,
  type ShortDraftDirectoryResult,
  SHORT_DRAFT_DIRECTORY_OWN_URL,
  type ShortDraftDirectoryRecord,
  exact,
  string,
  ITEM,
  type Common,
  SHORT_DRAFT_DIRECTORY_REASONS,
  type ShortDraftDirectoryCoverage,
  count,
  flag,
  type ShortDraftDirectoryProof,
  type Counters,
  ACCOUNT,
  array,
} from './unicode.js';

import { shortMetadataApiListUrl } from '../short-metadata-api-schema.js';

export function time(value: unknown): string {
  if (!isShortDraftDirectoryTime(value)) return invalid();
  return value;
}

export function nullableTime(value: unknown): string | null {
  return value === null ? null : time(value);
}

export function freeze<T>(value: T): T {
  const pending: unknown[] = [value],
    seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== 'object' || seen.has(next)) continue;
    if (seen.size > 2048) return invalid();
    seen.add(next);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(next)))
      if (
        Object.hasOwn(descriptor, 'value') &&
        descriptor.value &&
        typeof descriptor.value === 'object'
      )
        pending.push(descriptor.value);
    Object.freeze(next);
  }
  return value;
}

export function initial(
  reason: ShortDraftDirectoryReason,
  transport: ShortDraftDirectoryResult['provenance']['transport'],
): ShortDraftDirectoryResult {
  return {
    schema: 'short-draft-directory-api/v1',
    status: 'capability_unavailable',
    reason,
    records: [],
    owner: null,
    provenance: { transport },
    coverage: {
      pageSize: 10,
      firstPageIndex: 0,
      pagesRead: 0,
      rowsRead: 0,
      declaredTotal: null,
      complete: false,
      atomicRevision: false,
      readStartedAt: null,
      readFinishedAt: null,
      proofCapturedAt: null,
    },
    proof: {
      platformStarted: false,
      ownerBefore: false,
      ownerAfter: false,
      ownerCallback: false,
      fixedSourceVerified: false,
      paginationComplete: false,
      ownerCheckedAt: null,
    },
    requests: { own: { attempts: 0, disposed: 0 }, list: { attempts: 0, disposed: 0 } },
    transport: { redirects: 0, responseFailures: 0, oversizeResponses: 0 },
    cleanup: {
      sessionCreated: false,
      sessionDisposed: false,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: new Date().toISOString(),
    },
  };
}

export function shortDraftDirectoryReadUrl(kind: 'own' | 'list', pageIndex?: number): string {
  if (kind === 'own' && pageIndex === undefined) return SHORT_DRAFT_DIRECTORY_OWN_URL;
  if (kind === 'list' && pageIndex !== undefined) return shortMetadataApiListUrl(pageIndex);
  return invalid();
}

function copyRecord(value: unknown): ShortDraftDirectoryRecord {
  const row = exact(value, ['id', 'title', 'publicationStatus', 'signingStatus', 'listingScope']),
    id = exact(row.id, ['namespace', 'value']);
  if (
    id.namespace !== 'native_short_item' ||
    !string(id.value, 22) ||
    !ITEM.test(id.value) ||
    row.title !== null ||
    row.publicationStatus !== 'unknown' ||
    row.signingStatus !== 'unknown' ||
    row.listingScope !== 'own_draft_list'
  )
    return invalid();
  return {
    id: { namespace: 'native_short_item', value: id.value },
    title: null,
    publicationStatus: 'unknown',
    signingStatus: 'unknown',
    listingScope: 'own_draft_list',
  };
}

export function readCommon(value: Record<string, unknown>): Common {
  if (value.status !== 'success' && value.status !== 'capability_unavailable') return invalid();
  if (
    value.status === 'success'
      ? value.reason !== null
      : typeof value.reason !== 'string' ||
        !SHORT_DRAFT_DIRECTORY_REASONS.includes(value.reason as ShortDraftDirectoryReason)
  )
    return invalid();
  const c = exact(value.coverage, [
    'pageSize',
    'firstPageIndex',
    'pagesRead',
    'rowsRead',
    'declaredTotal',
    'complete',
    'atomicRevision',
    'readStartedAt',
    'readFinishedAt',
    'proofCapturedAt',
  ]);
  if (
    c.pageSize !== 10 ||
    c.firstPageIndex !== 0 ||
    Object.is(c.firstPageIndex, -0) ||
    c.atomicRevision !== false
  )
    return invalid();
  const coverage: ShortDraftDirectoryCoverage = {
    pageSize: 10,
    firstPageIndex: 0,
    pagesRead: count(c.pagesRead, 10),
    rowsRead: count(c.rowsRead, 100),
    declaredTotal: c.declaredTotal === null ? null : count(c.declaredTotal, 100),
    complete: flag(c.complete),
    atomicRevision: false,
    readStartedAt: nullableTime(c.readStartedAt),
    readFinishedAt: nullableTime(c.readFinishedAt),
    proofCapturedAt: nullableTime(c.proofCapturedAt),
  };
  const p = exact(value.proof, [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'ownerCallback',
    'fixedSourceVerified',
    'paginationComplete',
    'ownerCheckedAt',
  ]);
  const proof: ShortDraftDirectoryProof = {
    platformStarted: flag(p.platformStarted),
    ownerBefore: flag(p.ownerBefore),
    ownerAfter: flag(p.ownerAfter),
    ownerCallback: flag(p.ownerCallback),
    fixedSourceVerified: flag(p.fixedSourceVerified),
    paginationComplete: flag(p.paginationComplete),
    ownerCheckedAt: nullableTime(p.ownerCheckedAt),
  };
  const q = exact(value.requests, ['own', 'list']);
  function counters(input: unknown, max: number): Counters {
    const v = exact(input, ['attempts', 'disposed']);
    const out = { attempts: count(v.attempts, max), disposed: count(v.disposed, max) };
    if (out.disposed > out.attempts) return invalid();
    return out;
  }
  const requests = { own: counters(q.own, 2), list: counters(q.list, 10) };
  const t = exact(value.transport, ['redirects', 'responseFailures', 'oversizeResponses']);
  const transport = {
    redirects: count(t.redirects, 12),
    responseFailures: count(t.responseFailures, 12),
    oversizeResponses: count(t.oversizeResponses, 12),
  };
  const k = exact(value.cleanup, [
    'sessionCreated',
    'sessionDisposed',
    'pendingAtEnd',
    'disposalFailures',
    'quarantined',
    'checkedAt',
  ]);
  const cleanup = {
    sessionCreated: flag(k.sessionCreated),
    sessionDisposed: flag(k.sessionDisposed),
    pendingAtEnd: count(k.pendingAtEnd, 32),
    disposalFailures: count(k.disposalFailures, 13),
    quarantined: flag(k.quarantined),
    checkedAt: time(k.checkedAt),
  };
  let owner: Common['owner'] = null;
  if (value.owner !== null) {
    const o = exact(value.owner, ['kind', 'id']);
    if (o.kind !== 'account' || !string(o.id, 30) || !ACCOUNT.test(o.id)) return invalid();
    owner = { kind: 'account', id: o.id };
  }
  const records = array(value.records, 100).map(copyRecord),
    ids = records.map((row) => row.id.value);
  if (
    new Set(ids).size !== ids.length ||
    coverage.pagesRead > requests.list.attempts ||
    proof.platformStarted !== requests.own.attempts + requests.list.attempts > 0 ||
    proof.platformStarted !== (coverage.readStartedAt !== null)
  )
    return invalid();
  if (
    (proof.ownerBefore && (!owner || requests.own.attempts < 1)) ||
    (proof.ownerAfter && (!proof.ownerBefore || requests.own.attempts !== 2)) ||
    (requests.list.attempts > 0 && !proof.ownerBefore)
  )
    return invalid();
  if (
    (cleanup.sessionDisposed && !cleanup.sessionCreated) ||
    (!cleanup.sessionCreated && proof.platformStarted) ||
    cleanup.quarantined !== cleanup.disposalFailures > 0
  )
    return invalid();
  if (
    proof.ownerCallback !== (proof.ownerCheckedAt !== null) ||
    coverage.proofCapturedAt !== proof.ownerCheckedAt ||
    (coverage.readFinishedAt !== null &&
      (!proof.ownerAfter || !proof.paginationComplete || !proof.fixedSourceVerified))
  )
    return invalid();
  if (
    (coverage.readStartedAt && coverage.readStartedAt > cleanup.checkedAt) ||
    (coverage.readFinishedAt &&
      (coverage.readStartedAt === null ||
        coverage.readFinishedAt < coverage.readStartedAt ||
        coverage.readFinishedAt > cleanup.checkedAt)) ||
    (proof.ownerCheckedAt && proof.ownerCheckedAt < cleanup.checkedAt)
  )
    return invalid();
  if (
    coverage.rowsRead > (coverage.declaredTotal ?? 0) ||
    (coverage.pagesRead === 0 && coverage.rowsRead !== 0)
  )
    return invalid();
  if (value.status === 'success') {
    const total = coverage.declaredTotal;
    if (
      !owner ||
      total === null ||
      !coverage.complete ||
      coverage.atomicRevision !== false ||
      records.length !== total ||
      coverage.rowsRead !== total ||
      coverage.pagesRead !== Math.max(1, Math.ceil(total / 10)) ||
      requests.list.attempts !== coverage.pagesRead ||
      requests.list.disposed !== requests.list.attempts ||
      requests.own.attempts !== 2 ||
      requests.own.disposed !== 2 ||
      Object.values(transport).some((n) => n !== 0) ||
      !proof.platformStarted ||
      !proof.ownerBefore ||
      !proof.ownerAfter ||
      !proof.ownerCallback ||
      !proof.fixedSourceVerified ||
      !proof.paginationComplete ||
      !coverage.readFinishedAt ||
      !coverage.proofCapturedAt ||
      !cleanup.sessionCreated ||
      !cleanup.sessionDisposed ||
      cleanup.pendingAtEnd !== 0 ||
      cleanup.disposalFailures !== 0 ||
      cleanup.quarantined
    )
      return invalid();
  } else if (records.length !== 0 || coverage.complete || proof.ownerCallback) return invalid();
  return {
    status: value.status,
    reason: value.reason as Common['reason'],
    records,
    owner,
    coverage,
    proof,
    requests,
    transport,
    cleanup,
  };
}

export const COMMON_KEYS = [
  'status',
  'reason',
  'records',
  'owner',
  'coverage',
  'proof',
  'requests',
  'transport',
  'cleanup',
] as const;
