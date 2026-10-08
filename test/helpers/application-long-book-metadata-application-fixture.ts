import path from 'node:path';

import { writeFileSync, readdirSync, readFileSync } from 'node:fs';

import { loadConfig } from '../../src/config.js';

import assert from 'node:assert/strict';

import { BrowserSession } from '../../src/platform/browser.js';

import { ownAccountState } from './application-binding-fixture.js';

import { type Page } from 'playwright';

import { createApplication } from '../../src/application.js';

import {
  type Job,
  canonicalJson as recoveryCanonicalJson,
  Store as CreationRecoveryStore,
} from '../../src/runtime/store.js';

import { createHash } from 'node:crypto';

import { DatabaseSync } from 'node:sqlite';

const longBookWrites = await import('../../src/platform/writes.js');

export async function longBookMetadataApplicationFixture(directory: string, enabled: boolean) {
  const workId = '7600000000000000001',
    chapterId = '7800000000000000001',
    profilePath = path.join(directory, 'synthetic-book-metadata-profile.json');
  const profile: import('../../src/platform/writes.js').UiLongBookMetadataProfile = {
    id: 'synthetic-book-metadata',
    evidenceRef: 'fixture://book-metadata-profile',
    verifiedAt: '2026-10-03T00:00:00Z',
    kind: 'long-book',
    metadataRoute: '/main/writer/fixture-book-metadata/{workId}',
    targetPattern: '^/main/writer/fixture-book-metadata/(?<workId>\\d+)$',
    identity: { selector: { css: '#account' } },
    state: { selector: { css: '#state' } },
    states: { draft: 'draft', published: 'published' },
    editableStates: ['draft'],
    title: { css: '#title' },
    save: { css: '#save' },
    fields: { description: { kind: 'text', selector: { css: '#description' } } },
  };
  writeFileSync(profilePath, JSON.stringify({ 'long-book': profile }), { mode: 0o600 });
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-book-metadata-token',
    FANQIE_ACCOUNT_ID: 'book-metadata-fixture',
    FANQIE_WRITE_PROFILE: profilePath,
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    FANQIE_ENABLE_WRITES: enabled ? 'true' : 'false',
  });
  const { Store } = await import('../../src/runtime/store.js');
  const { JobQueue } = await import('../../src/runtime/jobs.js');
  const protectedScopes = [
    'account',
    'editable_snapshot',
    `chapters.${workId}`,
    `chapter_drafts.${workId}`,
    `chapter_body.${workId}.${chapterId}`,
  ];
  const seedStore = new Store({
      databasePath: path.join(config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(config.dataDir, 'evidence'),
      evidenceMode: 'fixture',
    }),
    seedQueue = new JobQueue(seedStore);
  try {
    for (const scope of protectedScopes) {
      const seeded = await seedQueue.enqueueRead({
        accountId: config.accountId,
        operation: 'fixture_sentinel',
        scope,
        datasets: ['fixture_sentinel'],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [ctx.saveEvidence('fixture_sentinel', { complete: true, sentinel: scope })];
        },
      }).completion;
      assert.equal(seeded.status, 'succeeded');
    }
  } finally {
    await seedQueue.drainAndStop();
    seedStore.close();
  }
  let loginCalls = 0,
    pageCalls = 0,
    ownCalls = 0;
  const page = {
    currentUrl: `https://fanqienovel.com/main/writer/fixture-book-metadata/${workId}`,
    account: '1001',
    saved: {
      title: 'Synthetic work title',
      description: 'Original work description',
      state: 'draft',
    },
    data: {
      title: 'Synthetic work title',
      description: 'Original work description',
      state: 'draft',
    },
    failAfterSave: false,
    savePersists: true,
    missing: new Set<string>(),
    fills: [] as string[],
    saves: 0,
    navigations: 0,
    beforeFill: undefined as (() => Promise<void>) | undefined,
    url() {
      return this.currentUrl;
    },
    async goto(url: string) {
      this.navigations++;
      this.currentUrl = url;
      this.data = structuredClone(this.saved);
      return null;
    },
    locator(key: string) {
      if (key === '#body') throw Error('The metadata-only page has no manuscript control');
      const current = this;
      return {
        async count() {
          return current.missing.has(key) ? 0 : 1;
        },
        async isVisible() {
          return true;
        },
        async evaluate<T>(fn: (element: { tagName: string }) => T) {
          return fn({ tagName: 'INPUT' });
        },
        async inputValue() {
          return key === '#title'
            ? current.data.title
            : key === '#description'
              ? current.data.description
              : '';
        },
        async innerText() {
          return key === '#account'
            ? current.account
            : key === '#state'
              ? current.data.state
              : this.inputValue();
        },
        async fill(value: string) {
          await current.beforeFill?.();
          current.fills.push(key);
          if (key === '#title') current.data.title = value;
          else if (key === '#description') current.data.description = value;
          else throw Error('Unknown synthetic metadata field');
        },
        async click() {
          assert.equal(key, '#save');
          current.saves++;
          if (current.savePersists) current.saved = structuredClone(current.data);
          if (current.failAfterSave) throw Error('Synthetic lost metadata save response');
        },
      };
    },
  };
  class BookMetadataBrowser extends BrowserSession {
    override async checkLogin() {
      loginCalls++;
      return ownAccountState('1001');
    }
    override async verifyCurrentAccount() {
      ownCalls++;
      return ownAccountState('1001');
    }
    override async withPage<T>(read: (current: Page) => Promise<T>): Promise<T> {
      pageCalls++;
      return read(page as unknown as Page);
    }
  }
  const application = createApplication(config, {
    browser: new BookMetadataBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const target = { kind: 'long-book' as const, workId };
  const invoke = (name: string, args: unknown) =>
    application.dispatch(
      'POST',
      `/api/v1/tools/fanqie_${name}`,
      new URLSearchParams(),
      args,
    ) as Promise<{
      job: Job;
      data: Record<string, unknown>[];
      evidence: Array<{ dataset: string }>;
    }>;
  const snapshot = (scope: string) =>
    application.dispatch('GET', '/api/v1/snapshot', new URLSearchParams({ scope }), undefined);
  const jobs = () =>
    application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined) as Promise<{
      jobs: Job[];
    }>;
  const expected = () =>
    longBookWrites.hashLongBookMetadata({
      title: page.saved.title,
      metadata: { description: page.saved.description },
    });
  return {
    application,
    config,
    page,
    target,
    invoke,
    snapshot,
    jobs,
    expected,
    protectedScopes,
    counts: () => ({ loginCalls, pageCalls, ownCalls }),
  };
}

