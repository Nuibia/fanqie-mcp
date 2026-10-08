import test from 'node:test';

import {
  fixture,
  forbiddenBrowser,
  expectCode,
  CODE,
  stripes,
  pngHeaderDimensions,
  framedJpeg,
  deferred,
  fakeBrowser,
  sha,
} from './helpers/short-native-cover-image-fixtures.js';

import { randomUUID } from 'node:crypto';

import assert from 'node:assert/strict';

import {
  prepareNativeShortCoverImage,
  type NativeShortCoverImageReference,
} from '../src/platform/short-native-cover-image.js';

import { NATIVE_SHORT_COVER_LIMITS } from '../src/platform/short-native-cover.js';

import { symlinkSync, linkSync, rmSync, mkdirSync } from 'node:fs';

import path from 'node:path';

test('reference and options reject paths, extra keys and accessors before files or browser use', async (t) => {
  const f = fixture(),
    forbidden = forbiddenBrowser();
  let accessorCalls = 0;
  const getter = {
    uploadPath: f.name,
    get sha256() {
      accessorCalls++;
      return f.reference.sha256;
    },
  };
  const hostileFit = {
    toString() {
      accessorCalls++;
      return 'cover';
    },
  };
  const invalid: unknown[] = [
    { ...f.reference, uploadPath: `../${f.name}` },
    { ...f.reference, uploadPath: f.filename },
    { ...f.reference, uploadPath: `${randomUUID()}.webp` },
    { ...f.reference, uploadPath: f.name.toUpperCase() },
    { ...f.reference, uploadPath: 'cover.png' },
    { ...f.reference, sha256: 'A'.repeat(64) },
    { ...f.reference, extra: true },
    { ...f.reference, fit: 'stretch' },
    { ...f.reference, fit: null },
    { ...f.reference, fit: hostileFit },
    { ...f.reference, [Symbol('hidden')]: true },
    getter,
    Object.create({ uploadPath: f.name, sha256: f.reference.sha256 }),
  ];
  try {
    for (let index = 0; index < invalid.length; index++)
      await t.test(`invalid descriptor ${index}`, () =>
        assert.rejects(
          prepareNativeShortCoverImage(
            forbidden.browser,
            f.directory,
            invalid[index] as NativeShortCoverImageReference,
          ),
          expectCode(CODE.reference),
        ),
      );
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: null },
      { timeoutMs: 60_001 },
      { timeoutMs: 1.5 },
      { extra: true },
      { signal: {} },
      { signal: Object.create(AbortSignal.prototype) },
      {
        get timeoutMs() {
          accessorCalls++;
          return 100;
        },
      },
    ]) {
      await assert.rejects(
        prepareNativeShortCoverImage(forbidden.browser, f.directory, f.reference, options as never),
        expectCode(CODE.reference),
      );
    }
    assert.equal(accessorCalls, 0);
    assert.equal(forbidden.calls(), 0);
  } finally {
    f.close();
  }
});

