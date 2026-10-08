import * as body from '../../src/platform/short-native-body.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { createHash } from 'node:crypto';

import {
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
  type Job,
} from '../../src/runtime/store.js';

import * as proof from '../../src/platform/short-native-body-proof.js';

export const ACCOUNT = 'fixture-runtime',
  WORK = '7000000001',
  POLICY = body.NATIVE_SHORT_BODY_COMPARISON_POLICY_V2;

export const OLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const JOB = '11111111-1111-4111-8111-111111111111',
  READ = '33333333-3333-4333-8333-333333333333',
  MANIFEST = '55555555-5555-4555-8555-555555555555';

export const T = (n: number) => new Date(Date.parse('2026-10-04T00:00:00.000Z') + n).toISOString();

export const raw = (n = 500, version = 7, wordNumber: unknown = n) => ({
  binding: {
    account: { kind: 'account_id' as const, id: '9001' },
    work: { kind: 'short' as const, id: WORK },
  },
  editData: {
    item_id: WORK,
    publish_status: 0,
    content: `<p>${'甲'.repeat(n)}</p><p></p>`,
    word_number: wordNumber,
    multi_title: ['Synthetic title'],
    thumb_uri: 'synthetic-head',
    book_thumb_uri: 'synthetic-cover',
    category: [],
    sign_type: 1,
    origin_activity_flag: 0,
    latest_version: version,
    modify_time: '1789450000',
    opaque: { unchanged: true },
  },
  categoryData: {
    category_list: [{ category_id: 'c1', label: 'A', name: 'Synthetic' }],
    opaque_catalog: 'unchanged',
  },
});

// Explicit modern source fixture; the raw3 factory input above remains unchanged.
export const modernTuple4 = (value: ReturnType<typeof raw>) => {
  const snapshot = body.createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(value));
  return { ...value, statusFacts: structuredClone(snapshot.native.statusFacts) };
};

export const snapshot = (r = raw()) =>
  body.createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(r));

export const request = (
  s: body.NativeShortBodySnapshot,
  v2 = false,
): body.NativeShortBodyWriteRequest => ({
  expectedSnapshotVersionHash: s.snapshotVersionHash,
  hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
  expectedState: 'draft',
  representation: body.NATIVE_SHORT_BODY_REPRESENTATION,
  paragraphs: [
    { sourceIndex: null, lines: ['甲'.repeat(600)] },
    { sourceIndex: 1, lines: [''] },
  ],
  trial: { action: 'preserve' },
  ...(v2 ? { comparisonPolicy: POLICY } : {}),
});

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Data = Record<string, unknown>;

export const data = (v: unknown) => v as Data;

export const hashBytes = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function phase(n: number) {
  return {
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
      fixedSourceVerified: true,
      targetUnique: true,
      paginationComplete: true,
      atomicRevision: false as const,
      readStartedAt: T(n),
      readFinishedAt: T(n + 1),
      proofCapturedAt: T(n + 2),
    },
    requests: {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 1, disposed: 1 },
      edit: { attempts: 1, disposed: 1 },
      catalog: { attempts: 1, disposed: 1 },
    },
    list: { pagesRead: 1, rowsRead: 1, totalCount: 1 },
  };
}

export const clean = (n: number) => ({
  sessionCreated: true,
  sessionDisposed: true,
  pendingAtEnd: 0,
  disposalFailures: 0,
  quarantined: false,
  checkedAt: T(n),
});

const link = (r: EvidenceRef) => ({ id: r.id, sha256: r.sha256, capturedAt: r.capturedAt });

