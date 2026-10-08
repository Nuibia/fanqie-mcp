import { type Page, type Locator } from 'playwright';

import {
  type Selector,
  type ReadField,
  type UiWriteProfile,
  type WriteOptions,
  type GenericShortOwnerInvocation,
  PlatformWriteError,
  origin,
  type WriteTarget,
  idPattern,
  type FieldBinding,
  type DraftMetadata,
  metadataKeys,
} from './hash-draft-content.js';

import {
  locate,
  unavailable,
  invalid,
  shortCaptureRejected,
  sameTarget,
  editorUrl,
} from './is-generic-short-capture-failure.js';

import { captureShortStatusJson } from '../short-status.js';

export async function unique(page: Page, selector: Selector): Promise<Locator> {
  const locator = locate(page, selector);
  if ((await locator.count()) !== 1 || !(await locator.isVisible()))
    unavailable('A verified page control is missing, ambiguous, or hidden.');
  return locator;
}

export async function readField(page: Page, field: ReadField): Promise<string> {
  const locator = await unique(page, field.selector);
  if (field.mode === 'attribute') {
    if (!field.attribute) unavailable('The page profile omitted a readback attribute.');
    const value = await locator.getAttribute(field.attribute);
    if (value === null) unavailable('The expected readback attribute is absent.');
    return value;
  }
  if (field.mode === 'value') return locator.inputValue();
  return locator.innerText();
}

export async function readTextInput(page: Page, selector: Selector): Promise<string> {
  const locator = await unique(page, selector);
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  return tag === 'input' || tag === 'textarea' ? locator.inputValue() : locator.innerText();
}

export async function verifyIdentity(
  page: Page,
  expectedAccountId: string,
  profile: Pick<UiWriteProfile, 'identity'>,
  options: Pick<WriteOptions, 'verifyAccount' | 'now' | 'identityType'>,
  requireInvocation = false,
): Promise<GenericShortOwnerInvocation | undefined> {
  if (!/^\d{1,30}$/.test(expectedAccountId))
    invalid(
      'accountId must identify a stable numeric platform account or author, not a service alias or display name.',
    );
  const identity = profile.identity;
  const apiIdentity = 'kind' in identity && identity.kind === 'own_account_api';
  if (apiIdentity && (Object.keys(identity).length !== 1 || !options.verifyAccount))
    unavailable('The own-account API identity requires the trusted current verification callback.');
  if (options.identityType !== undefined && !['account', 'author'].includes(options.identityType))
    unavailable('The requested own identity namespace is unsupported.');
  let domError: unknown;
  if (!requireInvocation && !('kind' in identity) && !options.identityType)
    try {
      const observedId = (await readField(page, identity)).trim();
      if (/^\d{1,30}$/.test(observedId)) {
        if (observedId !== expectedAccountId)
          throw new PlatformWriteError(
            'requires_login',
            'The signed-in own-account ID differs from the request.',
          );
        if (!options.identityType) return;
      }
    } catch (error) {
      if (error instanceof PlatformWriteError && error.code === 'requires_login') throw error;
      domError = error;
    }
  if (requireInvocation && (!options.verifyAccount || (!options.identityType && !apiIdentity)))
    unavailable('The modern short source requires a trusted typed own-account callback.');
  if (!options.verifyAccount) {
    if (domError) throw domError;
    throw new PlatformWriteError(
      'requires_login',
      'The visible author name does not establish a stable own-account ID.',
    );
  }
  const requestedAt = (options.now?.() ?? new Date()).getTime();
  const returned = await options.verifyAccount(page);
  const completedAt = (options.now?.() ?? new Date()).getTime();
  let observation = returned;
  if (requireInvocation)
    try {
      observation = captureShortStatusJson(returned) as typeof returned;
    } catch {
      shortCaptureRejected('The modern short owner callback cannot be captured safely.');
    }
  if (
    requireInvocation &&
    (!observation ||
      ['status', 'identity', 'sourceUrl', 'checkedAt'].some(
        (key) => !Object.hasOwn(observation, key),
      ) ||
      (observation.identity !== null &&
        (typeof observation.identity !== 'object' ||
          !Object.hasOwn(
            observation.identity,
            (options.identityType ?? 'account') === 'account' ? 'accountId' : 'authorId',
          ))))
  )
    shortCaptureRejected('The modern short callback omitted its actual typed identity fields.');
  const observedAt = Date.parse(observation.checkedAt);
  let source: URL;
  try {
    source = new URL(observation.sourceUrl);
  } catch {
    unavailable('The own-account verification callback did not supply a valid source.');
  }
  if (
    source.origin !== origin ||
    !Number.isFinite(observedAt) ||
    observedAt < requestedAt ||
    observedAt > completedAt + 1_000
  )
    unavailable(
      'The own-account verification callback did not establish a fresh platform observation.',
    );
  const identityType = options.identityType ?? (apiIdentity ? 'account' : undefined);
  const ids = observation.identity
    ? (identityType
        ? [observation.identity[identityType === 'account' ? 'accountId' : 'authorId']]
        : [observation.identity.authorId, observation.identity.accountId]
      ).filter((id): id is string => typeof id === 'string' && /^\d{1,30}$/.test(id))
    : [];
  if (observation.status !== 'authenticated' || !ids.includes(expectedAccountId))
    throw new PlatformWriteError(
      'requires_login',
      'A fresh own-account observation did not match the requested stable ID.',
    );
  return {
    requestedAt: new Date(requestedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    checkedAt: observation.checkedAt,
  };
}

export function targetFromPage(page: Page, profile: UiWriteProfile): WriteTarget {
  const url = new URL(page.url());
  if (url.origin !== origin)
    throw new PlatformWriteError(
      'requires_login',
      'The writer page redirected away from the expected platform.',
    );
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(profile.targetPattern).exec(url.pathname);
  } catch {
    unavailable('The target route profile is invalid.');
  }
  const target: WriteTarget = { kind: profile.kind, workId: match?.groups?.workId ?? '' };
  if (profile.kind === 'chapter') target.chapterId = match?.groups?.chapterId ?? '';
  if (
    !idPattern.test(target.workId) ||
    (target.kind === 'chapter' && !idPattern.test(target.chapterId ?? ''))
  )
    unavailable('The platform did not expose a stable target ID.');
  return target;
}

