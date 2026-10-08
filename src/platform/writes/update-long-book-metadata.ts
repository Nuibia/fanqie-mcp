import { type Page } from 'playwright';

import {
  type LongBookMetadataInput,
  type LongBookMetadataOptions,
  type LongBookMetadataResult,
  type UiLongBookMetadataProfile,
} from './diagnostic-url.js';

import {
  requireBookProfile,
  bookTarget,
  checkedBookMetadata,
  readLongBookMetadataSnapshot,
  hashLongBookMetadata,
  currentBookTarget,
  unknownBook,
  bookUrl,
} from './book-target.js';

import { invalid, unavailable } from './is-generic-short-capture-failure.js';

import {
  PlatformWriteError,
  type DraftMetadata,
  type UploadReference,
} from './hash-draft-content.js';

import { unique, verifyIdentity } from './unique.js';

import { controlledUpload } from './controlled-upload.js';

export async function updateLongBookMetadata(
  page: Page,
  input: LongBookMetadataInput,
  options: LongBookMetadataOptions = {},
): Promise<LongBookMetadataResult> {
  const profile = requireBookProfile(options);
  bookTarget(input.target);
  const supplied = checkedBookMetadata(input.metadata, true);
  if (
    input.title !== undefined &&
    (typeof input.title !== 'string' || !input.title || input.title.includes('\0'))
  )
    invalid('title must be a nonempty string without NUL.');
  const before = await readLongBookMetadataSnapshot(page, input.accountId, input.target, options);
  if (!/^[a-f0-9]{64}$/.test(input.expectedContentHash))
    invalid('expectedContentHash must identify a metadata SHA-256.');
  if (
    before.metadataHash !== input.expectedContentHash ||
    before.state !== input.expectedState ||
    !profile.editableStates.includes(before.state)
  )
    throw new PlatformWriteError(
      'version_conflict',
      'The metadata version or editable work state changed.',
    );
  const uploads = new Map<string, string>();
  await unique(page, profile.save);
  if (input.title !== undefined) await unique(page, profile.title);
  for (const [key, value] of Object.entries(supplied)) {
    const binding = profile.fields?.[key as keyof DraftMetadata];
    if (!binding) unavailable('The metadata profile does not support the requested field.');
    if (binding.kind === 'radio') {
      if (!binding.choices[String(value)])
        unavailable('This metadata option is outside the verified choices.');
      await unique(page, binding.choices[String(value)]!);
    } else {
      await unique(page, binding.selector);
      if (
        binding.kind === 'select' &&
        binding.values &&
        (Array.isArray(value) ? value : [value]).some(
          (value) => !Object.hasOwn(binding.values!, String(value)),
        )
      )
        unavailable('This metadata option is outside the verified choices.');
      if (binding.kind === 'checkbox' && !Object.hasOwn(binding.values, String(value)))
        unavailable('This metadata option is outside the verified choices.');
      if (binding.kind === 'upload')
        uploads.set(key, await controlledUpload(value as UploadReference, options));
    }
  }
  const desiredContentHash = hashLongBookMetadata({
    title: input.title ?? before.title,
    metadata: { ...before.metadata, ...supplied },
  });
  currentBookTarget(page, profile, input.target);
  await verifyIdentity(page, input.accountId, profile, options);
  currentBookTarget(page, profile, input.target);
  if (!options.beforeSideEffect)
    unavailable('A durable runtime metadata write-intent hook is required.');
  await options.beforeSideEffect({
    capability: 'update_work_metadata',
    target: input.target,
    snapshotScope: 'long_book_metadata',
    hashBasis: 'long-book-metadata/v1',
    expectedContentHash: input.expectedContentHash,
    desiredContentHash,
    expectedStates: [before.state],
  });
  try {
    currentBookTarget(page, profile, input.target);
    await verifyIdentity(page, input.accountId, profile, options);
    currentBookTarget(page, profile, input.target);
    if (input.title !== undefined) {
      const locator = await unique(page, profile.title);
      currentBookTarget(page, profile, input.target);
      await locator.fill(input.title);
    }
    for (const [key, value] of Object.entries(supplied)) {
      const binding = profile.fields![key as keyof DraftMetadata]!;
      if (binding.kind === 'radio') {
        const locator = await unique(page, binding.choices[String(value)]!);
        currentBookTarget(page, profile, input.target);
        await locator.check();
      } else {
        const locator = await unique(page, binding.selector);
        currentBookTarget(page, profile, input.target);
        if (binding.kind === 'text') await locator.fill(String(value));
        else if (binding.kind === 'checkbox')
          await locator.setChecked(binding.values[String(value)]!);
        else if (binding.kind === 'upload') await locator.setInputFiles(uploads.get(key)!);
        else {
          const values = (Array.isArray(value) ? value : [value]).map(
            (value) => binding.values?.[String(value)] ?? String(value),
          );
          await locator.selectOption(binding.multiple ? values : values[0]!);
        }
      }
    }
    const save = await unique(page, profile.save);
    currentBookTarget(page, profile, input.target);
    await save.click();
    const after = await readLongBookMetadataSnapshot(page, input.accountId, input.target, options);
    if (after.metadataHash !== desiredContentHash || after.state !== before.state)
      return unknownBook(input.target);
    return {
      status: 'succeeded',
      capability: 'update_work_metadata',
      target: after.target,
      snapshotScope: after.snapshotScope,
      hashBasis: after.hashBasis,
      metadataHash: after.metadataHash,
      platformState: after.state,
      verifiedAt: after.platformReadAt,
      sourceUrl: after.sourceUrl,
    };
  } catch {
    return unknownBook(input.target);
  }
}

export function getLongBookMetadataCapabilities(profile?: UiLongBookMetadataProfile) {
  let available = false;
  try {
    const verified = requireBookProfile({ profile });
    bookUrl(verified, { kind: 'long-book', workId: '1000000000' });
    available = true;
  } catch {
    /* configuration does not establish a verified live maintenance result */
  }
  return {
    implemented: true,
    available,
    verification: 'not-verified-live' as const,
    scope: 'existing-long-book-metadata' as const,
    hashBasis: 'long-book-metadata/v1' as const,
    bodyIncluded: false,
    createAvailable: false,
    submissionAvailable: false,
  };
}
