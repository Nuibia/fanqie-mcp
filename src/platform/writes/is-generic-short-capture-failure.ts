import {
  PlatformWriteError,
  type ModernShortSnapshot,
  idPattern,
  canonical,
  origin,
  hashDraftContent,
  type WriteOptions,
  type WriteTarget,
  type UiWriteProfile,
  type Selector,
} from './hash-draft-content.js';

import { captureShortStatusJson, resolveShortEditorStatus } from '../short-status.js';

import { type Page, type Locator } from 'playwright';

export class GenericShortCaptureFailure extends PlatformWriteError {
  constructor(message: string, code: PlatformWriteError['code'] = 'capability_unavailable') {
    super(code, message);
  }
}

/** Classification of an actual native capture failure; it does not grant execution authority. */
export function isGenericShortCaptureFailure(error: unknown): boolean {
  return error instanceof GenericShortCaptureFailure;
}

export function shortCaptureRejected(message: string): never {
  throw new GenericShortCaptureFailure(message);
}

/** Reserved own keys are a signal even on partial data; callers must then validate the entire carrier. */
export function isModernShortSnapshot(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  return ['statusInput', 'statusFacts', 'statusProof'].some((key) =>
    Object.hasOwn(descriptors, key),
  );
}

export function shortExact(
  input: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    shortCaptureRejected('The modern short carrier is not an exact object.');
  const value = input as Record<string, unknown>,
    actual = Object.keys(value);
  if (
    keys.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !keys.includes(key) && !optional.includes(key))
  )
    shortCaptureRejected('The modern short carrier has an incomplete or unexpected shape.');
  return value;
}

function shortCanonicalTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return new Date(value).toISOString() === value;
}

export function freezeShortCarrier<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeShortCarrier(child);
    Object.freeze(value);
  }
  return value;
}

/** Full private data validation only: no caller/context/SQL/ref execution authority is manufactured. */
export function validateGenericShortSnapshot(input: unknown): ModernShortSnapshot {
  let captured: unknown;
  try {
    captured = captureShortStatusJson(input);
  } catch {
    shortCaptureRejected('The modern short carrier cannot be captured as bounded JSON.');
  }
  const snapshot = shortExact(captured, [
    'title',
    'body',
    'metadata',
    'accountId',
    'target',
    'state',
    'contentHash',
    'sourceUrl',
    'platformReadAt',
    'statusInput',
    'statusFacts',
    'statusProof',
  ]);
  const target = shortExact(snapshot.target, ['kind', 'workId']),
    metadata = shortExact(snapshot.metadata, []);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !idPattern.test(target.workId) ||
    typeof snapshot.accountId !== 'string' ||
    !/^\d{1,30}$/.test(snapshot.accountId)
  )
    shortCaptureRejected('The modern short target or owner binding is invalid.');
  for (const field of ['title', 'body'] as const) {
    const value = snapshot[field];
    if (
      typeof value !== 'string' ||
      value.includes('\0') ||
      value.length > 3_000_000 ||
      Buffer.byteLength(value, 'utf8') > 3_000_000
    )
      shortCaptureRejected('The modern short content exceeds its original complete-field bounds.');
  }
  const statusInput = shortExact(snapshot.statusInput, [], ['publish_status', 'display_status']);
  const facts = resolveShortEditorStatus(statusInput);
  if (
    canonical(snapshot.statusFacts) !== canonical(facts) ||
    snapshot.state !== facts.resolvedState
  )
    shortCaptureRejected(
      'The complete modern short facts do not match their original raw status values.',
    );
  const proof = shortExact(snapshot.statusProof, [
    'schema',
    'profileId',
    'profileVerifiedAt',
    'profileSource',
    'owner',
    'method',
    'endpoint',
    'requestCount',
    'responseCount',
    'mainFrame',
    'fixedSourceVerified',
    'routeStable',
    'bodyBound',
    'readStartedAt',
    'getRequestedAt',
    'getCompletedAt',
    'readFinishedAt',
  ]);
  const owner = shortExact(proof.owner, ['kind', 'id', 'before', 'after']);
  if (
    proof.schema !== 'fanqie-generic-short-editor-proof/v1' ||
    typeof proof.profileId !== 'string' ||
    !proof.profileId ||
    proof.profileId.length > 512 ||
    typeof proof.profileVerifiedAt !== 'string' ||
    !Number.isFinite(Date.parse(proof.profileVerifiedAt)) ||
    proof.profileSource !== 'short_article_edit_v1' ||
    proof.method !== 'GET' ||
    proof.endpoint !== '/api/author/short_article/edit/v1/' ||
    proof.requestCount !== 1 ||
    proof.responseCount !== 1 ||
    ['mainFrame', 'fixedSourceVerified', 'routeStable', 'bodyBound'].some(
      (key) => proof[key] !== true,
    ) ||
    (owner.kind !== 'account' && owner.kind !== 'author') ||
    owner.id !== snapshot.accountId
  )
    shortCaptureRejected('The modern short proof has an invalid fixed source or owner binding.');
  const invocations = ['before', 'after'].map((key) => {
    const invocation = shortExact(owner[key], ['requestedAt', 'completedAt', 'checkedAt']);
    if (
      !shortCanonicalTime(invocation.requestedAt) ||
      !shortCanonicalTime(invocation.completedAt) ||
      typeof invocation.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(invocation.checkedAt)) ||
      invocation.requestedAt > invocation.completedAt ||
      Date.parse(invocation.checkedAt) < Date.parse(invocation.requestedAt) ||
      Date.parse(invocation.checkedAt) > Date.parse(invocation.completedAt) + 1_000
    )
      shortCaptureRejected(
        'The modern short owner invocation is outside its original freshness allowance.',
      );
    return invocation;
  });
  if (
    ['readStartedAt', 'getRequestedAt', 'getCompletedAt', 'readFinishedAt'].some(
      (key) => !shortCanonicalTime(proof[key]),
    ) ||
    !shortCanonicalTime(snapshot.platformReadAt)
  )
    shortCaptureRejected('The modern short local boundaries are not canonical timestamps.');
  const times = [
    proof.readStartedAt,
    invocations[0]!.requestedAt,
    invocations[0]!.completedAt,
    proof.getRequestedAt,
    proof.getCompletedAt,
    invocations[1]!.requestedAt,
    invocations[1]!.completedAt,
    proof.readFinishedAt,
  ] as string[];
  if (
    times.some((time, i) => i > 0 && time < times[i - 1]!) ||
    proof.readFinishedAt !== snapshot.platformReadAt
  )
    shortCaptureRejected('The modern short local read boundaries are out of order.');
  if (typeof snapshot.sourceUrl !== 'string')
    shortCaptureRejected('The modern short source URL is not a string.');
  let source: URL;
  try {
    source = new URL(snapshot.sourceUrl);
  } catch {
    shortCaptureRejected('The modern short source URL is invalid.');
  }
  if (
    source.origin !== origin ||
    source.username ||
    source.password ||
    source.hash ||
    !source.pathname.startsWith('/main/writer/')
  )
    shortCaptureRejected('The modern short source is outside its verified writer origin.');
  const content = {
    title: snapshot.title as string,
    body: snapshot.body as string,
    metadata: metadata as Record<string, never>,
  };
  if (
    typeof snapshot.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.contentHash) ||
    snapshot.contentHash !== hashDraftContent(content)
  )
    shortCaptureRejected('The modern short content hash does not match its complete content.');
  return freezeShortCarrier(snapshot) as unknown as ModernShortSnapshot;
}

