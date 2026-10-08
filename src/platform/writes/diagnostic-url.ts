import { type EditorDiagnosticInput, type EditorDiagnostic, diagnosticLabels } from './submit.js';

import {
  type WriteOptions,
  origin,
  PlatformWriteError,
  sha256,
  normalizeBody,
  type ReadField,
  type PlatformState,
  type Selector,
  type DraftMetadata,
  type FieldBinding,
} from './hash-draft-content.js';

import {
  validateTarget,
  requireProfile,
  editorUrl,
  safeUrl,
  invalid,
  unavailable,
  sameTarget,
} from './is-generic-short-capture-failure.js';

import { type Page } from 'playwright';

import { targetFromPage } from './unique.js';

import { snapshotFromCurrentPage } from './await-created-short-target.js';

function diagnosticUrl(
  input: EditorDiagnosticInput,
  options: WriteOptions,
): { url: string; routeBasis: EditorDiagnostic['routeBasis'] } {
  validateTarget(input.target);
  let url: string;
  let routeBasis: EditorDiagnostic['routeBasis'];
  if (options.profile) {
    const profile = requireProfile(options, input.target.kind);
    url = editorUrl(profile, input.target);
    routeBasis = 'verified-profile';
    if (input.editorUrl && safeUrl(input.editorUrl) !== url)
      invalid('The diagnostic URL differs from the verified stable editor route.');
  } else if (input.target.kind === 'short') {
    url = `${origin}/main/writer/publish-short/${input.target.workId}`;
    routeBasis = 'observed-short-editor';
    if (input.editorUrl && safeUrl(input.editorUrl) !== url)
      invalid('Only the observed stable short-story editor route is allowed.');
  } else {
    if (!input.editorUrl || !input.routeEvidenceRef?.trim())
      unavailable(
        'An observed existing chapter editor route and its evidence reference are required.',
      );
    url = safeUrl(input.editorUrl);
    routeBasis = 'operator-read-evidence';
  }
  const parsed = new URL(url);
  if (/(?:^|[/_-])(?:new|create|add|remove|delete|save|submit)(?=[/_-]|$)/i.test(parsed.pathname))
    invalid('Creation and action routes cannot be opened by the read-only editor diagnostic.');
  for (const key of parsed.searchParams.keys())
    if (/^(?:action|new|create|add|delete|remove|save|submit|publish)$/i.test(key))
      invalid('Action query parameters cannot be opened by the read-only editor diagnostic.');
  const identifiers = new Set([...parsed.pathname.split('/'), ...parsed.searchParams.values()]);
  if (
    !identifiers.has(input.target.workId) ||
    (input.target.kind === 'chapter' && !identifiers.has(input.target.chapterId!))
  )
    invalid('The diagnostic route must identify the exact existing work and chapter.');
  return { url, routeBasis };
}

/**
 * Does not fill, upload, click, check an agreement or open a new-draft route.
 * DOM content is consumed internally to calculate hashes; the result never contains it.
 * Selector hints are observations for human review, not automatically enabled write profiles.
 */
