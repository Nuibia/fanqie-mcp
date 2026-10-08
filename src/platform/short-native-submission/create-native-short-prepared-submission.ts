import {
  type NativeShortMetadataSnapshot,
  type NativeShortBinding,
} from '../short-native-metadata.js';

import { type NativeShortSubmissionContract } from './contract-source-hash.js';

import {
  type NativeShortSubmissionBusinessInput,
  checkedSnapshot,
  validateNativeShortSubmissionBusinessInput,
  time,
  reject,
  fresh,
  NATIVE_SHORT_SUBMISSION_TTL_MS,
  nativeShortSubmissionBusinessInputHash,
  freeze,
  NATIVE_SHORT_SUBMISSION_SCOPE,
  VALIDATION,
  object,
  capture,
  same,
  exactHash,
  string,
  REQUEST_URL,
  CONTENT_TYPE,
} from './reject.js';

import {
  type NativeShortPreparedSubmission,
  validateNativeShortSubmissionContract,
  submissionForm,
  desired,
  payload,
  checkedForm,
} from './validate-native-short-submission-contract.js';

import { type ShortResolvedState, type ShortStatusFactsV1 } from '../short-status.js';

export function createNativeShortPreparedSubmission(
  snapshotInput: NativeShortMetadataSnapshot,
  contractInput: NativeShortSubmissionContract,
  businessInput: NativeShortSubmissionBusinessInput,
  preparedAtInput: string,
): NativeShortPreparedSubmission {
  const snapshot = checkedSnapshot(snapshotInput),
    contract = validateNativeShortSubmissionContract(contractInput),
    business = validateNativeShortSubmissionBusinessInput(businessInput),
    preparedAt = time(preparedAtInput);
  if (
    snapshot.binding.work.id !== business.target.workId ||
    snapshot.snapshotVersionHash !== business.expectedSnapshotVersionHash
  )
    reject('source_version_mismatch');
  if (snapshot.state !== 'draft') reject('state_not_draft');
  for (const source of Object.values(contract.sources)) fresh(source.observedAt, preparedAt);
  const expiresAt = new Date(Date.parse(preparedAt) + NATIVE_SHORT_SUBMISSION_TTL_MS).toISOString(),
    form = submissionForm(snapshot, business.useAi);
  const businessInputHash = nativeShortSubmissionBusinessInputHash(business),
    desiredSubmissionHash = desired(
      snapshot.snapshotVersionHash,
      snapshot.catalogHash,
      snapshot.categorySelectionHash,
      snapshot.binding,
      form,
      contract,
    );
  return freeze({
    schema: 'short-native-prepared-submission/v1',
    snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
    business,
    businessInputHash,
    completeCurrentSnapshot: snapshot,
    contract,
    preparedAt,
    expiresAt,
    desiredSubmissionHash,
    payloadHash: payload(desiredSubmissionHash, businessInputHash, contract, preparedAt, expiresAt),
    form,
    validation: VALIDATION,
  });
}

export function validateNativeShortPreparedSubmission(
  input: unknown,
): NativeShortPreparedSubmission {
  const raw = object(capture(input), [
    'schema',
    'snapshotScope',
    'business',
    'businessInputHash',
    'completeCurrentSnapshot',
    'contract',
    'preparedAt',
    'expiresAt',
    'desiredSubmissionHash',
    'payloadHash',
    'form',
    'validation',
  ]);
  const rebuilt = createNativeShortPreparedSubmission(
    raw.completeCurrentSnapshot as NativeShortMetadataSnapshot,
    raw.contract as NativeShortSubmissionContract,
    raw.business as NativeShortSubmissionBusinessInput,
    raw.preparedAt as string,
  );
  if (!same(raw, rebuilt)) reject('prepared_hash_mismatch');
  return rebuilt;
}

export interface NativeShortSubmissionExpectation {
  readonly schema: 'short-native-submission-expectation/v1';
  readonly binding: NativeShortBinding;
  readonly sourceVersionHash: string;
  readonly catalogHash: string;
  readonly categorySelectionHash: string;
  readonly sourceHash: string;
  readonly termsHash: string;
  readonly useAi: 1 | 2;
  readonly form: Readonly<Record<string, string>>;
  readonly contract: NativeShortSubmissionContract;
  readonly business: NativeShortSubmissionBusinessInput;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly desiredSubmissionHash: string;
  readonly payloadHash: string;
}

function expectation(prepared: NativeShortPreparedSubmission): NativeShortSubmissionExpectation {
  const native = prepared.completeCurrentSnapshot;
  return freeze({
    schema: 'short-native-submission-expectation/v1',
    binding: native.binding,
    sourceVersionHash: native.snapshotVersionHash,
    catalogHash: native.catalogHash,
    categorySelectionHash: native.categorySelectionHash,
    sourceHash: prepared.contract.sourceHash,
    termsHash: prepared.contract.terms.sha256,
    useAi: prepared.business.useAi,
    form: prepared.form,
    contract: prepared.contract,
    business: prepared.business,
    preparedAt: prepared.preparedAt,
    expiresAt: prepared.expiresAt,
    desiredSubmissionHash: prepared.desiredSubmissionHash,
    payloadHash: prepared.payloadHash,
  });
}

