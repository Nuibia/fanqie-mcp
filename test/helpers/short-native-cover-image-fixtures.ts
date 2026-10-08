import { createHash, randomUUID } from 'node:crypto';

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { type NativeShortCoverImageReference } from '../../src/platform/short-native-cover-image.js';

import { PNG } from 'pngjs';

import assert from 'node:assert/strict';

import { NativeShortCoverError } from '../../src/platform/short-native-cover.js';

import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';

export const CODE = {
  reference: 'native_short_cover_invalid_reference',
  source: 'native_short_cover_invalid_source',
  hash: 'native_short_cover_source_hash_mismatch',
  image: 'native_short_cover_invalid_image',
  aborted: 'native_short_cover_aborted',
  timeout: 'native_short_cover_timeout',
  prepare: 'native_short_cover_image_prepare_failed',
  cleanup: 'native_short_cover_image_cleanup_failed',
};

export function sha(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function fixture(bytes = stripes(), extension = 'png') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-cover-image-'));
  const name = `${randomUUID()}.${extension}`,
    filename = path.join(directory, name);
  writeFileSync(filename, bytes, { mode: 0o600, flag: 'wx' });
  const reference: NativeShortCoverImageReference = { uploadPath: name, sha256: sha(bytes) };
  return {
    directory,
    filename,
    name,
    bytes,
    reference,
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function stripes() {
  const png = new PNG({ width: 1200, height: 800 });
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const index = (y * png.width + x) * 4,
        channel = Math.floor(x / 400);
      png.data[index] = channel === 0 ? 255 : 0;
      png.data[index + 1] = channel === 1 ? 255 : 0;
      png.data[index + 2] = channel === 2 ? 255 : 0;
      png.data[index + 3] = 255;
    }
  return PNG.sync.write(png);
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngHeaderDimensions(bytes: Buffer, width: number, height: number) {
  const changed = Buffer.from(bytes);
  changed.writeUInt32BE(width, 16);
  changed.writeUInt32BE(height, 20);
  changed.writeUInt32BE(crc32(changed.subarray(12, 29)), 29);
  return changed;
}

export function corruptedDeflate(bytes: Buffer) {
  const changed = Buffer.from(bytes);
  let offset = 8;
  while (offset < changed.length) {
    const length = changed.readUInt32BE(offset),
      end = offset + length + 12;
    if (changed.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      changed[offset + 8] = 0; // Not a valid zlib header; recompute CRC so framing remains valid.
      changed.writeUInt32BE(crc32(changed.subarray(offset + 4, end - 4)), end - 4);
      return changed;
    }
    offset = end;
  }
  throw new Error('Synthetic fixture lacks IDAT');
}

export function expectCode(code: string) {
  return (error: unknown) => {
    assert(error instanceof NativeShortCoverError);
    assert.equal(error.code, code);
    assert(!error.message.includes(os.tmpdir()));
    assert(!error.message.includes('secret-local-path'));
    assert(!error.message.includes('example.invalid'));
    return true;
  };
}

export function forbiddenBrowser() {
  let calls = 0;
  const browser = {
    newContext() {
      calls++;
      throw new Error('secret-local-path');
    },
  } as unknown as Browser;
  return { browser, calls: () => calls };
}

// A framing-only result is sufficient for fake lifecycle tests. Pixel and valid
// encoded-image evidence is deliberately supplied by the real Chromium test below.
export function framedJpeg(width = 600, height = 800) {
  const frame = Buffer.alloc(19);
  frame[0] = 0xff;
  frame[1] = 0xc0;
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame[9] = 3;
  frame.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 10);
  const scan = Buffer.from([0xff, 0xda, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, scan, Buffer.from([0xff, 0xd9])]);
}

export type FakeOptions = {
  newContext?: () => Promise<BrowserContext>;
  newPage?: () => Promise<Page>;
  route?: () => Promise<void>;
  cookies?: () => Promise<unknown[]>;
  setContent?: () => Promise<void>;
  evaluate?: () => Promise<unknown>;
  pageClose?: () => Promise<void>;
  contextClose?: () => Promise<void>;
};

export function fakeBrowser(options: FakeOptions = {}) {
  const events: string[] = [];
  const page = {
    async setContent() {
      events.push('setContent');
      if (options.setContent) await options.setContent();
    },
    async evaluate() {
      events.push('evaluate');
      return options.evaluate ? options.evaluate() : framedJpeg().toString('base64');
    },
    async close() {
      events.push('page-close-start');
      if (options.pageClose) await options.pageClose();
      events.push('page-close-done');
    },
  } as unknown as Page;
  const context = {
    async route(pattern: string) {
      events.push('route');
      assert.equal(pattern, '**/*');
      if (options.route) await options.route();
    },
    async cookies() {
      events.push('cookies');
      return options.cookies ? options.cookies() : [];
    },
    async newPage() {
      events.push('newPage');
      return options.newPage ? options.newPage() : page;
    },
    async close() {
      events.push('context-close-start');
      if (options.contextClose) await options.contextClose();
      events.push('context-close-done');
    },
  } as unknown as BrowserContext;
  const browser = {
    async newContext(input: unknown) {
      events.push('newContext');
      assert.deepEqual(input, {
        offline: true,
        serviceWorkers: 'block',
        acceptDownloads: false,
        storageState: { cookies: [], origins: [] },
      });
      return options.newContext ? options.newContext() : context;
    },
    async close() {
      events.push('browser-close-forbidden');
      throw new Error('Do not close caller Browser');
    },
  } as unknown as Browser;
  return { browser, context, page, events };
}

export function browserExecutable(): string {
  const requested = process.env.FANQIE_COVER_TEST_BROWSER;
  if (requested) {
    assert(existsSync(requested), 'FANQIE_COVER_TEST_BROWSER must name an installed browser');
    return requested;
  }
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(chrome)) return chrome;
  throw new Error(
    'Real Chromium is required: set FANQIE_COVER_TEST_BROWSER or install the configured browser.',
  );
}

