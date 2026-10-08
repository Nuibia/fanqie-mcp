import {
  type NativeShortCoverFit,
  NativeShortCoverError,
  NATIVE_SHORT_COVER_LIMITS,
  type NativeShortCoverPreparedAsset,
  validateNativeShortCoverAsset,
  nativeShortCoverImagePolicy,
} from './short-native-cover.js';

import { createHash } from 'node:crypto';

import { SAFE_CODES, CODES, fail } from './short-native-cover-image-errors.js';

import path from 'node:path';

import { Ownership } from './short-native-cover-image-lifecycle.js';

import { realpath, lstat, type FileHandle, open } from 'node:fs/promises';

import { constants } from 'node:fs';

import { sourceDimensions, jpegDimensions } from './short-native-cover-image-format.js';

import { type Page, type Browser, type BrowserContext } from 'playwright';

export type NativeShortCoverImageReference = {
  uploadPath: string;
  sha256: string;
  fit?: NativeShortCoverFit;
};

type Options = { signal?: AbortSignal; timeoutMs?: number };

type Source = {
  bytes: Buffer;
  sha256: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
};

const NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg)$/;

const HASH = /^[a-f0-9]{64}$/;

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeFailure(error: unknown): NativeShortCoverError {
  return error instanceof NativeShortCoverError && SAFE_CODES.has(error.code)
    ? new NativeShortCoverError(error.code)
    : new NativeShortCoverError(CODES.prepare);
}

// Snapshot data descriptors synchronously. Accessors are rejected without invoking them;
// no caller-owned reference or options object is consulted after the first await.
function descriptors(
  value: unknown,
  allowed: string[],
  required: string[],
): Record<string, PropertyDescriptor> {
  if (
    typeof value !== 'object' ||
    value === null ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(CODES.reference);
  const own = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(own);
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(own, key))
  )
    fail(CODES.reference);
  for (const key of keys)
    if (!Object.hasOwn(own[key as string]!, 'value') || !own[key as string]!.enumerable)
      fail(CODES.reference);
  return own;
}

function snapshotInputs(
  uploadDir: string,
  reference: NativeShortCoverImageReference,
  options: Options,
) {
  const ref = descriptors(reference, ['uploadPath', 'sha256', 'fit'], ['uploadPath', 'sha256']);
  const opt = descriptors(options, ['signal', 'timeoutMs'], []);
  const name: unknown = ref.uploadPath!.value,
    sha256: unknown = ref.sha256!.value;
  const fit: unknown = ref.fit?.value === undefined ? 'cover' : ref.fit.value;
  const signal: unknown = opt.signal?.value,
    timeoutMs: unknown = opt.timeoutMs?.value === undefined ? 15_000 : opt.timeoutMs.value;
  if (
    typeof uploadDir !== 'string' ||
    !uploadDir ||
    uploadDir.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(uploadDir) ||
    typeof name !== 'string' ||
    !NAME.test(name) ||
    path.basename(name) !== name ||
    typeof sha256 !== 'string' ||
    !HASH.test(sha256) ||
    typeof fit !== 'string' ||
    !['cover', 'contain'].includes(fit) ||
    typeof timeoutMs !== 'number' ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  )
    fail(CODES.reference);
  if (signal) Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(signal);
  return Object.freeze({
    uploadDir,
    uploadPath: name,
    sha256,
    fit: fit as NativeShortCoverFit,
    signal: signal as AbortSignal | undefined,
    timeoutMs,
  });
}

async function readSource(
  owner: Ownership,
  input: ReturnType<typeof snapshotInputs>,
): Promise<Source> {
  try {
    const root = await owner.run(() => realpath(input.uploadDir));
    const rootBefore = await owner.run(() => lstat(root));
    if (!rootBefore.isDirectory()) fail(CODES.source);
    const filename = path.join(root, input.uploadPath);
    if (path.dirname(filename) !== root) fail(CODES.source);
    const fd: FileHandle = await owner.own(
      () => open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
      (handle) => handle.close(),
    );
    const before = await owner.run(() => fd.stat());
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      !Number.isSafeInteger(before.size) ||
      before.size < 1 ||
      before.size > NATIVE_SHORT_COVER_LIMITS.sourceBytes
    )
      fail(CODES.source);
    const [resolvedFile, rootAfter, rootNow, namedFile] = await owner.run(() =>
      Promise.all([realpath(filename), lstat(root), realpath(input.uploadDir), lstat(filename)]),
    );
    if (
      resolvedFile !== filename ||
      rootNow !== root ||
      !rootAfter.isDirectory() ||
      rootBefore.dev !== rootAfter.dev ||
      rootBefore.ino !== rootAfter.ino ||
      !namedFile.isFile() ||
      namedFile.nlink !== 1 ||
      namedFile.dev !== before.dev ||
      namedFile.ino !== before.ino
    )
      fail(CODES.source);
    // One descriptor, one bounded RAM copy. The extra byte detects growth without
    // readFile() allocating an unbounded buffer if the source changes after stat.
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await owner.run(() => fd.read(buffer, offset, buffer.length - offset, offset));
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await owner.run(() => fd.stat());
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.nlink !== 1 ||
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      fail(CODES.source);
    const bytes = buffer.subarray(0, offset),
      sha256 = digest(bytes);
    if (sha256 !== input.sha256) fail(CODES.hash);
    const image = sourceDimensions(bytes, path.extname(input.uploadPath));
    return { bytes, sha256, ...image };
  } catch (error) {
    if (error instanceof NativeShortCoverError && SAFE_CODES.has(error.code)) throw error;
    fail(CODES.source);
  }
}

