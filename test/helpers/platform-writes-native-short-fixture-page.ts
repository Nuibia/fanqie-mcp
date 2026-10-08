import {
  FixturePage,
  workId,
  createdId,
  chapterId,
  FixtureLocator,
  profile,
} from './platform-writes-fixture-page.js';

import {
  nativeContent,
  fixtureTemplateDocument,
  fixtureHTML,
  fixtureDecode,
  nativeUpdateInput,
  nativeOptions,
} from './platform-writes-fixture-template-document.js';

import { runInNewContext } from 'node:vm';

import assert from 'node:assert/strict';

import { updateDraft, type UiWriteProfile } from '../../src/platform/writes.js';

export class NativeShortFixturePage extends FixturePage {
  constructor() {
    super();
    this.records.set(workId, { content: structuredClone(nativeContent), state: 'draft' });
    this.data = structuredClone(this.records.get(workId)!);
  }
  async evaluate(fn?: unknown, arg?: unknown): Promise<any> {
    if (typeof fn !== 'function') return super.evaluate();
    return runInNewContext('(' + fn.toString() + ')(payload)', {
      payload: arg,
      document: fixtureTemplateDocument(),
    });
  }
  serverBody(): string {
    return this.records.get(this.activeId)!.content.body;
  }
  serverTitle(): string {
    return this.records.get(this.activeId)!.content.title;
  }
  suppressDefaultAck = false;
  bodyBinding:
    'valid' | 'wrong-root' | 'missing-set' | 'missing-get' | 'truncate' | 'route-change' = 'valid';
  nativeSetMergeEmpty: boolean | null = null;
  nativeEvents = new Map<string, Set<(value: unknown) => void>>();
  nativeFrame = {};
  nativeResponse:
    'valid' | 'wrong-target' | 'code-failed' | 'http-failed' | 'duplicate-parent' | 'absent' =
    'valid';
  statusOverride: unknown;
  displayStatusOverride: unknown;
  rawResponseTransform?: (raw: unknown) => unknown;
  idDelay = 10;
  noId = false;
  readyDelay = 15;
  readyAt = 0;
  targetBound = false;
  requireBinding = false;
  routeChangedDuringReady = false;
  pendingTimers: ReturnType<typeof setTimeout>[] = [];
  on(name: string, callback: (value: unknown) => void) {
    const entries = this.nativeEvents.get(name) ?? new Set();
    entries.add(callback);
    this.nativeEvents.set(name, entries);
    return this;
  }
  off(name: string, callback: (value: unknown) => void) {
    this.nativeEvents.get(name)?.delete(callback);
    return this;
  }
  mainFrame() {
    return this.nativeFrame;
  }
  emit(name: string, value: unknown) {
    for (const fn of this.nativeEvents.get(name) ?? []) fn(value);
  }
  async goto(url: string) {
    if (url === 'https://fanqienovel.com/main/writer/publish-short/?enter_from=MODIFYDRAFT') {
      this.gotoCalls.push(url);
      this.currentUrl = url;
      if (!this.noId)
        this.pendingTimers.push(
          setTimeout(() => {
            this.activeId = createdId;
            this.records.set(createdId, {
              content: { title: '', body: '', metadata: {} },
              state: 'draft',
            });
            this.data = structuredClone(this.records.get(createdId)!);
            this.currentUrl = `https://fanqienovel.com/main/writer/publish-short/${createdId}?enter_from=MODIFYDRAFT`;
          }, this.idDelay),
        );
      return null;
    }
    await super.goto(url);
    this.readyAt = performance.now() + this.readyDelay;
    if (this.nativeResponse !== 'absent') {
      const id = this.nativeResponse === 'wrong-target' ? chapterId : this.activeId;
      const query =
        this.nativeResponse === 'duplicate-parent'
          ? `item_id=${id}&item_id=${id}`
          : `item_id=${id}`;
      const requestUrl = `https://fanqienovel.com/api/author/short_article/edit/v1/?${query}`;
      const request = {
        method: () => 'GET',
        resourceType: () => 'fetch',
        frame: () => this.nativeFrame,
        url: () => requestUrl,
      };
      this.emit('request', request);
      this.emit('response', {
        request: () => request,
        url: () => requestUrl,
        status: () => (this.nativeResponse === 'http-failed' ? 403 : 200),
        json: async () => {
          const raw = {
            code: this.nativeResponse === 'code-failed' ? 1 : 0,
            data: {
              content: fixtureHTML(this.serverBody()),
              multi_title: [this.serverTitle()],
              item_id: id,
              publish_status:
                this.statusOverride === undefined
                  ? this.data.state === 'draft'
                    ? 0
                    : 1
                  : this.statusOverride,
              ...(this.displayStatusOverride === undefined
                ? {}
                : { display_status: this.displayStatusOverride }),
            },
          };
          return this.rawResponseTransform ? this.rawResponseTransform(raw) : raw;
        },
      });
    }
    return null;
  }
  locator(css: string) {
    return this.nativeLocator(super.locator(css), css);
  }
  getByRole(role: string, options?: { name: string }) {
    return this.nativeLocator(
      super.getByRole(role, options ?? { name: '' }),
      role === 'dialog' ? 'dialog' : `${role}:${options?.name}`,
    );
  }
  getByText(caption: string, options: { exact: boolean }): any {
    assert.equal(caption, '有刚刚更新的草稿，是否继续编辑？');
    assert.equal(options.exact, true);
    return { cacheCaption: true };
  }
  nativeLocator(locator: FixtureLocator, key: string) {
    return new Proxy(locator, {
      get: (object, property) => {
        if (key === 'dialog' && property === 'count') return async () => 0;
        if (key === 'dialog' && property === 'filter')
          return (options: { has: { cacheCaption: boolean } }) => {
            assert.equal(options.has.cacheCaption, true);
            return this.nativeLocator(object, key);
          };
        if (key === '#body' && property === 'evaluate')
          return async (fn: (root: never, args?: unknown) => unknown, args?: unknown) => {
            const root = { isConnected: true, ownerDocument: { defaultView: {} as any } };
            const doc = () => ({
              content: { size: this.data.content.body.length + 2 },
              textBetween: () => this.data.content.body,
            });
            const view = {
              dom: this.bodyBinding === 'wrong-root' ? {} : root,
              state: { doc: doc() },
            };
            root.ownerDocument.defaultView.location = { href: this.url() };
            root.ownerDocument.defaultView.adapter = {
              view,
              getHTML: () => fixtureHTML(this.data.content.body),
              setHTML: (html: string, options: { silent: boolean; mergeEmpty?: boolean }) => {
                assert.equal(options.silent, false);
                this.nativeSetMergeEmpty = options.mergeEmpty ?? true;
                const parsedHTML = this.nativeSetMergeEmpty
                  ? html.replace(/(?:<p><\/p>){2,}/g, '<p></p>')
                  : html;
                this.fills.push('#body');
                this.data.content.body = fixtureDecode(
                  parsedHTML.replace(/<\/p><p>/g, '\n').replace(/^<p>|<\/p>$/g, ''),
                );
                if (this.bodyBinding === 'truncate')
                  this.data.content.body = this.data.content.body.split('\n')[0]!;
                if (this.bodyBinding === 'route-change')
                  root.ownerDocument.defaultView.location.href =
                    'https://fanqienovel.com/main/writer/publish-short/' + chapterId;
                view.state.doc = doc();
              },
            };
            if (this.bodyBinding === 'missing-set')
              delete root.ownerDocument.defaultView.adapter.setHTML;
            if (this.bodyBinding === 'missing-get')
              delete root.ownerDocument.defaultView.adapter.getHTML;
            return fn(root as never, args);
          };
        if (key === 'button:存草稿' && property === 'click')
          return async () => {
            await object.click();
            if (this.suppressDefaultAck) return;
            const wireHTML = fixtureHTML(this.data.content.body),
              requestUrl = 'https://fanqienovel.com/api/author/short_article/cover/v0/';
            const request = {
              method: () => 'POST',
              resourceType: () => 'fetch',
              frame: () => this.nativeFrame,
              url: () => requestUrl,
              postData: () =>
                new URLSearchParams({
                  item_id: this.activeId,
                  content: wireHTML,
                  multi_title: JSON.stringify([this.data.content.title]),
                }).toString(),
            };
            this.emit('request', request);
            this.emit('response', {
              request: () => request,
              url: () => requestUrl,
              status: () => 200,
              json: async () => ({ code: 0 }),
            });
          };
        if (property === 'isEnabled')
          return async () => {
            if (this.routeChangedDuringReady)
              this.currentUrl = `https://fanqienovel.com/main/writer/publish-short/${chapterId}`;
            return performance.now() >= this.readyAt;
          };
        if (property === 'fill')
          return async (value: string) => {
            if (this.requireBinding) assert.equal(this.targetBound, true);
            return object.fill(value);
          };
        const value = Reflect.get(object, property);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  }
  cleanup() {
    for (const timer of this.pendingTimers) clearTimeout(timer);
  }
}

export const nativeUpdate = (page: NativeShortFixturePage) =>
  updateDraft(page.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 35,
  });

export const nativeShortProfile: UiWriteProfile = {
  ...profile,
  kind: 'short',
  state: undefined,
  serverState: 'short_article_edit_v1',
  readiness: 'short_editor_save_enabled',
  newRoute: '/main/writer/publish-short/?enter_from=MODIFYDRAFT',
  fields: {},
};

export const ownApiNativeShortProfile: UiWriteProfile = {
  ...nativeShortProfile,
  kind: 'short',
  serverState: 'short_article_edit_v1',
  identity: { kind: 'own_account_api' },
};

export class NativeDocumentFixturePage extends NativeShortFixturePage {
  documentText: unknown = '';
  documentSize = 2;
  boundRoot = true;
  documentApiPresent = true;
  changeDocumentDuringRead = false;
  serverBody(): string {
    return typeof this.documentText === 'string' ? this.documentText : '';
  }
  domBodyReads = 0;
  textArguments: unknown[] = [];
  locator(css: string) {
    const locator = super.locator(css);
    if (css !== '#body') return locator;
    return new Proxy(locator, {
      get: (object, property) => {
        if (property === 'evaluate')
          return async (fn: (element: never) => unknown) => {
            const root = {
              isConnected: true,
              ownerDocument: { defaultView: { location: { href: this.url() } } as any },
            };
            const doc = {
              content: { size: this.documentSize },
              textBetween: (...args: unknown[]) => {
                this.textArguments = args;
                if (this.changeDocumentDuringRead) view.state.doc = { ...doc };
                return this.documentText;
              },
            };
            const view = { dom: this.boundRoot ? root : {}, state: { doc } };
            if (this.documentApiPresent)
              root.ownerDocument.defaultView.adapter = {
                view,
                getHTML: () =>
                  fixtureHTML(typeof this.documentText === 'string' ? this.documentText : ''),
                setHTML: () => {},
              };
            return fn(root as never);
          };
        if (['locator', 'allTextContents', 'innerText', 'inputValue'].includes(String(property)))
          return (...args: unknown[]) => {
            this.domBodyReads++;
            const method = Reflect.get(object, property);
            return method.apply(object, args);
          };
        const value = Reflect.get(object, property);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  }
}