export async function diagnoseEditor(
  page: Page,
  input: EditorDiagnosticInput,
  options: WriteOptions = {},
): Promise<EditorDiagnostic> {
  const { url, routeBasis } = diagnosticUrl(input, options);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 30_000 });
  const actual = new URL(page.url());
  const expected = new URL(url);
  if (actual.origin !== origin)
    throw new PlatformWriteError(
      'requires_login',
      'The editor diagnostic was redirected away from the platform.',
    );
  if (actual.pathname !== expected.pathname)
    throw new PlatformWriteError(
      'version_conflict',
      'The diagnostic opened a different page instead of the requested existing editor.',
    );
  const observedIds = new Set([...actual.pathname.split('/'), ...actual.searchParams.values()]);
  if (
    !observedIds.has(input.target.workId) ||
    (input.target.kind === 'chapter' && !observedIds.has(input.target.chapterId!))
  )
    throw new PlatformWriteError(
      'version_conflict',
      'The diagnostic redirect no longer identifies the requested stable work and chapter.',
    );
  const raw = await page.evaluate(() => {
    const hint = (element: Element): string | undefined => {
      const tag = element.tagName.toLowerCase();
      const id = element.id;
      if (id && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)) return `${tag}#${id}`;
      const classes = Array.from(element.classList)
        .filter((name) => /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(name))
        .slice(0, 3);
      return classes.length ? `${tag}.${classes.join('.')}` : undefined;
    };
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };
    const labelFor = (element: Element): string => {
      const aria = element.getAttribute('aria-label');
      if (aria) return aria.trim().slice(0, 100);
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return (label.textContent ?? '').trim().slice(0, 100);
      }
      if (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button')
        return (element.textContent ?? '').trim().slice(0, 100);
      return (element.getAttribute('placeholder') ?? '').trim().slice(0, 100);
    };
    const controls = Array.from(
      document.querySelectorAll(
        'input,textarea,select,button,[contenteditable="true"],[role="textbox"],[role="button"],[role="radio"],[role="checkbox"],[role="combobox"]',
      ),
    )
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') ?? undefined,
        type: element.tagName === 'INPUT' ? (element.getAttribute('type') ?? 'text') : undefined,
        label: labelFor(element),
        selectorHint: hint(element),
        visible: visible(element),
        editable:
          element.getAttribute('contenteditable') === 'true' || element.tagName === 'TEXTAREA',
      }));
    const candidates = Array.from(
      document.querySelectorAll(
        '[contenteditable="true"],[role="textbox"][aria-multiline="true"],textarea',
      ),
    )
      .filter(visible)
      .slice(0, 8)
      .map((element) => {
        const paragraphs = Array.from(element.querySelectorAll('p'));
        const body =
          element.tagName === 'TEXTAREA'
            ? (element as HTMLTextAreaElement).value
            : paragraphs.length
              ? paragraphs.map((paragraph) => paragraph.textContent ?? '').join('\n')
              : ((element as HTMLElement).innerText ?? '');
        const normalized = body.replace(/\r\n?/g, '\n');
        return {
          selectorHint: hint(element),
          body: normalized.slice(0, 3_000_000),
          characterCount: normalized.length,
          paragraphCount: normalized.split('\n').length,
          complete: normalized.length <= 3_000_000,
        };
      });
    return { controls, candidates };
  });
  const controls = raw.controls.slice(0, 80).map((control) => ({
    tag: control.tag.slice(0, 20),
    ...(control.role ? { role: control.role.slice(0, 30) } : {}),
    ...(control.type ? { type: control.type.slice(0, 30) } : {}),
    ...(diagnosticLabels.has(control.label) ? { label: control.label } : {}),
    ...(control.selectorHint ? { selectorHint: control.selectorHint.slice(0, 240) } : {}),
    visible: control.visible,
    editable: control.editable,
  }));
  const result: EditorDiagnostic = {
    readOnly: true,
    target: input.target,
    sourceUrl: `${actual.origin}${actual.pathname}`,
    observedAt: (options.now?.() ?? new Date()).toISOString(),
    routeBasis,
    controls,
    labels: [...new Set(controls.flatMap((control) => (control.label ? [control.label] : [])))],
    bodyCandidates: raw.candidates.slice(0, 8).map((candidate) => ({
      ...(candidate.selectorHint ? { selectorHint: candidate.selectorHint.slice(0, 240) } : {}),
      characterCount: candidate.characterCount,
      paragraphCount: candidate.paragraphCount,
      complete: candidate.complete,
      ...(candidate.complete ? { sha256: sha256(normalizeBody(candidate.body)) } : {}),
    })),
    state: 'unknown',
    limitations: [
      'Control labels and selector hints require review before use in a write profile.',
      'Body candidate hashes are not complete draft content hashes.',
      'No private body, field values, cookies, storage or response payloads are returned.',
    ],
  };
  if (options.profile && input.accountId) {
    try {
      const target = targetFromPage(page, options.profile);
      if (!sameTarget(target, input.target))
        throw new PlatformWriteError(
          'version_conflict',
          'The verified editor profile identifies a different stable target.',
        );
      const snapshot = await snapshotFromCurrentPage(
        page,
        input.accountId,
        target,
        options.profile,
        options,
      );
      result.state = snapshot.state;
      result.contentHash = snapshot.contentHash;
      result.verifiedSnapshotAt = snapshot.platformReadAt;
    } catch (error) {
      if (
        error instanceof PlatformWriteError &&
        (error.code === 'requires_login' || error.code === 'version_conflict')
      )
        throw error;
      result.limitations.push(
        'The configured profile did not establish a complete verified editor snapshot.',
      );
    }
  }
  return result;
}

/** An existing work's metadata has a separate version domain from any manuscript. */
export interface LongBookMetadataTarget {
  kind: 'long-book';
  workId: string;
}

export interface UiLongBookMetadataProfile {
  id: string;
  evidenceRef: string;
  verifiedAt: string;
  kind: 'long-book';
  metadataRoute: string;
  targetPattern: string;
  identity: ReadField;
  state: ReadField;
  states: Record<string, PlatformState>;
  editableStates: PlatformState[];
  title: Selector;
  save: Selector;
  fields?: Partial<Record<keyof DraftMetadata, FieldBinding>>;
}

export interface LongBookMetadataSnapshot {
  snapshotScope: 'long_book_metadata';
  hashBasis: 'long-book-metadata/v1';
  accountId: string;
  target: LongBookMetadataTarget;
  state: PlatformState;
  title: string;
  metadata: DraftMetadata;
  metadataHash: string;
  sourceUrl: string;
  platformReadAt: string;
}

export interface LongBookMetadataOptions extends Omit<
  WriteOptions,
  'profile' | 'beforeSideEffect' | 'onTargetDiscovered'
> {
  profile?: UiLongBookMetadataProfile;
  beforeSideEffect?: (intent: {
    capability: 'update_work_metadata';
    target: LongBookMetadataTarget;
    snapshotScope: 'long_book_metadata';
    hashBasis: 'long-book-metadata/v1';
    expectedContentHash: string;
    desiredContentHash: string;
    expectedStates: PlatformState[];
  }) => Promise<void>;
}

export interface LongBookMetadataInput {
  accountId: string;
  target: LongBookMetadataTarget;
  /** For this target only, the compatibility argument identifies metadataHash. */
  expectedContentHash: string;
  expectedState: PlatformState;
  title?: string;
  metadata: DraftMetadata;
}

export interface LongBookMetadataResult {
  status: 'succeeded' | 'uncertain';
  capability: 'update_work_metadata';
  target: LongBookMetadataTarget;
  snapshotScope: 'long_book_metadata';
  hashBasis: 'long-book-metadata/v1';
  metadataHash?: string;
  platformState?: PlatformState;
  verifiedAt?: string;
  sourceUrl?: string;
  reason?: string;
  code?: 'outcome_unknown';
}

export const bookProfileKeys = new Set([
  'id',
  'evidenceRef',
  'verifiedAt',
  'kind',
  'metadataRoute',
  'targetPattern',
  'identity',
  'state',
  'states',
  'editableStates',
  'title',
  'save',
  'fields',
]);