export function assertCurrentTarget(
  page: Page,
  profile: UiWriteProfile,
  target: WriteTarget,
): void {
  if (!sameTarget(targetFromPage(page, profile), target))
    throw new PlatformWriteError(
      'version_conflict',
      'The writer page no longer identifies the bound stable target.',
    );
}

async function readTrialRatio(page: Page, binding: FieldBinding): Promise<number> {
  let observed: unknown;
  if (binding.kind === 'text') observed = await readTextInput(page, binding.selector);
  else if (binding.kind === 'upload') observed = await readField(page, binding.readHash);
  else if (binding.kind === 'checkbox') {
    const checked = await (await unique(page, binding.selector)).isChecked();
    if (typeof checked !== 'boolean')
      unavailable('The trial ratio checkbox state was not observed.');
    const values = Object.entries(binding.values).filter(([, value]) => value === checked);
    if (values.length !== 1) unavailable('The trial ratio has no unique verified logical value.');
    observed = values[0]![0];
  } else if (binding.kind === 'radio') {
    const selected: string[] = [];
    for (const [value, selector] of Object.entries(binding.choices)) {
      const checked = await (await unique(page, selector)).isChecked();
      if (typeof checked !== 'boolean')
        unavailable('The trial ratio radio state was not observed.');
      if (checked) selected.push(value);
    }
    if (selected.length !== 1) unavailable('The trial ratio has no unique selected value.');
    observed = selected[0];
  } else {
    if (binding.multiple) unavailable('The trial ratio must be a single observed value.');
    const locator = await unique(page, binding.selector);
    const raw = await locator.evaluate((element) =>
      Array.from((element as HTMLSelectElement).selectedOptions).map((option) => option.value),
    );
    if (
      !Array.isArray(raw) ||
      raw.length !== 1 ||
      typeof raw[0] !== 'string' ||
      !raw[0] ||
      raw[0].trim() !== raw[0]
    )
      unavailable('The trial ratio selection is absent or ambiguous.');
    if (binding.values) {
      const values = Object.entries(binding.values).filter(([, value]) => value === raw[0]);
      if (values.length !== 1)
        unavailable('The raw trial ratio has no unique verified inverse mapping.');
      observed = values[0]![0];
    } else observed = raw[0];
  }
  if (
    typeof observed !== 'string' ||
    observed.trim() !== observed ||
    !/^\d+(?:\.\d+)?$/.test(observed)
  )
    unavailable('The platform trial ratio was not observed as a complete decimal token.');
  const value = Number(observed);
  if (!Number.isFinite(value) || value < 0 || value > 100)
    unavailable('The platform trial ratio is outside its verified range.');
  return value;
}

