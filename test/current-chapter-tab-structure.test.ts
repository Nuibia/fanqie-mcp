import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { type Page } from 'playwright';
import { BrowserSession } from '../src/platform/browser.js';

const ROOT = '.chapter-manage-tabs';
const SCOPED =
  '.chapter-manage-tabs.serial-tabs.serial-tabs-text.arco-tabs-size-small .arco-tabs-header-nav .arco-tabs-header-title';
const POOL = '[role="tab"],.arco-tabs-header-title';
const CONTROLS = 'a,button,input,select,label,img,canvas,[role="tab"],[role="dialog"],[aria-label]';
class DomNode {
  parentElement: DomNode | null = null;
  isConnected = true;
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string>,
    private text: string | null = null,
    readonly hidden = false,
  ) {}
  get textContent(): string | null {
    if (this.text === null) throw Error('Ancestor prose must never be read');
    return this.text;
  }
  getAttribute(key: string): string | null {
    if (
      ![
        'class',
        'role',
        'type',
        'id',
        'aria-label',
        'aria-selected',
        'aria-disabled',
        'disabled',
      ].includes(key)
    )
      throw Error('Unknown private attributes must never be read');
    return this.attrs[key] ?? null;
  }
  getBoundingClientRect() {
    return { width: this.hidden ? 0 : 100, height: 30 };
  }
}
function fixture(input: {
  pool: DomNode[];
  roots: DomNode[];
  scoped: DomNode[];
  controls?: DomNode[];
  external?: boolean;
  beforeDom?: () => Promise<void>;
}) {
  const session = new BrowserSession({ profileDir: '/synthetic-unopened-profile', headless: true });
  const internal = session as unknown as {
    page: Page;
    identityEpoch: number;
    inspectLogin(page: Page, verify: boolean): Promise<unknown>;
  };
  let evaluations = 0,
    inspected = 0;
  const page = {
    url: () =>
      input.external
        ? 'https://external.invalid/main/writer/'
        : 'https://fanqienovel.com/main/writer/chapter-manage/7600000000000000001&PRIVATE_TITLE',
    isClosed: () => false,
    async goto() {
      throw Error('No navigation permitted');
    },
    async click() {
      throw Error('No action permitted');
    },
    async evaluate(callback: unknown, arg: unknown) {
      evaluations++;
      if (input.beforeDom) await input.beforeDom();
      const source = String(callback),
        compiled = import.meta.url.endsWith('.js');
      if (compiled) assert.equal(source.includes('__name'), false);
      const result = runInNewContext(`(${source})(arg)`, {
        arg,
        document: {
          querySelectorAll(selector: string) {
            if (selector === CONTROLS) return input.controls ?? [];
            if (selector === ROOT) return input.roots;
            if (selector === SCOPED) return input.scoped;
            if (selector === POOL) return input.pool;
            throw Error('Unexpected selector; fixture cannot supply fallback evidence');
          },
        },
        window: {},
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        ...(compiled ? {} : { __name: (value: unknown) => value }),
      });
      return JSON.parse(JSON.stringify(result));
    },
  } as unknown as Page;
  internal.page = page;
  internal.inspectLogin = async () => {
    inspected++;
    return {
      status: 'unknown',
      sourceUrl: page.url(),
      checkedAt: '2026-10-03T00:00:00.000Z',
      identity: null,
    };
  };
  Object.assign(session, { withPage: async <T>(run: (current: Page) => Promise<T>) => run(page) });
  return {
    session,
    get evaluations() {
      return evaluations;
    },
    get inspected() {
      return inspected;
    },
    navigation: () => {
      internal.identityEpoch++;
    },
  };
}
function tree(depth = 10) {
  const root = new DomNode('DIV', {
    class:
      'chapter-manage-tabs serial-tabs serial-tabs-text arco-tabs-size-small PRIVATE_ROOT_CLASS',
    id: 'PRIVATE_ID',
    title: 'PRIVATE_TITLE',
  });
  const nav = new DomNode('DIV', {
    role: 'tablist',
    class: 'arco-tabs-header-nav PRIVATE_NAV_CLASS',
  });
  nav.parentElement = root;
  const draft = new DomNode(
    'DIV',
    { role: 'tab', class: 'arco-tabs-header-title PRIVATE_TAB_CLASS', 'aria-disabled': 'true' },
    '草稿箱',
  );
  draft.parentElement = nav;
  const manager = new DomNode(
    'DIV',
    {
      role: 'tab',
      class: 'arco-tabs-header-title arco-tabs-header-title-active',
      'aria-selected': 'true',
    },
    '章节管理',
  );
  manager.parentElement = nav;
  let parent = root;
  for (let index = 2; index < depth; index++) {
    const next = new DomNode('SECTION', { class: 'PRIVATE_PARENT_CLASS', role: 'PRIVATE_ROLE' });
    parent.parentElement = next;
    parent = next;
  }
  return { root, nav, draft, manager };
}

