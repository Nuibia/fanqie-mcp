import {
  type WriteTarget,
  type DraftContent,
  type UiWriteProfile,
  type PlatformState,
  hashDraftContent,
  PlatformWriteError,
} from '../../src/platform/writes.js';

import { type Page } from 'playwright';

import { createHash } from 'node:crypto';

import assert from 'node:assert/strict';

export const workId = '7691000000000000001';

export const chapterId = '7691000000000000002';

export const createdId = '7691000000000000003';

export const accountId = '901234567890123456';

export const target: WriteTarget = { kind: 'short', workId };

export const content: DraftContent = {
  title: 'Fixture draft',
  body: 'First paragraph\n\nThird paragraph',
  metadata: {
    description: 'Fixture description',
    aiDeclaration: 'no',
    categories: ['fixture-category'],
    trialRatio: 30,
  },
};

export const profile: Extract<
  UiWriteProfile,
  {
    identity: import('../../src/platform/writes.js').ReadField;
    state: import('../../src/platform/writes.js').ReadField;
  }
> = {
  id: 'fixture-short-v1',
  evidenceRef: 'fixture://platform-writes/short',
  verifiedAt: '2026-10-02T00:00:00Z',
  kind: 'short',
  editorRoute: '/main/writer/publish-short/{workId}',
  newRoute: '/main/writer/new-short',
  targetPattern: '^/main/writer/publish-short/(?<workId>\\d+)$',
  identity: { selector: { css: '#account' } },
  state: { selector: { css: '#state' } },
  states: { 草稿: 'draft', 审核中: 'reviewing', 已发布: 'published' },
  editableStates: ['draft'],
  title: { css: '#title' },
  body: { css: '#body' },
  bodyParagraphSelector: 'p',
  save: { role: 'button', name: '存草稿' },
  fields: {
    description: { kind: 'text', selector: { css: '#description' } },
    aiDeclaration: { kind: 'radio', choices: { yes: { css: '#ai-yes' }, no: { css: '#ai-no' } } },
    categories: {
      kind: 'select',
      selector: { css: '#categories' },
      multiple: true,
      values: { 'fixture-category': 'category-1', 'other-category': 'category-2' },
    },
    trialRatio: { kind: 'select', selector: { css: '#trial' }, values: { 30: '30', 50: '50' } },
  },
  submission: {
    terms: [{ selector: { css: '#terms' } }],
    acceptedStates: ['reviewing', 'published'],
    preparationTtlMs: 60_000,
    steps: [
      {
        button: { role: 'button', name: '下一步' },
        guard: { selector: { css: '#prompt' }, equals: 'Ready to prepare submission' },
      },
      {
        button: { role: 'button', name: '确认提交' },
        guard: { selector: { css: '#prompt' }, equals: 'Submit this exact story' },
        publicationAgreement: { css: '#publication-agreement' },
      },
    ],
  },
};

interface FixtureData {
  content: DraftContent;
  state: PlatformState;
}

export class FixturePage {
  records = new Map<string, FixtureData>([
    [workId, { content: structuredClone(content), state: 'draft' }],
  ]);
  data: FixtureData = structuredClone(this.records.get(workId)!);
  currentUrl = `https://fanqienovel.com/main/writer/publish-short/${workId}`;
  activeId = workId;
  account = accountId;
  terms = 'Fixture publication terms';
  prompt = 'Ready to prepare submission';
  agreement = false;
  missing = new Set<string>();
  duplicate = new Set<string>();
  clicks: string[] = [];
  fills: string[] = [];
  gotoCalls: string[] = [];
  failAfterSave = false;
  failAfterSubmit = false;
  failCreation = false;
  savePersists = true;
  submissionState: PlatformState = 'reviewing';
  onReopen?: () => void;
  url() {
    return this.currentUrl;
  }
  asPage() {
    return this as unknown as Page;
  }
  async goto(url: string) {
    this.gotoCalls.push(url);
    if (url.endsWith('/new-short') || url.endsWith('/fixture-new-chapter')) {
      if (this.failCreation) throw new Error('Navigation response lost');
      this.activeId = createdId;
      this.records.set(createdId, {
        content: { title: '', body: '', metadata: structuredClone(content.metadata) },
        state: 'draft',
      });
      this.currentUrl = url.endsWith('/new-short')
        ? `https://fanqienovel.com/main/writer/publish-short/${createdId}`
        : url.replace('/fixture-new-chapter', `/fixture-chapter/${createdId}`);
    } else {
      this.currentUrl = url;
      this.activeId = new URL(url).pathname.split('/').at(-1)!;
      this.onReopen?.();
    }
    const record = this.records.get(this.activeId);
    if (!record) throw new Error('Target not found');
    this.data = structuredClone(record);
    this.prompt = 'Ready to prepare submission';
    return null;
  }
  locator(css: string) {
    return new FixtureLocator(this, css);
  }
  getByRole(role: string, options: { name: string }) {
    return new FixtureLocator(this, `${role}:${options.name}`);
  }
  getByLabel(label: string) {
    return new FixtureLocator(this, `label:${label}`);
  }
  getByPlaceholder(placeholder: string) {
    return new FixtureLocator(this, `placeholder:${placeholder}`);
  }
  async evaluate() {
    const body = this.data.content.body.replace(/\r\n?/g, '\n');
    return {
      controls: [
        {
          tag: 'input',
          type: 'text',
          label: this.data.content.title,
          selectorHint: 'input#title',
          visible: true,
          editable: false,
        },
        {
          tag: 'div',
          role: 'textbox',
          label: '正文',
          selectorHint: 'div#body',
          visible: true,
          editable: true,
        },
        {
          tag: 'button',
          label: '存草稿',
          selectorHint: 'button.save',
          visible: true,
          editable: false,
        },
        {
          tag: 'input',
          type: 'hidden',
          label: 'session-token-private',
          selectorHint: 'input#session',
          visible: false,
          editable: false,
        },
      ],
      candidates: [
        {
          body,
          selectorHint: 'div#body',
          characterCount: body.length,
          paragraphCount: body.split('\n').length,
          complete: true,
        },
      ],
    };
  }
}

