import { type Page } from 'playwright';

import {
  type SubmitInput,
  type WriteOptions,
  type WriteResult,
  PlatformWriteError,
  sha256,
  canonical,
  type WriteCapability,
  type WriteTarget,
  type PlatformState,
  type UiWriteProfile,
} from './hash-draft-content.js';

import {
  requireProfile,
  sameTarget,
  invalid,
  unavailable,
  isModernShortSnapshot,
  isGenericShortCaptureFailure,
} from './is-generic-short-capture-failure.js';

import { profileHash, readTerms } from './create-target.js';

import {
  readWriteSnapshotInMode,
  checkPreconditions,
  readWriteSnapshot,
} from './await-created-short-target.js';

import { readField, unique, assertCurrentTarget } from './unique.js';

import { recordIntent, unknown, confirmed } from './controlled-upload.js';

async function submit(
  page: Page,
  input: SubmitInput,
  options: WriteOptions,
  capability: 'submit_short_story' | 'publish_chapter',
): Promise<WriteResult> {
  const profile = requireProfile(options, input.target.kind);
  const prepared = input.prepared;
  const now = options.now?.() ?? new Date();
  if (
    !prepared ||
    prepared.accountId !== input.accountId ||
    !sameTarget(prepared.target, input.target) ||
    prepared.expectedContentHash !== input.expectedContentHash ||
    prepared.expectedState !== input.expectedState ||
    prepared.profileHash !== profileHash(profile)
  )
    throw new PlatformWriteError(
      'version_conflict',
      'Submission is not bound to this exact target, version, state and verified profile.',
    );
  if (
    !Number.isFinite(Date.parse(prepared.preparedAt)) ||
    !Number.isFinite(Date.parse(prepared.expiresAt)) ||
    Date.parse(prepared.preparedAt) > now.getTime() ||
    Date.parse(prepared.expiresAt) <= now.getTime()
  )
    throw new PlatformWriteError(
      'version_conflict',
      'The submission preparation expired or has an invalid time.',
    );
  if (input.acceptPublicationTerms !== true)
    invalid('Acceptance of the prepared publication terms must be explicit.');
  const before = await readWriteSnapshotInMode(
    page,
    input.accountId,
    input.target,
    options,
    'legacy_authority',
  );
  checkPreconditions(before, input.expectedContentHash, input.expectedState, profile);
  const terms = await readTerms(page, profile);
  if (
    sha256(canonical(terms)) !== prepared.termsHash ||
    sha256(canonical(prepared.terms)) !== prepared.termsHash
  )
    throw new PlatformWriteError(
      'version_conflict',
      'The platform publication terms changed since preparation.',
    );
  const first = profile.submission!.steps[0]!;
  if ((await readField(page, first.guard)) !== first.guard.equals)
    unavailable('The verified submission prompt is not present.');
  await unique(page, first.button);
  if (first.publicationAgreement) await unique(page, first.publicationAgreement);
  await recordIntent(options, {
    capability,
    target: input.target,
    expectedContentHash: input.expectedContentHash,
    desiredContentHash: input.expectedContentHash,
    expectedStates: profile.submission!.acceptedStates,
  });
  try {
    for (const step of profile.submission!.steps) {
      if ((await readField(page, step.guard)) !== step.guard.equals)
        return unknown(
          capability,
          input.target,
          'The platform confirmation prompt differs from the verified submission flow.',
        );
      if (step.publicationAgreement) {
        const agreement = await unique(page, step.publicationAgreement);
        assertCurrentTarget(page, profile, before.target);
        await agreement.check();
      }
      const button = await unique(page, step.button);
      assertCurrentTarget(page, profile, before.target);
      await button.click();
    }
    const after = await readWriteSnapshotInMode(
      page,
      input.accountId,
      input.target,
      options,
      'legacy_authority',
    );
    return after.contentHash === input.expectedContentHash &&
      profile.submission!.acceptedStates.includes(after.state)
      ? confirmed(capability, after)
      : unknown(
          capability,
          input.target,
          'The reopened target has no confirmed submission state for the prepared content.',
        );
  } catch {
    return unknown(capability, input.target);
  }
}

export async function submitShortStory(
  page: Page,
  input: SubmitInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (input.target.kind !== 'short') invalid('submit_short_story requires a short-story target.');
  return submit(page, input, options, 'submit_short_story');
}

export async function publishChapter(
  page: Page,
  input: SubmitInput,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (input.target.kind !== 'chapter') invalid('publish_chapter requires a chapter target.');
  return submit(page, input, options, 'publish_chapter');
}

