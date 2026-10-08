import { type Page, type Locator } from 'playwright';

import {
  type UiWriteProfile,
  type WriteOptions,
  type WriteTarget,
  origin,
  type DraftSnapshot,
  type WriteSnapshot,
  PlatformWriteError,
  type PlatformState,
  normalizeBody,
  hashDraftContent,
  type DraftContent,
  metadataKeys,
} from './hash-draft-content.js';

import {
  unavailable,
  invalid,
  validateTarget,
  sameTarget,
  editorUrl,
  requireProfile,
  isModernShortSnapshot,
  validateGenericShortSnapshot,
} from './is-generic-short-capture-failure.js';

import {
  targetFromPage,
  boundedPause,
  type ShortSnapshotMode,
  verifyIdentity,
  readField,
  readTextInput,
  unique,
  readMetadata,
  assertCurrentTarget,
} from './unique.js';

import { readShortServerSnapshot } from './read-short-server-snapshot.js';

export async function awaitCreatedShortTarget(
  page: Page,
  profile: UiWriteProfile,
  newUrl: string,
  options: WriteOptions,
): Promise<WriteTarget> {
  const deadline = performance.now() + (options.timeoutMs ?? 20_000),
    initial = new URL(newUrl);
  while (performance.now() < deadline) {
    const current = new URL(page.url());
    if (
      current.origin !== origin ||
      current.username ||
      current.password ||
      current.hash ||
      current.search !== initial.search
    )
      unavailable('The new short editor left its observed creation route.');
    try {
      const target = targetFromPage(page, profile);
      return target;
    } catch (error) {
      if (page.url() !== newUrl) throw error;
    }
    await boundedPause(deadline);
  }
  unavailable('The new short editor did not expose a stable target before its deadline.');
}

export function chapterCreationTimeout(timeoutMs: number | undefined): number {
  const timeout = timeoutMs === undefined ? 20_000 : timeoutMs;
  if (!Number.isFinite(timeout) || timeout <= 0)
    invalid('Chapter creation requires a finite positive timeout.');
  return Math.min(timeout, 30_000);
}

export function assertCreatedChapterTarget(
  page: Page,
  profile: UiWriteProfile,
  target: WriteTarget,
  requestedWorkId: string,
  pinnedUrl: string,
): void {
  validateTarget(target);
  if (target.kind !== 'chapter' || target.workId !== requestedWorkId)
    unavailable('The created chapter does not belong to the requested stable work.');
  const currentUrl = page.url(),
    current = new URL(currentUrl);
  if (
    current.origin !== origin ||
    current.username ||
    current.password ||
    current.hash ||
    !current.pathname.startsWith('/main/writer/') ||
    currentUrl !== pinnedUrl
  )
    unavailable('The created chapter left its pinned editor route.');
  if (!sameTarget(targetFromPage(page, profile), target))
    unavailable('The created chapter no longer identifies the bound stable target.');
}

export async function awaitCreatedChapterTarget(
  page: Page,
  profile: UiWriteProfile,
  newUrl: string,
  requestedWorkId: string,
  deadline: number,
): Promise<{ target: WriteTarget; pinnedUrl: string }> {
  const initial = new URL(newUrl);
  while (performance.now() < deadline) {
    const currentUrl = page.url(),
      current = new URL(currentUrl);
    if (
      current.origin !== origin ||
      current.username ||
      current.password ||
      current.hash ||
      current.search !== initial.search
    )
      unavailable('The new chapter editor left its verified creation route.');
    // Only the exact creation URL may wait. Any other route must already be the complete verified target.
    if (currentUrl !== newUrl) {
      const target = targetFromPage(page, profile),
        pinnedUrl = editorUrl(profile, target);
      assertCreatedChapterTarget(page, profile, target, requestedWorkId, pinnedUrl);
      if (performance.now() >= deadline)
        unavailable('The new chapter target validation exceeded its deadline.');
      return { target, pinnedUrl };
    }
    await boundedPause(deadline);
  }
  unavailable('The new chapter editor did not expose a stable target before its deadline.');
}

/** The exported generic reader uses the modern protocol only for its fixed native short source. */
export async function readWriteSnapshot(
  page: Page,
  accountId: string,
  target: WriteTarget,
  options: WriteOptions = {},
): Promise<DraftSnapshot> {
  return target.kind === 'short' &&
    options.profile?.kind === 'short' &&
    options.profile.serverState === 'short_article_edit_v1'
    ? readWriteSnapshotInMode(page, accountId, target, options, 'modern_short')
    : readWriteSnapshotInMode(page, accountId, target, options, 'legacy_authority');
}

export function readWriteSnapshotInMode(
  page: Page,
  accountId: string,
  target: WriteTarget,
  options: WriteOptions,
  mode: 'legacy_authority',
): Promise<WriteSnapshot>;

export function readWriteSnapshotInMode(
  page: Page,
  accountId: string,
  target: WriteTarget,
  options: WriteOptions,
  mode: 'modern_short',
): Promise<DraftSnapshot>;

