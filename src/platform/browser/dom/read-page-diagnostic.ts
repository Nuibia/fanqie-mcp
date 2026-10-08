import { type ChapterDirectoryUiStructure } from '../chapter-diagnostics.js';

export const readPageDiagnosticDom = ({
  maxElements,
  redactions,
  inspectChapterUi,
  inspectVolumeOptions,
}: {
  maxElements: number;
  inspectChapterUi: boolean;
  inspectVolumeOptions: boolean;
  redactions: string[];
}) => {
  const uiLabel = (value: string | null): string | null => {
    if (
      !value ||
      value.length > 50 ||
      redactions.some((secret) => secret && value.includes(secret))
    )
      return null;
    const clean = value.trim().replace(/\s+/g, ' ');
    return /^(?:作品管理|章节管理|短故事|长篇|小说|草稿箱|数据中心|作品数据|收益数据|账号设置|个人中心|实名认证|作者福利|笔名|作者ID|用户ID|累计|近7天|近30天|昨日|今日|全部|进行中|已结束|最近更新|详情|查看|编辑|修改|保存|存草稿|下一步|上一步|发布|提交|新建作品|新建章节|创建|删除|登录|扫码登录|退出登录|作品名称|短故事名称|章节名称|章节标题|正文|简介|书名|封面设置|作品分类|是否使用AI|试读比例|主分类|第 \d{1,4} 页|上一页|下一页|(?:请输入|请填写)(?:作品|短故事|章节)?(?:名称|标题|简介|正文|笔名))$/.test(
      clean,
    )
      ? clean
      : null;
  };
  const selectorValue = (value: string | null): string | null => {
    if (
      !value ||
      value.length > 160 ||
      redactions.some((secret) => secret && value.includes(secret)) ||
      !/^[a-zA-Z_][a-zA-Z0-9_ .:-]*$/.test(value)
    )
      return null;
    return value.replace(/\d{5,}/g, '{id}').replace(/[a-f\d]{24,}/gi, '{opaque}');
  };
  const candidateSelector =
    'a,button,input,textarea,select,label,dt,th,[role],[aria-label],[placeholder],[class],[id]';
  const originalCandidates = [...document.querySelectorAll(candidateSelector)];
  // Existing metadata shape, prioritizing list chrome rather than private row/editor content.
  const tableRoot = inspectVolumeOptions ? document.querySelector('.chapter-table') : null;
  const chromeRoots = inspectVolumeOptions
    ? [
        ...document.querySelectorAll('.chapter-select,.chapter-manage-tabs'),
        ...[...(tableRoot?.parentElement?.children ?? [])].filter(
          (element) => element !== tableRoot && !element.contains(tableRoot),
        ),
      ]
    : [];
  const excluded = (element: Element) =>
    Boolean(
      element.closest('tr,td,.arco-table-tr,.arco-table-td,textarea,[contenteditable="true"]'),
    );
  const priority = chromeRoots
    .flatMap((root) => [root, ...root.querySelectorAll(candidateSelector)])
    .filter((element) => !excluded(element));
  const candidates = inspectVolumeOptions
    ? [...new Set([...priority, ...originalCandidates.filter((element) => !excluded(element))])]
    : originalCandidates;
  const elements = candidates.slice(0, maxElements).map((element) => {
    const attributes: Record<string, string> = {};
    for (const name of inspectVolumeOptions
      ? ['class', 'role', 'type']
      : ['id', 'class', 'role', 'type', 'name', 'data-testid']) {
      const raw = element.getAttribute(name);
      const value = selectorValue(
        inspectVolumeOptions && name === 'class'
          ? (raw ?? '')
              .split(/\s+/)
              .filter((token) =>
                /^(?:(?:arco|byte|chapter)-[a-z0-9_-]+|serial-select)$/.test(token),
              )
              .join(' ')
          : raw,
      );
      if (value) attributes[name] = value;
    }
    for (const name of ['aria-label', 'placeholder']) {
      const value = uiLabel(element.getAttribute(name));
      if (value) attributes[name] = value;
    }
    const label = /^(?:BUTTON|LABEL|DT|TH)$/.test(element.tagName)
      ? uiLabel(element.textContent)
      : null;
    return { tag: element.tagName.toLowerCase(), attributes, label };
  });
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .slice(0, 500)
    .map((anchor) => ({ href: anchor.href, label: uiLabel(anchor.textContent) }));
  const navigationWords = new Set([
    '工作台',
    '作品管理',
    '数据中心',
    '小说数据',
    '短故事数据',
    '长篇',
    '短故事',
    '小说',
    '章节管理',
    '收益数据',
    '作者福利',
    '作家福利',
  ]);
  const navigationLabels = [
    ...new Set(
      [...document.querySelectorAll('.new-nav-item-label')]
        .map((element) => element.textContent?.trim().replace(/\s+/g, ' ') ?? '')
        .filter((label) => navigationWords.has(label)),
    ),
  ];
  // Exact previously observed title selectors only, used privately to reject title-shaped schema keys.
  const internalBookTitles = [
    ...document.querySelectorAll('.book-select-title,.info-content-title'),
  ]
    .slice(0, 20)
    .map((element) => element.textContent?.trim() ?? '')
    .filter((value) => value.length >= 3 && value.length <= 200);
  let chapterUi: ChapterDirectoryUiStructure | undefined;
  if (inspectChapterUi) {
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };
    const knownLabels = new Set([
      '已发布',
      '已发布章节',
      '章节管理',
      '草稿箱',
      '全部',
      '全部状态',
      '全部章节',
      '所有章节',
    ]);
    const publicLabel = (element: Element): string | null => {
      const raw = element.textContent ?? '';
      if (raw.length > 50 || redactions.some((secret) => secret && raw.includes(secret)))
        return null;
      const clean = raw.trim().replace(/\s+/g, ' ');
      return knownLabels.has(clean) ? clean : null;
    };
    const tabs = [...document.querySelectorAll('.chapter-manage-tabs [role="tab"]')].filter(
      visible,
    );
    const statusValues = [
      ...document.querySelectorAll('.chapter-status-select .byte-select-view-value'),
    ].filter(visible);
    // The observed status control also has serial-select; it must not be mistaken for a volume selection.
    const volumeValues = [...document.querySelectorAll('.chapter-select-left .serial-select')]
      .filter(
        (element) =>
          visible(element) &&
          !(element.getAttribute('class') ?? '').split(/\s+/).includes('chapter-status-select'),
      )
      .map((element) => element.querySelector('.byte-select-view-value'))
      .filter((element): element is Element => element !== null && visible(element));
    const filter = (values: Element[]) => {
      const label = values.length === 1 ? publicLabel(values[0]!) : null;
      return {
        present: values.length > 0,
        matches: Math.min(values.length, 8),
        label,
        all: label !== null && new Set(['全部', '全部状态', '全部章节', '所有章节']).has(label),
      };
    };
    const table = document.querySelector('.chapter-table');
    const nullableAttribute = (element: Element, name: string): boolean | null => {
      const value = element.getAttribute(name);
      return value === 'true' ? true : value === 'false' ? false : null;
    };
    const disabled = (element: Element): boolean | null => {
      const native = /^(?:BUTTON|INPUT|OPTION)$/.test(element.tagName);
      if (native && element.hasAttribute('disabled')) return true;
      return nullableAttribute(element, 'aria-disabled') ?? (native ? false : null);
    };
    // Framework selectors discover structure, not action semantics. No generic global options or labels are emitted.
    const pagerRoots = [...document.querySelectorAll('.arco-pagination,.byte-pagination')].filter(
      (element) =>
        visible(element) &&
        (element.getAttribute('class') ?? '')
          .split(/\s+/)
          .some((name) => name === 'arco-pagination' || name === 'byte-pagination'),
    );
    const pagerControls = [
      ...new Set(
        pagerRoots
          .slice(0, 8)
          .flatMap((root) =>
            [
              ...root.querySelectorAll(
                'button,a,input,[role="button"],[aria-label],[aria-current],.arco-pagination-item,.byte-pagination-item',
              ),
            ].filter(visible),
          ),
      ),
    ];
    const pagination: NonNullable<ChapterDirectoryUiStructure['pagination']> = {
      state:
        pagerRoots.length === 0
          ? 'not_observed'
          : pagerRoots.length === 1
            ? 'observed'
            : 'ambiguous',
      rootCount: Math.min(pagerRoots.length, 8),
      rootCountTruncated: pagerRoots.length > 8,
      controlCount: Math.min(pagerControls.length, 100),
      controls: pagerControls.slice(0, 32).map((element) => {
        const type =
          element.tagName === 'BUTTON'
            ? 'button'
            : element.tagName === 'A'
              ? 'link'
              : element.tagName === 'INPUT'
                ? 'input'
                : element.tagName === 'DIV'
                  ? 'div'
                  : element.tagName === 'SPAN'
                    ? 'span'
                    : 'other';
        const ariaLabel = element.getAttribute('aria-label')?.trim().toLowerCase() ?? '';
        const direction = new Set(['下一页', 'next', 'next page']).has(ariaLabel)
          ? 'next'
          : new Set(['上一页', 'previous', 'previous page']).has(ariaLabel)
            ? 'previous'
            : 'unknown';
        const caption = element.textContent?.trim() ?? '';
        const pageNumber =
          /^[1-9]\d{0,3}$/.test(caption) &&
          !redactions.some((secret) => secret && caption.includes(secret))
            ? Number(caption)
            : null;
        const currentValue = element.getAttribute('aria-current');
        return {
          type,
          direction,
          pageNumber,
          current: currentValue === 'page' ? true : currentValue === 'false' ? false : null,
          disabled: disabled(element),
        };
      }),
      truncated: pagerRoots.length > 8 || pagerControls.length > 32,
    };
    const volumeControls = [
      ...document.querySelectorAll('.chapter-select-left .serial-select'),
    ].filter(
      (element) =>
        visible(element) &&
        !(element.getAttribute('class') ?? '').split(/\s+/).includes('chapter-status-select'),
    );
    // Portal options without an observed control association are deliberately excluded.
    let visibleOptions =
      volumeControls.length === 1
        ? [...volumeControls[0]!.querySelectorAll('option,[role="option"]')].filter(visible)
        : [];
    if (inspectVolumeOptions && volumeControls.length === 1 && visibleOptions.length === 0) {
      const control = volumeControls[0]!,
        views = [...control.querySelectorAll('.byte-select-view')];
      const associationIds = [
        ...new Set(
          [control, ...views].flatMap((element) =>
            ['aria-controls', 'aria-owns'].flatMap((name) =>
              (element.getAttribute(name) ?? '').trim().split(/\s+/).filter(Boolean),
            ),
          ),
        ),
      ];
      if (associationIds.length === 1) {
        const popup = document.getElementById(associationIds[0]!);
        const linked = [...document.querySelectorAll('[role="listbox"]')].filter(
          (element) => element.getAttribute('id') === associationIds[0],
        );
        if (popup && linked.length === 1 && linked[0] === popup && visible(popup))
          visibleOptions = [...popup.querySelectorAll('option,[role="option"]')].filter(visible);
      }
    }
    const volumeFilter = filter(volumeValues);
    const volumeOptions: NonNullable<ChapterDirectoryUiStructure['volumeOptions']> = {
      state:
        volumeControls.length === 0
          ? 'not_observed'
          : volumeControls.length > 1
            ? 'ambiguous_control'
            : visibleOptions.length === 0
              ? 'no_visible_options'
              : 'visible_options',
      controlCount: Math.min(volumeControls.length, 8),
      controlCountTruncated: volumeControls.length > 8,
      selectionScope:
        volumeControls.length === 0
          ? 'not_observed'
          : volumeControls.length === 1 && volumeFilter.all
            ? 'all_label'
            : 'other_or_unknown',
      optionCount: Math.min(visibleOptions.length, 100),
      options: visibleOptions.slice(0, 32).map((element) => {
        const nativeSelected: unknown =
          element.tagName === 'OPTION' ? (element as HTMLOptionElement).selected : null;
        return {
          type: element.tagName === 'OPTION' ? 'native_option' : 'aria_option',
          selected:
            element.tagName === 'OPTION'
              ? typeof nativeSelected === 'boolean'
                ? nativeSelected
                : null
              : nullableAttribute(element, 'aria-selected'),
          disabled: disabled(element),
        };
      }),
      truncated: visibleOptions.length > 32,
    };
    chapterUi = {
      tabs: tabs.slice(0, 8).map((element, index) => ({
        index,
        label: publicLabel(element),
        active:
          element.getAttribute('aria-selected') === 'true' ||
          (element.getAttribute('class') ?? '')
            .split(/\s+/)
            .includes('arco-tabs-header-title-active'),
      })),
      tabsTruncated: tabs.length > 8,
      statusFilter: filter(statusValues),
      volumeFilter,
      tablePresent: table !== null && visible(table),
      pagination,
      volumeOptions,
    };
  }
  return {
    elements,
    links,
    navigationLabels,
    internalBookTitles,
    chapterUi,
    truncated: candidates.length > maxElements,
  };
};
