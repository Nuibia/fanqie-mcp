import test from 'node:test';

import { createServer } from 'node:http';

import {
  ACCOUNT,
  WORK,
  afterEdit,
  edit,
  catalog,
  digest,
  JPEG,
  URI,
  PIC_URL,
  UPLOAD,
} from './helpers/short-native-cover-api-deferred.js';

import assert from 'node:assert/strict';

import { nativeShortMetadataEndpoints } from '../src/platform/short-native-metadata.js';

import { type APIRequestContext, type APIResponse, type APIRequest, request } from 'playwright';

import { nativeShortMetadataFixedReadUrl } from '../src/platform/short-native-metadata-api.js';

import { fixture } from './helpers/short-native-cover-api-fixture.js';

// The wrapper verifies platform literals then forwards only to this loopback
// server. Its response.url override is an encoding oracle, never provenance
// evidence that a live platform accepted the request. Actual API context closes.
test(
  'real Playwright loopback HTTP oracle emits exact multipart JPEG and complete opaque form',
  { timeout: 20_000 },
  async () => {
    let saved = false,
      posts = 0,
      apiDisposes = 0;
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, 'http://127.0.0.1');
        let data: unknown;
        if (req.method === 'GET') {
          if (url.pathname === '/own') data = { id: ACCOUNT };
          else if (url.pathname === '/list')
            data = { total_count: 1, item_list: [{ item_id: WORK }] };
          else if (url.pathname === '/edit') data = saved ? afterEdit() : edit();
          else if (url.pathname === '/catalog') data = catalog();
          else throw Error('Unknown oracle read');
        } else {
          posts++;
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks);
          if (url.pathname === '/upload') {
            const contentType = req.headers['content-type'] ?? '',
              match = /^multipart\/form-data; boundary=(?:"([^"]+)"|([^;\s]+))$/.exec(contentType);
            assert(match);
            const boundary = match[1] ?? match[2]!,
              separator = bytes.indexOf(Buffer.from('\r\n\r\n'));
            assert(separator > 0);
            const head = bytes.subarray(0, separator).toString('utf8');
            assert(head.startsWith(`--${boundary}\r\n`));
            assert.match(head, /Content-Disposition: form-data; name="file"; filename="temp"/i);
            assert.match(head, /Content-Type: image\/jpeg/i);
            const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
            assert(bytes.subarray(-tail.length).equals(tail));
            const image = bytes.subarray(separator + 4, bytes.length - tail.length);
            assert.equal(digest(image), digest(JPEG));
            assert.deepEqual(image, JPEG);
            data = { pic_uri: URI, pic_url: PIC_URL };
          } else {
            assert.equal(url.pathname, '/save');
            assert.equal(
              req.headers['content-type'],
              nativeShortMetadataEndpoints(WORK).contentType,
            );
            const form = new URLSearchParams(bytes.toString('utf8'));
            assert.deepEqual(
              [...form.keys()].sort(),
              [
                'item_id',
                'content',
                'thumb_uri',
                'book_thumb_uri',
                'item_version',
                'multi_title',
                'sign_type',
                'activity_flag',
                'category',
              ].sort(),
            );
            assert.equal(form.get('content'), edit().content);
            assert.equal(form.get('thumb_uri'), edit().thumb_uri);
            assert.equal(form.get('book_thumb_uri'), URI);
            assert.equal(form.get('multi_title'), JSON.stringify(edit().multi_title));
            assert.equal(form.get('item_version'), '-1');
            assert.equal(form.get('category'), 'c1');
            saved = true;
            data = {};
          }
        }
        res.writeHead(200, { 'content-type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ code: 0, ...(url.pathname === '/save' ? {} : { data }) }));
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 1, data: {} }));
        server.emit('oracle-error', error);
      }
    });
    let oracleError: unknown;
    server.on('oracle-error', (error) => {
      oracleError = error;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const local = `http://127.0.0.1:${address.port}`;
    let actual: APIRequestContext | null = null;
    const routes = new Map<string, string>(
      [
        ['own', '/own'],
        ['list', '/list'],
        ['edit', '/edit'],
        ['catalog', '/catalog'],
      ].map(([kind, localPath]) => [
        nativeShortMetadataFixedReadUrl(WORK, kind as 'own' | 'list' | 'edit' | 'catalog'),
        localPath!,
      ]),
    );
    function wrap(response: APIResponse, literal: string): APIResponse {
      return new Proxy(response, {
        get(target, key) {
          if (key === 'url') return () => literal;
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }
    const factory: Pick<APIRequest, 'newContext'> = {
      async newContext(options) {
        actual = await request.newContext(options);
        return {
          async get(literal: string, options: Parameters<APIRequestContext['get']>[1]) {
            assert(routes.has(literal));
            const response = await actual!.get(local + routes.get(literal)!, options);
            return wrap(response, literal);
          },
          async post(literal: string, options: Parameters<APIRequestContext['post']>[1]) {
            assert([UPLOAD, nativeShortMetadataEndpoints(WORK).save].includes(literal));
            const response = await actual!.post(
              local + (literal === UPLOAD ? '/upload' : '/save'),
              options,
            );
            return wrap(response, literal);
          },
          async dispose() {
            await actual!.dispose();
            apiDisposes++;
          },
        } as unknown as APIRequestContext;
      },
    };
    const f = fixture({ factory });
    // Constructor snapshots trusted callbacks; use the fixture's six original receipt callbacks.
    try {
      const result = await f.run.run();
      if (oracleError) throw oracleError;
      assert.equal(result.status, 'success');
      assert.equal(posts, 2);
      assert.equal(apiDisposes, 1);
      assert.equal(result.cleanup.sessionDisposed, true);
      assert.equal(f.callbacks.receipts.length, 6);
      assert.equal(saved, true);
    } finally {
      if (actual && apiDisposes === 0) await (actual as APIRequestContext).dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
