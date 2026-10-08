import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

import { BrowserSession } from '../src/platform/browser.js';

import { ownAccountState } from './helpers/application-binding-fixture.js';

import { createApplication } from '../src/application.js';

import { directoryApplicationFixture } from './helpers/application-directory-application-fixture.js';

import { originalDirectoryToolNames } from './helpers/application-a6-unclosed.js';

for (const kind of ['short', 'long'] as const)
  test(`F03 metrics time context: new ${kind} collection persists strict fields and replays them unchanged`, async () => {
    const { Store } = await import('../src/runtime/store.js');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-f03-current-'));
    const config = loadConfig({
      FANQIE_TOKEN: 'synthetic-f03-current-token',
      FANQIE_ACCOUNT_ID: 'synthetic-f03-current-owner',
      FANQIE_DATA_DIR: path.join(directory, 'data'),
      FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
      FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    });
    const api = (data: unknown) => ({ ok: true, status: 200, json: { code: 0, data } });
    const sources =
      kind === 'short'
        ? [
            'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
            'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
          ]
        : [
            'https://fanqienovel.com/api/author/stats/book_list/v0/?page_index=0',
            'https://fanqienovel.com/api/author/stats/book_common_v1/v0/?book_id=1001',
          ];
    const remaining = [
      { loginRequired: false, text: '截止至2026-10-01 24:00' },
      ...(kind === 'short'
        ? [
            api({ stats_book_list: [{ book_id: '1001', book_name: 'Synthetic' }] }),
            api({ stats_book_list: [] }),
            api({
              show_count: 0,
              read_count: 0,
              click_rate: '0%',
              comment_count: 0,
              digg_count: 0,
              shelf_count: 0,
            }),
          ]
        : [
            api({
              stats_book_list: [
                {
                  book_id: '1001',
                  book_name: 'Synthetic',
                  word_number: 0,
                  creation_status: 0,
                  read_count: '--',
                },
              ],
              total_count: 1,
            }),
            api({
              book_name: 'Synthetic',
              reader_uv_daily: '--',
              pursue_read_rate: '未知',
              update_time: '2026-10-01',
            }),
          ]),
      { loginRequired: false, text: '' },
    ];
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    let url = 'about:blank',
      callbacks = 0,
      loginCalls = 0;
    const emit = (event: string, value: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(value);
    };
    const page = {
      on(event: string, listener: (value: unknown) => void) {
        let group = listeners.get(event);
        if (!group) listeners.set(event, (group = new Set()));
        group.add(listener);
      },
      off(event: string, listener: (value: unknown) => void) {
        listeners.get(event)?.delete(listener);
      },
      mainFrame() {
        return null;
      },
      url() {
        return url;
      },
      isClosed() {
        return false;
      },
      async goto(destination: string) {
        emit('request', {
          method: () => 'GET',
          isNavigationRequest: () => true,
          frame: () => null,
        });
        url = destination;
        emit('framenavigated', null);
        for (const source of sources) {
          const request = {
            method: () => 'GET',
            isNavigationRequest: () => false,
            frame: () => null,
          };
          emit('request', request);
          emit('response', { url: () => source, request: () => request });
        }
      },
      async waitForLoadState() {},
      async waitForResponse() {
        throw Error('Synthetic current response unavailable');
      },
      async evaluate() {
        assert(remaining.length);
        return remaining.shift();
      },
    } as unknown as Page;
    class CurrentBrowser extends BrowserSession {
      override async checkLogin() {
        loginCalls++;
        return ownAccountState('1001');
      }
      override async verifyCurrentAccount() {
        return ownAccountState('1001');
      }
      override async withPage<T>(read: (page: Page) => Promise<T>) {
        callbacks++;
        return read(page);
      }
    }
    const app = createApplication(config, {
      browser: new CurrentBrowser({ profileDir: config.profileDir, headless: true }),
    });
    let detail!: Record<string, any>;
    try {
      detail = (await app.tools
        .find((item) => item.name === 'fanqie_get_metrics')!
        .run({ kind, workId: '1001' })) as Record<string, any>;
      assert.equal(detail.job.status, 'succeeded');
      assert.equal(detail.data[0].statisticsWindow.reason, 'platform_window_unverified');
      assert.equal(
        detail.data[0].statisticsTimezone.reason,
        'platform_statistics_timezone_unverified',
      );
      const saved = (await app.dispatch(
        'GET',
        `/api/v1/jobs/${detail.job.id}`,
        new URLSearchParams(),
        undefined,
      )) as Record<string, any>;
      const snapshot = (await app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: `${kind}_metrics.1001` }),
        undefined,
      )) as Record<string, any>;
      assert.deepEqual(saved.data, detail.data);
      assert.deepEqual(snapshot.data, detail.data);
      assert.equal(callbacks, 1);
      assert.equal(loginCalls, 1);
      assert.equal(remaining.length, 0);
    } finally {
      await app.close();
    }
    const store = new Store({
      databasePath: path.join(config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(config.dataDir, 'evidence'),
    });
    try {
      const ref = store.listEvidence(detail.job.id)[0]!,
        document = store.readEvidence(ref).payload as Record<string, any>;
      assert.deepEqual(document.statisticsWindow, detail.data[0].statisticsWindow);
      assert.deepEqual(document.statisticsTimezone, detail.data[0].statisticsTimezone);
      assert(document.limitations.some((value: string) => value.startsWith('统计窗口未知：')));
      assert.equal(ref.sha256, detail.data[0].evidenceHash);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('F02 directory App: preserves all original 37 tools and registers one strict read-only empty-input tool', async () => {
  const f = directoryApplicationFixture();
  try {
    assert.equal(f.application.tools.length, 40);
    const names = f.application.tools.map((item) => item.name);
    assert.equal(new Set(names).size, 40);
    for (const name of originalDirectoryToolNames)
      assert.equal(names.filter((value) => value === name).length, 1);
    const tool = f.application.tools.find((item) => item.name === 'fanqie_list_short_drafts')!;
    assert(tool);
    assert.equal(tool.readOnly, true);
    assert.equal(tool.schema.safeParse({}).success, true);
    assert.equal(tool.schema.safeParse({ workId: '7900000000000000001' }).success, false);
    assert.equal(f.calls, 0);
  } finally {
    await f.close();
  }
});

test('F02 directory App: rejects raw nonempty and descriptor inputs before Zod or queue with zero reads', async () => {
  const f = directoryApplicationFixture();
  let getterReads = 0;
  const getter = Object.defineProperty({}, 'mode', {
    enumerable: true,
    get() {
      getterReads++;
      return 'fixture';
    },
  });
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const symbol = { [Symbol('private')]: 1 };
  try {
    const tool = f.application.tools.find((item) => item.name === 'fanqie_list_short_drafts')!;
    const inputs: unknown[] = [
      null,
      undefined,
      [],
      1,
      'x',
      true,
      getter,
      hidden,
      symbol,
      Object.create({ mode: 'live' }),
      { workId: '7900000000000000001' },
      { idempotencyKey: 'caller-control' },
      { factory: {} },
      { mode: 'fixture' },
    ];
    for (const input of inputs) {
      await assert.rejects(tool.run(input as Record<string, unknown>), {
        code: 'invalid_input',
        message: 'Short draft directory input must be an empty object.',
      });
      await assert.rejects(
        f.application.dispatch(
          'POST',
          '/api/v1/tools/fanqie_list_short_drafts',
          new URLSearchParams(),
          input,
        ),
        { code: 'invalid_input' },
      );
    }
    assert.equal(getterReads, 0);
    assert.equal(f.calls, 0);
    assert.deepEqual(
      (
        (await f.application.dispatch(
          'GET',
          '/api/v1/jobs',
          new URLSearchParams(),
          undefined,
        )) as any
      ).jobs,
      [],
    );
    await assert.rejects(
      f.application.dispatch('POST', '/api/v1/refresh', new URLSearchParams(), {
        datasets: ['short_drafts'],
      }),
      { code: 'invalid_input' },
    );
  } finally {
    await f.close();
  }
});
