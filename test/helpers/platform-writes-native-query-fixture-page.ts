import { type UiWriteProfile } from '../../src/platform/writes.js';

import {
  nativeShortProfile,
  NativeShortFixturePage,
} from './platform-writes-native-short-fixture-page.js';

import { chapterId } from './platform-writes-fixture-page.js';

import { fixtureHTML } from './platform-writes-fixture-template-document.js';

import assert from 'node:assert/strict';

export const documentShortProfile: UiWriteProfile = {
  ...nativeShortProfile,
  kind: 'short',
  serverState: 'short_article_edit_v1',
  bodyRead: 'short_editor_document',
};

export class NativeQueryFixturePage extends NativeShortFixturePage {
  querySuffix =
    '&aid=fixture&app_name=fixture&image_fmt_list=fixture&msToken=opaque_fixture&a_bogus=opaque_fixture';
  mappedRequests = new WeakMap<object, { url(): string }>();
  emit(name: string, value: unknown) {
    if (name === 'request') {
      const original = value as { url(): string };
      const mapped = { ...original, url: () => original.url() + this.querySuffix };
      this.mappedRequests.set(original, mapped);
      super.emit(name, mapped);
    } else if (name === 'response') {
      const response = value as { request(): object; url(): string };
      const mapped = this.mappedRequests.get(response.request());
      super.emit(name, {
        ...response,
        request: () => mapped ?? response.request(),
        url: () => response.url() + this.querySuffix,
      });
    } else super.emit(name, value);
  }
}