export function unavailable(message: string): never {
  throw new PlatformWriteError('capability_unavailable', message);
}

export function invalid(message: string): never {
  throw new PlatformWriteError('invalid_input', message);
}

export function requireProfile(options: WriteOptions, kind?: WriteTarget['kind']): UiWriteProfile {
  const profile = options.profile;
  if (!profile?.evidenceRef || !profile.id || !Number.isFinite(Date.parse(profile.verifiedAt)))
    unavailable('No verified page write profile is configured.');
  if (kind && profile.kind !== kind)
    unavailable('The verified page profile does not cover this target kind.');
  if (!profile.editorRoute || !profile.targetPattern || !profile.editableStates.length)
    unavailable('The verified page profile is incomplete.');
  if (
    profile.saveAcknowledgement !== undefined &&
    (profile.saveAcknowledgement !== 'short_article_cover_v0' ||
      profile.kind !== 'short' ||
      profile.serverState !== 'short_article_edit_v1')
  )
    unavailable('The native save acknowledgement is only supported by the native short profile.');
  if (
    profile.bodyRead !== undefined &&
    (profile.bodyRead !== 'short_editor_document' ||
      profile.kind !== 'short' ||
      profile.serverState !== 'short_article_edit_v1')
  )
    unavailable('The editor document body source is only supported by the native short profile.');
  if (
    'kind' in profile.identity &&
    (profile.identity.kind !== 'own_account_api' ||
      profile.serverState !== 'short_article_edit_v1' ||
      profile.kind !== 'short')
  )
    unavailable('The API identity source is only supported by the native short editor profile.');
  if (
    (profile.serverState !== undefined &&
      (profile.serverState !== 'short_article_edit_v1' || profile.kind !== 'short')) ||
    (profile.readiness !== undefined &&
      (profile.readiness !== 'short_editor_save_enabled' || profile.kind !== 'short')) ||
    (!profile.serverState && !profile.state)
  )
    unavailable('The verified state/readiness source is unsupported.');
  return profile;
}

export function validateTarget(target: WriteTarget): void {
  if (!idPattern.test(target.workId) || (target.kind !== 'short' && target.kind !== 'chapter'))
    invalid('A stable platform work ID and supported target kind are required.');
  if (target.kind === 'chapter' && (!target.chapterId || !idPattern.test(target.chapterId)))
    invalid('A stable platform chapter ID is required.');
  if (target.kind === 'short' && target.chapterId)
    invalid('A short-story target cannot contain a chapter ID.');
}

export function sameTarget(a: WriteTarget, b: WriteTarget): boolean {
  return a.kind === b.kind && a.workId === b.workId && a.chapterId === b.chapterId;
}

export function editorUrl(profile: UiWriteProfile, target: WriteTarget): string {
  validateTarget(target);
  const route = profile.editorRoute
    .replaceAll('{workId}', target.workId)
    .replaceAll('{chapterId}', target.chapterId ?? '');
  return safeUrl(route);
}

export function safeUrl(route: string): string {
  const url = new URL(route, origin);
  if (
    url.origin !== origin ||
    !url.pathname.startsWith('/main/writer/') ||
    url.username ||
    url.password ||
    url.hash
  )
    unavailable('The page profile route is outside the verified writer origin.');
  return url.href;
}

export function locate(page: Page, selector: Selector): Locator {
  if ('css' in selector) return page.locator(selector.css);
  if ('role' in selector)
    return page.getByRole(selector.role, { name: selector.name, exact: true });
  if ('label' in selector) return page.getByLabel(selector.label, { exact: true });
  return page.getByPlaceholder(selector.placeholder, { exact: true });
}
