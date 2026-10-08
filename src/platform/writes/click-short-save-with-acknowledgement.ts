import { type Page, type Locator, type Request, type Response } from 'playwright';

import {
  type UiWriteProfile,
  type WriteTarget,
  type WriteOptions,
  origin,
  type UpdateDraftInput,
  type WriteCapability,
  type WriteResult,
  type DraftContent,
  hashDraftContent,
  type UpdateMetadataInput,
  type SaveChapterInput,
  type CreateDraftInput,
  type CreateChapterInput,
  idPattern,
} from './hash-draft-content.js';

import {
  editorUrl,
  unavailable,
  requireProfile,
  isModernShortSnapshot,
  validateGenericShortSnapshot,
  isGenericShortCaptureFailure,
  invalid,
} from './is-generic-short-capture-failure.js';

import {
  shortSaveParametersMatch,
  writerShortObservations,
  preflightFields,
  recordIntent,
  fillContent,
  confirmed,
  unknown,
} from './controlled-upload.js';

import { assertShortReadTarget, boundedPause, unique, assertCurrentTarget } from './unique.js';

import {
  validateContent,
  readWriteSnapshot,
  checkPreconditions,
} from './await-created-short-target.js';

import { createTarget } from './create-target.js';

export async function clickShortSaveWithAcknowledgement(
  page: Page,
  save: Locator,
  profile: UiWriteProfile,
  target: WriteTarget,
  desiredTitle: string,
  options: WriteOptions,
  desiredWireHTML?: string,
): Promise<void> {
  const deadline = performance.now() + (options.timeoutMs ?? 20_000),
    destination = editorUrl(profile, target);
  const requests = new Set<Request>();
  let clickStarted = false,
    acknowledged = false,
    invalidAcknowledgement = false,
    closed = false;
  const matchUrl = (raw: string): boolean => {
    try {
      const u = new URL(raw);
      return (
        u.origin === origin &&
        !u.username &&
        !u.password &&
        !u.hash &&
        u.pathname === '/api/author/short_article/cover/v0/'
      );
    } catch {
      return false;
    }
  };
  const onRequest = (request: Request): void => {
    if (closed || !clickStarted) return;
    try {
      if (
        request.method() === 'POST' &&
        matchUrl(request.url()) &&
        ['xhr', 'fetch'].includes(request.resourceType()) &&
        request.frame() === page.mainFrame() &&
        page.url() === destination &&
        shortSaveParametersMatch(request, target, desiredTitle, desiredWireHTML)
      )
        requests.add(request);
    } catch {
      invalidAcknowledgement = true;
    }
  };
  const onResponse = (response: Response): void => {
    if (closed) return;
    try {
      const request = response.request();
      if (!requests.has(request)) return;
      if (
        response.url() !== request.url() ||
        !matchUrl(response.url()) ||
        page.url() !== destination ||
        response.status() < 200 ||
        response.status() >= 300
      ) {
        invalidAcknowledgement = true;
        return;
      }
      void response.json().then(
        (raw: unknown) => {
          if (closed) return;
          const envelope =
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : null;
          if (page.url() !== destination || envelope?.code !== 0) {
            invalidAcknowledgement = true;
            return;
          }
          acknowledged = true;
        },
        () => {
          if (!closed) invalidAcknowledgement = true;
        },
      );
    } catch {
      invalidAcknowledgement = true;
    }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    assertShortReadTarget(page, profile, target);
    clickStarted = true;
    await save.click({ timeout: Math.max(1, deadline - performance.now()) });
    assertShortReadTarget(page, profile, target);
    while (!acknowledged && !invalidAcknowledgement && performance.now() < deadline) {
      await boundedPause(deadline);
      assertShortReadTarget(page, profile, target);
    }
    if (!acknowledged || invalidAcknowledgement || performance.now() >= deadline)
      unavailable('The current native short save was not acknowledged before its deadline.');
  } finally {
    closed = true;
    page.off('request', onRequest);
    page.off('response', onResponse);
    requests.clear();
  }
}