async function render(
  page: Page,
  source: Source,
  fit: NativeShortCoverFit,
  owner: Ownership,
): Promise<Buffer> {
  await owner.run(() =>
    page.setContent(
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob:; connect-src \'none\';"><title>Offline cover preparation</title>',
    ),
  );
  const result: unknown = await owner.run(() =>
    page.evaluate(
      async (input) => {
        const binary = atob(input.base64),
          data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
        const blob = new Blob([data], { type: input.mimeType });
        const image = await createImageBitmap(blob, { imageOrientation: 'none' });
        try {
          if (image.width !== input.width || image.height !== input.height)
            throw new Error('Invalid decoded dimensions');
          const canvas = document.createElement('canvas');
          canvas.width = 600;
          canvas.height = 800;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw new Error('Canvas unavailable');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 600, 800);
          const scale =
            input.fit === 'cover'
              ? Math.max(600 / image.width, 800 / image.height)
              : Math.min(600 / image.width, 800 / image.height);
          const width = image.width * scale,
            height = image.height * scale;
          ctx.drawImage(image, (600 - width) / 2, (800 - height) / 2, width, height);
          const output = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) => (value ? resolve(value) : reject(new Error('JPEG encoding failed'))),
              'image/jpeg',
              0.9,
            ),
          );
          if (output.type !== 'image/jpeg' || output.size < 1 || output.size > input.maxBytes)
            throw new Error('Invalid encoded image');
          const bytes = new Uint8Array(await output.arrayBuffer());
          let encoded = '';
          for (let start = 0; start < bytes.length; start += 0x8000)
            encoded += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
          return btoa(encoded);
        } finally {
          image.close();
        }
      },
      {
        base64: source.bytes.toString('base64'),
        mimeType: source.mimeType,
        width: source.width,
        height: source.height,
        fit,
        maxBytes: NATIVE_SHORT_COVER_LIMITS.preparedBytes,
      },
    ),
  );
  const maxBase64 = Math.ceil(NATIVE_SHORT_COVER_LIMITS.preparedBytes / 3) * 4;
  if (
    typeof result !== 'string' ||
    !result ||
    result.length > maxBase64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result)
  )
    fail(CODES.image);
  const bytes = Buffer.from(result, 'base64');
  if (bytes.length > NATIVE_SHORT_COVER_LIMITS.preparedBytes || bytes.toString('base64') !== result)
    fail(CODES.image);
  const size = jpegDimensions(bytes);
  if (size.width !== 600 || size.height !== 800) fail(CODES.image);
  return bytes;
}

export async function prepareNativeShortCoverImage(
  browser: Browser,
  uploadDir: string,
  reference: NativeShortCoverImageReference,
  options: Options = {},
): Promise<{ asset: NativeShortCoverPreparedAsset; bytes: Buffer }> {
  let input: ReturnType<typeof snapshotInputs>;
  try {
    input = snapshotInputs(uploadDir, reference, options);
  } catch {
    fail(CODES.reference);
  }
  const owner = new Ownership(input.signal, input.timeoutMs);
  let result: { asset: NativeShortCoverPreparedAsset; bytes: Buffer } | undefined;
  let failure: NativeShortCoverError | undefined;
  try {
    const source = await readSource(owner, input);
    const context: BrowserContext = await owner.own(
      () =>
        browser.newContext({
          offline: true,
          serviceWorkers: 'block',
          acceptDownloads: false,
          storageState: { cookies: [], origins: [] },
        }),
      (value) => value.close(),
    );
    await owner.run(() => context.route('**/*', (route) => route.abort('blockedbyclient')));
    const cookies = await owner.run(() => context.cookies());
    if (cookies.length !== 0) fail(CODES.prepare);
    const page: Page = await owner.own(
      () => context.newPage(),
      (value) => value.close({ runBeforeUnload: false }),
    );
    const bytes = await render(page, source, input.fit, owner);
    owner.check();
    const asset = validateNativeShortCoverAsset({
      sourceSha256: source.sha256,
      sourceSize: source.bytes.length,
      sourceMimeType: source.mimeType,
      sourceWidth: source.width,
      sourceHeight: source.height,
      preparedSha256: digest(bytes),
      preparedSize: bytes.length,
      policy: nativeShortCoverImagePolicy(input.fit),
    });
    result = { asset, bytes };
  } catch (error) {
    failure = safeFailure(error);
  } finally {
    if (await owner.cleanup()) failure = new NativeShortCoverError(CODES.cleanup);
    else if (owner.reason) failure = owner.reason;
  }
  if (failure) throw failure;
  if (!result) fail(CODES.prepare);
  return result;
}
