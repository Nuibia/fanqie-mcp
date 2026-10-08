import test from 'node:test';

import { fixture } from './helpers/short-native-body-public-fixture.js';

import { createHttpServer } from '../src/transport/http.js';

import assert from 'node:assert/strict';

import { TOKEN, WORK } from './helpers/short-native-body-public-account.js';

import { noPrivate } from './helpers/short-native-body-public-check-physical.js';

import { request as httpRequest } from 'node:http';

import { rmSync } from 'node:fs';

import { NATIVE_SHORT_BODY_SCOPE } from '../src/platform/short-native-body.js';

test('body public authentication and no-store protect explicit body response', async () => {
  const f = fixture({ writes: false }),
    http = createHttpServer(f.config, f.app);
  try {
    const address = await http.listen();
    assert(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/api/v1/tools/fanqie_get_short_body_snapshot`;
    for (const headers of [
      { 'content-type': 'application/json' },
      { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      {
        authorization: 'Bearer ' + TOKEN,
        origin: 'https://invalid.example',
        'content-type': 'application/json',
      },
    ] as Array<Record<string, string>>) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workId: WORK }),
      });
      assert([401, 403].includes(response.status));
      noPrivate(await response.json());
    }
    let receivedHost: string | undefined;
    const observeHost = (request: import('node:http').IncomingMessage) => {
      receivedHost = request.headers.host;
    };
    http.server.once('request', observeHost);
    const deniedHost = await new Promise<{ status: number | undefined; value: any }>(
      (resolve, reject) => {
        const payload = JSON.stringify({ workId: WORK });
        const request = httpRequest(
          url,
          {
            method: 'POST',
            agent: false,
            setHost: false,
            headers: {
              host: 'invalid.example',
              authorization: 'Bearer ' + TOKEN,
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            response.once('error', reject);
            response.once('end', () => {
              try {
                resolve({
                  status: response.statusCode,
                  value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                });
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        request.setTimeout(2000, () =>
          request.destroy(Error('Synthetic invalid-host request timed out')),
        );
        request.once('error', reject);
        request.end(payload);
      },
    );
    assert.equal(receivedHost, 'invalid.example');
    assert.equal(deniedHost.status, 403);
    assert.equal(deniedHost.value.error.code, 'invalid_host');
    noPrivate(deniedHost.value);
    assert.deepEqual(f.counters, {
      gets: 0,
      posts: 0,
      contexts: 0,
      disposals: 0,
      readCalls: 0,
      forbidden: 0,
      peak: 0,
    });
    assert.equal(f.jobs().length, 0);
    const authorized = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ workId: WORK }),
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get('cache-control'), 'no-store');
    const value = (await authorized.json()) as any;
    assert.equal(value.bodySnapshot.bodyIncluded, true);
    assert.equal(f.counters.posts, 0);
    assert.equal(f.counters.forbidden, 0);
  } finally {
    await http.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('body public directory behavior and body namespace remain independent', async () => {
  const f = fixture();
  try {
    const directory = f.app.tools.find((item) => item.name === 'fanqie_list_short_drafts')!;
    assert.equal(directory.readOnly, true);
    assert.equal(f.app.tools.length, 40);
    for (const [name, input] of [
      ['list_short_drafts', f.request()],
      ['get_short_metadata_snapshot', { workId: WORK, snapshotScope: NATIVE_SHORT_BODY_SCOPE }],
      ['update_work_metadata', f.request()],
      ['get_short_body_snapshot', { workId: WORK, snapshotScope: 'short-native-trial/v1' }],
    ] as const)
      await assert.rejects(f.call(name, input), { code: 'invalid_input' });
    assert.equal(f.jobs().length, 0);
    assert.equal(
      f.counters.contexts + f.counters.readCalls + f.counters.gets + f.counters.posts,
      0,
    );
    const capability = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert(
      capability.reads.some(
        (item: any) => item.dataset === 'short_drafts' && item.bodyIncluded === false,
      ),
    );
  } finally {
    await f.close();
  }
});
