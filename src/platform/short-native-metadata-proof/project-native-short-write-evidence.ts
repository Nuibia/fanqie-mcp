import {
  type NativeShortWriteEvidenceContext,
  type NativeShortWriteProjection,
  WRITE_DATASETS,
  safeWriteRef,
  createWriteResultCore,
} from './clean-after-business.js';

import {
  reject,
  type Data,
  copyBoundedNativeJson,
  object,
  copyNativeShortJson,
  UUID,
  HASH,
  equal,
  time,
  ordered,
  nativeShortReadScope,
  exact,
  type StoredAfter,
} from './reject.js';

import {
  type EvidenceDocument,
  type Job,
  type EvidenceRef,
  canonicalJson,
} from '../../runtime/store.js';

import { NATIVE_SHORT_RESOURCE_LIMITS } from '../short-native-metadata.js';

import {
  NATIVE_SHORT_WRITE_OPERATION,
  NATIVE_SHORT_AFTER_DATASET,
  NATIVE_SHORT_BASELINE_DATASET,
} from './validate-native-short-evidence-context.js';

import { createHash } from 'node:crypto';

import {
  carrierVersion,
  carrier,
  nativeShortWriteInputHash,
  type NativeShortWriteResultEvidence,
  storedSnapshot,
  statusProjection,
  expectationVersion,
  snapshotStatus,
  comparisonBasis,
} from './validate-native-short-write-business-input.js';

import { rejectAdditionalNativeSignals } from './validate-api-result-core.js';

import { validateStoredBaseline, validateIntentCore } from './link.js';

import { validateAfterCore, nativeShortSnapshotBusiness } from './validate-after-core.js';

