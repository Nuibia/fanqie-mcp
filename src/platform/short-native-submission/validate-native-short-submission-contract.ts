import {
  type NativeShortSubmissionContract,
  type NativeShortSubmissionSourceDocuments,
  type SourceObservation,
  contractSourceHash,
} from './contract-source-hash.js';

import {
  object,
  capture,
  same,
  UNKNOWN_VALIDATION,
  reject,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  exactHash,
  time,
  NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  TERMS_START,
  TERMS_END,
  sha,
  freeze,
  string,
  BAD_UNICODE,
  type NativeShortSubmissionBusinessInput,
  FORM_KEYS,
  hash,
  NATIVE_SHORT_SUBMISSION_SCOPE,
  VALIDATION,
} from './reject.js';

import {
  type NativeShortMetadataSnapshot,
  type NativeShortBinding,
} from '../short-native-metadata.js';

import { parseNativeShortTrialDocument } from '../short-native-trial.js';

/** Validates a pure source summary, not owned HTTP provenance. Fixture summaries are explicitly no-live. */
export function validateNativeShortSubmissionContract(
  input: unknown,
): NativeShortSubmissionContract {
  const raw = object(capture(input), [
    'schema',
    'mode',
    'observedAt',
    'sourceHash',
    'sources',
    'terms',
    'validation',
  ]);
  if (
    raw.schema !== 'short-native-submission-contract/v1' ||
    !['production-fixed-contract', 'fixture-no-live'].includes(raw.mode as string) ||
    !same(raw.validation, UNKNOWN_VALIDATION)
  )
    reject('contract_invalid');
  const sourcesRaw = object(raw.sources, ['writer', 'main', 'publishShort', 'asyncMain']);
  const sources = {} as Record<keyof NativeShortSubmissionSourceDocuments, SourceObservation>;
  for (const key of ['writer', 'main', 'publishShort', 'asyncMain'] as const) {
    const item = object(sourcesRaw[key], ['url', 'sha256', 'observedAt']),
      pin = NATIVE_SHORT_SUBMISSION_SOURCE_PINS[key];
    if (item.url !== pin.url || ('sha256' in pin && item.sha256 !== pin.sha256))
      reject('contract_invalid');
    sources[key] = {
      url: pin.url,
      sha256: exactHash(item.sha256),
      observedAt: time(item.observedAt),
    };
  }
  const terms = object(raw.terms, [
    'title',
    'text',
    'sha256',
    'sourceUrl',
    'sourceSha256',
    'byteStart',
    'byteEndExclusive',
  ]);
  if (
    terms.title !== '短故事发布事项' ||
    terms.sha256 !== NATIVE_SHORT_SUBMISSION_TERMS_HASH ||
    terms.sourceUrl !== NATIVE_SHORT_SUBMISSION_SOURCE_PINS.publishShort.url ||
    terms.sourceSha256 !== NATIVE_SHORT_SUBMISSION_SOURCE_PINS.publishShort.sha256 ||
    terms.byteStart !== TERMS_START ||
    terms.byteEndExclusive !== TERMS_END ||
    typeof terms.text !== 'string' ||
    Buffer.byteLength(terms.text, 'utf8') !== 4419 ||
    sha(terms.text) !== NATIVE_SHORT_SUBMISSION_TERMS_HASH
  )
    reject('terms_unavailable');
  if (
    raw.observedAt !== sources.writer.observedAt ||
    raw.sourceHash !== contractSourceHash(sources)
  )
    reject('contract_invalid');
  return freeze({
    schema: 'short-native-submission-contract/v1',
    mode: raw.mode as NativeShortSubmissionContract['mode'],
    observedAt: time(raw.observedAt),
    sourceHash: string(raw.sourceHash),
    sources,
    terms: terms as unknown as NativeShortSubmissionContract['terms'],
    validation: UNKNOWN_VALIDATION,
  });
}

