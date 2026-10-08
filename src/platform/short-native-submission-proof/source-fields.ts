import {
  type Data,
  fail,
  type NativeShortSubmissionContext,
  object,
  copy,
  type NativeShortSubmissionBusinessInput,
  exact,
  UUID,
  freeze,
  hash,
  same,
  refLink,
  nativeSnapshot,
  time,
  type NativeShortSubmissionStage,
  type AuditResult,
  type NativeShortSubmissionWriteResultEvidence,
} from './fail.js';

import {
  type NativeShortSubmissionBusinessInput as ModelBusiness,
  validateNativeShortSubmissionBusinessInput as validateModelBusiness,
  nativeShortSubmissionBusinessInputHash as modelBusinessHash,
  type NativeShortSubmissionWriteRequest,
  nativeShortSubmissionWriteRequest as modelRequest,
  type NativeShortPreparedSubmission,
  validateNativeShortPreparedSubmission,
  validateNativeShortSubmissionContract,
  planNativeShortSubmission,
  type NativeShortSubmissionPlan,
} from '../short-native-submission.js';

import { type NativeShortSubmissionHeldIntent } from '../short-native-submission-api.js';

import { validateNativeShortSubmissionReadContext } from './create-native-short-submission-stage-evidence.js';

import { type NativeShortProvenance } from '../short-native-metadata-proof.js';

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

export function checkedContext(input: unknown): NativeShortSubmissionContext {
  const d = sourceFields(
    input,
    Object.hasOwn(object(input), 'preparation')
      ? ['accountId', 'job', 'manifest', 'refs', 'documents', 'attempts', 'preparation']
      : ['accountId', 'job', 'manifest', 'refs', 'documents', 'attempts'],
  );
  const env = copy(
    {
      accountId: d.accountId,
      job: d.job,
      manifest: d.manifest,
      refs: d.refs,
      attempts: d.attempts,
    },
    512 * 1024,
  );
  const docs = copy(d.documents, 512 * 1024 * 1024);
  if (!Array.isArray(docs) || docs.length > 7) fail();
  return {
    ...env,
    documents: docs,
    ...(Object.hasOwn(d, 'preparation')
      ? { preparation: d.preparation === null ? null : copy(d.preparation, 192 * 1024 * 1024) }
      : {}),
  };
}

export function captureNativeShortSubmissionBusinessInput(input: unknown): ModelBusiness {
  try {
    return validateModelBusiness(copy(input, 16384));
  } catch {
    fail();
  }
}

export function validateNativeShortSubmissionBusinessInput(
  input: unknown,
): NativeShortSubmissionBusinessInput {
  const d = exact(copy(input, 16384), [
    'target',
    'snapshotScope',
    'hashBasis',
    'expectedSnapshotVersionHash',
    'expectedState',
    'useAi',
    'preparationJobId',
    'acceptPublicationTerms',
  ]);
  if (!UUID.test(d.preparationJobId) || d.acceptPublicationTerms !== true) fail();
  const { preparationJobId, acceptPublicationTerms, ...m } = d;
  return freeze({
    ...captureNativeShortSubmissionBusinessInput(m),
    preparationJobId,
    acceptPublicationTerms: true,
  });
}

export const nativeShortSubmissionBusinessInputHash = (b: NativeShortSubmissionBusinessInput) =>
  hash({
    basis: 'native-short-submission-service-input/v1',
    business: validateNativeShortSubmissionBusinessInput(b),
  });

export const nativeShortSubmissionPreparationInputHash = (b: ModelBusiness) =>
  modelBusinessHash(captureNativeShortSubmissionBusinessInput(b));

export function nativeShortSubmissionWriteRequest(
  b: ModelBusiness,
): NativeShortSubmissionWriteRequest {
  return modelRequest(
    captureNativeShortSubmissionBusinessInput(
      Object.fromEntries(
        [
          'target',
          'snapshotScope',
          'hashBasis',
          'expectedSnapshotVersionHash',
          'expectedState',
          'useAi',
        ].map((k) => [k, (b as any)[k]]),
      ),
    ),
  );
}

export function hasReservedNativeShortSubmissionSignal(input: unknown): boolean {
  const pending = [input],
    seen = new Set<object>();
  const reserved = (s: unknown) =>
    typeof s === 'string' &&
    (s.startsWith('native-short-submission') ||
      s.startsWith('native-short-prepared-submission') ||
      s.startsWith('fanqie-short-native-submission') ||
      s.startsWith('short_native_submission') ||
      s.startsWith('short-native-submission/'));
  try {
    while (pending.length) {
      const v = pending.pop();
      if (!v || typeof v !== 'object' || seen.has(v)) continue;
      if (seen.size > 200000) return true;
      seen.add(v);
      for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
        if (
          ['schema', 'scope', 'snapshotScope', 'dataset', 'datasets'].includes(k) &&
          !Object.hasOwn(d, 'value')
        )
          return true;
        if (!Object.hasOwn(d, 'value')) continue;
        const c = d.value;
        if (
          ['schema', 'scope', 'snapshotScope', 'dataset', 'datasets'].includes(k) &&
          (reserved(c) ||
            (Array.isArray(c) &&
              Object.values(Object.getOwnPropertyDescriptors(c)).some(
                (x) => Object.hasOwn(x, 'value') && reserved(x.value),
              )))
        )
          return true;
        if (c && typeof c === 'object') pending.push(c);
      }
    }
    return false;
  } catch {
    return true;
  }
}