export const recoveryAppHash = (value: unknown) =>
  createHash('sha256').update(recoveryCanonicalJson(value)).digest('hex');

const recoveryEscapeHTML = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const recoveryDecodeHTML = (text: string) =>
  text.replace(
    /&(?:amp|lt|gt|quot|apos|#39);/g,
    (token) =>
      ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[
        token
      ]!,
  );

export const recoveryEditorHTML = (body: string) =>
  (body.endsWith('\n') ? body.slice(0, -1) : body)
    .split('\n')
    .map((line) => '<p>' + recoveryEscapeHTML(line) + '</p>')
    .join('');

export const recoveryWireHTML = (body: string) => {
  const html = recoveryEditorHTML(body);
  return html.endsWith('<p></p>') ? html : html + '<p></p>';
};

export function recoveryTemplateDocument() {
  return {
    createElement: (tag: string) => {
      assert.equal(tag, 'template');
      const template = {
        content: { childNodes: [] as unknown[] },
        set innerHTML(html: string) {
          const nodes: unknown[] = [];
          for (const match of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
            const children: unknown[] = [];
            for (const part of match[1]!.split(/(<br\s*\/?>)/g)) {
              if (!part) continue;
              children.push(
                part.startsWith('<br')
                  ? { nodeType: 1, tagName: 'BR', attributes: [], childNodes: [] }
                  : { nodeType: 3, textContent: recoveryDecodeHTML(part), childNodes: [] },
              );
            }
            nodes.push({ nodeType: 1, tagName: 'P', attributes: [], childNodes: children });
          }
          this.content.childNodes = nodes;
        },
      };
      return template;
    },
  };
}

export type A6FamilyPlan = {
  recovery?: 'unknown' | 'write' | 'reconciled';
  repairCount?: number;
  final?: 'unknown' | 'write' | 'reconciled';
  key?: string;
  unrelated?: boolean;
};

const a6BusinessTables = [
  'jobs',
  'manifests',
  'current_manifests',
  'evidence',
  'creation_recoveries',
  'creation_repairs',
  'creation_repair_successors',
  'write_reconciliations',
] as const;

export function a6NativeDb(store: CreationRecoveryStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}

export function a6RawRows(store: CreationRecoveryStore) {
  const db = a6NativeDb(store);
  return a6BusinessTables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

export function a6EvidenceFiles(directory: string) {
  const rows: Array<{ path: string; bytes: string; sha256: string }> = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const bytes = readFileSync(file);
        rows.push({
          path: path.relative(directory, file),
          bytes: bytes.toString('base64'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  };
  walk(directory);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
