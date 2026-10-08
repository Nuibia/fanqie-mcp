import test from 'node:test';

import { chromium, type BrowserContext, type Browser } from 'playwright';

import {
  browserExecutable,
  stripes,
  fixture,
  jpegFixture,
  sha,
  inspectJpeg,
  pixel,
  corruptedDeflate,
  expectCode,
  CODE,
} from './helpers/short-native-cover-image-fixtures.js';

import { PNG } from 'pngjs';

import { prepareNativeShortCoverImage } from '../src/platform/short-native-cover-image.js';

import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

// This test cannot silently skip. It performs real raster decoding/encoding and
// also observes every preparation context through the public Browser interface.
test(
  'real offline Chromium prepares PNG/JPEG 600x800 JPEG with centered crop, white contain, zero traffic and cleanup',
  { timeout: 60_000 },
  async (t) => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: browserExecutable(),
      args: ['--disable-background-networking', '--no-first-run', '--disable-sync'],
    });
    const contexts: BrowserContext[] = [],
      requests: string[] = [],
      recordedOptions: unknown[] = [];
    const guarded = new Proxy(browser, {
      get(target, key) {
        if (key === 'newContext')
          return async (options: Parameters<Browser['newContext']>[0]) => {
            recordedOptions.push(structuredClone(options));
            const context = await target.newContext(options);
            contexts.push(context);
            context.on('request', (request) => requests.push(request.url()));
            return context;
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const png = stripes(),
      source = fixture(png),
      transparent = new PNG({ width: 30, height: 80 });
    transparent.data.fill(0);
    try {
      const baselineContexts = browser.contexts().length;
      const jpeg = await jpegFixture(browser, png),
        jpegSource = fixture(jpeg, 'jpg');
      try {
        await t.test('default center cover discards equal left/right portions', async () => {
          const prepared = await prepareNativeShortCoverImage(
            guarded,
            source.directory,
            source.reference,
          );
          assert.equal(prepared.asset.sourceMimeType, 'image/png');
          assert.equal(prepared.asset.sourceWidth, 1200);
          assert.equal(prepared.asset.sourceHeight, 800);
          assert.equal(prepared.asset.sourceSha256, sha(png));
          assert.equal(prepared.asset.sourceSize, png.length);
          assert.equal(prepared.asset.preparedSha256, sha(prepared.bytes));
          assert.equal(prepared.asset.preparedSize, prepared.bytes.length);
          assert(Object.isFrozen(prepared.asset));
          assert(Object.isFrozen(prepared.asset.policy));
          assert.deepEqual(prepared.asset.policy, {
            version: 'center-cover-or-white-contain/v1',
            fit: 'cover',
            width: 600,
            height: 800,
            mimeType: 'image/jpeg',
            quality: 0.9,
          });
          const inspected = await inspectJpeg(browser, prepared.bytes, [
            [20, 400],
            [300, 400],
            [580, 400],
          ]);
          assert.equal(inspected.width, 600);
          assert.equal(inspected.height, 800);
          pixel(inspected.pixels[0], [255, 0, 0, 255]);
          pixel(inspected.pixels[1], [0, 255, 0, 255]);
          pixel(inspected.pixels[2], [0, 0, 255, 255]);
          assert.deepEqual(readFileSync(source.filename), png); // Source receipt remains read-only.
          assert.equal(browser.contexts().length, baselineContexts);
        });
        await t.test('contain keeps all columns and centers white letterbox bands', async () => {
          const prepared = await prepareNativeShortCoverImage(guarded, source.directory, {
            ...source.reference,
            fit: 'contain',
          });
          const inspected = await inspectJpeg(browser, prepared.bytes, [
            [300, 50],
            [300, 750],
            [50, 400],
            [300, 400],
            [550, 400],
          ]);
          assert.equal(prepared.asset.policy.fit, 'contain');
          pixel(inspected.pixels[0], [255, 255, 255, 255]);
          pixel(inspected.pixels[1], [255, 255, 255, 255]);
          pixel(inspected.pixels[2], [255, 0, 0, 255]);
          pixel(inspected.pixels[3], [0, 255, 0, 255]);
          pixel(inspected.pixels[4], [0, 0, 255, 255]);
        });
        await t.test('JPEG source decodes through the same owned offline context', async () => {
          const prepared = await prepareNativeShortCoverImage(
            guarded,
            jpegSource.directory,
            jpegSource.reference,
          );
          assert.equal(prepared.asset.sourceMimeType, 'image/jpeg');
          assert.equal(prepared.asset.sourceWidth, 1200);
          assert.equal(prepared.asset.sourceHeight, 800);
          assert.equal(prepared.asset.sourceSha256, sha(jpeg));
          const inspected = await inspectJpeg(browser, prepared.bytes, [
            [20, 400],
            [300, 400],
            [580, 400],
          ]);
          pixel(inspected.pixels[0], [255, 0, 0, 255]);
          pixel(inspected.pixels[1], [0, 255, 0, 255]);
          pixel(inspected.pixels[2], [0, 0, 255, 255]);
        });
        await t.test('transparent PNG becomes white rather than black', async () => {
          const alpha = fixture(PNG.sync.write(transparent));
          try {
            const prepared = await prepareNativeShortCoverImage(guarded, alpha.directory, {
              ...alpha.reference,
              fit: 'contain',
            });
            const inspected = await inspectJpeg(browser, prepared.bytes, [
              [0, 0],
              [300, 400],
              [599, 799],
            ]);
            for (const value of inspected.pixels) pixel(value, [255, 255, 255, 255]);
          } finally {
            alpha.close();
          }
        });
        await t.test(
          'CRC-correct malformed compressed PNG fails actual decode and closes its context',
          async () => {
            const bad = fixture(corruptedDeflate(png)),
              count = contexts.length;
            try {
              await assert.rejects(
                prepareNativeShortCoverImage(guarded, bad.directory, bad.reference),
                expectCode(CODE.prepare),
              );
              assert.equal(contexts.length, count + 1);
              assert.equal(browser.contexts().length, baselineContexts);
            } finally {
              bad.close();
            }
          },
        );
        assert.equal(contexts.length, 5);
        assert.deepEqual(requests, []);
        for (const context of contexts) assert(!browser.contexts().includes(context));
        for (const options of recordedOptions)
          assert.deepEqual(options, {
            offline: true,
            serviceWorkers: 'block',
            acceptDownloads: false,
            storageState: { cookies: [], origins: [] },
          });
        assert.equal(browser.contexts().length, baselineContexts);
      } finally {
        jpegSource.close();
      }
    } finally {
      source.close();
      await browser.close();
    }
  },
);
