import {
  type A6FamilyPlan,
  recoveryAppHash,
  recoveryEditorHTML,
  recoveryDecodeHTML,
  recoveryWireHTML,
  recoveryTemplateDocument,
} from './application-long-book-metadata-application-fixture.js';

import { Store as CreationRecoveryStore } from '../../src/runtime/store.js';

import { loadConfig } from '../../src/config.js';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { hashDraftContent as recoveryContentHash } from '../../src/platform/writes.js';

import { a6SeedFamily } from './application-a6-seed-family.js';

import assert from 'node:assert/strict';

import { runInNewContext } from 'node:vm';

import { type Page } from 'playwright';

import { BrowserSession, type LoginState } from '../../src/platform/browser.js';

import { createApplication } from '../../src/application.js';

export async function resumeAppFixture(
  body?: string,
  familyPlan?: A6FamilyPlan,
  seedExtra?: (
    store: CreationRecoveryStore,
    config: ReturnType<typeof loadConfig>,
    target: { kind: 'short-story'; id: string },
    input: { clientReference: string; content: { title: string; body: string } },
  ) => void,
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-normal-resume-'));
  const profileFile = path.join(directory, 'profile.json');
  writeFileSync(
    profileFile,
    JSON.stringify({
      short: {
        id: 'native-resume-fixture',
        evidenceRef: 'fixture://native-resume',
        verifiedAt: '2026-10-03T00:00:00Z',
        kind: 'short',
        editorRoute: '/main/writer/publish-short/{workId}',
        newRoute: '/main/writer/publish-short/?enter_from=MODIFYDRAFT',
        targetPattern: '^/main/writer/publish-short/(?<workId>\\d+)$',
        identity: { kind: 'own_account_api' },
        serverState: 'short_article_edit_v1',
        readiness: 'short_editor_save_enabled',
        bodyRead: 'short_editor_document',
        saveAcknowledgement: 'short_article_cover_v0',
        states: {},
        editableStates: ['draft'],
        title: { css: '#title' },
        body: { css: '#body' },
        save: { role: 'button', name: '存草稿' },
      },
    }),
  );
  const config = loadConfig({
    FANQIE_TOKEN: 'resume-private-synthetic-token',
    FANQIE_ACCOUNT_ID: 'resume-app-account',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    FANQIE_ENABLE_WRITES: 'true',
    FANQIE_WRITE_PROFILE: profileFile,
  });
  const input = {
      clientReference: 'resume-app-ref',
      content: {
        title: 'Synthetic recovery title',
        body: body ?? 'Synthetic recovery body\n\nSecond paragraph\n',
      },
    },
    target = { kind: 'short-story' as const, id: '1234567890123456789' };
  const seeder = new CreationRecoveryStore({
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    evidenceMode: 'live',
  });
  const seed = seeder.createJob({
    accountId: config.accountId,
    kind: 'write',
    operation: 'create_draft',
    idempotencyKey: 'synthetic-create-key',
    inputHash: recoveryAppHash(input),
  }).job;
  seeder.startJob(seed.id);
  seeder.markPlatformReadStarted(seed.id);
  const referenceHash = recoveryAppHash({ kind: 'short', clientReference: input.clientReference });
  seeder.addJobMetadata(seed.id, { clientReferenceHash: referenceHash });
  seeder.saveEvidence(seed.id, 'write-intent', {
    phase: 'creation-entry',
    capability: 'create_draft',
    clientReferenceHash: referenceHash,
    requestedContentHash: recoveryContentHash(input.content),
  });
  seeder.markPlatformWriteStarted(seed.id);
  seeder.recordTarget(seed.id, target);
  let original = seeder.failJob(seed.id, {
    code: 'capability_unavailable',
    message: 'Synthetic initial baseline failure',
  });
  const family = familyPlan
    ? a6SeedFamily(seeder, config, original, input, target, familyPlan)
    : null;
  if (family) original = family.originalBefore;
  seedExtra?.(seeder, config, target, input);
  seeder.close();
  const state = {
    title: family ? input.content.title : '',
    body: family ? (family.closed ? input.content.body : 'Synthetic recovery body\n') : '',
    published: false,
    displayStatus: undefined as number | undefined,
    lostAck: false,
    fills: 0,
    saves: 0,
    newEntries: 0,
    gotos: [] as string[],
    checks: 0,
  };
  const frame = {},
    listeners = new Map<string, Set<(value: unknown) => void>>();
  let url = 'https://fanqienovel.com/main/writer/short-manage';
  const emit = (name: string, value: unknown) => {
    for (const fn of listeners.get(name) ?? []) fn(value);
  };
  const locator = (key: string) => ({
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    inputValue: async () => (key === '#title' ? state.title : state.body),
    evaluate: async (fn: (value: never, arg?: unknown) => unknown, arg?: unknown) => {
      if (key !== '#body') return fn({ tagName: 'TEXTAREA' } as never, arg);
      const root = {
        isConnected: true,
        ownerDocument: { defaultView: {} as { adapter?: unknown; location: { href: string } } },
      };
      const doc = {
        content: {
          get size() {
            return state.body.length + 2;
          },
        },
        textBetween: () => state.body,
      };
      root.ownerDocument.defaultView.location = { href: url };
      root.ownerDocument.defaultView.adapter = {
        view: { dom: root, state: { doc } },
        getHTML: () => recoveryEditorHTML(state.body),
        setHTML: (html: string, options: { silent: boolean; mergeEmpty?: boolean }) => {
          assert.equal(options.silent, false);
          state.fills++;
          const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) =>
            recoveryDecodeHTML(m[1]!.replace(/<br\s*\/?\s*>/g, '\n')),
          );
          // The public native adapter merges consecutive empty paragraphs by default.
          state.body = (
            options.mergeEmpty === false
              ? paragraphs
              : paragraphs.filter(
                  (part, index) => part !== '' || index === 0 || paragraphs[index - 1] !== '',
                )
          ).join('\n');
        },
      };
      return fn(root as never, arg);
    },
    fill: async (value: string) => {
      state.fills++;
      if (key === '#title') state.title = value;
      else if (key === '#body') state.body = value;
    },
    click: async () => {
      assert.equal(key, 'save');
      state.saves++;
      if (state.lostAck) throw Error('Synthetic lost acknowledgement after saved fields');
      const requestUrl =
        'https://fanqienovel.com/api/author/short_article/cover/v0/?msToken=synthetic';
      const request = {
        url: () => requestUrl,
        method: () => 'POST',
        resourceType: () => 'fetch',
        frame: () => frame,
        postData: () =>
          new URLSearchParams({
            item_id: target.id,
            multi_title: JSON.stringify([state.title]),
            content: recoveryWireHTML(state.body),
          }).toString(),
      };
      emit('request', request);
      emit('response', {
        request: () => request,
        url: () => requestUrl,
        status: () => 200,
        json: async () => ({ code: 0 }),
      });
    },
  });
  const page = {
    url: () => url,
    mainFrame: () => frame,
    on: (name: string, fn: (value: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
    },
    off: (name: string, fn: (value: unknown) => void) => {
      listeners.get(name)?.delete(fn);
    },
    evaluate: async (fn: unknown, arg: unknown) => {
      assert.equal(typeof fn, 'function');
      return runInNewContext('(' + String(fn) + ')(payload)', {
        payload: arg,
        document: recoveryTemplateDocument(),
      });
    },
    locator,
    getByText: (text: string, options: { exact: boolean }) => {
      assert.equal(text, '有刚刚更新的草稿，是否继续编辑？');
      assert.equal(options.exact, true);
      return { count: async () => 0 };
    },
    getByRole: (role: string, options?: { name?: string; includeHidden?: boolean }) => {
      if (role === 'dialog')
        return { count: async () => 0, filter: (_options: unknown) => ({ count: async () => 0 }) };
      assert.equal(role, 'button');
      assert.equal(options?.name, '存草稿');
      return locator('save');
    },
    goto: async (next: string) => {
      state.gotos.push(next);
      if (next.includes('enter_from')) state.newEntries++;
      assert.equal(
        next,
        'https://fanqienovel.com/main/writer/publish-short/' + target.id,
        'resume may navigate only to the allocated target',
      );
      url = next;
      const requestUrl =
        'https://fanqienovel.com/api/author/short_article/edit/v1/?item_id=' + target.id;
      const request = {
        url: () => requestUrl,
        method: () => 'GET',
        resourceType: () => 'fetch',
        frame: () => frame,
      };
      emit('request', request);
      emit('response', {
        request: () => request,
        url: () => requestUrl,
        status: () => 200,
        json: async () => ({
          code: 0,
          data: {
            item_id: target.id,
            publish_status: state.published ? 1 : 0,
            ...(state.displayStatus === undefined ? {} : { display_status: state.displayStatus }),
            multi_title: [state.title],
            content: state.body === '' ? '' : recoveryWireHTML(state.body),
          },
        }),
      });
      return null;
    },
  } as unknown as Page;
  class ResumeBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      state.checks++;
      return {
        status: 'authenticated',
        identity: {
          accountId: '1001',
          authorId: null,
          displayName: null,
          evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
        },
        sourceUrl: 'https://fanqienovel.com/main/writer/short-manage',
        checkedAt: new Date().toISOString(),
      };
    }
    override async verifyCurrentAccount(current: Page): Promise<LoginState> {
      assert.equal(current, page);
      return this.checkLogin();
    }
    override async withPage<T>(reader: (page: Page) => Promise<T>): Promise<T> {
      return reader(page);
    }
  }
  const application = createApplication(config, {
    browser: new ResumeBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const invoke = (name: string, args: Record<string, unknown>) =>
    application.dispatch('POST', '/api/v1/tools/fanqie_' + name, new URLSearchParams(), args);
  const args = { originalJobId: original.id, idempotencyKey: 'synthetic-resume-key', ...input };
  return {
    config,
    directory,
    state,
    application,
    original,
    input,
    args,
    invoke,
    family,
    async cleanup() {
      await application.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