/** Reconciliation never fills, uploads, accepts terms, or clicks a platform control. */
export async function reconcileWrite(
  page: Page,
  input: {
    accountId: string;
    capability: WriteCapability;
    target?: WriteTarget;
    expectedContentHash: string;
    expectedStates: PlatformState[];
  },
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (!input.target)
    return unknown(
      input.capability,
      undefined,
      'The interrupted creation has no known platform ID; manual read-only target identification is required.',
    );
  try {
    const snapshot = await readWriteSnapshot(page, input.accountId, input.target, options);
    if (isModernShortSnapshot(snapshot))
      return unknown(
        input.capability,
        input.target,
        'The native short read observes publication only; App must authenticate the requested effect separately.',
      );
    return snapshot.contentHash === input.expectedContentHash &&
      input.expectedStates.some((state) => state === snapshot.state)
      ? confirmed(input.capability, snapshot)
      : unknown(
          input.capability,
          input.target,
          'Read-only reconciliation did not establish the requested content and state.',
        );
  } catch (error) {
    if (isGenericShortCaptureFailure(error)) throw error;
    return unknown(
      input.capability,
      input.target,
      'Read-only platform reconciliation is currently unavailable.',
    );
  }
}

export function getWriteCapabilities(
  profile?: UiWriteProfile,
): Record<WriteCapability, { available: boolean; reason?: string }> {
  const verified = Boolean(
    profile?.id &&
    profile.evidenceRef &&
    Number.isFinite(Date.parse(profile.verifiedAt)) &&
    profile.editorRoute &&
    profile.targetPattern &&
    profile.save &&
    profile.title &&
    profile.body &&
    profile.identity &&
    (profile.state ||
      (profile.kind === 'short' && profile.serverState === 'short_article_edit_v1')) &&
    profile.editableStates.length,
  );
  const submission = Boolean(
    verified &&
    profile?.submission?.terms.length &&
    profile.submission.steps.length &&
    profile.submission.acceptedStates.length,
  );
  const available: Record<WriteCapability, boolean> = {
    create_draft: verified && profile?.kind === 'short' && Boolean(profile.newRoute),
    update_draft: verified && profile?.kind === 'short',
    update_work_metadata: verified && profile?.serverState !== 'short_article_edit_v1',
    save_chapter_draft: verified && profile?.kind === 'chapter',
    prepare_submission: submission,
    submit_short_story: submission && profile?.kind === 'short',
    publish_chapter: submission && profile?.kind === 'chapter',
  };
  return Object.fromEntries(
    Object.entries(available).map(([key, value]) => [
      key,
      value
        ? { available: true }
        : {
            available: false,
            reason:
              key === 'update_work_metadata' && profile?.serverState === 'short_article_edit_v1'
                ? 'The native short source verifies title and body only; editable metadata is unavailable.'
                : 'A complete verified page profile for this capability is not configured.',
          },
    ]),
  ) as ReturnType<typeof getWriteCapabilities>;
}

export interface EditorDiagnosticInput {
  target: WriteTarget;
  accountId?: string;
  /** Only an already observed existing chapter editor URL; never a creation/action URL. */
  editorUrl?: string;
  routeEvidenceRef?: string;
}

export interface EditorDiagnostic {
  readOnly: true;
  target: WriteTarget;
  sourceUrl: string;
  observedAt: string;
  routeBasis: 'observed-short-editor' | 'verified-profile' | 'operator-read-evidence';
  labels: string[];
  controls: {
    tag: string;
    role?: string;
    type?: string;
    label?: string;
    selectorHint?: string;
    visible: boolean;
    editable: boolean;
  }[];
  bodyCandidates: {
    selectorHint?: string;
    characterCount: number;
    paragraphCount: number;
    sha256?: string;
    complete: boolean;
  }[];
  state: PlatformState | 'unknown';
  contentHash?: string;
  verifiedSnapshotAt?: string;
  limitations: string[];
}

export const diagnosticLabels = new Set([
  '短故事名称',
  '短故事标题',
  '章节名称',
  '章节标题',
  '章名',
  '标题',
  '正文',
  '请输入正文',
  '作品简介',
  '简介',
  '封面设置',
  '上传封面',
  '作品分类',
  '主分类',
  '是否使用AI',
  '是否使用AI：',
  '试读比例',
  '存草稿',
  '保存草稿',
  '保存',
  '下一步',
  '发布',
  '提交',
  '提交审核',
  '确认提交',
  '确认发布',
  '发布协议',
  '我已阅读 短故事发布事项',
  '是',
  '否',
  '30%',
  '50%',
]);
