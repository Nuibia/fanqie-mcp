import assert from 'node:assert/strict';

import {
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
  type FixtureElement,
  type ChapterStaticUiFixtureElement,
} from '../platform-reads.test.js';

interface Ports {
  options: {
    rows?: unknown[];
    titles?: string[];
    buttons?: Array<{ label: string; type?: string; className?: string; disabled?: boolean }>;
    method?: string;
    destination?: string;
    apiDestination?: string;
    spa?: boolean;
    postOnClick?: boolean;
    changedOwner?: boolean;
    oldRequest?: boolean;
    navigateDuringReplay?: boolean;
    directorySources?: ChapterFixtureSource[];
    navigateDuringDirectoryReplay?: boolean;
    directoryReplayError?: boolean;
    directoryNavigationAfterIndex?: number;
    navigateDuringDiagnosticDom?: boolean;
    cancelDuringDirectoryReplay?: AbortController;
    ownerAfterDirectoryReplay?: boolean;
    navigateBeforeVolumeRefresh?: boolean;
    duplicateFreshVolumeRequest?: boolean;
    suppressFreshVolumeEvents?: boolean;
    replayVolumeStatus?: number;
    freshVolumeUrlDrift?: boolean;
    volumeInputWrapper?: 'strings' | 'all';
    freshVolumeOverride?: {
      query?: string;
      resourceType?: string;
      subframe?: boolean;
      frameUnavailable?: boolean;
    };
    extraFreshVolumeEvents?: number;
    oldVolumeResponseDuringFresh?: boolean;
    suppressFreshVolumeResponse?: boolean;
    delayedFreshVolumeResponse?: boolean;
    mismatchedFreshResponseStatus?: number;
    oldResponseDuringVolumeWait?: boolean;
    navigateDuringVolumeWait?: boolean;
    cancelDuringVolumeWait?: AbortController;
    duplicateDuringVolumeWait?: boolean;
    bootstrapNavigation?: string[];
    loseSlotDuringDirectoryReplay?: boolean;
    chapterUi?: ChapterStaticUiFixture;
    realChapterReadiness?: ChapterRenderReadinessFixture;
  };
  CHAPTER_ENTRY_FIXTURE_TITLE: 'PRIVATE_CHAPTER_MANAGER_TITLE';
  volumeExpanded: boolean;
}
export function createEntryDom(ports: Ports) {
  return () => {
    const element = (
      tagName: string,
      textContent: string,
      attributes: Record<string, string> = {},
    ): FixtureElement => ({
      isConnected: true,
      setAttribute: (name, value) => {
        attributes[name] = value;
      },
      tagName,
      textContent,
      contains: () => false,
      closest: () => (tagName === 'TEXTAREA' ? element('TEXTAREA', '') : null),
      getAttribute: (name) => attributes[name] ?? null,
      getBoundingClientRect: () => ({ width: 100, height: 40 }),
      hasAttribute: (name) => name in attributes,
      matches: (selector) =>
        selector === 'button.right-btn[type="button"]' &&
        tagName === 'BUTTON' &&
        attributes.type === 'button' &&
        (attributes.class ?? '').split(' ').includes('right-btn'),
      querySelector: () => null,
      querySelectorAll: () => [],
    });

    const buttons = (ports.options.buttons ?? [{ label: '章节管理' }]).map((button) =>
      element('BUTTON', button.label, {
        type: button.type ?? 'button',
        class: button.className ?? 'arco-btn right-btn',
        ...(button.disabled ? { disabled: '' } : {}),
      }),
    );

    const cards = (ports.options.titles ?? [ports.CHAPTER_ENTRY_FIXTURE_TITLE]).map((title) => {
      const card = element('DIV', '', { class: 'home-book-item' });
      const heading = element('DIV', title, { class: 'info-content-title font-1' });
      card.querySelector = (selector) => (selector === '.info-content-title' ? heading : null);
      card.querySelectorAll = (selector) => (selector === 'button' ? buttons : []);
      return card;
    });

    const nav = element('DIV', '章节管理', { class: 'new-nav-item-label' });

    const body = element('TEXTAREA', 'PRIVATE_CHAPTER_BODY', { class: 'chapter-body' });

    const chapterTabs = (ports.options.chapterUi?.tabs ?? []).map((tab) =>
      element('DIV', tab.label, {
        role: 'tab',
        class: `arco-tabs-header-title${tab.active ? ' arco-tabs-header-title-active' : ''}`,
        ...(tab.ariaSelected === undefined ? {} : { 'aria-selected': tab.ariaSelected }),
        ...(tab.hidden ? { 'data-fixture-hidden': '' } : {}),
      }),
    );

    const statusValues = (ports.options.chapterUi?.statusLabels ?? []).map((label) =>
      element('DIV', label, {
        class: 'byte-select-view-value',
        ...(ports.options.chapterUi?.hiddenFilters ? { 'data-fixture-hidden': '' } : {}),
      }),
    );

    const statusContainers = statusValues.map((value) => {
      const container = element('DIV', '', { class: 'serial-select chapter-status-select' });
      container.querySelector = (selector) =>
        selector === '.byte-select-view-value' ? value : null;
      return container;
    });

    const staticElement = (input: ChapterStaticUiFixtureElement) =>
      Object.assign(
        element(input.tag ?? 'DIV', input.text ?? '', {
          ...input.attributes,
          ...(input.hidden ? { 'data-fixture-hidden': '' } : {}),
        }),
        input.selected === undefined ? {} : { selected: input.selected },
      );

    const volumeViews: FixtureElement[] = [],
      optionGroups: FixtureElement[][] = [];

    const volumeContainers = (ports.options.chapterUi?.volumeLabels ?? []).map((label, index) => {
      const value = element('DIV', label, {
        class: 'byte-select-view-value',
        ...(ports.options.chapterUi?.hiddenFilters ? { 'data-fixture-hidden': '' } : {}),
      });
      const container = element('DIV', '', {
        class: 'byte-select serial-select',
        ...(ports.options.chapterUi?.hiddenFilters ||
        ports.options.realChapterReadiness?.volumeHidden
          ? { 'data-fixture-hidden': '' }
          : {}),
        ...(ports.options.realChapterReadiness?.volumeDisabled ? { 'aria-disabled': 'true' } : {}),
      });
      const association = ports.options.realChapterReadiness?.volumeExpansion;
      const view = element('DIV', '', {
        class: 'byte-select-view',
        role: 'combobox',
        ...(association === 'controls' || association === 'ambiguous'
          ? {
              'aria-controls':
                association === 'ambiguous'
                  ? 'PRIVATE_POPUP_ID PRIVATE_OTHER_POPUP_ID'
                  : 'PRIVATE_POPUP_ID',
            }
          : association === 'owns'
            ? { 'aria-owns': 'PRIVATE_POPUP_ID' }
            : {}),
      });
      const visibleOptions = (ports.options.chapterUi?.volumeOptions?.[index] ?? []).map(
        staticElement,
      );
      optionGroups.push(visibleOptions);
      volumeViews.push(view);
      container.querySelector = (selector) =>
        selector === '.byte-select-view-value'
          ? value
          : selector === '.byte-select-view'
            ? view
            : null;
      container.querySelectorAll = (selector) => {
        if (selector === '.byte-select-view') return [view];
        assert.equal(selector, 'option,[role="option"]');
        return association && (association !== 'descendant' || !ports.volumeExpanded)
          ? []
          : visibleOptions;
      };
      return container;
    });

    const volumeControlOrder = [...volumeContainers, ...statusContainers];

    const popup = element('DIV', 'PRIVATE_POPUP_TITLE', {
      id: 'PRIVATE_POPUP_ID',
      class: 'byte-select-dropdown PRIVATE_POPUP_CLASS',
      role: 'listbox',
    });

    popup.querySelectorAll = (selector) =>
      selector === 'option,[role="option"]' && ports.volumeExpanded ? optionGroups.flat() : [];

    const footer = element('DIV', '', { class: 'chapter-footer PRIVATE_FOOTER_CLASS' });

    const footerNext = element('BUTTON', '下一页', {
      class: 'byte-pagination-next',
      type: 'button',
      'aria-label': '下一页',
    });

    footer.querySelectorAll = () => [footerNext];

    const tableElement = element('DIV', '', { class: 'chapter-table' });

    tableElement.parentElement = { children: [tableElement, footer] };

    const selectRoot = element('DIV', '', { class: 'chapter-select' });

    selectRoot.querySelectorAll = () => [...volumeContainers, ...volumeViews, ...statusContainers];

    const tabsRoot = element('DIV', '', { class: 'chapter-manage-tabs' });

    tabsRoot.querySelectorAll = () => chapterTabs;

    const unboundOptions = (ports.options.chapterUi?.unboundOptions ?? []).map(staticElement);

    const pagerRoots = (ports.options.chapterUi?.pagerRoots ?? []).map((root) => {
      const node = element('DIV', 'PRIVATE_PAGER_ROOT_TITLE', {
        class: root.className ?? 'arco-pagination',
        ...(root.hidden ? { 'data-fixture-hidden': '' } : {}),
      });
      const controls = root.controls.map(staticElement);
      node.querySelectorAll = (selector) => {
        assert.equal(
          selector,
          'button,a,input,[role="button"],[aria-label],[aria-current],.arco-pagination-item,.byte-pagination-item',
        );
        return controls;
      };
      return node;
    });
    return {
      element,
      buttons,
      cards,
      nav,
      body,
      chapterTabs,
      statusValues,
      statusContainers,
      staticElement,
      volumeViews,
      optionGroups,
      volumeContainers,
      volumeControlOrder,
      popup,
      footer,
      footerNext,
      tableElement,
      selectRoot,
      tabsRoot,
      unboundOptions,
      pagerRoots,
    };
  };
}
