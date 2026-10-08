import {
  type PlatformState,
  idPattern,
  metadataKeys,
  PlatformWriteError,
  type DraftMetadata,
  sha256,
} from './hash-draft-content.js';

import {
  type LongBookMetadataTarget,
  type LongBookMetadataOptions,
  type UiLongBookMetadataProfile,
  bookProfileKeys,
  type LongBookMetadataSnapshot,
  type LongBookMetadataResult,
} from './diagnostic-url.js';

import { invalid, unavailable, safeUrl } from './is-generic-short-capture-failure.js';

import { type Page } from 'playwright';

import { readTextInput, readField, unique, verifyIdentity } from './unique.js';

const bookStates = new Set<PlatformState>([
  'draft',
  'reviewing',
  'submitted',
  'published',
  'rejected',
]);

export function bookTarget(target: LongBookMetadataTarget): void {
  if (
    !target ||
    target.kind !== 'long-book' ||
    !idPattern.test(target.workId) ||
    Object.keys(target).some((key) => key !== 'kind' && key !== 'workId')
  )
    invalid('An existing long-book work ID without a chapter ID is required.');
}

export function requireBookProfile(options: LongBookMetadataOptions): UiLongBookMetadataProfile {
  const profile = options.profile;
  if (
    !profile ||
    Object.keys(profile).some((key) => !bookProfileKeys.has(key)) ||
    profile.kind !== 'long-book' ||
    !profile.id ||
    !profile.evidenceRef ||
    !Number.isFinite(Date.parse(profile.verifiedAt))
  )
    unavailable('No verified metadata-only long-book profile is configured.');
  if (
    typeof profile.metadataRoute !== 'string' ||
    !profile.metadataRoute.includes('{workId}') ||
    profile.metadataRoute.includes('{chapterId}') ||
    typeof profile.targetPattern !== 'string' ||
    !profile.identity ||
    !profile.state ||
    !profile.title ||
    !profile.save ||
    !Array.isArray(profile.editableStates) ||
    !profile.editableStates.length ||
    profile.editableStates.some((state) => !bookStates.has(state)) ||
    !profile.states ||
    !Object.values(profile.states).length ||
    Object.values(profile.states).some((state) => !bookStates.has(state))
  )
    unavailable('The long-book metadata profile is incomplete.');
  for (const [key, binding] of Object.entries(profile.fields ?? {})) {
    if (
      !metadataKeys.has(key) ||
      !binding ||
      !['text', 'select', 'radio', 'checkbox', 'upload'].includes(binding.kind)
    )
      unavailable('The long-book profile has an unsupported metadata binding.');
    if (binding.kind === 'upload' && (key !== 'cover' || !binding.readHash))
      unavailable('Cover metadata requires a verified hash readback.');
    if (key === 'cover' && binding.kind !== 'upload')
      unavailable('Cover metadata must use controlled upload and hash readback.');
  }
  return profile;
}

export function bookUrl(
  profile: UiLongBookMetadataProfile,
  target: LongBookMetadataTarget,
): string {
  bookTarget(target);
  const route = profile.metadataRoute.replaceAll('{workId}', target.workId);
  let url: URL;
  try {
    url = new URL(safeUrl(route));
  } catch {
    unavailable('The metadata profile route is invalid.');
  }
  if (
    /(?:^|[\/_-])(?:new|create|editor|edit-chapter|publish|submit|sign|contract|finance|income|withdraw)(?:[\/_-]|$)/i.test(
      url.pathname,
    )
  )
    unavailable(
      'Creation, manuscript editor, submission and financial routes are outside this metadata capability.',
    );
  return url.href;
}

export function currentBookTarget(
  page: Page,
  profile: UiLongBookMetadataProfile,
  expected: LongBookMetadataTarget,
): void {
  let url: URL;
  let match: RegExpExecArray | null;
  try {
    url = new URL(safeUrl(page.url()));
    match = new RegExp(profile.targetPattern).exec(url.pathname);
  } catch {
    unavailable('The metadata target route cannot be verified.');
  }
  if (
    !match ||
    match[0] !== url.pathname ||
    match.groups?.workId !== expected.workId ||
    match.groups?.chapterId !== undefined ||
    url.href !== bookUrl(profile, expected)
  )
    throw new PlatformWriteError(
      'version_conflict',
      'The metadata page does not identify the requested existing work.',
    );
}

export function checkedBookMetadata(
  metadata: DraftMetadata,
  requestedUpload = false,
): DraftMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    invalid('Metadata must be a JSON object.');
  const checked: DraftMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!metadataKeys.has(key)) invalid('Unsupported long-book metadata field.');
    if (key === 'description') {
      if (typeof value !== 'string' || value.includes('\0'))
        invalid('description must be a string without NUL.');
      checked.description = value;
    }
    if (key === 'categories') {
      if (
        !Array.isArray(value) ||
        value.length > 8 ||
        value.some((item) => typeof item !== 'string' || item.includes('\0')) ||
        new Set(value).size !== value.length
      )
        invalid('categories must contain at most eight distinct strings.');
      checked.categories = [...value] as string[];
    }
    if (key === 'aiDeclaration') {
      if (value !== 'yes' && value !== 'no') invalid('aiDeclaration must explicitly be yes or no.');
      checked.aiDeclaration = value;
    }
    if (key === 'trialRatio') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
        invalid('trialRatio must be between 0 and 100.');
      checked.trialRatio = value;
    }
    if (key === 'cover') {
      if (typeof value === 'string' && !requestedUpload && /^[a-f0-9]{64}$/.test(value))
        checked.cover = value;
      else if (
        value &&
        typeof value === 'object' &&
        Object.keys(value).length === 2 &&
        Object.keys(value).every((key) => key === 'uploadPath' || key === 'sha256') &&
        typeof value.uploadPath === 'string' &&
        /^[a-f0-9]{64}$/.test(value.sha256)
      )
        checked.cover = { uploadPath: value.uploadPath, sha256: value.sha256 };
      else
        invalid(
          'A cover must identify verified image contents; new covers require a controlled upload reference.',
        );
    }
  }
  return checked;
}

