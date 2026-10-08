import { type Page } from 'playwright';

import {
  type CreateDraftInput,
  type WriteOptions,
  type WriteTarget,
  type WriteResult,
  type WriteCapability,
  origin,
  PlatformWriteError,
  type DraftMetadata,
  type UploadReference,
  hashDraftContent,
  type WriteSnapshot,
  type UiWriteProfile,
  sha256,
  canonical,
  type SubmitInput,
  type PreparedSubmission,
} from './hash-draft-content.js';

import {
  validateContent,
  chapterCreationTimeout,
  awaitCreatedChapterTarget,
  assertCreatedChapterTarget,
  awaitCreatedShortTarget,
  readWriteSnapshot,
  snapshotFromCurrentPage,
  readWriteSnapshotInMode,
  checkPreconditions,
} from './await-created-short-target.js';

import {
  invalid,
  requireProfile,
  unavailable,
  safeUrl,
  sameTarget,
  isModernShortSnapshot,
  validateGenericShortSnapshot,
  isGenericShortCaptureFailure,
} from './is-generic-short-capture-failure.js';

import {
  verifyIdentity,
  targetFromPage,
  assertCurrentTarget,
  unique,
  readField,
} from './unique.js';

import {
  controlledUpload,
  recordIntent,
  writerShortObservations,
  unknown,
  preflightFields,
  fillContent,
  confirmed,
} from './controlled-upload.js';

import { clickShortSaveWithAcknowledgement } from './click-short-save-with-acknowledgement.js';

import { randomUUID } from 'node:crypto';

export async function createTarget(
  page: Page,
  input: CreateDraftInput,
  options: WriteOptions,
  kind: WriteTarget['kind'],
  workId?: string,
): Promise<WriteResult> {
  validateContent(input.content);
  if (!input.accountId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(input.clientReference))
    invalid('A bounded clientReference and accountId are required.');
  const chapterTimeoutMs =
    kind === 'chapter' ? chapterCreationTimeout(options.timeoutMs) : undefined;
  const profile = requireProfile(options, kind);
  const capability: WriteCapability = kind === 'short' ? 'create_draft' : 'save_chapter_draft';
  if (!profile.newRoute)
    unavailable('No verified draft creation route is configured for this target kind.');
  if (!options.onTargetDiscovered)
    unavailable('A durable target-ID recording hook is required before creating a platform draft.');
  const newUrl = safeUrl(profile.newRoute.replaceAll('{workId}', workId ?? ''));
  // Identity is verified on the current authenticated writer page before entering a route that may create.
  const currentUrl = new URL(page.url());
  if (currentUrl.origin !== origin)
    throw new PlatformWriteError(
      'requires_login',
      'The creation request requires the matching signed-in writer account.',
    );
  await verifyIdentity(page, input.accountId, profile, options);
  // Reject unsupported fields and unsafe uploads before a zero-word draft can be created.
  for (const [key, value] of Object.entries(input.content.metadata ?? {})) {
    const binding = profile.fields?.[key as keyof DraftMetadata];
    if (!binding) unavailable(`The verified page profile does not support ${key}.`);
    if (binding.kind === 'upload') await controlledUpload(value as UploadReference, options);
    if (binding.kind === 'radio' && !binding.choices[String(value)])
      unavailable('This metadata option is outside the verified choices.');
    if (binding.kind === 'checkbox' && !Object.hasOwn(binding.values, String(value)))
      unavailable('This checkbox value is outside the verified choices.');
    if (
      binding.kind === 'select' &&
      binding.values &&
      (Array.isArray(value) ? value : [value]).some(
        (value) => !Object.hasOwn(binding.values!, String(value)),
      )
    )
      unavailable('This metadata option is outside the verified choices.');
  }
  const chapterProfileHash = kind === 'chapter' ? profileHash(profile) : undefined;
  await recordIntent(options, {
    capability,
    clientReference: input.clientReference,
    requestedContentHash: hashDraftContent(input.content),
  });
  let target: WriteTarget | undefined;
  const observations = writerShortObservations(
    options,
    kind === 'short' && profile.kind === 'short' && profile.serverState === 'short_article_edit_v1',
  );
  try {
    let chapterBinding: { target: WriteTarget; pinnedUrl: string } | undefined;
    // This deadline covers both the one creation navigation and subsequent ID discovery.
    const chapterDeadline =
      chapterTimeoutMs === undefined ? undefined : performance.now() + chapterTimeoutMs;
    const navigationTimeout =
      chapterDeadline === undefined
        ? (options.timeoutMs ?? 30_000)
        : chapterDeadline - performance.now();
    if (chapterDeadline !== undefined && navigationTimeout <= 0)
      unavailable('The chapter creation navigation exceeded its deadline.');
    await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
    if (kind === 'chapter') {
      if (profileHash(profile) !== chapterProfileHash)
        unavailable('The verified chapter profile changed during creation.');
      chapterBinding = await awaitCreatedChapterTarget(
        page,
        profile,
        newUrl,
        workId!,
        chapterDeadline!,
      );
      if (profileHash(profile) !== chapterProfileHash)
        unavailable('The verified chapter profile changed during target discovery.');
      target = chapterBinding.target;
      assertCreatedChapterTarget(page, profile, target, workId!, chapterBinding.pinnedUrl);
    } else if (profile.serverState)
      target = await awaitCreatedShortTarget(page, profile, newUrl, options);
    else target = targetFromPage(page, profile);
    const discoveredTarget = kind === 'chapter' ? { ...target } : target;
    await options.onTargetDiscovered(discoveredTarget);
    if (chapterBinding) {
      if (profileHash(profile) !== chapterProfileHash || !sameTarget(discoveredTarget, target))
        unavailable('The durable chapter target hook changed the verified binding.');
      assertCreatedChapterTarget(page, profile, target, workId!, chapterBinding.pinnedUrl);
    }
    if (profile.serverState) assertCurrentTarget(page, profile, target);
    if (workId && target.workId !== workId)
      return unknown(
        capability,
        target,
        'The platform created a chapter under a different stable work ID.',
      );
    const baseline = profile.serverState
      ? await readWriteSnapshot(page, input.accountId, target, options)
      : await snapshotFromCurrentPage(page, input.accountId, target, profile, options);
    await observations.observe('baseline', baseline);
    if (
      (isModernShortSnapshot(baseline) &&
        !validateGenericShortSnapshot(baseline).statusFacts.draftEditable) ||
      !profile.editableStates.some((state) => state === baseline.state)
    )
      return observations.result(
        unknown(capability, target, 'The created target is outside the verified editable states.'),
      );
    const uploads = await preflightFields(page, input.content, profile, options);
    const expected = {
      ...input.content,
      metadata: { ...baseline.metadata, ...input.content.metadata },
    };
    await recordIntent(options, {
      capability,
      target,
      clientReference: input.clientReference,
      desiredContentHash: hashDraftContent(expected),
      expectedStates: [
        isModernShortSnapshot(baseline) ? 'draft' : (baseline as WriteSnapshot).state,
      ],
    });
    const wireHTML = await fillContent(
      page,
      input.content,
      profile,
      uploads,
      target,
      options,
      input.accountId,
    );
    const save = await unique(page, profile.save);
    assertCurrentTarget(page, profile, target);
    if (profile.serverState || profile.saveAcknowledgement)
      await clickShortSaveWithAcknowledgement(
        page,
        save,
        profile,
        target,
        input.content.title,
        options,
        wireHTML,
      );
    else await save.click();
    const after = await readWriteSnapshot(page, input.accountId, target, options);
    await observations.observe('after', after);
    return observations.result(
      after.contentHash === hashDraftContent(expected) &&
        after.state === baseline.state &&
        (!isModernShortSnapshot(after) ||
          validateGenericShortSnapshot(after).statusFacts.draftEditable)
        ? confirmed(capability, after)
        : unknown(
            capability,
            target,
            'The created platform target failed complete readback verification.',
          ),
    );
  } catch (error) {
    if (observations.failed() || isGenericShortCaptureFailure(error)) throw error;
    return observations.result(unknown(capability, target));
  }
}

