/** Frozen official namespaces: editor publish_status is not management display_status. */
export type ShortResolvedState =
  | 'draft'
  | 'published'
  | 'reviewing'
  | 'rejected'
  | 'waiting_publication'
  | 'distribution_stopped'
  | 'unpublished'
  | 'unknown';
type Presence = 'observed' | 'missing' | 'invalid';
type ManagementState = Exclude<ShortResolvedState, 'draft'>;
export interface ShortStatusFactsV1 {
  schema: 'fanqie-short-status-facts/v1';
  source: 'management_labels' | 'editor_edit_v1';
  basis: 'management-visible-labels/v1' | 'editor-publish-and-display/v1';
  editor: {
    namespace: 'publish_status';
    raw: number | null;
    presence: Presence;
    branch: 'draft' | 'non_draft' | 'unknown';
  };
  management: {
    namespace: 'display_status';
    raw: number | null;
    presence: Presence;
    label: string | null;
    state: ManagementState;
    basis: 'observed_code' | 'visible_label' | 'unknown';
  };
  resolvedState: ShortResolvedState;
  draftEditable: boolean;
  conflict: boolean;
  reasons: string[];
}
const STATUS_REASONS = [
  'status_not_observed',
  'display_code_unmapped',
  'display_field_invalid',
  'editor_code_unmapped',
  'editor_field_invalid',
  'editor_not_publication_proof',
  'editor_display_conflict',
  'management_labels_conflict',
  'management_label_unrecognized',
  'management_status_masks_publication',
];
const DISPLAY_CODES: Record<number, [ManagementState, string]> = {
  1: ['published', '已发布'],
  4: ['reviewing', '审核中'],
  5: ['reviewing', '修改审核中'],
  7: ['rejected', '审核不通过'],
  10: ['waiting_publication', '待发表'],
  12: ['distribution_stopped', '已停止推荐/分发'],
};
const MANAGEMENT_LABELS: Record<string, ManagementState> = {
  已发布: 'published',
  审核中: 'reviewing',
  修改审核中: 'reviewing',
  待审核: 'reviewing',
  审核不通过: 'rejected',
  审核未通过: 'rejected',
  未通过: 'rejected',
  驳回: 'rejected',
  待发表: 'waiting_publication',
  '已停止推荐/分发': 'distribution_stopped',
  已停止推荐: 'distribution_stopped',
  已停止分发: 'distribution_stopped',
  未发布: 'unpublished',
};
function statusReject(): never {
  throw Error('invalid_short_status');
}
function statusObject(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    statusReject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((d) => !d.enumerable || !Object.hasOwn(d, 'value')))
    statusReject();
  return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]));
}
function statusExact(value: unknown, keys: string[]): Record<string, unknown> {
  const out = statusObject(value);
  if (Object.keys(out).length !== keys.length || keys.some((key) => !Object.hasOwn(out, key)))
    statusReject();
  return out;
}
function statusArray(value: unknown, max: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length
  )
    statusReject();
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value),
    length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) statusReject();
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (
    keys.length !== length ||
    keys.some(
      (key, index) =>
        key !== String(index) ||
        !descriptors[key]!.enumerable ||
        !Object.hasOwn(descriptors[key]!, 'value'),
    )
  )
    statusReject();
  return keys.map((key) => descriptors[key]!.value);
}
function statusTags(value: unknown): string[] {
  const tags = statusArray(value, 100);
  if (tags.some((tag) => typeof tag !== 'string' || tag.length > 4096)) statusReject();
  return tags as string[];
}
function statusFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) statusFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function statusReasons(reasons: string[]): string[] {
  return STATUS_REASONS.filter((reason) => reasons.includes(reason));
}
function statusNumber(
  data: Record<string, unknown>,
  key: string,
): { raw: number | null; presence: Presence } {
  if (!Object.hasOwn(data, key)) return { raw: null, presence: 'missing' };
  const raw = data[key];
  return typeof raw === 'number' && Number.isSafeInteger(raw) && !Object.is(raw, -0)
    ? { raw, presence: 'observed' }
    : { raw: null, presence: 'invalid' };
}
export function resolveShortEditorStatus(editData: unknown): ShortStatusFactsV1 {
  const data = statusObject(editData),
    editor = statusNumber(data, 'publish_status'),
    display = statusNumber(data, 'display_status');
  const mapped = display.raw === null ? undefined : DISPLAY_CODES[display.raw];
  const branch = editor.raw === 0 ? 'draft' : editor.raw === 1 ? 'non_draft' : 'unknown';
  const reasons: string[] = [];
  if (editor.presence === 'invalid') reasons.push('editor_field_invalid');
  else if (branch === 'unknown')
    reasons.push(editor.presence === 'missing' ? 'status_not_observed' : 'editor_code_unmapped');
  if (display.presence === 'invalid') reasons.push('display_field_invalid');
  else if (!mapped)
    reasons.push(display.presence === 'missing' ? 'status_not_observed' : 'display_code_unmapped');
  const conflict = branch === 'draft' && mapped !== undefined;
  if (conflict) reasons.push('editor_display_conflict');
  let resolvedState: ShortResolvedState = 'unknown';
  if (branch === 'draft' && (display.presence === 'missing' || display.raw === 0))
    resolvedState = 'draft';
  else if (branch === 'non_draft' && mapped) resolvedState = mapped[0];
  else if (branch === 'non_draft') reasons.push('editor_not_publication_proof');
  return statusFreeze({
    schema: 'fanqie-short-status-facts/v1',
    source: 'editor_edit_v1',
    basis: 'editor-publish-and-display/v1',
    editor: { namespace: 'publish_status', ...editor, branch },
    management: {
      namespace: 'display_status',
      ...display,
      label: mapped?.[1] ?? null,
      state: mapped?.[0] ?? 'unknown',
      basis: mapped ? 'observed_code' : 'unknown',
    },
    resolvedState,
    draftEditable: resolvedState === 'draft',
    conflict,
    reasons: statusReasons(reasons),
  });
}
export function resolveShortManagementLabels(input: unknown): ShortStatusFactsV1 {
  const tags = input === undefined ? [] : statusTags(input),
    states = new Set<ManagementState>(),
    labels: string[] = [],
    reasons: string[] = [];
  let masked = false;
  for (const raw of tags) {
    const label = raw.trim();
    if (Object.hasOwn(MANAGEMENT_LABELS, label)) {
      states.add(MANAGEMENT_LABELS[label]!);
      labels.push(label);
    } else if (label === '问题标注中') {
      masked = true;
      reasons.push('management_status_masks_publication');
    } else if (!['已签约', '未签约', '签约审核中', '签约处理中'].includes(label))
      reasons.push('management_label_unrecognized');
  }
  const conflict = states.size > 1;
  if (conflict) reasons.push('management_labels_conflict');
  const state = !conflict && !masked && states.size === 1 ? [...states][0]! : 'unknown';
  if (state === 'unknown') reasons.push('status_not_observed');
  const label = state !== 'unknown' ? labels[0]! : masked && !conflict ? '问题标注中' : null;
  return statusFreeze({
    schema: 'fanqie-short-status-facts/v1',
    source: 'management_labels',
    basis: 'management-visible-labels/v1',
    editor: { namespace: 'publish_status', raw: null, presence: 'missing', branch: 'unknown' },
    management: {
      namespace: 'display_status',
      raw: null,
      presence: 'missing',
      label,
      state,
      basis: label === null ? 'unknown' : 'visible_label',
    },
    resolvedState: state,
    draftEditable: false,
    conflict,
    reasons: statusReasons(reasons),
  });
}
function statusSame(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        statusSame((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
export function validateShortStatusFacts(input: unknown): ShortStatusFactsV1 {
  const f = statusExact(input, [
    'schema',
    'source',
    'basis',
    'editor',
    'management',
    'resolvedState',
    'draftEditable',
    'conflict',
    'reasons',
  ]);
  const e = statusExact(f.editor, ['namespace', 'raw', 'presence', 'branch']),
    m = statusExact(f.management, ['namespace', 'raw', 'presence', 'label', 'state', 'basis']);
  const reasons = statusTags(f.reasons);
  if (
    f.schema !== 'fanqie-short-status-facts/v1' ||
    e.namespace !== 'publish_status' ||
    m.namespace !== 'display_status' ||
    typeof f.draftEditable !== 'boolean' ||
    typeof f.conflict !== 'boolean' ||
    !statusSame(reasons, statusReasons(reasons))
  )
    statusReject();
  for (const field of [e, m])
    if (
      typeof field.presence !== 'string' ||
      !['missing', 'invalid', 'observed'].includes(field.presence) ||
      (field.presence === 'observed'
        ? typeof field.raw !== 'number' ||
          !Number.isSafeInteger(field.raw) ||
          Object.is(field.raw, -0)
        : field.raw !== null)
    )
      statusReject();
  if (f.source === 'editor_edit_v1') {
    const data: Record<string, unknown> = {};
    for (const [key, field] of [
      ['publish_status', e],
      ['display_status', m],
    ] as const)
      if (field.presence !== 'missing') data[key] = field.presence === 'invalid' ? null : field.raw;
    if (!statusSame(f, resolveShortEditorStatus(data))) statusReject();
  } else if (f.source === 'management_labels') {
    if (
      f.basis !== 'management-visible-labels/v1' ||
      !statusSame(e, {
        namespace: 'publish_status',
        raw: null,
        presence: 'missing',
        branch: 'unknown',
      }) ||
      m.raw !== null ||
      m.presence !== 'missing' ||
      f.draftEditable !== false ||
      f.resolvedState !== m.state ||
      reasons.some(
        (reason) =>
          ![
            'status_not_observed',
            'management_labels_conflict',
            'management_label_unrecognized',
            'management_status_masks_publication',
          ].includes(reason),
      )
    )
      statusReject();
    const known = typeof m.label === 'string' && Object.hasOwn(MANAGEMENT_LABELS, m.label);
    if (m.state !== 'unknown') {
      if (
        !known ||
        MANAGEMENT_LABELS[m.label as string] !== m.state ||
        m.basis !== 'visible_label' ||
        f.conflict ||
        reasons.includes('status_not_observed') ||
        reasons.includes('management_status_masks_publication')
      )
        statusReject();
    } else if (
      !reasons.includes('status_not_observed') ||
      ![null, '问题标注中'].includes(m.label as null | string) ||
      m.basis !== (m.label === null ? 'unknown' : 'visible_label')
    )
      statusReject();
    if (
      f.conflict !== reasons.includes('management_labels_conflict') ||
      (reasons.includes('management_status_masks_publication') &&
        !f.conflict &&
        m.label !== '问题标注中') ||
      (m.label === '问题标注中' && !reasons.includes('management_status_masks_publication'))
    )
      statusReject();
  } else statusReject();
  return statusFreeze({ ...f, editor: e, management: m, reasons }) as unknown as ShortStatusFactsV1;
}
/** Public WB receives the same exact facts plus its original label vector. */
export function validateShortStatusRow(input: unknown): void {
  const row = statusObject(input);
  if (!Object.hasOwn(row, 'statusFacts')) return; // Legacy WB schema stays readable; App supplies facts after adoption.
  const facts = validateShortStatusFacts(row.statusFacts),
    expected = resolveShortManagementLabels(
      Object.hasOwn(row, 'statusTags') ? row.statusTags : undefined,
    );
  if (!statusSame(facts, expected) || row.publicationStatus !== expected.resolvedState)
    statusReject();
}
/** Capture bounded JSON through descriptors before any spread/iteration/stringification. */
export function captureShortStatusJson(input: unknown): unknown {
  let nodes = 0,
    characters = 0;
  const active = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 200_000 || depth > 40) statusReject();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) statusReject();
      return value;
    }
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > 16_000_000) statusReject();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) statusReject();
    active.add(value);
    const out = Array.isArray(value)
      ? statusArray(value, 100_000).map((child) => copy(child, depth + 1))
      : Object.fromEntries(
          Object.entries(statusObject(value)).map(([key, child]) => [key, copy(child, depth + 1)]),
        );
    active.delete(value);
    return out;
  }
  return copy(input, 0);
}
export function projectShortWorksStatus(input: unknown): Record<string, unknown> {
  const payload = statusObject(captureShortStatusJson(input));
  if (!Object.hasOwn(payload, 'records')) statusReject();
  const records = statusArray(payload.records, 100_000).map((value) => {
    const row = statusObject(value);
    if (Object.hasOwn(row, 'statusFacts')) validateShortStatusFacts(row.statusFacts);
    const statusFacts = resolveShortManagementLabels(
      Object.hasOwn(row, 'statusTags') ? row.statusTags : undefined,
    );
    return { ...row, publicationStatus: statusFacts.resolvedState, statusFacts };
  });
  return { ...payload, records };
}