export function validateNativeShortSubmissionExpectation(
  input: unknown,
): NativeShortSubmissionExpectation {
  const raw = object(capture(input), [
    'schema',
    'binding',
    'sourceVersionHash',
    'catalogHash',
    'categorySelectionHash',
    'sourceHash',
    'termsHash',
    'useAi',
    'form',
    'contract',
    'business',
    'preparedAt',
    'expiresAt',
    'desiredSubmissionHash',
    'payloadHash',
  ]);
  const business = validateNativeShortSubmissionBusinessInput(raw.business),
    contract = validateNativeShortSubmissionContract(raw.contract),
    form = checkedForm(raw.form, business),
    binding = object(raw.binding, ['account', 'work']);
  const account = object(binding.account, ['kind', 'id']),
    work = object(binding.work, ['kind', 'id']);
  if (
    account.kind !== 'account_id' ||
    typeof account.id !== 'string' ||
    !/^[0-9]{1,30}$/.test(account.id) ||
    work.kind !== 'short' ||
    work.id !== business.target.workId
  )
    reject('binding_invalid');
  const preparedAt = time(raw.preparedAt),
    expiresAt = time(raw.expiresAt);
  for (const source of Object.values(contract.sources)) fresh(source.observedAt, preparedAt);
  if (
    Date.parse(expiresAt) - Date.parse(preparedAt) !== NATIVE_SHORT_SUBMISSION_TTL_MS ||
    raw.schema !== 'short-native-submission-expectation/v1' ||
    raw.sourceVersionHash !== business.expectedSnapshotVersionHash ||
    raw.sourceHash !== contract.sourceHash ||
    raw.termsHash !== contract.terms.sha256 ||
    raw.useAi !== business.useAi
  )
    reject('expectation_invalid');
  const typedBinding = binding as unknown as NativeShortBinding;
  const wanted = desired(
    exactHash(raw.sourceVersionHash),
    exactHash(raw.catalogHash),
    exactHash(raw.categorySelectionHash),
    typedBinding,
    form,
    contract,
  );
  if (
    raw.desiredSubmissionHash !== wanted ||
    raw.payloadHash !==
      payload(
        wanted,
        nativeShortSubmissionBusinessInputHash(business),
        contract,
        preparedAt,
        expiresAt,
      )
  )
    reject('expectation_hash_mismatch');
  return freeze({
    schema: 'short-native-submission-expectation/v1',
    binding: typedBinding,
    sourceVersionHash: string(raw.sourceVersionHash),
    catalogHash: string(raw.catalogHash),
    categorySelectionHash: string(raw.categorySelectionHash),
    sourceHash: contract.sourceHash,
    termsHash: contract.terms.sha256,
    useAi: business.useAi,
    form,
    contract,
    business,
    preparedAt,
    expiresAt,
    desiredSubmissionHash: wanted,
    payloadHash: string(raw.payloadHash),
  });
}

export interface NativeShortSubmissionPlan {
  readonly kind: 'native_submission_payload_plan';
  readonly atomicRevision: false;
  readonly prepared: NativeShortPreparedSubmission;
  readonly expectation: NativeShortSubmissionExpectation;
  readonly desiredContentHash: string;
  readonly payloadHash: string;
  readonly form: Readonly<Record<string, string>>;
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly contentType: string;
    readonly body: string;
    readonly liveAllowed: boolean;
  };
}

export function planNativeShortSubmission(
  snapshotInput: NativeShortMetadataSnapshot,
  contractInput: NativeShortSubmissionContract,
  businessInput: NativeShortSubmissionBusinessInput,
  preparedInput: NativeShortPreparedSubmission,
  currentTimeInput: string,
): NativeShortSubmissionPlan {
  const snapshot = checkedSnapshot(snapshotInput),
    contract = validateNativeShortSubmissionContract(contractInput),
    business = validateNativeShortSubmissionBusinessInput(businessInput),
    prepared = validateNativeShortPreparedSubmission(preparedInput),
    currentTime = time(currentTimeInput);
  if (
    Date.parse(currentTime) < Date.parse(prepared.preparedAt) ||
    Date.parse(currentTime) >= Date.parse(prepared.expiresAt)
  )
    reject('preparation_expired');
  for (const source of Object.values(contract.sources)) fresh(source.observedAt, currentTime);
  if (!same(snapshot, prepared.completeCurrentSnapshot) || !same(business, prepared.business))
    reject('prepared_source_changed');
  if (
    contract.sourceHash !== prepared.contract.sourceHash ||
    contract.terms.sha256 !== prepared.contract.terms.sha256 ||
    contract.mode !== prepared.contract.mode
  )
    reject('prepared_contract_changed');
  const form = submissionForm(snapshot, business.useAi);
  if (!same(form, prepared.form)) reject('prepared_form_changed');
  return freeze({
    kind: 'native_submission_payload_plan',
    atomicRevision: false,
    prepared,
    expectation: expectation(prepared),
    desiredContentHash: prepared.desiredSubmissionHash,
    payloadHash: prepared.payloadHash,
    form,
    request: {
      method: 'POST',
      url: REQUEST_URL,
      contentType: CONTENT_TYPE,
      body: new URLSearchParams(Object.entries(form)).toString(),
      liveAllowed: contract.mode === 'production-fixed-contract',
    },
  });
}

export interface NativeShortSubmissionComparison {
  readonly matches: boolean;
  readonly reason: string;
  readonly observedStatus: ShortResolvedState;
  readonly statusFacts: ShortStatusFactsV1;
  readonly ai: {
    readonly sent: 1 | 2;
    readonly observed: 1 | 2 | null;
    readonly evidence: 'matched' | 'mismatch' | 'missing' | 'invalid';
  };
  readonly actual: {
    readonly snapshotVersionHash: string;
    readonly catalogHash: string;
    readonly contentHash: string;
  };
  readonly fields: {
    readonly content: boolean;
    readonly title: boolean;
    readonly categories: boolean;
    readonly covers: boolean;
    readonly trial: boolean;
    readonly signType: boolean;
    readonly activityFlag: boolean;
    readonly storyOriginDividedChapters: boolean;
  };
}