function canonicalBookMetadata(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBookMetadata).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalBookMetadata((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}

export function hashLongBookMetadata(content: { title: string; metadata: DraftMetadata }): string {
  if (typeof content.title !== 'string' || content.title.includes('\0'))
    invalid('title must be a string without NUL.');
  const metadata = checkedBookMetadata(content.metadata);
  if (metadata.cover && typeof metadata.cover !== 'string') metadata.cover = metadata.cover.sha256;
  return sha256(
    canonicalBookMetadata({ schema: 'long-book-metadata/v1', title: content.title, metadata }),
  );
}

async function readLongBookMetadataFields(
  page: Page,
  profile: UiLongBookMetadataProfile,
): Promise<DraftMetadata> {
  const metadata: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(profile.fields ?? {})) {
    if (!metadataKeys.has(key) || !binding)
      unavailable('The metadata profile contains an unsupported field.');
    let value: unknown;
    if (binding.kind === 'text' || binding.kind === 'upload') {
      value =
        binding.kind === 'text'
          ? await readTextInput(page, binding.selector)
          : await readField(page, binding.readHash);
      if (typeof value !== 'string')
        unavailable('A declared metadata text or hash field is not a complete string.');
    } else if (binding.kind === 'checkbox') {
      const checked = await (await unique(page, binding.selector)).isChecked();
      if (typeof checked !== 'boolean') unavailable('The metadata checkbox state is unverified.');
      const values = Object.entries(binding.values).filter(([, value]) => value === checked);
      if (values.length !== 1)
        unavailable('The metadata checkbox state has no unique logical value.');
      value = values[0]![0];
    } else if (binding.kind === 'radio') {
      const selected: string[] = [];
      for (const [logical, selector] of Object.entries(binding.choices)) {
        const checked = await (await unique(page, selector)).isChecked();
        if (typeof checked !== 'boolean') unavailable('The metadata radio state is unverified.');
        if (checked) selected.push(logical);
      }
      if (selected.length !== 1)
        unavailable('The metadata radio group has no unique selected value.');
      value = selected[0];
    } else {
      const locator = await unique(page, binding.selector);
      const raw = await locator.evaluate((element) =>
        Array.from((element as HTMLSelectElement).selectedOptions).map((option) => option.value),
      );
      if (
        !Array.isArray(raw) ||
        raw.some((value) => typeof value !== 'string') ||
        new Set(raw).size !== raw.length ||
        (!binding.multiple && raw.length !== 1)
      )
        unavailable('The declared metadata select has ambiguous or incomplete cardinality.');
      if (key === 'trialRatio' && raw.some((value) => !value || value.trim() !== value))
        unavailable('The platform trial ratio was not observed as a nonempty value.');
      const mapped = raw.map((value) => {
        if (!binding.values) return value;
        const matches = Object.entries(binding.values).filter(([, observed]) => observed === value);
        if (matches.length !== 1)
          unavailable('The raw metadata selection has no unique verified inverse mapping.');
        return matches[0]![0];
      });
      value = binding.multiple ? mapped : mapped[0];
    }
    if (key === 'trialRatio') {
      if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
        unavailable('The platform trial ratio is not a complete decimal numeric token.');
      value = Number(value);
    }
    metadata[key] = value;
  }
  return checkedBookMetadata(metadata as DraftMetadata);
}

export async function readLongBookMetadataSnapshot(
  page: Page,
  accountId: string,
  target: LongBookMetadataTarget,
  options: LongBookMetadataOptions = {},
): Promise<LongBookMetadataSnapshot> {
  const profile = requireBookProfile(options);
  bookTarget(target);
  await page.goto(bookUrl(profile, target), {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs ?? 30_000,
  });
  currentBookTarget(page, profile, target);
  await verifyIdentity(page, accountId, profile, options);
  const state = profile.states[(await readField(page, profile.state)).trim()];
  if (!state || !bookStates.has(state))
    unavailable('The work state is outside the verified metadata mapping.');
  const title = await readTextInput(page, profile.title);
  let metadata: DraftMetadata;
  try {
    metadata = await readLongBookMetadataFields(page, profile);
  } catch {
    unavailable('The declared work metadata cannot be read completely.');
  }
  if (typeof title !== 'string' || !title || title.includes('\0'))
    unavailable('The work title cannot be read completely.');
  currentBookTarget(page, profile, target);
  await verifyIdentity(page, accountId, profile, options);
  currentBookTarget(page, profile, target);
  if (profile.states[(await readField(page, profile.state)).trim()] !== state)
    throw new PlatformWriteError(
      'version_conflict',
      'The work state changed during metadata readback.',
    );
  currentBookTarget(page, profile, target);
  return {
    snapshotScope: 'long_book_metadata',
    hashBasis: 'long-book-metadata/v1',
    accountId,
    target: { kind: 'long-book', workId: target.workId },
    state,
    title,
    metadata,
    metadataHash: hashLongBookMetadata({ title, metadata }),
    sourceUrl: page.url(),
    platformReadAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

export function unknownBook(target: LongBookMetadataTarget): LongBookMetadataResult {
  return {
    status: 'uncertain',
    capability: 'update_work_metadata',
    target,
    snapshotScope: 'long_book_metadata',
    hashBasis: 'long-book-metadata/v1',
    code: 'outcome_unknown',
    reason:
      'The metadata action may have happened; perform read-only reconciliation before any further write.',
  };
}