export function original() {
  const before = snapshot(),
    after = snapshot(raw(600, 8)),
    plan = body.planNativeShortBodyUpdate(before, request(before)),
    business = body.validateNativeShortBodyBusinessInput({
      target: { kind: 'short', workId: WORK },
      snapshotScope: body.NATIVE_SHORT_BODY_SCOPE,
      ...plan.expectation.writeRequest,
    });
  const inputHash = body.nativeShortBodyBusinessInputHash(ACCOUNT, business),
    refs: EvidenceRef[] = [],
    documents: EvidenceDocument[] = [],
    stages: proof.NativeShortBodyStageEvidence[] = [];
  const transport = {
    method: 'POST',
    url: 'https://fanqienovel.com/api/author/short_article/cover/v0/?aid=2503&app_name=muye_novel',
    contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
    maxRedirects: 0,
    maxRetries: 0,
    maxAttempts: 1,
  };
  const source = { mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' };
  function add(kind: proof.NativeShortBodyStageKind, n: number, payload: Data) {
    const id = `22222222-2222-4222-8222-${String(refs.length + 1).padStart(12, '0')}`,
      stage = proof.createNativeShortBodyStageEvidence({
        schema: 'native-short-body-stage/v1',
        scope: body.NATIVE_SHORT_BODY_SCOPE,
        kind,
        sequence: refs.length + 1,
        eventAt: T(n),
        priorStageHash: stages.length ? proof.nativeShortBodyGraphHash(stages.at(-1)) : null,
        accountId: ACCOUNT,
        jobId: JOB,
        inputHash,
        payload,
      });
    const document = {
      schemaVersion: 1,
      evidenceId: id,
      accountId: ACCOUNT,
      jobId: JOB,
      dataset: proof.NATIVE_SHORT_BODY_DATASETS[kind],
      capturedAt: T(n),
      collectionMode: 'fixture',
      evidenceKind: kind === 'intent' ? 'local-intent' : 'observation',
      payload: stage,
    } as EvidenceDocument;
    const ref = {
      id,
      accountId: ACCOUNT,
      jobId: JOB,
      dataset: document.dataset,
      capturedAt: T(n),
      path: `synthetic/${id}.json`,
      sha256: hashBytes(canonicalJson(document) + '\n'),
    };
    stages.push(stage);
    documents.push(document);
    refs.push(ref);
  }
  add('baseline', 7, {
    businessInput: business,
    native: modernTuple4(raw()),
    read: phase(3),
    source,
  });
  add('preSave', 12, {
    native: modernTuple4(raw()),
    read: phase(8),
    sourceVersionHash: plan.expectation.sourceVersionHash,
    desiredContentHash: plan.desiredContentHash,
  });
  add('intent', 13, {
    hashBasesHash: proof.nativeShortBodyHashBasesHash(),
    target: { kind: 'short-story', id: WORK },
    binding: before.binding,
    inputHash,
    sourceVersionHash: plan.expectation.sourceVersionHash,
    desiredContentHash: plan.desiredContentHash,
    baselineEvidence: link(refs[0]!),
    preSaveEvidence: link(refs[1]!),
    expectationHash: proof.nativeShortBodyGraphHash(plan.expectation),
    transport,
  });
  add('attempt', 14, { ordinal: 1, eventAt: T(14), intentEvidence: link(refs[2]!), transport });
  add('acknowledgement', 16, {
    observation: {
      schema: 'native-short-body-acknowledgement/v1',
      binding: before.binding,
      scope: body.NATIVE_SHORT_BODY_SCOPE,
      sourceVersionHash: before.snapshotVersionHash,
      desiredContentHash: plan.desiredContentHash,
      acknowledgedAt: T(16),
    },
    attemptEvidence: link(refs[3]!),
  });
  add('after', 20, {
    native: modernTuple4(raw(600, 8)),
    read: phase(17),
    comparison: body.compareNativeShortBodyReadback(plan.expectation, after),
  });
  const evidence = Object.fromEntries(
    ['baseline', 'preSave', 'intent', 'attempt', 'acknowledgement', 'after'].map((kind, i) => [
      kind,
      link(refs[i]!),
    ]),
  );
  add('result', 21, {
    schema: 'native-short-body-write-result/v1',
    outcome: 'unknown',
    reason: 'readback_mismatch',
    source,
    desiredContentHash: plan.desiredContentHash,
    preservationHash: plan.expectation.preservationHash,
    hashBasesHash: proof.nativeShortBodyHashBasesHash(),
    evidence,
    post: { attempts: 1, disposed: 1, startedAt: T(15), acknowledgedAt: T(16), acknowledged: true },
    ownerCheckedAt: T(18),
    cleanup: { ...clean(21), pendingAtEnd: 1, quarantined: true },
    atomicRevision: false,
  });
  const job = {
    id: JOB,
    accountId: ACCOUNT,
    ownerId: OLD,
    kind: 'write',
    operation: proof.NATIVE_SHORT_BODY_OPERATION,
    scope: proof.nativeShortBodyScope(WORK),
    datasets: [],
    idempotencyKey: 'synthetic-original-key',
    inputHash,
    status: 'uncertain',
    requestedAt: T(0),
    startedAt: T(1),
    platformReadStartedAt: T(2),
    platformWriteStartedAt: T(14),
    endedAt: T(22),
    updatedAt: T(22),
    result: { evidence: refs },
    error: {
      code: 'outcome_unknown',
      message: 'The platform write may have happened; reconcile before retrying.',
      details: {
        cause: { code: 'capability_unavailable', message: 'Native short body is unavailable.' },
      },
    },
    target: { kind: 'short-story', id: WORK },
    metadata: {},
    timeoutMs: 120000,
    deadlineAt: T(120001),
    cancellationRequestedAt: null,
    cancellationReason: null,
  } as Job;
  return {
    context: {
      accountId: ACCOUNT,
      job,
      manifest: null,
      refs,
      documents,
      attempts: [
        {
          jobId: JOB,
          accountId: ACCOUNT,
          ordinal: 1 as const,
          evidence: link(refs[3]!),
          eventAt: T(14),
        },
      ],
    },
    before,
    after,
    plan,
  };
}
