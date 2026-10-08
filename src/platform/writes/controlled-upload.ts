import {
  type UploadReference,
  type WriteOptions,
  sha256,
  type DraftContent,
  type UiWriteProfile,
  type DraftMetadata,
  type WriteTarget,
  normalizeBody,
  type WriteCapability,
  type WriteResult,
  type DraftSnapshot,
  type WriteSnapshot,
  type GenericShortObservation,
} from './hash-draft-content.js';

import {
  invalid,
  unavailable,
  isModernShortSnapshot,
  validateGenericShortSnapshot,
  freezeShortCarrier,
} from './is-generic-short-capture-failure.js';

import { realpath, stat, readFile } from 'node:fs/promises';

import path from 'node:path';

import { type Page, type Request } from 'playwright';

import {
  unique,
  verifyIdentity,
  assertShortReadTarget,
  awaitShortReady,
  assertCurrentTarget,
} from './unique.js';

import {
  discardShortLocalCache,
  assertShortEditorBinding,
  fillShortEditorDocument,
} from './parse-short-server-body.js';

export async function controlledUpload(
  reference: UploadReference,
  options: Pick<WriteOptions, 'uploadRoot'>,
): Promise<string> {
  if (
    !options.uploadRoot ||
    !reference ||
    typeof reference.uploadPath !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reference.sha256)
  )
    invalid('The cover requires a service-controlled upload directory and SHA-256.');
  const uploadRoot = await realpath(options.uploadRoot);
  if (path.isAbsolute(reference.uploadPath))
    invalid('The upload reference must be relative to the service-controlled directory.');
  const file = await realpath(path.resolve(uploadRoot, reference.uploadPath));
  const relative = path.relative(uploadRoot, file);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  )
    invalid('The upload reference escapes the controlled directory.');
  if (!/\.(png|jpe?g|webp)$/i.test(file)) invalid('The upload is not a supported cover image.');
  const info = await stat(file);
  if (!info.isFile() || info.size > 10 * 1024 * 1024)
    invalid('The cover must be a file no larger than 10 MiB.');
  const bytes = await readFile(file);
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp =
    bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if ((!isPng && !isJpeg && !isWebp) || sha256(bytes) !== reference.sha256)
    invalid('The cover contents or hash do not match the controlled image reference.');
  return file;
}

export async function preflightFields(
  page: Page,
  content: DraftContent,
  profile: UiWriteProfile,
  options: WriteOptions,
): Promise<Map<string, string>> {
  await unique(page, profile.title);
  await unique(page, profile.body);
  await unique(page, profile.save);
  const uploads = new Map<string, string>();
  for (const [key, value] of Object.entries(content.metadata ?? {})) {
    const binding = profile.fields?.[key as keyof DraftMetadata];
    if (!binding) unavailable(`The verified page profile does not support ${key}.`);
    if (binding.kind === 'radio') {
      const selector = binding.choices[String(value)];
      if (!selector) unavailable('This metadata option is outside the verified choices.');
      await unique(page, selector);
    } else {
      await unique(page, binding.selector);
      if (binding.kind === 'select' && binding.values) {
        const values = Array.isArray(value) ? value : [value];
        if (values.some((value) => !Object.hasOwn(binding.values!, String(value))))
          unavailable('This metadata option is outside the verified choices.');
      }
      if (binding.kind === 'checkbox' && !Object.hasOwn(binding.values, String(value)))
        unavailable('This checkbox value is outside the verified choices.');
      if (binding.kind === 'upload')
        uploads.set(key, await controlledUpload(value as UploadReference, options));
    }
  }
  return uploads;
}

