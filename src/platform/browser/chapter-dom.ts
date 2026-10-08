import {
  type ChapterManagementControlObservation,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../reads.js';

import { type CurrentChapterDirectoryOptions } from './contracts.js';

/** Private DOM values and handles stay in the current collector invocation. */
export function currentManagementDom(input: {
  control?: Element;
  view?: Element;
  popup?: Element;
  option?: Element;
  optionName?: string;
  next?: Element;
  portalOpeningObserved?: boolean;
  mode: 'state' | 'control' | 'popup' | 'option' | 'next';
}) {
  const visible = (node: Element) => {
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return (
      node.isConnected &&
      box.width > 0 &&
      box.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  };
  const disabled = (node: Element) =>
    node.hasAttribute('disabled') ||
    node.getAttribute('aria-disabled') === 'true' ||
    (node.tagName === 'BUTTON' && node.getAttribute('type') === 'submit');
  const controls = [...document.querySelectorAll('.chapter-select-left .serial-select')].filter(
    (node) => visible(node) && !node.classList.contains('chapter-status-select'),
  );
  const tabs = [...document.querySelectorAll('.chapter-manage-tabs [role="tab"]')].filter(visible);
  const activeTabs = tabs.filter(
    (node) =>
      node.getAttribute('aria-selected') === 'true' ||
      node.classList.contains('arco-tabs-header-title-active'),
  );
  const status = [
    ...document.querySelectorAll('.chapter-status-select .byte-select-view-value'),
  ].filter(visible);
  const table = document.querySelector('.chapter-table');
  const allStatus = Boolean(
    table &&
    visible(table) &&
    activeTabs.length === 1 &&
    ['章节管理', '已发布', '已发布章节'].includes(activeTabs[0]!.textContent?.trim() ?? '') &&
    status.length === 1 &&
    ['全部', '全部状态', '全部章节', '所有章节'].includes(status[0]!.textContent?.trim() ?? ''),
  );
  const popups = [...document.querySelectorAll('.byte-select-popup')].filter(visible);
  const openControls = [...document.querySelectorAll('.serial-select.byte-select-open')].filter(
    visible,
  );
  const control = controls.length === 1 && !disabled(controls[0]!) ? controls[0]! : null;
  const views = control ? [...control.querySelectorAll('.byte-select-view')].filter(visible) : [];
  const view = views.length === 1 && !disabled(views[0]!) ? views[0]! : null;
  const bound =
    control !== null &&
    view !== null &&
    (!input.control || control === input.control) &&
    (!input.view || view === input.view);
  if (input.mode === 'state') {
    const labels =
      controls.length === 1
        ? [...controls[0]!.querySelectorAll('.byte-select-view-value')].filter(visible)
        : [];
    return {
      allStatus,
      selectedName: labels.length === 1 ? (labels[0]!.textContent?.trim() ?? null) : null,
    };
  }
  if (input.mode === 'control')
    return {
      control,
      view,
      bound,
      popupCount: popups.length,
      openCount: openControls.length,
      open: control?.classList.contains('byte-select-open') === true,
    };
  if (input.mode === 'next') {
    const roots = [...document.querySelectorAll('.arco-pagination,.byte-pagination')].filter(
      visible,
    );
    const nexts =
      roots.length === 1
        ? [
            ...roots[0]!.querySelectorAll(
              '.arco-pagination-item-next,.byte-pagination-item-next,[aria-label="下一页"],[aria-label="Next page"]',
            ),
          ].filter(
            (node) =>
              visible(node) &&
              !disabled(node) &&
              (node.tagName === 'BUTTON' ||
                node.tagName === 'LI' ||
                node.getAttribute('role') === 'button'),
          )
        : [];
    const next = nexts.length === 1 ? nexts[0]! : null;
    return { next, bound: next !== null && (!input.next || next === input.next), allStatus };
  }
  const descendants = control
    ? [...control.querySelectorAll('.byte-select-popup')].filter(visible)
    : [];
  const popup =
    bound && descendants.length === 1
      ? descendants[0]!
      : bound &&
          input.portalOpeningObserved === true &&
          descendants.length === 0 &&
          openControls.length === 1 &&
          openControls[0] === control &&
          popups.length === 1
        ? popups[0]!
        : null;
  const popupBound = popup !== null && (!input.popup || input.popup === popup);
  const options = popup ? [...popup.querySelectorAll('.byte-select-option')].filter(visible) : [];
  // A visible flat list is usable only when no hidden, clipped or virtual option
  // extent is present. Backend completeness additionally needs exact inventory match.
  const extent =
    popup !== null &&
    options.length > 0 &&
    options.length <= 32 &&
    popup.querySelectorAll('.byte-select-option').length === options.length &&
    !popup.querySelector('[class*="virtual"],[aria-busy="true"],[aria-setsize="-1"]') &&
    [popup, ...popup.querySelectorAll('.byte-select-popup-inner')].every(
      (node) => node.scrollHeight <= node.clientHeight + 1,
    );
  if (input.mode === 'option')
    return {
      bound:
        bound &&
        popupBound &&
        input.option !== undefined &&
        options.includes(input.option) &&
        !disabled(input.option) &&
        input.option.textContent?.trim() === input.optionName &&
        allStatus,
    };
  return {
    popup,
    bound: bound && popupBound,
    extent,
    options: options.map((node) => ({
      node,
      name: node.textContent?.trim() ?? '',
      disabled: disabled(node),
    })),
    allStatus,
  };
}

/** Exact draft-tab/list controls only. Raw labels and DOM handles never leave this call. */
export function currentDraftDirectoryDom(input: {
  mode: 'tab' | 'state' | 'next';
  tab?: Element;
  next?: Element;
}) {
  const visible = (node: Element) => {
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return (
      node.isConnected &&
      box.width > 0 &&
      box.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  };
  const disabled = (node: Element) =>
    node.hasAttribute('disabled') ||
    node.getAttribute('aria-disabled') === 'true' ||
    (node.tagName === 'BUTTON' && node.getAttribute('type') === 'submit');
  const tabs = [
    ...document.querySelectorAll(
      '.chapter-manage-tabs.serial-tabs.serial-tabs-text.arco-tabs-size-small .arco-tabs-header-nav .arco-tabs-header-title',
    ),
  ].filter(visible);
  const drafts = tabs.filter((node) => node.textContent?.trim() === '草稿箱' && !disabled(node));
  const tab = drafts.length === 1 ? drafts[0]! : null;
  const active = tabs.filter(
    (node) =>
      node.getAttribute('aria-selected') === 'true' ||
      node.classList.contains('arco-tabs-header-title-active'),
  );
  const activeDraft = tab !== null && active.length === 1 && active[0] === tab;
  if (input.mode === 'tab')
    return { tab, bound: tab !== null && (!input.tab || input.tab === tab), activeDraft };
  const table = [...document.querySelectorAll('.draft-table.auto-editor-draft')].filter(visible);
  // Only known table-empty markers inside the actual draft table qualify zero scope.
  const empty =
    table.length === 1 &&
    [...table[0]!.querySelectorAll('.arco-table-no-data,.byte-table-empty')].some(visible);
  const ready = activeDraft && table.length === 1;
  if (input.mode === 'state')
    return { ready, activeDraft, tablePresent: table.length === 1, explicitEmpty: empty };
  const roots = [...document.querySelectorAll('.arco-pagination,.byte-pagination')].filter(visible);
  const nexts =
    roots.length === 1
      ? [
          ...roots[0]!.querySelectorAll(
            '.arco-pagination-item-next,.byte-pagination-item-next,[aria-label="下一页"],[aria-label="Next page"]',
          ),
        ].filter(
          (node) =>
            visible(node) &&
            !disabled(node) &&
            (node.tagName === 'BUTTON' ||
              node.tagName === 'LI' ||
              node.getAttribute('role') === 'button'),
        )
      : [];
  const next = nexts.length === 1 ? nexts[0]! : null;
  return { next, bound: next !== null && (!input.next || input.next === next), ready };
}

/** Fixed historical counts from known next selectors only; never an action/source proof. */
export function currentManagementNextObservation(): ChapterManagementControlObservation {
  const visible = (node: Element) => {
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return (
      node.isConnected &&
      box.width > 0 &&
      box.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  };
  const disabled = (node: Element) =>
    node.hasAttribute('disabled') ||
    node.getAttribute('aria-disabled') === 'true' ||
    (node.tagName === 'BUTTON' && node.getAttribute('type') === 'submit');
  const roots = [...document.querySelectorAll('.arco-pagination,.byte-pagination')].filter(visible);
  const raw = [
    ...new Set(
      roots
        .slice(0, 32)
        .flatMap((root) => [
          ...root.querySelectorAll(
            '.arco-pagination-item-next,.byte-pagination-item-next,[aria-label="下一页"],[aria-label="Next page"]',
          ),
        ]),
    ),
  ];
  const nodes = raw.slice(0, 32),
    tags = { button: 0, li: 0, div: 0, a: 0, span: 0, input: 0, other: 0 };
  let eligibleNextCount = 0,
    roleButtonCount = 0,
    disabledCount = 0,
    visibleCount = 0;
  for (const node of nodes) {
    const tag = node.tagName;
    if (tag === 'BUTTON') tags.button++;
    else if (tag === 'LI') tags.li++;
    else if (tag === 'DIV') tags.div++;
    else if (tag === 'A') tags.a++;
    else if (tag === 'SPAN') tags.span++;
    else if (tag === 'INPUT') tags.input++;
    else tags.other++;
    const shown = visible(node),
      blocked = disabled(node),
      roleButton = node.getAttribute('role') === 'button';
    if (shown) visibleCount++;
    if (blocked) disabledCount++;
    if (roleButton) roleButtonCount++;
    if (shown && !blocked && (tag === 'BUTTON' || tag === 'LI' || roleButton)) eligibleNextCount++;
  }
  return {
    kind: 'management_next_control_observation',
    rootCount: Math.min(roots.length, 32),
    rawKnownNextCount: nodes.length,
    eligibleNextCount,
    tags,
    roleButtonCount,
    disabledCount,
    visibleCount,
    truncated: roots.length > 32 || raw.length > 32,
  };
}

export function currentChapterFailureMetadata(
  kind: CurrentChapterDirectoryOptions['expectedOwner']['kind'],
): CurrentChapterCollectionFailureDiagnostic {
  return {
    kind: 'current_chapter_collection_failure',
    failedStage: 'manager_entry',
    initialState: null,
    identityTypes: {
      initialAuthenticated: null,
      initialAccountIdPresent: null,
      initialAuthorIdPresent: null,
      bindingAccountKind: null,
      bindingAuthorKind: null,
      expectedAccountKind: kind === 'account',
      expectedAuthorKind: kind === 'author',
      beforeParsedAccountIdPresent: null,
      beforeAccepted: null,
      afterParsedAccountIdPresent: null,
      afterAccepted: null,
    },
    ownAccountContext: {
      attempts: 0,
      disposed: 0,
      responseBefore: 'not_observed',
      responseAfter: 'not_observed',
    },
    callback: { entered: false, succeeded: false },
    observedReason: null,
    canonicalBootstrap: null,
    sourceObservation: null,
  };
}

export function currentChapterObservedReason(
  value: unknown,
): CurrentChapterCollectionFailureDiagnostic['observedReason'] {
  switch (value) {
    case null:
      return null;
    case 'identity_unverified':
    case 'target_owner_mismatch':
    case 'document_changed':
    case 'shell_unready':
    case 'template_missing':
    case 'template_ambiguous':
    case 'context_unavailable':
    case 'transport_failed':
    case 'http_failed':
    case 'response_url_changed':
    case 'json_unavailable':
    case 'code_not_zero':
    case 'owner_changed':
    case 'response_disposal_failed':
    case 'bootstrap_request_blocked':
      return value;
    default:
      return 'unknown';
  }
}

export function currentChapterHttpCategory(
  status: unknown,
): CurrentChapterCollectionFailureDiagnostic['ownAccountContext']['responseBefore'] {
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599)
    return 'not_observed';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client_error';
  if (status >= 500) return 'server_error';
  return 'other';
}