async function saveExisting(
  page: Page,
  input: UpdateDraftInput,
  options: WriteOptions,
  capability: WriteCapability,
): Promise<WriteResult> {
  validateContent(input.content);
  const profile = requireProfile(options, input.target.kind);
  const observations = writerShortObservations(
    options,
    capability === 'update_draft' &&
      input.target.kind === 'short' &&
      profile.kind === 'short' &&
      profile.serverState === 'short_article_edit_v1',
  );
  const before = await readWriteSnapshot(page, input.accountId, input.target, options);
  await observations.observe('baseline', before);
  checkPreconditions(before, input.expectedContentHash, input.expectedState, profile);
  const merged: DraftContent = {
    ...input.content,
    metadata: { ...before.metadata, ...input.content.metadata },
  };
  // Existing cover hashes are preserved internally; only a changed cover is uploaded.
  const supplied: DraftContent = { ...input.content, metadata: input.content.metadata ?? {} };
  const uploads = await preflightFields(page, supplied, profile, options);
  const desiredContentHash = hashDraftContent(merged);
  await recordIntent(options, {
    capability,
    target: input.target,
    expectedContentHash: input.expectedContentHash,
    desiredContentHash,
    expectedStates: [input.expectedState],
  });
  try {
    const wireHTML = await fillContent(
      page,
      supplied,
      profile,
      uploads,
      before.target,
      options,
      input.accountId,
    );
    const save = await unique(page, profile.save);
    assertCurrentTarget(page, profile, before.target);
    if (profile.serverState || profile.saveAcknowledgement)
      await clickShortSaveWithAcknowledgement(
        page,
        save,
        profile,
        input.target,
        input.content.title,
        options,
        wireHTML,
      );
    else await save.click();
    const after = await readWriteSnapshot(page, input.accountId, input.target, options);
    await observations.observe('after', after);
    return observations.result(
      after.contentHash === desiredContentHash &&
        after.state === before.state &&
        (!isModernShortSnapshot(after) ||
          validateGenericShortSnapshot(after).statusFacts.draftEditable)
        ? confirmed(capability, after)
        : unknown(
            capability,
            input.target,
            'The reopened platform target does not match the requested saved content and state.',
          ),
    );
  } catch (error) {
    if (observations.failed() || isGenericShortCaptureFailure(error)) throw error;
    return observations.result(unknown(capability, input.target));
  }
}

export async function updateDraft(
  page: Page,
  input: UpdateDraftInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (input.target.kind !== 'short') invalid('update_draft requires a short-story target.');
  return saveExisting(page, input, options, 'update_draft');
}

export async function updateWorkMetadata(
  page: Page,
  input: UpdateMetadataInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (options.profile?.serverState === 'short_article_edit_v1')
    unavailable(
      'The native short source verifies title and body only; editable metadata is unavailable.',
    );
  const before = await readWriteSnapshot(page, input.accountId, input.target, options);
  return saveExisting(
    page,
    {
      ...input,
      content: { title: input.title ?? before.title, body: before.body, metadata: input.metadata },
    },
    options,
    'update_work_metadata',
  );
}

export async function saveChapterDraft(
  page: Page,
  input: SaveChapterInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (!input.chapterId) {
    if (!('clientReference' in input))
      invalid('A stable chapterId or creation clientReference is required.');
    return createChapterDraft(
      page,
      {
        accountId: input.accountId,
        workId: input.workId,
        clientReference: input.clientReference,
        content: input.content,
      },
      options,
    );
  }
  return saveExisting(
    page,
    { ...input, target: { kind: 'chapter', workId: input.workId, chapterId: input.chapterId } },
    options,
    'save_chapter_draft',
  );
}

export async function createDraft(
  page: Page,
  input: CreateDraftInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  return createTarget(page, input, options, 'short');
}

export async function createChapterDraft(
  page: Page,
  input: CreateChapterInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (!idPattern.test(input.workId))
    invalid('A stable platform work ID is required before creating a chapter draft.');
  return createTarget(page, input, options, 'chapter', input.workId);
}