test('controlled file checks reject links, missing files, bytes, magic, truncation and pixel budget before browser creation', async (t) => {
  const valid = stripes();
  const invalid = [
    { name: 'truncated PNG', bytes: valid.subarray(0, 32), extension: 'png', code: CODE.image },
    { name: 'missing IEND', bytes: valid.subarray(0, -12), extension: 'png', code: CODE.image },
    {
      name: 'bad CRC',
      bytes: (() => {
        const b = Buffer.from(valid);
        b[29] = b[29]! ^ 1;
        return b;
      })(),
      extension: 'png',
      code: CODE.image,
    },
    { name: 'empty source', bytes: Buffer.alloc(0), extension: 'png', code: CODE.source },
    {
      name: 'oversized source',
      bytes: Buffer.alloc(NATIVE_SHORT_COVER_LIMITS.sourceBytes + 1),
      extension: 'png',
      code: CODE.source,
    },
    { name: 'PNG declared as JPEG', bytes: valid, extension: 'jpg', code: CODE.image },
    {
      name: 'signature-only JPEG',
      bytes: Buffer.from([255, 216, 255, 217]),
      extension: 'jpg',
      code: CODE.image,
    },
    {
      name: 'truncated JPEG segment',
      bytes: Buffer.from([255, 216, 255, 224, 0, 20, 1]),
      extension: 'jpg',
      code: CODE.image,
    },
    {
      name: 'zero dimension',
      bytes: pngHeaderDimensions(valid, 0, 800),
      extension: 'png',
      code: CODE.image,
    },
    {
      name: 'pixel bomb',
      bytes: pngHeaderDimensions(valid, 8192, 8192),
      extension: 'png',
      code: CODE.image,
    },
    {
      name: 'integer dimension overflow',
      bytes: pngHeaderDimensions(valid, 0xffffffff, 0xffffffff),
      extension: 'png',
      code: CODE.image,
    },
    {
      name: 'JPEG pixel bomb',
      bytes: framedJpeg(65535, 65535),
      extension: 'jpg',
      code: CODE.image,
    },
  ];
  for (const value of invalid)
    await t.test(value.name, async () => {
      const f = fixture(value.bytes, value.extension),
        forbidden = forbiddenBrowser();
      try {
        await assert.rejects(
          prepareNativeShortCoverImage(forbidden.browser, f.directory, f.reference),
          expectCode(value.code),
        );
        assert.equal(forbidden.calls(), 0);
      } finally {
        f.close();
      }
    });
  await t.test('hash mismatch', async () => {
    const f = fixture(),
      forbidden = forbiddenBrowser();
    try {
      await assert.rejects(
        prepareNativeShortCoverImage(forbidden.browser, f.directory, {
          ...f.reference,
          sha256: '0'.repeat(64),
        }),
        expectCode(CODE.hash),
      );
      assert.equal(forbidden.calls(), 0);
    } finally {
      f.close();
    }
  });
  for (const kind of ['symlink', 'hardlink', 'directory', 'missing', 'bad root'] as const)
    await t.test(kind, async () => {
      const f = fixture(),
        forbidden = forbiddenBrowser(),
        second = `${randomUUID()}.png`;
      try {
        let name = second,
          root = f.directory;
        if (kind === 'symlink') symlinkSync(f.filename, path.join(f.directory, second));
        if (kind === 'hardlink') linkSync(f.filename, path.join(f.directory, second));
        if (kind === 'directory') {
          name = f.name;
          rmSync(f.filename);
          mkdirSync(f.filename);
        }
        if (kind === 'bad root') root = f.filename;
        await assert.rejects(
          prepareNativeShortCoverImage(forbidden.browser, root, {
            ...f.reference,
            uploadPath: name,
          }),
          expectCode(CODE.source),
        );
        assert.equal(forbidden.calls(), 0);
      } finally {
        f.close();
      }
    });
});

test('caller mutation cannot change the snapshotted source/fit after preparation begins', async () => {
  const f = fixture(),
    entered = deferred<void>(),
    gate = deferred<void>();
  const fake = fakeBrowser({
    newContext: async () => {
      entered.resolve();
      await gate.promise;
      return fake.context;
    },
  });
  const reference = { ...f.reference, fit: 'contain' as const };
  try {
    const preparing = prepareNativeShortCoverImage(fake.browser, f.directory, reference);
    await entered.promise;
    Object.assign(reference, {
      uploadPath: '../secret-local-path',
      sha256: '0'.repeat(64),
      fit: 'cover',
    });
    gate.resolve();
    const result = await preparing;
    assert.equal(result.asset.sourceSha256, sha(f.bytes));
    assert.equal(result.asset.policy.fit, 'contain');
    assert.equal(result.asset.preparedSha256, sha(result.bytes));
    assert(fake.events.includes('page-close-done'));
    assert(fake.events.includes('context-close-done'));
  } finally {
    gate.resolve();
    f.close();
  }
});
