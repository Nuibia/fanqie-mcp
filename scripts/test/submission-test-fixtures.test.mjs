import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fixtureNames, prepareSubmissionFixtures } from '../lib/submission-test-fixtures.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bodies = { main: 'main source', publishShort: 'publish source', asyncMain: 'async source' };
const pins = Object.fromEntries(
  ['writer', 'main', 'publishShort', 'asyncMain'].map((key) => [
    key,
    {
      url: `https://fixtures.invalid/${key}`,
      ...(key === 'writer' ? {} : { sha256: hash(bodies[key]) }),
    },
  ]),
);
const verifySources = (documents) => {
  assert.match(documents.writer.body, /https:\/\/fixtures.invalid\/main/);
  for (const key of Object.keys(bodies)) assert.equal(documents[key].body, bodies[key]);
  return { terms: { text: 'original test terms' } };
};
const response = (key, body = bodies[key], options = {}) => {
  const result = new Response(body, options);
  Object.defineProperty(result, 'url', { value: pins[key].url });
  return result;
};
const fetchImpl = async (url) => response(url.split('/').at(-1));
async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fanqie-fixtures-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, pins, verifySources, fetchImpl };
}

test('downloads fixed sources, validates them and reuses verified cache without network', async (t) => {
  const options = await setup(t);
  assert.equal((await prepareSubmissionFixtures(options)).mode, 'downloaded-and-verified');
  const files = await readdir(options.directory);
  assert.deepEqual(files.sort(), Object.values(fixtureNames).sort());
  const manifest = JSON.parse(await readFile(path.join(options.directory, fixtureNames.manifest)));
  assert.equal(manifest.origins.writer, 'original-synthetic-html');
  assert.equal(manifest.sources.main.sha256, pins.main.sha256);
  assert.equal(
    (
      await prepareSubmissionFixtures({
        ...options,
        fetchImpl: () => assert.fail('offline cache fetched'),
      })
    ).mode,
    'verified-cache',
  );
});

for (const [name, expected, mutate] of [
  ['changed hash', 'source_hash', () => response('main', 'unexpected source')],
  ['redirect', 'source_response', () => response('main', null, { status: 302 })],
  [
    'declared oversize',
    'source_size',
    () => response('main', '', { headers: { 'content-length': '2097153' } }),
  ],
  ['stream oversize', 'source_size', () => response('main', new Uint8Array(2097153))],
  ['empty body', 'source_empty', () => response('main', null)],
]) {
  test(`refuses ${name} without publishing cache`, async (t) => {
    const options = await setup(t);
    await assert.rejects(
      prepareSubmissionFixtures({
        ...options,
        fetchImpl: async (url) => (url === pins.main.url ? mutate() : fetchImpl(url)),
      }),
      { code: expected },
    );
    assert.deepEqual(await readdir(options.directory), []);
  });
}

test('refuses invalid UTF-8 even with matching pinned hash', async (t) => {
  const options = await setup(t);
  const invalid = new Uint8Array([0xff]);
  await assert.rejects(
    prepareSubmissionFixtures({
      ...options,
      pins: { ...pins, main: { ...pins.main, sha256: hash(invalid) } },
      fetchImpl: async (url) =>
        url === pins.main.url ? response('main', invalid) : fetchImpl(url),
    }),
    { code: 'source_utf8' },
  );
  assert.deepEqual(await readdir(options.directory), []);
});

test('production contract verifier must succeed before publishing', async (t) => {
  const options = await setup(t);
  await assert.rejects(
    prepareSubmissionFixtures({
      ...options,
      verifySources: () => {
        throw new Error('contract changed');
      },
    }),
    /contract changed/,
  );
  assert.deepEqual(await readdir(options.directory), []);
});

test('refuses partial cache without fetching or repairing it', async (t) => {
  const options = await setup(t);
  await writeFile(path.join(options.directory, fixtureNames.terms), 'partial');
  await assert.rejects(
    prepareSubmissionFixtures({
      ...options,
      fetchImpl: () => assert.fail('partial cache fetched'),
    }),
    { code: 'cache_incomplete' },
  );
});

test('refuses corrupt complete cache', async (t) => {
  const options = await setup(t);
  await prepareSubmissionFixtures(options);
  await writeFile(path.join(options.directory, fixtureNames.bundle), 'corrupt');
  await assert.rejects(prepareSubmissionFixtures(options), { code: 'cache_hash' });
});

test('refuses symlink cache file and symlink directory', async (t) => {
  const options = await setup(t);
  await writeFile(path.join(options.directory, 'target'), 'private');
  await symlink('target', path.join(options.directory, fixtureNames.terms));
  await assert.rejects(prepareSubmissionFixtures(options), { code: 'cache_file' });
  await symlink(options.directory, path.join(options.directory, 'alias'));
  await assert.rejects(
    prepareSubmissionFixtures({ ...options, directory: path.join(options.directory, 'alias') }),
    { code: 'cache_directory' },
  );
});

test('aborts sibling downloads when one source fails', async (t) => {
  const options = await setup(t);
  let cancelled = 0;
  await assert.rejects(
    prepareSubmissionFixtures({
      ...options,
      fetchImpl: (url, { signal }) =>
        url === pins.main.url
          ? Promise.resolve(response('main', 'changed'))
          : new Promise((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  cancelled++;
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
    }),
    { code: 'source_hash' },
  );
  assert.equal(cancelled, 2);
  assert.deepEqual(await readdir(options.directory), []);
});