/** Independent write cardinality and stage contracts; never fabricates a C2 read manifest. */
export function projectNativeShortWriteEvidence(
  context: NativeShortWriteEvidenceContext,
): NativeShortWriteProjection {
  const descriptors = Object.getOwnPropertyDescriptors(context),
    fields = ['accountId', 'job', 'manifest', 'refs', 'documents'];
  if (
    !context ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context)) ||
    Object.getOwnPropertySymbols(context).length ||
    Object.keys(descriptors).length !== fields.length ||
    fields.some(
      (name) =>
        !descriptors[name] ||
        !descriptors[name]!.enumerable ||
        !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject();
  const heads: Data[] = [],
    payloads: unknown[] = [];
  if (
    !Array.isArray(context.documents) ||
    Object.getPrototypeOf(context.documents) !== Array.prototype ||
    Object.getOwnPropertySymbols(context.documents).length
  )
    reject();
  const arrayDescriptors = Object.getOwnPropertyDescriptors(context.documents) as Record<
    string,
    PropertyDescriptor
  >;
  const arrayNames = Object.keys(arrayDescriptors).filter((name) => name !== 'length');
  if (
    arrayNames.length !== arrayDescriptors.length!.value ||
    arrayNames.some(
      (name, index) =>
        name !== String(index) ||
        !arrayDescriptors[name]!.enumerable ||
        !Object.hasOwn(arrayDescriptors[name]!, 'value'),
    )
  )
    reject();
  for (const name of arrayNames) {
    const document = arrayDescriptors[name]!.value as EvidenceDocument;
    const d = Object.getOwnPropertyDescriptors(document),
      names = [
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
      !document ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(document)) ||
      Object.getOwnPropertySymbols(document).length ||
      Object.keys(d).length !== names.length ||
      names.some((name) => !d[name] || !d[name]!.enumerable || !Object.hasOwn(d[name]!, 'value'))
    )
      reject();
    heads.push(
      Object.fromEntries(
        names.filter((name) => name !== 'payload').map((name) => [name, d[name]!.value]),
      ),
    );
    const index = payloads.length;
    payloads.push(
      copyBoundedNativeJson(
        d.payload!.value,
        index === 1
          ? 16384
          : (index === 0 ? 5 : 4) * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 128 * 1024,
        index === 1 ? 4096 : 5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
        index === 1 ? 20 : NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
      ),
    );
  }
  const envelope = object(
    copyNativeShortJson({
      accountId: context.accountId,
      job: context.job,
      manifest: context.manifest,
      refs: context.refs,
      documents: heads,
    }),
  );
  const job = envelope.job as Job,
    refs = envelope.refs as EvidenceRef[],
    documents = envelope.documents as EvidenceDocument[];
  const workId = /^short_native_metadata\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  if (
    !workId ||
    job.kind !== 'write' ||
    job.operation !== NATIVE_SHORT_WRITE_OPERATION ||
    job.accountId !== envelope.accountId ||
    !UUID.test(job.id) ||
    !HASH.test(job.inputHash) ||
    !equal(job.datasets, []) ||
    envelope.manifest !== null ||
    ![
      'queued',
      'running',
      'failed',
      'cancelled',
      'waiting_for_login',
      'uncertain',
      'succeeded',
    ].includes(job.status)
  )
    reject();
  time(job.requestedAt);
  time(job.updatedAt);
  if (job.startedAt !== null) ordered([job.requestedAt, job.startedAt, job.updatedAt]);
  if (
    job.endedAt !== null &&
    (job.updatedAt !== time(job.endedAt) || job.requestedAt > job.endedAt)
  )
    reject();
  if (job.deadlineAt !== null) time(job.deadlineAt);
  if (!Number.isSafeInteger(job.timeoutMs) || job.timeoutMs < 1 || job.timeoutMs > 2_147_483_647)
    reject();
  if (
    refs.length > 4 ||
    refs.length !== documents.length ||
    refs.some((ref, index) => ref.dataset !== WRITE_DATASETS[index]) ||
    new Set(refs.map((ref) => ref.id)).size !== refs.length
  )
    reject();
  const allowed = new Map<string, unknown>([
    [JSON.stringify(['job', 'scope']), nativeShortReadScope(workId)],
  ]);
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index]!,
      document = documents[index]!;
    exact(ref, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
    if (
      !UUID.test(ref.id) ||
      !HASH.test(ref.sha256) ||
      ref.accountId !== job.accountId ||
      document.accountId !== job.accountId ||
      ref.jobId !== job.id ||
      document.jobId !== job.id ||
      document.schemaVersion !== 1 ||
      document.evidenceId !== ref.id ||
      document.dataset !== ref.dataset ||
      document.capturedAt !== ref.capturedAt ||
      document.evidenceKind !== (index === 1 ? 'local-intent' : 'observation') ||
      !['live', 'fixture'].includes(document.collectionMode)
    )
      reject();
    time(ref.capturedAt);
    if (index > 0 && refs[index - 1]!.capturedAt > ref.capturedAt) reject();
    const bytesHash = createHash('sha256')
      .update(`${canonicalJson({ ...document, payload: payloads[index] })}\n`)
      .digest('hex');
    if (bytesHash !== ref.sha256) reject();
    if (index === 0 || index === 2) {
      allowed.set(JSON.stringify(['refs', String(index), 'dataset']), ref.dataset);
      allowed.set(JSON.stringify(['documents', String(index), 'dataset']), ref.dataset);
    }
  }
  if (job.status === 'succeeded') {
    const version = carrierVersion(object(payloads[0]).schema, 'native-short-metadata-held-before');
    allowed.set(
      JSON.stringify(['job', 'result', 'schema']),
      carrier('native-short-metadata-write-result', version),
    );
    allowed.set(
      JSON.stringify(['job', 'result', 'business', 'schema']),
      carrier('fanqie-short-native-metadata-write-business', version),
    );
    allowed.set(
      JSON.stringify(['job', 'result', 'business', 'dataset']),
      NATIVE_SHORT_AFTER_DATASET,
    );
  } else if (job.result !== null) {
    const failure = exact(job.result, ['evidence']);
    if (!equal(failure.evidence, refs)) reject();
    for (let index = 0; index < refs.length; index++)
      if (index === 0 || index === 2)
        allowed.set(
          JSON.stringify(['job', 'result', 'evidence', String(index), 'dataset']),
          refs[index]!.dataset,
        );
  }
  rejectAdditionalNativeSignals(envelope, allowed);
  if (refs.length === 0) {
    if (job.status === 'succeeded') reject();
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
  const baseline = validateStoredBaseline(payloads[0]),
    baselineRef = refs[0]!;
  if (
    baseline.held.snapshot.binding.work.id !== workId ||
    nativeShortWriteInputHash(baseline.businessInput) !== job.inputHash ||
    (baseline.source.mode === 'live' &&
      documents.some((document) => document.collectionMode !== 'live'))
  )
    reject();
  ordered([
    job.requestedAt,
    job.platformReadStartedAt,
    baseline.held.read.proof.readStartedAt,
    baseline.held.read.proof.readFinishedAt,
    baseline.held.read.proof.proofCapturedAt,
    baseline.held.cleanup.checkedAt,
    baselineRef.capturedAt,
  ]);
  if (refs.length === 1) {
    if (job.status === 'succeeded' || job.platformWriteStartedAt !== null) reject();
    return {
      validated: false,
      result: null,
      evidence: [safeWriteRef(baselineRef)],
      data: [],
      collectionMode: baseline.source.mode,
    };
  }
  validateIntentCore(payloads[1], baseline, baselineRef);
  const intentRef = refs[1]!;
  if (!equal(job.target, { kind: 'short-story', id: workId })) reject();
  ordered([baselineRef.capturedAt, intentRef.capturedAt]);
  let after: StoredAfter | null = null,
    result: NativeShortWriteResultEvidence | null = null;
  if (job.platformWriteStartedAt !== null)
    ordered([intentRef.capturedAt, job.platformWriteStartedAt]);
  if (refs.length >= 3) {
    if (job.platformWriteStartedAt === null) reject();
    after = validateAfterCore(payloads[2], baseline, baselineRef, intentRef, storedSnapshot);
    if (
      after.result.post.markedAt !== job.platformWriteStartedAt ||
      after.result.receipt!.jobId !== job.id
    )
      reject();
    ordered([after.result.proof.proofCapturedAt, refs[2]!.capturedAt]);
  }
  if (refs.length === 4) {
    if (!after) reject();
    const expected = createWriteResultCore(after, baselineRef, intentRef, refs[2]!);
    const payload = copyNativeShortJson(payloads[3]);
    if (!equal(payload, expected)) reject();
    result = expected;
  }
  if (job.status === 'succeeded') {
    if (
      !result ||
      !equal(job.result, result) ||
      job.error !== null ||
      job.platformWriteStartedAt === null
    )
      reject();
    ordered([refs[3]!.capturedAt, job.endedAt]);
    const business = {
      ...result.business,
      ...statusProjection(after!.result.snapshot!, refs[2]!, 'after'),
    };
    return {
      validated: true,
      result: { ...result, business },
      evidence: refs.filter((ref) => ref.dataset !== 'write-intent').map(safeWriteRef),
      data: [business],
      collectionMode: baseline.source.mode,
    };
  }
  if (job.endedAt !== null) ordered([refs[refs.length - 1]!.capturedAt, job.endedAt]);
  if (job.status !== 'uncertain' || job.platformWriteStartedAt === null)
    return {
      validated: false,
      result: null,
      evidence: refs.filter((ref) => ref.dataset !== 'write-intent').map(safeWriteRef),
      data: [],
      collectionMode: baseline.source.mode,
    };
  return {
    validated: true,
    result: null,
    evidence: refs.filter((ref) => ref.dataset !== 'write-intent').map(safeWriteRef),
    data: [
      {
        schema: carrier(
          'fanqie-short-native-metadata-write-business',
          expectationVersion(baseline.held.expectation),
        ),
        dataset: NATIVE_SHORT_BASELINE_DATASET,
        status: 'uncertain',
        accountId: job.accountId,
        target: { kind: 'short-story', id: workId },
        baseline: {
          ...nativeShortSnapshotBusiness(baseline.held.snapshot),
          ...snapshotStatus(baseline.held.snapshot),
        },
        ...(after
          ? {
              after: {
                ...nativeShortSnapshotBusiness(after.result.snapshot!),
                ...snapshotStatus(after.result.snapshot!),
              },
            }
          : {}),
        source: baseline.source,
        provenance: baseline.provenance,
        comparisonBasis: comparisonBasis(expectationVersion(baseline.held.expectation)),
        desiredContentHash: baseline.held.desiredContentHash,
        writeMarkedAt: job.platformWriteStartedAt,
        ...statusProjection(
          after?.result.snapshot ?? baseline.held.snapshot,
          after ? refs[2]! : baselineRef,
          after ? 'after' : 'baseline',
        ),
      },
    ],
    collectionMode: baseline.source.mode,
  };
}