export async function readMetadata(page: Page, profile: UiWriteProfile): Promise<DraftMetadata> {
  const metadata: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(profile.fields ?? {})) {
    if (!metadataKeys.has(key) || !binding)
      unavailable('The page profile contains an unsupported metadata field.');
    if (key === 'trialRatio') {
      metadata[key] = await readTrialRatio(page, binding);
      continue;
    }
    if (binding.kind === 'text') metadata[key] = await readTextInput(page, binding.selector);
    else if (binding.kind === 'upload') metadata[key] = await readField(page, binding.readHash);
    else if (binding.kind === 'checkbox') {
      const checked = await (await unique(page, binding.selector)).isChecked();
      const mapped = Object.entries(binding.values).filter(([, value]) => value === checked);
      if (mapped.length !== 1) unavailable('The checkbox has no unique verified metadata value.');
      metadata[key] = mapped[0]![0];
    } else if (binding.kind === 'radio') {
      const selected: string[] = [];
      for (const [value, selector] of Object.entries(binding.choices))
        if (await (await unique(page, selector)).isChecked()) selected.push(value);
      if (selected.length !== 1)
        unavailable('The platform radio field has no unique selected value.');
      metadata[key] = selected[0];
    } else {
      const locator = await unique(page, binding.selector);
      const values = await locator.evaluate((element) =>
        Array.from((element as HTMLSelectElement).selectedOptions).map((option) => option.value),
      );
      const reverse = new Map(
        Object.entries(binding.values ?? {}).map(([key, value]) => [value, key]),
      );
      const mapped = values.map((value) => reverse.get(value) ?? value);
      metadata[key] = binding.multiple ? mapped : mapped[0];
    }
  }
  return metadata as DraftMetadata;
}

export async function boundedPause(deadline: number): Promise<void> {
  const remaining = deadline - performance.now();
  if (remaining <= 0) unavailable('The verified editor did not become ready before its deadline.');
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, remaining)));
}

export function assertShortReadTarget(
  page: Page,
  profile: UiWriteProfile,
  target: WriteTarget,
): void {
  assertCurrentTarget(page, profile, target);
  if (page.url() !== editorUrl(profile, target))
    unavailable('The current short editor route changed during readback.');
}

export async function awaitShortReady(
  page: Page,
  profile: UiWriteProfile,
  target: WriteTarget,
  deadline: number,
): Promise<void> {
  if (!profile.readiness) return;
  while (performance.now() < deadline) {
    assertShortReadTarget(page, profile, target);
    let ready = true;
    for (const selector of [profile.title, profile.body, profile.save]) {
      const locator = locate(page, selector);
      const count = await locator.count();
      assertShortReadTarget(page, profile, target);
      if (count > 1) unavailable('The short editor readiness control is ambiguous.');
      if (count !== 1) {
        ready = false;
        continue;
      }
      const visible = await locator.isVisible();
      assertShortReadTarget(page, profile, target);
      if (!visible) {
        ready = false;
        continue;
      }
      if (selector === profile.save) {
        const enabled = await locator.isEnabled();
        assertShortReadTarget(page, profile, target);
        if (!enabled) ready = false;
      }
    }
    if (ready && performance.now() < deadline) return;
    await boundedPause(deadline);
  }
  unavailable('The verified short editor controls did not become ready.');
}

export type ShortSnapshotMode = 'modern_short' | 'legacy_authority';