export async function readWriteSnapshotInMode(
  page: Page,
  accountId: string,
  target: WriteTarget,
  options: WriteOptions,
  mode: ShortSnapshotMode,
): Promise<DraftSnapshot> {
  const profile = requireProfile(options, target.kind);
  if (!accountId) invalid('accountId is required.');
  if (
    target.kind === 'short' &&
    profile.kind === 'short' &&
    profile.serverState === 'short_article_edit_v1'
  )
    return readShortServerSnapshot(page, accountId, target, profile, options, mode);
  await page.goto(editorUrl(profile, target), {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs ?? 30_000,
  });
  const actual = targetFromPage(page, profile);
  if (!sameTarget(actual, target))
    throw new PlatformWriteError(
      'version_conflict',
      'The platform opened a different stable target.',
    );
  return snapshotFromCurrentPage(page, accountId, actual, profile, options);
}

async function readShortEditorDocument(bodyControl: Locator): Promise<string> {
  const body = await bodyControl.evaluate((root) => {
    try {
      type DocumentApi = {
        content?: { size?: unknown };
        textBetween?: (
          from: number,
          to: number,
          blockSeparator: string,
          leafText: string,
        ) => unknown;
      };
      type ViewApi = { dom?: unknown; state?: { doc?: DocumentApi } };
      const currentWindow = root.ownerDocument.defaultView as
        (Window & { adapter?: { view?: ViewApi } }) | null;
      const view = currentWindow?.adapter?.view,
        doc = view?.state?.doc,
        size = doc?.content?.size;
      if (
        !root.isConnected ||
        view?.dom !== root ||
        !doc ||
        typeof doc.textBetween !== 'function' ||
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < 0 ||
        size > 3_000_000
      )
        return null;
      const text = doc.textBetween(0, size, '\n', '\n');
      if (
        typeof text !== 'string' ||
        text.length > 3_000_000 ||
        text.includes('\0') ||
        currentWindow?.adapter?.view !== view ||
        view.state?.doc !== doc ||
        view.dom !== root ||
        !root.isConnected ||
        doc.content?.size !== size
      )
        return null;
      return text;
    } catch {
      return null;
    }
  });
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 3_000_000)
    unavailable(
      'The complete short editor document body was unavailable or not bound to the current root.',
    );
  return body;
}

export async function snapshotFromCurrentPage(
  page: Page,
  accountId: string,
  target: WriteTarget,
  profile: UiWriteProfile,
  options: WriteOptions,
  serverState?: PlatformState,
): Promise<WriteSnapshot> {
  await verifyIdentity(page, accountId, profile, options);
  const visibleState = serverState ? undefined : (await readField(page, profile.state!)).trim();
  const state = serverState ?? profile.states[visibleState!];
  if (!state) unavailable('The platform state is absent or outside the verified state mapping.');
  const title = await readTextInput(page, profile.title);
  const bodyControl = await unique(page, profile.body);
  const body = normalizeBody(
    profile.bodyRead === 'short_editor_document'
      ? await readShortEditorDocument(bodyControl)
      : profile.bodyParagraphSelector
        ? (await bodyControl.locator(profile.bodyParagraphSelector).allTextContents()).join('\n')
        : await readTextInput(page, profile.body),
  );
  const content = { title, body, metadata: await readMetadata(page, profile) };
  assertCurrentTarget(page, profile, target);
  return {
    ...content,
    accountId,
    target,
    state,
    contentHash: hashDraftContent(content),
    sourceUrl: page.url(),
    platformReadAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

export function validateContent(content: DraftContent): void {
  if (
    !content ||
    typeof content.title !== 'string' ||
    typeof content.body !== 'string' ||
    content.title.includes('\0') ||
    content.body.includes('\0')
  )
    invalid('title and body must be JSON strings without NUL characters.');
  for (const [key, value] of Object.entries(content.metadata ?? {})) {
    if (!metadataKeys.has(key)) invalid('Unsupported metadata field.');
    if (key === 'description' && typeof value !== 'string')
      invalid('description must be a string.');
    if (
      key === 'categories' &&
      (!Array.isArray(value) ||
        value.length > 8 ||
        value.some((item) => typeof item !== 'string') ||
        new Set(value).size !== value.length)
    )
      invalid('categories must contain at most eight distinct values.');
    if (key === 'aiDeclaration' && value !== 'yes' && value !== 'no')
      invalid('aiDeclaration must explicitly be yes or no.');
    if (
      key === 'trialRatio' &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    )
      invalid('trialRatio must be between 0 and 100.');
    if (
      key === 'cover' &&
      (typeof value !== 'object' ||
        value === null ||
        !('uploadPath' in value) ||
        !('sha256' in value))
    )
      invalid('A new cover must use a controlled upload reference.');
  }
}

export function checkPreconditions(
  snapshot: DraftSnapshot,
  expectedHash: string,
  expectedState: PlatformState,
  profile: UiWriteProfile,
): void {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) invalid('expectedContentHash must be a SHA-256 hash.');
  if (snapshot.contentHash !== expectedHash || snapshot.state !== expectedState)
    throw new PlatformWriteError(
      'version_conflict',
      'The platform content or state changed since the request was prepared.',
    );
  if (
    (isModernShortSnapshot(snapshot) &&
      !validateGenericShortSnapshot(snapshot).statusFacts.draftEditable) ||
    !profile.editableStates.some((state) => state === snapshot.state)
  )
    throw new PlatformWriteError(
      'version_conflict',
      'The target state is not approved for editing by this page profile.',
    );
}
