import { type Page, type BrowserContext } from 'playwright';

import {
  CANONICAL_OWN_USER_URL,
  BrowserSession,
  type ProfileLockRecoveryOptions,
} from '../../src/platform/browser.js';

import { type TestContext } from 'node:test';

import { mkdtemp, realpath, rm, mkdir, symlink, writeFile, readlink } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import assert from 'node:assert/strict';

import { PNG } from 'pngjs';

export type FixtureElement = {
  isConnected: boolean;
  setAttribute(name: string, value: string): void;
  tagName: string;
  textContent: string;
  parentElement?: { children: FixtureElement[] };
  contains(element: unknown): boolean;
  closest(selector: string): FixtureElement | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
  querySelector(selector: string): FixtureElement | null;
  querySelectorAll(selector: string): FixtureElement[];
};

export const ssr = (route: string, page: unknown) =>
  `<html><script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { [route]: page } })};</script></html>`;

export const article = (id: string, title = '写作技巧') => ({
  title,
  link: `/writer/zone/article/${id}`,
  time: '2026-10-01',
  is_video: 0,
});

export function metricsPage(evaluations: unknown[]): {
  page: Page;
  remaining: unknown[];
  emitResponse: (url: string, method?: string) => unknown;
  emitEvent: (event: string, value: unknown) => void;
  setUrl: (url: string) => void;
} {
  const remaining = [...evaluations];
  const bootstraps = Array.isArray(remaining[1]) ? (remaining.splice(1, 1)[0] as string[]) : [];
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const emitEvent = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  let currentUrl = 'https://fanqienovel.com/main/writer/';
  const setUrl = (url: string) => {
    currentUrl = url;
  };
  const emitResponse = (url: string, method = 'GET') => {
    const request = { method: () => method, isNavigationRequest: () => false, frame: () => null };
    const response = { url: () => url, request: () => request };
    emitEvent('request', request);
    emitEvent('response', response);
    return response;
  };
  const page = {
    on(event: string, listener: (value: unknown) => void) {
      let entries = listeners.get(event);
      if (!entries) listeners.set(event, (entries = new Set()));
      entries.add(listener);
    },
    off(event: string, listener: (value: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
    mainFrame() {
      return null;
    },
    url() {
      return currentUrl;
    },
    isClosed() {
      return false;
    },
    async goto(url: string) {
      emitEvent('request', {
        method: () => 'GET',
        isNavigationRequest: () => true,
        frame: () => null,
      });
      setUrl(url);
      emitEvent('framenavigated', null);
      for (const source of bootstraps) emitResponse(source);
    },
    async waitForLoadState() {},
    async waitForResponse() {
      throw new Error('No further fixture response');
    },
    async evaluate() {
      if (!remaining.length) throw new Error('unexpected evaluate');
      return remaining.shift();
    },
  } as unknown as Page;
  return { page, remaining, emitResponse, emitEvent, setUrl };
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export function fakeBrowser() {
  const pages: Array<Page & { closed: boolean; onClose?: () => void; evaluations: unknown[] }> = [];
  const makePage = () => {
    const page = {
      closed: false,
      evaluations: [] as unknown[],
      onClose: undefined as (() => void) | undefined,
      isClosed() {
        return page.closed;
      },
      context() {
        return context;
      },
      on() {},
      off() {},
      mainFrame() {
        return null;
      },
      async close() {
        page.closed = true;
        page.onClose?.();
      },
      url() {
        return 'https://fanqienovel.com/main/writer/short-manage';
      },
      async waitForFunction() {},
      async evaluate(_callback: unknown, arg: unknown) {
        if (arg === CANONICAL_OWN_USER_URL)
          return { status: 200, ok: true, json: { code: 0, data: {} } };
        if (!page.evaluations.length) throw new Error('Unexpected page evaluation');
        return page.evaluations.shift();
      },
    } as unknown as Page & { closed: boolean; onClose?: () => void; evaluations: unknown[] };
    pages.push(page);
    return page;
  };
  const context = {
    async newPage() {
      return makePage();
    },
    async close() {
      for (const page of pages) await page.close();
    },
  } as unknown as BrowserContext;
  const session = new BrowserSession({
    profileDir: '/not-opened-test-profile',
    headless: true,
    operationTimeoutMs: 1_000,
  });
  const internal = session as unknown as {
    context: BrowserContext;
    page: Page;
    identity: unknown;
    ownInfoUrls: WeakMap<Page, Set<string>>;
  };
  internal.context = context;
  internal.page = makePage();
  return { session, pages, internal };
}

export async function singletonFixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'fanqie-singleton-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, 'profile');
  const procRoot = join(root, 'proc');
  await mkdir(profile);
  await mkdir(procRoot);
  const targets = {
    SingletonLock: 'old-container-188',
    SingletonSocket: '/tmp/org.chromium.Chromium.tdR3Vg/SingletonSocket',
    SingletonCookie: '3926741992907541',
  };
  const install = async (
    names: Array<keyof typeof targets> = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'],
  ) => {
    for (const name of names) await symlink(targets[name], join(profile, name));
  };
  const options: ProfileLockRecoveryOptions = {
    procRoot,
    assertProfileRecoveryLease: () => undefined,
  };
  const processEntry = async (pid: string, name: string) => {
    await mkdir(join(procRoot, pid));
    await writeFile(join(procRoot, pid, 'comm'), `${name}\n`);
  };
  const processExecutable = async (
    pid: string,
    ownerExe = process.execPath,
    selfExe = process.execPath,
  ) => {
    await mkdir(join(procRoot, 'self'), { recursive: true });
    await symlink(selfExe, join(procRoot, 'self', 'exe'));
    await symlink(ownerExe, join(procRoot, pid, 'exe'));
  };
  const assertIntact = async (
    names: Array<keyof typeof targets> = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'],
  ) => {
    for (const name of names) assert.equal(await readlink(join(profile, name)), targets[name]);
  };
  return {
    root,
    profile,
    procRoot,
    targets,
    install,
    options,
    processEntry,
    processExecutable,
    assertIntact,
  };
}

// Generated once from the literal text "fanqie-fixture". No login challenge or platform nonce.
export const QR_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAAAklEQVR4AewaftIAAAOqSURBVO3BAY7jRhAEwawG///l8j1gBJhnaqVtZ0T6B9ISg7TIIC0ySIsM0iKDtMggLTJIiwzSIoO0yCAtMkiLDNIig7TIIC0ySIsM0iKDtMggLTJIiwzSIoO0yCAtMkiLDNIiFz8gCb9JW06ScEdb7krCSVtOkvCbtOWdBmmRQVpkkBYZpEUGaZFBWuTiw9ryKUm4oy0nSfg2bfmUJHzKIC0ySIsM0iKDtMggLXLxpZLwhLY8JQknbTlJwitt+ZQkPKEt32aQFhmkRQZpkUFaZJAWudDbtOWVJJy0RX9vkBYZpEUGaZFBWmSQFrnQf5YEfYdBWmSQFhmkRQZpkUFa5OJLteXbtGWDtmw1SIsM0iKDtMggLTJIiwzSIhcfloTfIgknbTlJwittOUnCSVvuSML/0SAtMkiLDNIig7TIIC2S/oH+kyTc1RY9b5AWGaRFBmmRQVpkkBa5+AFJeLe23JWEk7acJOGkLSdJeCUJJ205ScJJW+5KwhPacpKEV9ryToO0yCAtMkiLDNIig7TIxXJJeKUt79SWT0nCXW05ScJvMUiLDNIig7TIIC0ySItc/IC2PCUJT0nCHW05ScJdbbmjLU9pyx1tOUnCtxmkRQZpkUFaZJAWGaRFBmmRiy+VhJO2PKUtJ0k4ScIdbbkrCSdteUoS7mjLbzFIiwzSIoO0yCAtMkiLXPyAJLzSljuS8JQknLTljiR8ShJO2vJKEk7a8oS2fMogLTJIiwzSIoO0yCAtcvED2nJXW75NEk7a8iltebcknLTl2wzSIoO0yCAtMkiLDNIiFz8gCb9JW07a8pQknLRFf2+QFhmkRQZpkUFaZJAWufiwtnxKEp6QhJO23JWEO9pyV1tOkvCEJLzSlncapEUGaZFBWmSQFhmkRQZpkYsvlYQntOXd2nKShFfackcS7kjCK205actJEk6ScNKWTxmkRQZpkUFaZJAWGaRFLvSvJeGkLXcl4QlJOGnLU9pykoRvM0iLDNIig7TIIC0ySItc6G3a8koS7mjLuyXhjrZ8m0FaZJAWGaRFBmmRQVrk4ku15bdIwlPacpKEp7TlpC1PSMIrbXmnQVpkkBYZpEUGaZFBWuTiw5Lw27XlriTc0ZaTJJy05SlJOGnLSVs+ZZAWGaRFBmmRQVpkkBYZpEXSP5CWGKRFBmmRQVpkkBYZpEUGaZFBWmSQFhmkRQZpkUFaZJAWGaRFBmmRQVpkkBYZpEUGaZFBWmSQFhmkRQZpkUFa5B8POgB57CaLAAAAAABJRU5ErkJggg==',
  'base64',
);

export function blankPng(): Buffer {
  const png = new PNG({ width: 180, height: 180 });
  png.data.fill(255);
  return PNG.sync.write(png);
}