export class FixtureLocator {
  constructor(
    private page: FixturePage,
    private key: string,
  ) {}
  async count() {
    return this.page.missing.has(this.key) ? 0 : this.page.duplicate.has(this.key) ? 2 : 1;
  }
  async isVisible() {
    return true;
  }
  locator(css: string) {
    return new FixtureLocator(this.page, `${this.key} ${css}`);
  }
  async allTextContents() {
    return this.page.data.content.body.replace(/\r\n?/g, '\n').split('\n');
  }
  async innerText() {
    if (this.key === '#account') return this.page.account;
    if (this.key === '#state')
      return {
        draft: '草稿',
        reviewing: '审核中',
        published: '已发布',
        submitted: '已提交',
        rejected: '已拒绝',
      }[this.page.data.state];
    if (this.key === '#terms') return this.page.terms;
    if (this.key === '#prompt') return this.page.prompt;
    if (this.key === '#body') return this.page.data.content.body;
    if (this.key === '#cover-hash') return String(this.page.data.content.metadata?.cover ?? '');
    return this.inputValue();
  }
  async inputValue() {
    if (this.key === '#title') return this.page.data.content.title;
    if (this.key === '#description')
      return String(this.page.data.content.metadata?.description ?? '');
    if (this.key === '#body') return this.page.data.content.body;
    return '';
  }
  async getAttribute() {
    return this.innerText();
  }
  async evaluate<R>(fn: (element: never) => R): Promise<R> {
    const values =
      this.key === '#categories'
        ? this.page.data.content.metadata?.categories?.map((value) =>
            value === 'fixture-category' ? 'category-1' : 'category-2',
          )
        : [String(this.page.data.content.metadata?.trialRatio)];
    return fn({
      tagName: this.key === '#body' ? 'DIV' : 'INPUT',
      selectedOptions: values?.map((value) => ({ value })) ?? [],
    } as never);
  }
  async isChecked() {
    if (this.key === '#ai-yes') return this.page.data.content.metadata?.aiDeclaration === 'yes';
    if (this.key === '#ai-no') return this.page.data.content.metadata?.aiDeclaration === 'no';
    return this.page.agreement;
  }
  async fill(value: string) {
    this.page.fills.push(this.key);
    if (this.key === '#title') this.page.data.content.title = value;
    else if (this.key === '#body') this.page.data.content.body = value;
    else if (this.key === '#description') this.page.data.content.metadata!.description = value;
    else throw new Error('Unknown fixture fill control');
  }
  async check() {
    if (this.key === '#ai-yes') this.page.data.content.metadata!.aiDeclaration = 'yes';
    else if (this.key === '#ai-no') this.page.data.content.metadata!.aiDeclaration = 'no';
    else this.page.agreement = true;
  }
  async setChecked(value: boolean) {
    this.page.agreement = value;
  }
  async selectOption(value: string | string[]) {
    if (this.key === '#categories')
      this.page.data.content.metadata!.categories = (Array.isArray(value) ? value : [value]).map(
        (value) => (value === 'category-1' ? 'fixture-category' : 'other-category'),
      );
    else if (this.key === '#trial') this.page.data.content.metadata!.trialRatio = Number(value);
  }
  async setInputFiles(file: string) {
    const { readFile } = await import('node:fs/promises');
    this.page.data.content.metadata!.cover = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  }
  async click() {
    this.page.clicks.push(this.key);
    if (this.key === 'button:存草稿') {
      if (this.page.savePersists)
        this.page.records.set(this.page.activeId, structuredClone(this.page.data));
      if (this.page.failAfterSave) throw new Error('Lost save response');
    } else if (this.key === 'button:下一步') this.page.prompt = 'Submit this exact story';
    else if (this.key === 'button:确认提交') {
      assert.equal(this.page.agreement, true);
      this.page.data.state = this.page.submissionState;
      this.page.records.set(this.page.activeId, structuredClone(this.page.data));
      if (this.page.failAfterSubmit) throw new Error('Lost submission response');
    } else throw new Error('Unknown fixture button');
  }
}

export const fixedNow = () => new Date('2026-10-02T10:00:00Z');

export const options = {
  profile,
  now: fixedNow,
  beforeSideEffect: async () => {},
  onTargetDiscovered: async () => {},
};

export const updateInput = (changes: Partial<DraftContent> = {}) => ({
  accountId,
  target,
  expectedContentHash: hashDraftContent(content),
  expectedState: 'draft' as const,
  content: { ...content, ...changes },
});

export const rejectsCode = (code: string) => (error: unknown) =>
  error instanceof PlatformWriteError && error.code === code;