export class NativeAcknowledgementFixturePage extends NativeShortFixturePage {
  suppressDefaultAck = true;
  acknowledgement:
    | 'valid'
    | 'missing'
    | 'old'
    | 'wrong-target'
    | 'get'
    | 'wrong-title'
    | 'duplicate-param'
    | 'http-failed'
    | 'code-failed'
    | 'json'
    | 'wrong-content' = 'valid';
  acknowledgedAt = 0;
  reopenedAfterSave = false;
  getByRole(role: string, options: { name: string }) {
    const locator = super.getByRole(role, options);
    if (role !== 'button' || options.name !== '存草稿') return locator;
    return new Proxy(locator, {
      get: (object, property) => {
        if (property === 'click')
          return async () => {
            await object.click();
            if (this.acknowledgement === 'missing') return;
            const id = this.acknowledgement === 'wrong-target' ? chapterId : this.activeId;
            const titles = JSON.stringify([
              this.acknowledgement === 'wrong-title'
                ? 'Other fixture title'
                : this.data.content.title,
            ]);
            let post = new URLSearchParams({
              item_id: id,
              content:
                this.acknowledgement === 'wrong-content'
                  ? '<p>Wrong body</p>'
                  : fixtureHTML(this.data.content.body),
              multi_title: titles,
            }).toString();
            if (this.acknowledgement === 'duplicate-param') post += '&item_id=' + id;
            if (this.acknowledgement === 'json')
              post = JSON.stringify({
                item_id: id,
                content: fixtureHTML(this.data.content.body),
                multi_title: titles,
              });
            const url =
              'https://fanqienovel.com/api/author/short_article/cover/v0/?aid=fixture&msToken=opaque_fixture&a_bogus=opaque_fixture';
            const request = {
              url: () => url,
              method: () => (this.acknowledgement === 'get' ? 'GET' : 'POST'),
              resourceType: () => 'fetch',
              frame: () => this.nativeFrame,
              postData: () => post,
            };
            if (this.acknowledgement !== 'old') this.emit('request', request);
            this.pendingTimers.push(
              setTimeout(() => {
                this.emit('response', {
                  request: () => request,
                  url: () => url,
                  status: () => (this.acknowledgement === 'http-failed' ? 403 : 200),
                  json: async () => {
                    this.acknowledgedAt = performance.now();
                    return { code: this.acknowledgement === 'code-failed' ? 1 : 0 };
                  },
                });
              }, 10),
            );
          };
        const value = Reflect.get(object, property);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  }
  async goto(url: string) {
    if (this.clicks.length > 0) {
      assert.equal(this.acknowledgedAt > 0, true, 'reopen must wait for the save response');
      this.reopenedAfterSave = true;
    }
    return super.goto(url);
  }
}

export const acknowledgementShortProfile: UiWriteProfile = {
  ...nativeShortProfile,
  kind: 'short',
  serverState: 'short_article_edit_v1',
  saveAcknowledgement: 'short_article_cover_v0',
};

export class NativeResponseIdFixturePage extends NativeShortFixturePage {
  responseItemId: unknown = '0';
  emit(name: string, value: unknown) {
    if (name !== 'response') return super.emit(name, value);
    const response = value as { json(): Promise<{ code: number; data: Record<string, unknown> }> };
    super.emit(name, {
      ...response,
      json: async () => {
        const raw = await response.json();
        return { ...raw, data: { ...raw.data, item_id: this.responseItemId } };
      },
    });
  }
}

export class AuthoritativeShortFixturePage extends NativeShortFixturePage {
  serverHTMLOverride: unknown = undefined;
  serverTitlesOverride: unknown = undefined;
  cachedBody = '';
  cacheDialog: 'none' | 'exact' | 'other' | 'duplicate' | 'tour-cache' | 'tour-only' = 'none';
  cacheCaptionVisible = true;
  cacheButtonVisible = true;
  captionWrongDialog = false;
  tourClicks = 0;
  discardDetached = false;
  discardClicks = 0;
  disposedHandles = 0;
  desiredRecorded = false;
  async goto(url: string) {
    const result = await super.goto(url);
    if (this.cacheDialog !== 'none' && this.cacheDialog !== 'tour-only')
      this.data.content.body = this.cachedBody;
    return result;
  }
  emit(name: string, value: unknown) {
    if (name !== 'response') return super.emit(name, value);
    const response = value as {
      request(): { method(): string };
      json(): Promise<{ code: number; data?: Record<string, unknown> }>;
    };
    if (response.request().method() !== 'GET') return super.emit(name, value);
    super.emit(name, {
      ...response,
      json: async () => {
        const raw = await response.json();
        return {
          ...raw,
          data: {
            ...raw.data,
            ...(this.serverHTMLOverride === undefined ? {} : { content: this.serverHTMLOverride }),
            ...(this.serverTitlesOverride === undefined
              ? {}
              : { multi_title: this.serverTitlesOverride }),
          },
        };
      },
    });
  }
  getByText(caption: string, options: { exact: boolean }): any {
    assert.equal(caption, '有刚刚更新的草稿，是否继续编辑？');
    assert.equal(options.exact, true);
    return { cacheCaption: true };
  }
  getByRole(role: string, options?: { name?: string; includeHidden?: boolean }): any {
    if (role !== 'dialog') {
      const locator = super.getByRole(role, options as { name: string });
      if (role === 'button' && options?.name === '存草稿' && this.cacheDialog === 'other')
        return new Proxy(locator, {
          get: (object, property) =>
            property === 'isEnabled'
              ? async () => false
              : typeof Reflect.get(object, property) === 'function'
                ? Reflect.get(object, property).bind(object)
                : Reflect.get(object, property),
        });
      return locator;
    }
    const page = this,
      hiddenIncluded = options?.includeHidden === true;
    const caption = {
      childElementCount: 0,
      textContent: '有刚刚更新的草稿，是否继续编辑？',
      closest: () => (page.captionWrongDialog ? {} : dialog),
    };
    const button = {
      isConnected: !this.discardDetached,
      tagName: 'BUTTON',
      textContent: '放弃',
      disabled: false,
      getAttribute: () => null,
      closest: () => dialog,
    };
    const dialog = {
      isConnected: true,
      contains: (node: unknown) => node === button || node === caption,
      querySelectorAll: () => [caption],
      getAttribute: () => 'dialog',
      dispose: async () => {
        page.disposedHandles++;
      },
    };
    const handle = {
      evaluate: async (fn: (node: unknown, original: unknown) => unknown, original: unknown) =>
        fn(button, original),
      click: async () => {
        assert.equal(
          page.desiredRecorded,
          true,
          'local cache discard must follow the durable desired intent',
        );
        page.discardClicks++;
        page.cacheDialog = 'none';
        page.data = structuredClone(page.records.get(page.activeId)!);
      },
      dispose: async () => {
        page.disposedHandles++;
      },
    };
    const dialogLocator = (scoped: boolean): any => ({
      count: async () =>
        page.cacheDialog === 'none'
          ? 0
          : page.cacheDialog === 'tour-only' || page.cacheDialog === 'other'
            ? scoped
              ? 0
              : 1
            : page.cacheDialog === 'duplicate'
              ? 2
              : page.cacheDialog === 'tour-cache'
                ? hiddenIncluded
                  ? scoped
                    ? 1
                    : 2
                  : scoped
                    ? 0
                    : 1
                : 1,
      filter: (filter: { has: { cacheCaption: boolean } }) => {
        assert.equal(filter.has.cacheCaption, true);
        return dialogLocator(true);
      },
      getByText: (text: string, exact: { exact: boolean }) => {
        assert.equal(text, '有刚刚更新的草稿，是否继续编辑？');
        assert.equal(exact.exact, true);
        return {
          count: async () =>
            page.cacheDialog === 'other' || (page.cacheDialog === 'tour-cache' && !hiddenIncluded)
              ? 0
              : 1,
          isVisible: async () => page.cacheCaptionVisible,
        };
      },
      getByRole: (
        kind: string,
        options: { name: string; exact: boolean; includeHidden?: boolean },
      ) => {
        assert.equal(kind, 'button');
        assert.equal(options.name, '放弃');
        assert.equal(options.exact, true);
        assert.equal(options.includeHidden, true);
        return {
          count: async () => 1,
          isVisible: async () => page.cacheButtonVisible,
          isEnabled: async () => true,
          elementHandle: async () => handle,
        };
      },
      elementHandle: async () => dialog,
    });
    return dialogLocator(false);
  }
}
