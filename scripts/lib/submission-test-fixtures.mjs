import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export const fixtureNames = Object.freeze({
  bundle: 'short-native-submission-public-sources-20261007.json.gz',
  manifest: 'short-native-submission-public-sources-20261007.manifest.json',
  terms: 'short-native-submission-terms-4c89ddd6.txt',
});
const keys = ['writer', 'main', 'publishShort', 'asyncMain'];
const maxBytes = 2 * 1024 * 1024;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writerHtml = (pins) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><script src="${pins.main.url}"></script></body></html>`;

function fail(code) {
  const error = new Error(`Test fixture preparation failed: ${code}`);
  error.code = code;
  throw error;
}

async function boundedSource(pin, fetchImpl, signal) {
  const response = await fetchImpl(pin.url, { redirect: 'manual', signal });
  if (response.status !== 200 || response.redirected || response.url !== pin.url) {
    await response.body?.cancel();
    fail('source_response');
  }
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    fail('source_size');
  }
  if (!response.body) fail('source_empty');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) fail('source_size');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (sha(bytes) !== pin.sha256) fail('source_hash');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('source_utf8');
  }
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('source_utf8');
  return text;
}

function verifyBundle(bytes, manifest, terms, pins, verifySources) {
  if (manifest.schema !== 'submission-test-public-source-manifest/v1') fail('cache_manifest');
  if (bytes.length !== manifest.compressed.bytes || sha(bytes) !== manifest.compressed.sha256)
    fail('cache_hash');
  const plain = gunzipSync(bytes, { maxOutputLength: 8 * maxBytes });
  if (plain.length !== manifest.decompressedBytes) fail('cache_size');
  const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  if (
    bundle.schema !== 'submission-test-public-source-bytes/v1' ||
    JSON.stringify(Object.keys(bundle.files)) !== JSON.stringify(keys) ||
    bundle.files.writer.text !== writerHtml(pins)
  )
    fail('cache_shape');
  const documents = {};
  for (const key of keys) {
    const file = bundle.files[key];
    const source = manifest.sources[key];
    if (
      typeof file.text !== 'string' ||
      Buffer.byteLength(file.text) > maxBytes ||
      Buffer.byteLength(file.text) !== file.bytes ||
      sha(file.text) !== file.sha256 ||
      source.url !== pins[key].url ||
      source.bytes !== file.bytes ||
      source.sha256 !== file.sha256 ||
      ('sha256' in pins[key] && pins[key].sha256 !== file.sha256)
    )
      fail('cache_source');
    documents[key] = {
      url: pins[key].url,
      body: file.text,
      observedAt: '2026-10-07T04:00:00.000Z',
    };
  }
  const contract = verifySources(documents);
  if (contract.terms.text !== terms) fail('cache_terms');
  return contract;
}

async function cacheState(directory) {
  const states = await Promise.all(
    Object.values(fixtureNames).map(async (name) => {
      try {
        const stat = await lstat(path.join(directory, name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * maxBytes) fail('cache_file');
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    }),
  );
  if (states.some(Boolean) && !states.every(Boolean)) fail('cache_incomplete');
  return states.every(Boolean);
}

export async function prepareSubmissionFixtures({
  directory,
  pins,
  verifySources,
  fetchImpl = fetch,
  timeoutMs = 120000,
}) {
  await mkdir(directory, { recursive: true });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('cache_directory');
  if (await cacheState(directory)) {
    verifyBundle(
      await readFile(path.join(directory, fixtureNames.bundle)),
      JSON.parse(await readFile(path.join(directory, fixtureNames.manifest), 'utf8')),
      await readFile(path.join(directory, fixtureNames.terms), 'utf8'),
      pins,
      verifySources,
    );
    return { status: 'ready', mode: 'verified-cache', sources: 3 };
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), controller.signal]);
  const pending = keys.slice(1).map((key) => boundedSource(pins[key], fetchImpl, signal));
  let downloaded;
  try {
    downloaded = await Promise.all(pending);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled(pending);
    throw error;
  }
  const files = Object.fromEntries(
    [writerHtml(pins), ...downloaded].map((text, index) => [
      keys[index],
      { sha256: sha(text), bytes: Buffer.byteLength(text), text },
    ]),
  );
  const documents = Object.fromEntries(
    keys.map((key) => [
      key,
      { url: pins[key].url, body: files[key].text, observedAt: '2026-10-07T04:00:00.000Z' },
    ]),
  );
  const contract = verifySources(documents);
  const plain = Buffer.from(
    JSON.stringify({ schema: 'submission-test-public-source-bytes/v1', files }),
  );
  const compressed = gzipSync(plain, { level: 9 });
  const manifest = {
    schema: 'submission-test-public-source-manifest/v1',
    usage: 'Local development cache only; do not redistribute upstream JavaScript or terms',
    synthetic: false,
    syntheticTransport: true,
    network: 'none',
    origins: {
      writer: 'original-synthetic-html',
      main: 'upstream',
      publishShort: 'upstream',
      asyncMain: 'upstream',
    },
    compressed: { file: fixtureNames.bundle, bytes: compressed.length, sha256: sha(compressed) },
    decompressedBytes: plain.length,
    sources: Object.fromEntries(
      keys.map((key) => [
        key,
        { url: pins[key].url, sha256: files[key].sha256, bytes: files[key].bytes },
      ]),
    ),
  };
  verifyBundle(compressed, manifest, contract.terms.text, pins, verifySources);
  const staging = path.join(directory, `.prepare-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    await writeFile(path.join(staging, fixtureNames.bundle), compressed, { mode: 0o600 });
    await writeFile(path.join(staging, fixtureNames.terms), contract.terms.text, { mode: 0o600 });
    await writeFile(
      path.join(staging, fixtureNames.manifest),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    signal.throwIfAborted();
    // The manifest is the last published file; an interrupted family is refused on reuse.
    for (const name of [fixtureNames.bundle, fixtureNames.terms, fixtureNames.manifest])
      await rename(path.join(staging, name), path.join(directory, name));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { status: 'ready', mode: 'downloaded-and-verified', sources: 3 };
}