/** Only the exact transformations in fixed PublishShort.tp; trial markers are retained. */
export function normalizeNativeShortSubmissionContent(rawHtml: string): string {
  if (
    typeof rawHtml !== 'string' ||
    BAD_UNICODE.test(rawHtml) ||
    Buffer.byteLength(rawHtml, 'utf8') > 3 * 1024 * 1024
  )
    reject('content_unsupported');
  return rawHtml
    .replace(/<small id=".+?" data-source=".+?"( data-reason=".+?")?>/g, '')
    .replace(/<\/small>/g, '')
    .replace(/<p class="">/g, '<p>')
    .replace(/&lt;/g, '＜')
    .replace(/&gt;/g, '＞')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

export function submissionForm(
  snapshot: NativeShortMetadataSnapshot,
  useAi: 1 | 2,
): Readonly<Record<string, string>> {
  const fields = snapshot.savedFields,
    raw = snapshot.editData;
  if (snapshot.state !== 'draft') reject('state_not_draft');
  const originalTitle = fields.multi_title[0]!;
  if (/\s/u.test(originalTitle)) reject('title_invalid');
  const title = originalTitle.trim();
  if (!title) reject('title_invalid');
  if (!fields.book_thumb_uri) reject('cover_required');
  if (
    fields.activity_flag === null ||
    fields.activity_flag !== 0 ||
    raw.activity_info != null ||
    raw.activity_id != null
  )
    reject('activity_branch_unsupported');
  if (![0, 1].includes(raw.story_origin_divided_chapters as number))
    reject('story_origin_branch_unsupported');
  const authorize = raw.authorize_type;
  if (
    !Object.hasOwn(raw, 'authorize_type') ||
    (authorize !== null && !['number', 'string', 'boolean'].includes(typeof authorize))
  )
    reject('authorize_branch_unsupported');
  const mainLabel = snapshot.catalog[0]?.label;
  if (!fields.category.length || !mainLabel || !Array.isArray(raw.category))
    reject('categories_invalid');
  const selected = new Set<string | number>();
  let mainCount = 0;
  for (const row of raw.category) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      (typeof row.category_id !== 'number' && typeof row.category_id !== 'string')
    )
      reject('categories_invalid');
    const matching = snapshot.catalog.filter(
      (candidate) => candidate.category_id === row.category_id,
    );
    if (
      matching.length !== 1 ||
      selected.has(row.category_id) ||
      row.label !== matching[0]!.label ||
      row.name !== matching[0]!.name
    )
      reject('categories_invalid');
    selected.add(row.category_id);
    if (row.label === mainLabel) mainCount++;
  }
  if (mainCount !== 1) reject('categories_invalid');
  let max = 8;
  if (Object.hasOwn(raw, 'category_max_count')) {
    const value = raw.category_max_count;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      reject('categories_unsupported');
    max = value || 8;
  }
  if (!Boolean(authorize) && fields.category.length > max) reject('categories_invalid');
  const content = normalizeNativeShortSubmissionContent(fields.content);
  let document;
  try {
    document = parseNativeShortTrialDocument(
      fields.content
        .replace(/<small id=".+?" data-source=".+?"( data-reason=".+?")?>/g, '')
        .replace(/<\/small>/g, '')
        .replace(/<p class="">/g, '<p>'),
    );
  } catch {
    reject('trial_document_unsupported');
  }
  if (
    !document.markerAttrs ||
    document.characterCount < 200 ||
    document.characterCount >= 100_000 ||
    document.eligibleParagraphCount < 3
  )
    reject('trial_required');
  if (Boolean(authorize) && document.characterCount < 5000) reject('signed_min_text');
  if (
    raw.title_problem ||
    raw.content_mark_problem ||
    raw.picture_mark_problem ||
    raw.thumb_mark_problem ||
    (Array.isArray(raw.audit_fail_infos) && raw.audit_fail_infos.length)
  )
    reject('unresolved_review_problem');
  for (const tail of fields.multi_title.slice(1)) {
    const size = Math.ceil(
      tail
        .trim()
        .replace(/[^\x00-\xff]/g, '**')
        .replace(/\s/g, '').length / 2,
    );
    if (tail && (/\s/.test(tail) || size < 5 || size > 30)) reject('recommended_title_invalid');
  }
  return freeze({
    content,
    item_id: fields.item_id,
    multi_title: JSON.stringify([title]),
    thumb_uri: fields.thumb_uri,
    book_thumb_uri: fields.book_thumb_uri,
    category: fields.category.map(String).join(','),
    sign_type: '1',
    activity_flag: '0',
    story_origin_divided_chapters: String(raw.story_origin_divided_chapters),
    use_ai: String(useAi),
  });
}

export function checkedForm(
  input: unknown,
  business: NativeShortSubmissionBusinessInput,
): Readonly<Record<string, string>> {
  const raw = object(capture(input), FORM_KEYS),
    form: Record<string, string> = Object.create(null);
  for (const key of FORM_KEYS) form[key] = string(raw[key]);
  if (
    form.item_id !== business.target.workId ||
    form.sign_type !== '1' ||
    form.activity_flag !== '0' ||
    !['0', '1'].includes(form.story_origin_divided_chapters!) ||
    form.use_ai !== String(business.useAi)
  )
    reject('form_invalid');
  let titles: unknown;
  try {
    titles = JSON.parse(form.multi_title!);
  } catch {
    reject('form_invalid');
  }
  if (
    !Array.isArray(titles) ||
    titles.length !== 1 ||
    typeof titles[0] !== 'string' ||
    !titles[0] ||
    /\s/u.test(titles[0]) ||
    JSON.stringify(titles) !== form.multi_title ||
    !form.category ||
    !form.book_thumb_uri
  )
    reject('form_invalid');
  return freeze(form);
}

export function desired(
  snapshotVersionHash: string,
  catalogHash: string,
  categorySelectionHash: string,
  binding: NativeShortBinding,
  form: Readonly<Record<string, string>>,
  contract: NativeShortSubmissionContract,
): string {
  return hash({
    basis: 'native-submission-complete-wire-and-pinned-sources/v1',
    snapshotVersionHash,
    catalogHash,
    categorySelectionHash,
    binding,
    form,
    sourceHash: contract.sourceHash,
    termsHash: contract.terms.sha256,
  });
}

export function payload(
  desiredSubmissionHash: string,
  businessInputHash: string,
  contract: NativeShortSubmissionContract,
  preparedAt: string,
  expiresAt: string,
): string {
  return hash({
    basis: 'native-submission-preparation-payload/v1',
    desiredSubmissionHash,
    businessInputHash,
    contract,
    preparedAt,
    expiresAt,
  });
}

export interface NativeShortPreparedSubmission {
  readonly schema: 'short-native-prepared-submission/v1';
  readonly snapshotScope: typeof NATIVE_SHORT_SUBMISSION_SCOPE;
  readonly business: NativeShortSubmissionBusinessInput;
  readonly businessInputHash: string;
  readonly completeCurrentSnapshot: NativeShortMetadataSnapshot;
  readonly contract: NativeShortSubmissionContract;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly desiredSubmissionHash: string;
  readonly payloadHash: string;
  readonly form: Readonly<Record<string, string>>;
  readonly validation: typeof VALIDATION;
}