export async function fillContent(
  page: Page,
  content: DraftContent,
  profile: UiWriteProfile,
  uploads: Map<string, string>,
  target: WriteTarget,
  options: WriteOptions,
  accountId: string,
): Promise<string | undefined> {
  const native = profile.serverState === 'short_article_edit_v1',
    deadline = performance.now() + (options.timeoutMs ?? 20_000);
  if (native) {
    await verifyIdentity(page, accountId, profile, options);
    assertShortReadTarget(page, profile, target);
    await discardShortLocalCache(page, profile, target, deadline);
    assertShortReadTarget(page, profile, target);
    await awaitShortReady(page, profile, target, deadline);
    assertShortReadTarget(page, profile, target);
    const boundBody = await unique(page, profile.body);
    assertShortReadTarget(page, profile, target);
    await assertShortEditorBinding(page, boundBody, profile, target);
    assertShortReadTarget(page, profile, target);
  }
  const title = await unique(page, profile.title);
  assertCurrentTarget(page, profile, target);
  await title.fill(content.title);
  const body = await unique(page, profile.body);
  assertCurrentTarget(page, profile, target);
  let wireHTML: string | undefined;
  if (native)
    wireHTML = await fillShortEditorDocument(
      page,
      body,
      profile,
      target,
      normalizeBody(content.body),
      deadline,
    );
  else await body.fill(normalizeBody(content.body));
  for (const [key, value] of Object.entries(content.metadata ?? {})) {
    const binding = profile.fields![key as keyof DraftMetadata]!;
    if (binding.kind === 'radio') {
      const locator = await unique(page, binding.choices[String(value)]!);
      assertCurrentTarget(page, profile, target);
      await locator.check();
    } else {
      const locator = await unique(page, binding.selector);
      if (binding.kind === 'text') {
        assertCurrentTarget(page, profile, target);
        await locator.fill(String(value));
      } else if (binding.kind === 'checkbox') {
        assertCurrentTarget(page, profile, target);
        await locator.setChecked(binding.values[String(value)]!);
      } else if (binding.kind === 'upload') {
        assertCurrentTarget(page, profile, target);
        await locator.setInputFiles(uploads.get(key)!);
      } else {
        const values = (Array.isArray(value) ? value : [value]).map(
          (value) => binding.values?.[String(value)] ?? String(value),
        );
        assertCurrentTarget(page, profile, target);
        await locator.selectOption(binding.multiple ? values : values[0]!);
      }
    }
  }
  return wireHTML;
}

export function unknown(
  capability: WriteCapability,
  target?: WriteTarget,
  reason = 'The platform action may have happened; perform read-only reconciliation before any further write.',
): WriteResult {
  return { status: 'uncertain', capability, target, code: 'outcome_unknown', reason };
}

export function confirmed(capability: WriteCapability, snapshot: DraftSnapshot): WriteResult {
  const platformState = isModernShortSnapshot(snapshot)
    ? validateGenericShortSnapshot(snapshot).state === 'draft'
      ? 'draft'
      : unavailable('A publication observation cannot confirm a generic short save.')
    : (snapshot as WriteSnapshot).state;
  return {
    status: 'succeeded',
    capability,
    target: snapshot.target,
    contentHash: snapshot.contentHash,
    platformState,
    verifiedAt: snapshot.platformReadAt,
    sourceUrl: snapshot.sourceUrl,
  };
}

export function writerShortObservations(options: WriteOptions, modern: boolean) {
  let last: GenericShortObservation | null = null,
    callbackFailed = false;
  return {
    async observe(phase: GenericShortObservation['phase'], snapshot: DraftSnapshot): Promise<void> {
      if (!modern) return;
      try {
        const observation = freezeShortCarrier({
          schema: 'fanqie-generic-short-editor-observation/v1' as const,
          phase,
          snapshot: validateGenericShortSnapshot(snapshot),
        });
        await options.onShortObservation?.(observation);
        last = observation;
      } catch (error) {
        callbackFailed = true;
        throw error;
      }
    },
    failed: () => callbackFailed,
    result: (event: WriteResult): WriteResult =>
      modern
        ? { ...event, statusProtocol: 'fanqie-generic-short-status/v1', shortObservation: last }
        : event,
  };
}

export async function recordIntent(
  options: WriteOptions,
  intent: Parameters<NonNullable<WriteOptions['beforeSideEffect']>>[0],
): Promise<void> {
  if (!options.beforeSideEffect)
    unavailable('A durable runtime write-intent hook is required before a platform side effect.');
  await options.beforeSideEffect(intent);
}

export function shortSaveParametersMatch(
  request: Request,
  target: WriteTarget,
  desiredTitle: string,
  desiredWireHTML?: string,
): boolean {
  try {
    const raw = request.postData();
    if (typeof raw !== 'string' || raw.length > 12_000_000) return false;
    let values: Record<string, unknown>;
    if (raw.trimStart().startsWith('{')) {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        JSON.stringify(parsed) !== raw.trim()
      )
        return false;
      values = parsed as Record<string, unknown>;
    } else {
      if (/%(?![0-9a-fA-F]{2})/.test(raw)) return false;
      const params = new URLSearchParams(raw),
        keys = [...params.keys()];
      if (keys.length === 0 || new Set(keys).size !== keys.length) return false;
      values = Object.fromEntries(params);
    }
    if (values.item_id !== target.workId) return false;
    if (desiredWireHTML !== undefined && values.content !== desiredWireHTML) return false;
    const titles: unknown =
      typeof values.multi_title === 'string' ? JSON.parse(values.multi_title) : values.multi_title;
    return (
      Array.isArray(titles) &&
      titles.length > 0 &&
      titles.length <= 10 &&
      titles.every((title) => typeof title === 'string') &&
      titles[0] === desiredTitle
    );
  } catch {
    return false;
  }
}