function modelPart(b: NativeShortSubmissionBusinessInput): ModelBusiness {
  const { preparationJobId: _p, acceptPublicationTerms: _a, ...m } = b;
  return captureNativeShortSubmissionBusinessInput(m);
}

function prepared(input: unknown): NativeShortPreparedSubmission {
  try {
    return validateNativeShortPreparedSubmission(input);
  } catch {
    fail();
  }
}

export function validatePreparationLink(
  c: NativeShortSubmissionContext,
  b: NativeShortSubmissionBusinessInput,
  h: NativeShortSubmissionHeldIntent,
): void {
  const p = c.preparation;
  if (!p) fail();
  const validated = validateNativeShortSubmissionReadContext({
    accountId: c.accountId,
    job: p.job,
    manifest: p.manifest,
    refs: [p.ref],
    documents: [p.document],
    attempts: [],
  });
  if (
    p.job.id !== b.preparationJobId ||
    p.job.accountId !== c.accountId ||
    !same(validated.businessInput, modelPart(b)) ||
    !same(validated.result.prepared, h.servicePrepared.prepared) ||
    !same(h.servicePrepared.preparationEvidence, refLink(p.ref)) ||
    h.servicePrepared.preparationJobId !== p.job.id ||
    p.job.endedAt! > c.job.requestedAt
  )
    fail();
  if (
    validated.provenance.mode === 'fixture' &&
    (c.documents[0]?.collectionMode === 'live' || h.plan.request.liveAllowed)
  )
    fail();
}

export function held(
  input: unknown,
  b: NativeShortSubmissionBusinessInput,
  base?: NativeShortSubmissionHeldIntent,
): NativeShortSubmissionHeldIntent {
  const h = exact(copy(input, 128 * 1024 * 1024), [
    'schema',
    'beforeSnapshot',
    'snapshot',
    'contract',
    'businessRequest',
    'servicePrepared',
    'plan',
    'expectation',
    'desiredSubmissionHash',
    'read',
    'checkedAt',
  ]);
  if (h.schema !== 'native-short-submission-held-intent/v1') fail();
  assertExpected(h.businessRequest, nativeShortSubmissionWriteRequest(b));
  const before = nativeSnapshot(h.beforeSnapshot),
    current = nativeSnapshot(h.snapshot),
    sp = exact(h.servicePrepared, ['preparationJobId', 'preparationEvidence', 'prepared']);
  const pp = prepared(sp.prepared);
  if (
    sp.preparationJobId !== b.preparationJobId ||
    !same(pp.business, modelPart(b)) ||
    before.binding.work.id !== b.target.workId ||
    !same(before, current) ||
    (base && !same(before, base.beforeSnapshot))
  )
    fail();
  const contract = validateNativeShortSubmissionContract(h.contract),
    at = time(h.checkedAt),
    plan = planNativeShortSubmission(current, contract, modelPart(b), pp, at);
  assertExpected(h.plan, plan);
  assertExpected(h.expectation, plan.expectation);
  if (h.desiredSubmissionHash !== plan.desiredContentHash) fail();
  return freeze({
    ...h,
    beforeSnapshot: before,
    snapshot: current,
    contract,
    servicePrepared: { ...sp, prepared: pp },
    plan,
    expectation: plan.expectation,
  }) as NativeShortSubmissionHeldIntent;
}

export interface State {
  context: NativeShortSubmissionContext;
  kinds: NativeShortSubmissionStage[];
  payloads: Data[];
  baseline: NativeShortSubmissionHeldIntent | null;
  business: NativeShortSubmissionBusinessInput | null;
  provenance: NativeShortProvenance | null;
  preSubmit: NativeShortSubmissionHeldIntent | null;
  plan: NativeShortSubmissionPlan | null;
  after: AuditResult | null;
  result: NativeShortSubmissionWriteResultEvidence | null;
}

export function transport(_id: string) {
  return {
    schema: 'native-short-submission-publish-transport/v1' as const,
    provenance: 'static-unobserved' as const,
    method: 'POST' as const,
    url: 'https://fanqienovel.com/api/author/short_article/publish/v0/?aid=2503&app_name=muye_novel',
    encoding: 'application/x-www-form-urlencoded;charset=UTF-8' as const,
  };
}