async function withOfflinePage<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
  });
  try {
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    assert.deepEqual(await context.cookies(), []);
    const page = await context.newPage();
    return await run(page);
  } finally {
    await context.close();
  }
}

export async function inspectJpeg(
  browser: Browser,
  bytes: Buffer,
  coordinates: Array<[number, number]>,
) {
  return withOfflinePage(browser, (page) =>
    page.evaluate(
      async (input) => {
        const raw = atob(input.base64),
          array = Uint8Array.from(raw, (value) => value.charCodeAt(0));
        const image = await createImageBitmap(new Blob([array], { type: 'image/jpeg' }));
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            pixels: input.coordinates.map(([x, y]) =>
              Array.from(context.getImageData(x, y, 1, 1).data),
            ),
          };
        } finally {
          image.close();
        }
      },
      { base64: bytes.toString('base64'), coordinates },
    ),
  );
}

export async function jpegFixture(browser: Browser, png: Buffer) {
  const encoded = await withOfflinePage(browser, (page) =>
    page.evaluate(async (base64) => {
      const raw = atob(base64),
        array = Uint8Array.from(raw, (value) => value.charCodeAt(0));
      const image = await createImageBitmap(new Blob([array], { type: 'image/png' }));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.98).slice('data:image/jpeg;base64,'.length);
      } finally {
        image.close();
      }
    }, png.toString('base64')),
  );
  return Buffer.from(encoded, 'base64');
}

export function pixel(actual: number[] | undefined, expected: number[]) {
  assert(actual);
  assert.equal(actual.length, 4);
  for (let channel = 0; channel < 4; channel++)
    assert(
      Math.abs(actual[channel]! - expected[channel]!) <= 8,
      `Pixel channel ${channel}: ${actual[channel]} vs ${expected[channel]}`,
    );
}