export function profileHash(profile: UiWriteProfile): string {
  return sha256(canonical(profile));
}

export async function readTerms(page: Page, profile: UiWriteProfile): Promise<string[]> {
  if (
    !profile.submission?.terms.length ||
    !profile.submission.steps.length ||
    !profile.submission.acceptedStates.length
  )
    unavailable('Submission controls and terms have not been verified for this page profile.');
  const terms = await Promise.all(profile.submission.terms.map((field) => readField(page, field)));
  if (terms.some((term) => !term.trim()))
    unavailable('The actual platform publication terms are unavailable.');
  return terms;
}

export async function prepareSubmission(
  page: Page,
  input: Omit<SubmitInput, 'prepared' | 'acceptPublicationTerms'>,
  options: WriteOptions = {},
): Promise<PreparedSubmission> {
  const profile = requireProfile(options, input.target.kind);
  const snapshot = await readWriteSnapshotInMode(
    page,
    input.accountId,
    input.target,
    options,
    'legacy_authority',
  );
  checkPreconditions(snapshot, input.expectedContentHash, input.expectedState, profile);
  const terms = await readTerms(page, profile);
  assertCurrentTarget(page, profile, snapshot.target);
  const now = options.now?.() ?? new Date();
  const ttl = profile.submission?.preparationTtlMs ?? 5 * 60_000;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 30 * 60_000)
    unavailable('The submission preparation lifetime is invalid.');
  return {
    preparationId: randomUUID(),
    accountId: input.accountId,
    target: input.target,
    expectedContentHash: snapshot.contentHash,
    expectedState: snapshot.state,
    profileHash: profileHash(profile),
    termsHash: sha256(canonical(terms)),
    terms,
    title: snapshot.title,
    metadata: snapshot.metadata ?? {},
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
  };
}