test('current chapter tab structure records bounded current parents independently of generic controls and never serializes private prose or attributes', async () => {
  const nodes = tree(),
    generic = [new DomNode('BUTTON', {}, '知道了'), new DomNode('BUTTON', {}, '查看')];
  const session = fixture({
    pool: [nodes.draft, nodes.manager],
    roots: [nodes.root],
    scoped: [nodes.draft, nodes.manager],
    controls: generic,
  });
  const result = await session.session.diagnoseCurrentLoginPage({ maxElements: 1 }),
    tabs = result.chapterTabStructure!;
  assert.equal(result.controls.length, 1);
  assert.equal(result.truncated.controls, true);
  assert.equal(tabs.rootMatches, 1);
  assert.equal(tabs.scopedTabMatches, 2);
  assert.equal(tabs.draftMatches, 1);
  assert.equal(tabs.managementMatches, 1);
  assert.equal(tabs.candidates.length, 2);
  assert.equal(tabs.candidates[0]!.label, '草稿箱');
  assert.equal(tabs.candidates[0]!.disabled, true);
  assert.equal(tabs.candidates[0]!.active, false);
  assert.equal(tabs.candidates[1]!.active, true);
  assert.equal(tabs.candidates[0]!.connected, true);
  assert.equal(tabs.candidates[0]!.visible, true);
  assert.equal(tabs.candidates[0]!.matchesScopedSelector, true);
  assert.equal(tabs.candidates[0]!.parents.length, 8);
  assert.equal(tabs.candidates[0]!.parentsTruncated, true);
  assert.deepEqual(tabs.candidates[0]!.parents[0]!.classes, ['arco-tabs-header-nav']);
  assert.deepEqual(tabs.candidates[0]!.parents[1]!.classes, [
    'chapter-manage-tabs',
    'serial-tabs',
    'serial-tabs-text',
    'arco-tabs-size-small',
  ]);
  assert.equal(
    JSON.stringify(tabs).includes('PRIVATE_') ||
      JSON.stringify(tabs).includes('7600000000000000001'),
    false,
  );
  assert.equal(session.evaluations, 1);
  assert.equal(session.inspected, 1);
});

test('current chapter tab structure preserves unknown scope and explicit bounds rather than guessing an ancestor selector or claiming completeness', async () => {
  const nodes = tree(2),
    unknown = new DomNode('DIV', { class: 'PRIVATE_CLASS', role: 'PRIVATE_ROLE' }, '草稿箱'),
    hidden = new DomNode(
      'DIV',
      { role: 'tab', class: 'arco-tabs-header-title', disabled: '' },
      '草稿箱',
      true,
    );
  hidden.isConnected = false;
  const f = fixture({ pool: [unknown, hidden, nodes.manager], roots: [unknown], scoped: [] });
  const result = await f.session.diagnoseCurrentLoginPage(),
    structure = result.chapterTabStructure!;
  assert.equal(structure.rootMatches, 0);
  assert.equal(structure.scopedTabMatches, 0);
  assert.equal(structure.candidates.length, 2);
  assert.equal(structure.candidates[0]!.visible, false);
  assert.equal(structure.candidates[0]!.connected, false);
  assert.equal(structure.candidates[0]!.disabled, true);
  assert.equal(
    structure.candidates.every((row) => !row.matchesScopedSelector),
    true,
  );
  const pool = Array.from(
    { length: 101 },
    () => new DomNode('DIV', { role: 'tab', class: 'arco-tabs-header-title' }, '草稿箱'),
  );
  const large = fixture({
    pool,
    roots: Array.from({ length: 101 }, () => new DomNode('DIV', { class: 'chapter-manage-tabs' })),
    scoped: pool,
  });
  const bounded = (await large.session.diagnoseCurrentLoginPage()).chapterTabStructure!;
  assert.equal(bounded.rootMatches, 100);
  assert.equal(bounded.scopedTabMatches, 100);
  assert.equal(bounded.draftMatches, 100);
  assert.equal(bounded.candidates.length, 8);
  assert.deepEqual(bounded.truncated, {
    candidatePool: true,
    candidates: true,
    roots: true,
    scopedTabs: true,
  });
  // Candidate text may change, but a validated fixed label is read only once and cached.
  let reads = 0;
  const changing = new DomNode('DIV', { role: 'tab', class: 'arco-tabs-header-title' }, '草稿箱');
  Object.defineProperty(changing, 'textContent', {
    get() {
      reads++;
      return reads === 1 ? '草稿箱' : 'PRIVATE_CHANGED_LABEL';
    },
  });
  const fixed = fixture({ pool: [changing], roots: [], scoped: [] });
  const cached = (await fixed.session.diagnoseCurrentLoginPage()).chapterTabStructure!;
  assert.equal(reads, 1);
  assert.equal(cached.candidates[0]!.label, '草稿箱');
  assert.equal(JSON.stringify(cached).includes('PRIVATE_CHANGED_LABEL'), false);
});

test('current chapter tab structure is omitted outside the official writer and a changed document still fails the original diagnostic fence', async () => {
  const external = fixture({ pool: [], roots: [], scoped: [], external: true });
  const result = await external.session.diagnoseCurrentLoginPage();
  assert.equal(result.chapterTabStructure, undefined);
  assert.equal(external.evaluations, 0);
  const broken = tree(2);
  Object.defineProperty(broken.draft, 'parentElement', {
    get() {
      throw Error('PRIVATE_STRUCTURAL_FAILURE');
    },
  });
  const unknownStructure = fixture({
    pool: [broken.draft],
    roots: [broken.root],
    scoped: [],
    controls: [new DomNode('BUTTON', {}, '知道了')],
  });
  const retained = await unknownStructure.session.diagnoseCurrentLoginPage();
  assert.equal(retained.status, 'unknown');
  assert.equal(retained.controls[0]!.label, '知道了');
  assert.equal(retained.chapterTabStructure, undefined);
  assert.equal(JSON.stringify(retained).includes('PRIVATE_STRUCTURAL_FAILURE'), false);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    begun = new Promise<void>((resolve) => {
      started = resolve;
    });
  const current = fixture({
    pool: [],
    roots: [],
    scoped: [],
    beforeDom: async () => {
      started();
      await gate;
    },
  });
  const reading = current.session.diagnoseCurrentLoginPage();
  const rejected = assert.rejects(reading, { code: 'login_diagnostic_stale' });
  await begun;
  current.navigation();
  release();
  await rejected;
  assert.equal(current.evaluations, 1);
});
