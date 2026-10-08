import {
  type NativeShortSubmissionStage,
  type NativeShortSubmissionContext,
  fail,
  provenance,
  copy,
  freeze,
  ORIGIN,
  time,
  type NativeShortSubmissionProjection,
  type Data,
  same,
  exact,
  NATIVE_SHORT_SUBMISSION_READ_OPERATION,
  nativeShortSubmissionScope,
  NATIVE_SHORT_SUBMISSION_READ_DATASET,
  UUID,
  HASH,
} from './fail.js';

import { stateFor, allowedNext } from './ordinary-job.js';

import {
  sourceFields,
  validateNativeShortSubmissionBusinessInput,
  held,
  nativeShortSubmissionBusinessInputHash,
  validatePreparationLink,
  assertExpected,
  transport,
  type State,
  captureNativeShortSubmissionBusinessInput,
  checkedContext,
  nativeShortSubmissionPreparationInputHash,
} from './source-fields.js';

import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  type NativeShortSubmissionBusinessInput as ModelBusiness,
} from '../short-native-submission.js';

import {
  linkBase,
  intentPayload,
  acknowledgement,
  apiResult,
  resultPayload,
  businessResult,
} from './link-base.js';

import {
  type NativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../short-native-metadata.js';

import { type EvidenceRef, type Manifest } from '../../runtime/store.js';

import {
  type NativeShortSubmissionApiResult,
  validateNativeShortSubmissionApiResult,
} from '../short-native-submission-api.js';

import {
  type NativeShortProvenance,
  isCanonicalNativeTime,
} from '../short-native-metadata-proof.js';

import { validateReadJob } from './safe-native-short-submission-job.js';

export function createNativeShortSubmissionStageEvidence(
  k: NativeShortSubmissionStage,
  input: unknown,
  c: NativeShortSubmissionContext,
): any {
  const s = stateFor(c, false, k === 'attempt');
  if (!allowedNext(s.kinds, k)) fail();
  const v = sourceFields(
    input,
    k === 'baseline'
      ? ['held', 'business', 'provenance']
      : ['preSubmit', 'intent'].includes(k)
        ? ['held']
        : k === 'attempt'
          ? ['eventAt']
          : k === 'acknowledgement'
            ? ['observation']
            : k === 'after'
              ? ['result']
              : [],
  );
  if (k === 'baseline') {
    const b = validateNativeShortSubmissionBusinessInput(v.business),
      p = provenance(copy(v.provenance)),
      h = held(v.held, b);
    if (nativeShortSubmissionBusinessInputHash(b) !== c.job.inputHash) fail();
    validatePreparationLink(c, b, h);
    return freeze({
      schema: 'native-short-submission-baseline-evidence/v1',
      scope: NATIVE_SHORT_SUBMISSION_SCOPE,
      held: h,
      businessInput: b,
      source: { origin: ORIGIN, mode: p.mode },
      provenance: p,
    });
  }
  if (!s.baseline) fail();
  if (k === 'preSubmit')
    return freeze({ ...linkBase(s, k), held: held(v.held, s.business!, s.baseline) });
  if (k === 'intent') {
    assertExpected(v.held, s.preSubmit);
    return freeze(intentPayload(s));
  }
  if (k === 'attempt') {
    if (
      c.job.platformWriteStartedAt !== v.eventAt ||
      s.kinds.at(-1) !== 'intent' ||
      c.attempts.length
    )
      fail();
    return freeze({
      ...linkBase(s, k),
      stage: 'attempt',
      ordinal: 1,
      eventAt: time(v.eventAt),
      transport: transport(s.business!.target.workId),
    });
  }
  if (k === 'acknowledgement')
    return freeze({ ...linkBase(s, k), observation: acknowledgement(v.observation, s) });
  if (k === 'after') return freeze({ ...linkBase(s, k), result: apiResult(v.result, s) });
  return freeze(resultPayload(s));
}

export function projectState(s: State): NativeShortSubmissionProjection {
  const b = s.baseline
    ? {
        ...(s.result?.business ??
          businessResult(
            s,
            s.context.job.status === 'uncertain' ? 'uncertain' : 'capability_unavailable',
            'outcome_not_verified',
          )),
        ...statusObservation(s),
      }
    : null;
  return {
    validated: !!s.baseline,
    result: s.result ? { ...s.result, business: b! } : null,
    evidence: s.context.refs
      .filter((r) => r.dataset !== 'write-intent')
      .map(safeNativeShortSubmissionRef),
    data: b ? [b] : [],
    collectionMode: s.provenance?.mode ?? null,
  };
}

export function projectNativeShortSubmissionEvidenceContext(
  c: NativeShortSubmissionContext,
): NativeShortSubmissionProjection {
  try {
    return freeze(projectState(stateFor(c)));
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}

export function nativeObservation(
  s: NativeShortMetadataSnapshot,
  phase: string,
  ref: EvidenceRef,
): Data {
  return {
    state: s.state,
    statusFacts: s.statusFacts,
    statusSource: {
      phase,
      sourceRef: ref.id,
      evidenceHash: ref.sha256,
      evidenceCapturedAt: ref.capturedAt,
    },
    publication: { status: s.state, statusFacts: s.statusFacts },
  };
}

export function statusObservation(s: State): Data {
  if (s.after?.snapshot)
    return nativeObservation(s.after.snapshot, 'after', s.context.refs[s.kinds.indexOf('after')]!);
  if (s.preSubmit)
    return nativeObservation(
      s.preSubmit.snapshot,
      'pre_submit',
      s.context.refs[s.kinds.indexOf('preSubmit')]!,
    );
  if (s.baseline) return nativeObservation(s.baseline.snapshot, 'baseline', s.context.refs[0]!);
  return {
    state: 'unknown',
    statusFacts: null,
    statusSource: null,
    publication: { status: 'unknown', statusFacts: null },
  };
}

export interface NativeShortSubmissionReadEvidence {
  schema: 'native-short-submission-read-evidence/v1';
  scope: typeof NATIVE_SHORT_SUBMISSION_SCOPE;
  businessInput: ModelBusiness;
  result: NativeShortSubmissionApiResult;
  source: { origin: typeof ORIGIN; mode: 'live' | 'fixture' };
  provenance: NativeShortProvenance;
}

export function createNativeShortSubmissionReadEvidence(
  raw: NativeShortSubmissionApiResult,
  b: ModelBusiness,
  p: NativeShortProvenance,
): NativeShortSubmissionReadEvidence {
  const result = validateNativeShortSubmissionApiResult(copy(raw, 192 * 1024 * 1024));
  if (
    result.provenance.mode !== p.mode ||
    (p.mode === 'live' &&
      (!result.proof.fixedSourcesVerified ||
        result.contract?.mode !== 'production-fixed-contract')) ||
    result.mode !== 'prepare' ||
    result.status !== 'success' ||
    !result.prepared ||
    !same(result.prepared.business, captureNativeShortSubmissionBusinessInput(b))
  )
    fail();
  return freeze({
    schema: 'native-short-submission-read-evidence/v1',
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    businessInput: captureNativeShortSubmissionBusinessInput(b),
    result,
    source: { origin: ORIGIN, mode: p.mode },
    provenance: provenance(copy(p)),
  });
}

export function validateNativeShortSubmissionReadContext(
  input: NativeShortSubmissionContext,
): NativeShortSubmissionReadEvidence {
  const c = checkedContext(input);
  if (!c.manifest || c.refs.length !== 1 || c.documents.length !== 1 || c.attempts.length) fail();
  const p = exact(c.documents[0]!.payload, [
      'schema',
      'scope',
      'businessInput',
      'result',
      'source',
      'provenance',
    ]),
    expected = createNativeShortSubmissionReadEvidence(p.result, p.businessInput, p.provenance);
  if (!same(p, expected)) fail();
  const b = expected.businessInput,
    r = expected.result;
  validateReadJob(
    c.job,
    c.manifest,
    c.refs[0]!,
    c.documents[0]!,
    c.accountId,
    b.target.workId,
    NATIVE_SHORT_SUBMISSION_READ_OPERATION,
    nativeShortSubmissionScope(b.target.workId),
    nativeShortSubmissionPreparationInputHash(b),
    r,
    expected.provenance.mode,
  );
  if (c.refs[0]!.dataset !== NATIVE_SHORT_SUBMISSION_READ_DATASET) fail();
  return expected;
}

export function projectNativeShortSubmissionReadContext(
  c: NativeShortSubmissionContext,
): NativeShortSubmissionProjection {
  try {
    const p = validateNativeShortSubmissionReadContext(c),
      r = p.result,
      pp = r.prepared!;
    const b = {
      schema: 'fanqie-short-native-submission-preparation-business/v1',
      status: 'prepared',
      scope: NATIVE_SHORT_SUBMISSION_SCOPE,
      preparationJobId: c.job.id,
      target: { kind: 'short-story', id: pp.business.target.workId },
      snapshotVersionHash: pp.completeCurrentSnapshot.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      useAi: pp.business.useAi,
      desiredSubmissionHash: pp.desiredSubmissionHash,
      payloadHash: pp.payloadHash,
      preparedAt: pp.preparedAt,
      expiresAt: pp.expiresAt,
      terms: pp.contract.terms,
      contractHash: pp.contract.sourceHash,
      validation: pp.validation,
      bodyIncluded: false,
      ...nativeObservation(pp.completeCurrentSnapshot, 'prepare', c.refs[0]!),
    };
    return {
      validated: true,
      result: null,
      evidence: c.refs.map(safeNativeShortSubmissionRef),
      data: [b],
      collectionMode: p.provenance.mode,
    };
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}

export function scalar(object: unknown, key: string): unknown {
  try {
    const d =
      object && typeof object === 'object'
        ? Object.getOwnPropertyDescriptor(object, key)
        : undefined;
    return d && Object.hasOwn(d, 'value') ? d.value : null;
  } catch {
    return null;
  }
}

export function safeString(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

export function safeNativeShortSubmissionRef(ref: EvidenceRef): Record<string, unknown> {
  return {
    id: safeString(scalar(ref, 'id'), UUID),
    accountId: safeString(scalar(ref, 'accountId'), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    jobId: safeString(scalar(ref, 'jobId'), UUID),
    dataset: safeString(
      scalar(ref, 'dataset'),
      /^(short_native_submission(?:_[a-z_]+)?|reconciliation|write-result)$/,
    ),
    capturedAt: isCanonicalNativeTime(scalar(ref, 'capturedAt')) ? scalar(ref, 'capturedAt') : null,
    sha256: safeString(scalar(ref, 'sha256'), HASH),
  };
}

export function safeNativeShortSubmissionManifest(manifest: Manifest): Record<string, unknown> {
  try {
    const d = copy(manifest, 64 * 1024),
      reconciliation = d.operation === 'reconcile_write';
    return {
      schemaVersion: 1,
      id: safeString(d.id, UUID),
      accountId: safeString(d.accountId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
      jobId: safeString(d.jobId, UUID),
      operation: reconciliation ? 'reconcile_write' : NATIVE_SHORT_SUBMISSION_READ_OPERATION,
      scope: reconciliation
        ? 'reconciliation'
        : safeString(d.scope, /^short_native_submission\.[1-9][0-9]{9,21}$/),
      datasets: reconciliation ? ['reconciliation'] : [NATIVE_SHORT_SUBMISSION_READ_DATASET],
      requestedAt: time(d.requestedAt),
      platformReadStartedAt: time(d.platformReadStartedAt),
      committedAt: time(d.committedAt),
      evidence: Array.isArray(d.evidence) ? d.evidence.map(safeNativeShortSubmissionRef) : [],
    };
  } catch {
    return {
      schemaVersion: 1,
      id: null,
      accountId: null,
      jobId: null,
      operation: null,
      scope: null,
      datasets: [],
      evidence: [],
    };
  }
}
