import { type ChapterTabStructure } from '../read-diagnostics.js';

import { type ChapterTabStructureNode } from '../chapter-diagnostics.js';

export const readCurrentLoginDom = ({
  maxElements,
  redactions,
}: {
  maxElements: number;
  redactions: string[];
}) => {
  const visible = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      box.width > 0 &&
      box.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  };
  const labels = new Set([
    '工作台',
    '作家工作台',
    '作品管理',
    '我的作品',
    '数据中心',
    '短故事',
    '长篇',
    '小说',
    '章节管理',
    '草稿箱',
    '作家福利',
    '消息',
    '通知',
    '扫码登录',
    '验证码登录',
    '手机号登录',
    '密码登录',
    '登录',
    '退出登录',
    '关闭',
    '知道了',
    '我知道了',
    '新功能公告',
    '下一步',
    '上一页',
    '下一页',
    '查看',
    '详情',
    '个人中心',
    '账号设置',
    '请完成安全验证',
    '二维码已失效',
    '二维码已过期',
    '番茄作家助手扫码登录',
  ]);
  const label = (raw: string | null): string | null => {
    const text = raw?.trim().replace(/\s+/g, ' ');
    return text && labels.has(text) && !redactions.includes(text) ? text : null;
  };
  const candidates = [
    ...document.querySelectorAll(
      'a,button,input,select,label,img,canvas,[role="tab"],[role="dialog"],[aria-label]',
    ),
  ].filter(visible);
  const controls = candidates.slice(0, maxElements).map((element) => {
    const attributes: Record<string, string> = {};
    for (const key of ['role', 'type']) {
      const value = element.getAttribute(key);
      if (value && /^[a-z][a-z-]{0,30}$/.test(value)) attributes[key] = value;
    }
    const classes = (element.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(
        (value) =>
          /^(?:slogin-|arco-|ant-|el-|writer-|muye-|byte-|header|nav|menu|tabs?|button|btn|login|account|author|work|book|chapter|short|container|layout|modal|dialog|root|content|form|qrcode)[A-Za-z0-9_:.-]{0,80}$/.test(
            value,
          ) &&
          !/\d{5,}|[a-f\d]{24,}/i.test(value) &&
          !redactions.some((secret) => secret && value.includes(secret)),
      )
      .slice(0, 8);
    if (classes.length) attributes.class = classes.join(' ');
    const id = element.getAttribute('id');
    if (id && /^(?:root|app|login|writer|passport|captcha|qrcode)$/.test(id)) attributes.id = id;
    const aria = label(element.getAttribute('aria-label'));
    if (aria) attributes['aria-label'] = aria;
    const box = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      attributes,
      label:
        /^(?:BUTTON|LABEL)$/.test(element.tagName) || element.getAttribute('role') === 'tab'
          ? label(element.textContent)
          : null,
      width: Math.min(6400, Math.round(box.width)),
      height: Math.min(6400, Math.round(box.height)),
    };
  });
  const routerStructure: Array<{ pathTemplate: string; fields: string[] }> = [];
  let routerTruncated = false;
  const envelopes = new Set([
    'data',
    'loaderData',
    'userInfo',
    'user_info',
    'authorInfo',
    'author_info',
    'accountInfo',
    'account_info',
    'writerInfo',
    'writer_info',
    'userData',
    'user_data',
    'authorData',
    'author_data',
    'ownAccount',
    'own_account',
    'personalInfo',
    'personal_info',
  ]);
  const structural = new Set([
    'data',
    'loaderdata',
    'actiondata',
    'errors',
    'basename',
    'route',
    'routes',
    'status',
    'statuscode',
    'code',
    'message',
    'msg',
    'success',
    'userinfo',
    'authorinfo',
    'accountinfo',
    'writerinfo',
    'userdata',
    'authordata',
    'ownaccount',
    'personalinfo',
  ]);
  const ownFields = new Set([
    'id',
    'uid',
    'userid',
    'accountid',
    'authorid',
    'writerid',
    'nickname',
    'authorname',
    'writername',
    'username',
    'penname',
    'displayname',
    'name',
    'avatar',
    'avatarurl',
    'phone',
    'mobile',
    'email',
    'token',
    'accesstoken',
    'refreshtoken',
    'session',
    'sessionid',
    'islogin',
    'isloggedin',
    'isauthor',
    'role',
    'roles',
    'permissions',
  ]);
  const safeField = (key: string): boolean =>
    /^[A-Za-z_$][A-Za-z_$]{0,63}$/.test(key) &&
    !redactions.includes(key) &&
    (structural.has(key.replace(/_/g, '').toLowerCase()) ||
      ownFields.has(key.replace(/_/g, '').toLowerCase()));
  const walk = (value: unknown, pathTemplate: string, depth: number): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return;
    if (routerStructure.length >= 60) {
      routerTruncated = true;
      return;
    }
    const object = value as Record<string, unknown>;
    const fields = Object.keys(object).filter(safeField);
    if (fields.length > 40) routerTruncated = true;
    routerStructure.push({ pathTemplate, fields: fields.slice(0, 40) });
    for (const key of fields) {
      if (!envelopes.has(key)) continue;
      if (key === 'loaderData') {
        const envelope = object[key];
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) continue;
        const routes = Object.values(envelope);
        if (routes.length > 10) routerTruncated = true;
        // Route keys can be URLs, IDs, titles or account names; never serialize them.
        for (const route of routes.slice(0, 10))
          walk(route, `${pathTemplate}.loaderData.{route}`, depth + 1);
      } else walk(object[key], `${pathTemplate}.${key}`, depth + 1);
    }
  };
  walk((window as unknown as { _ROUTER_DATA?: unknown })._ROUTER_DATA, '_ROUTER_DATA', 0);
  // Inspect fixed tab markers independently of the truncated generic
  // control list. Ancestor prose, IDs, values and unknown classes are never read or returned.
  let chapterTabStructure: ChapterTabStructure | undefined;
  try {
    const classNames = new Set([
      'chapter-manage-tabs',
      'serial-tabs',
      'serial-tabs-text',
      'arco-tabs-size-small',
      'arco-tabs-header-nav',
      'arco-tabs-header-title',
      'arco-tabs-header-title-active',
    ]);
    const classTokens = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/);
    const nodeStructure = (element: Element): ChapterTabStructureNode => {
      const tag = element.tagName.toLowerCase(),
        role = element.getAttribute('role'),
        tokens = classTokens(element),
        classes = tokens.filter(
          (value) =>
            classNames.has(value) && !redactions.some((secret) => secret && value.includes(secret)),
        );
      return {
        tag: ['div', 'span', 'button', 'a', 'section', 'main', 'nav'].includes(tag)
          ? (tag as ChapterTabStructureNode['tag'])
          : 'other',
        role:
          role && ['tab', 'tablist', 'presentation', 'none'].includes(role)
            ? (role as ChapterTabStructureNode['role'])
            : null,
        classes: [...new Set(classes)] as ChapterTabStructureNode['classes'],
        connected: element.isConnected === true,
        visible: visible(element),
        disabled:
          element.getAttribute('disabled') !== null ||
          element.getAttribute('aria-disabled') === 'true',
        active:
          element.getAttribute('aria-selected') === 'true' ||
          tokens.includes('arco-tabs-header-title-active'),
      };
    };
    const roots = [...document.querySelectorAll('.chapter-manage-tabs')].filter((element) =>
      classTokens(element).includes('chapter-manage-tabs'),
    );
    const scopedTabs = [
      ...document.querySelectorAll(
        '.chapter-manage-tabs.serial-tabs.serial-tabs-text.arco-tabs-size-small .arco-tabs-header-nav .arco-tabs-header-title',
      ),
    ].filter((element) => classTokens(element).includes('arco-tabs-header-title'));
    const tabPool = [...document.querySelectorAll('[role="tab"],.arco-tabs-header-title')].filter(
      (element) =>
        element.getAttribute('role') === 'tab' ||
        classTokens(element).includes('arco-tabs-header-title'),
    );
    const fixedTabs = tabPool.slice(0, 100).flatMap((element) => {
      const value = element.textContent?.trim();
      return (value === '草稿箱' || value === '章节管理') && !redactions.includes(value)
        ? [{ element, label: value as '草稿箱' | '章节管理' }]
        : [];
    });
    chapterTabStructure = {
      rootMatches: Math.min(roots.length, 100),
      scopedTabMatches: Math.min(scopedTabs.length, 100),
      draftMatches: fixedTabs.filter((row) => row.label === '草稿箱').length,
      managementMatches: fixedTabs.filter((row) => row.label === '章节管理').length,
      candidates: fixedTabs.slice(0, 8).map(({ element, label }) => {
        const parents: ChapterTabStructureNode[] = [];
        let parent = element.parentElement;
        while (parent && parents.length < 8) {
          parents.push(nodeStructure(parent));
          parent = parent.parentElement;
        }
        return {
          ...nodeStructure(element),
          label,
          matchesScopedSelector: scopedTabs.includes(element),
          parents,
          parentsTruncated: parent !== null,
        };
      }),
      truncated: {
        candidatePool: tabPool.length > 100,
        candidates: fixedTabs.length > 8,
        roots: roots.length > 100,
        scopedTabs: scopedTabs.length > 100,
      },
    };
  } catch {
    /* Unknown DOM structure omits only this metadata; no raw failure or change to the existing diagnostic. */
  }
  return {
    controls,
    routerStructure,
    ...(chapterTabStructure ? { chapterTabStructure } : {}),
    truncated: { controls: candidates.length > maxElements, router: routerTruncated },
  };
};
