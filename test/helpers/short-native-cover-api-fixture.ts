import {
  type Overrides,
  deferred,
  receiptCallbacks,
  WORK,
  ACCOUNT,
  catalog,
  afterEdit,
  edit,
  UPLOAD,
  JPEG,
  digest,
  asset,
  URI,
  PIC_URL,
  business,
} from './short-native-cover-api-deferred.js';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import { nativeShortMetadataEndpoints } from '../../src/platform/short-native-metadata.js';

import { type APIResponse, type APIRequestContext, type BrowserContext } from 'playwright';

import assert from 'node:assert/strict';

import {
  type NativeShortCoverApiOptions,
  OwnedNativeShortCoverRun,
  type NativeShortCoverApiResult,
} from '../../src/platform/short-native-cover-api.js';

import { NativeShortCoverError } from '../../src/platform/short-native-cover.js';

import { prepareNativeShortCoverImage } from '../../src/platform/short-native-cover-image.js';

export function fixture(overrides: Overrides = {}) {
  const events: string[] = [],
    calls: Array<{ method: string; url: string; options: Record<string, unknown> }> = [];
  const gate = deferred<void>(),
    entered = deferred<void>(),
    controller = new AbortController();
  const callbacks = receiptCallbacks(events, overrides.transform);
  let clientCreates = 0,
    clientDisposes = 0,
    quarantines = 0,
    ownerCallbacks = 0,
    editReads = 0,
    held = false,
    cookieReads = 0;
  let capturedStorage: unknown;
  async function pause(stage: Overrides['hold']) {
    if (overrides.hold === stage && !held) {
      held = true;
      entered.resolve();
      await gate.promise;
    }
  }
  function data(url: string) {
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'own'))
      return { id: overrides.ownerChanged ? '9999' : ACCOUNT };
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
      return { total_count: 1, item_list: [{ item_id: WORK }] };
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) return catalog();
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
      editReads++;
      const value =
        editReads === 3
          ? afterEdit()
          : overrides.drift && editReads === 2
            ? { ...edit(), unknown: { changed: true } }
            : edit();
      return overrides.nonDraftRead === editReads
        ? { ...value, publish_status: 1, display_status: 12 }
        : value;
    }
    throw Error('Unexpected synthetic read');
  }
  function response(url: string, data: unknown, post = false) {
    return {
      url: () => (post && overrides.responseFault === 'url' ? url + '&unexpected=1' : url),
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json;charset=utf-8' }),
      async body() {
        return post && overrides.responseFault === 'utf8'
          ? Buffer.from([0xc3, 0x28])
          : Buffer.from(
              JSON.stringify({
                code: post && overrides.responseFault === 'code' ? '0' : 0,
                ...(post && url === nativeShortMetadataEndpoints(WORK).save ? {} : { data }),
              }),
            );
      },
      async dispose() {
        if (post && overrides.failDispose === 'response') throw Error('secret-response-disposal');
        events.push('response-disposed');
      },
    } as unknown as APIResponse;
  }
  const api = {
    async get(url: string, options: Record<string, unknown>) {
      calls.push({ method: 'GET', url, options });
      return response(url, data(url));
    },
    async post(url: string, options: Record<string, unknown>) {
      calls.push({ method: 'POST', url, options });
      const phase = url === UPLOAD ? 'upload' : 'save';
      events.push(`POST:${phase}`);
      if (phase === 'upload') {
        assert(!Object.hasOwn(options, 'headers'));
        const upload = (
          options.multipart as { file: { name: string; mimeType: string; buffer: Buffer } }
        ).file;
        assert.equal(upload.name, 'temp');
        assert.equal(upload.mimeType, 'image/jpeg');
        assert.deepEqual(upload.buffer, JPEG);
        assert.equal(digest(upload.buffer), asset().preparedSha256);
        await pause('upload');
      } else {
        assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
        assert.equal(
          (options.headers as Record<string, string>)['content-type'],
          nativeShortMetadataEndpoints(WORK).contentType,
        );
      }
      if (overrides.loseAck === phase) throw Error('secret-ACK-loss');
      return response(
        url,
        phase === 'upload'
          ? { pic_uri: overrides.responseFault === 'uri' ? '' : URI, pic_url: PIC_URL }
          : {},
        true,
      );
    },
    async dispose() {
      clientDisposes++;
      events.push('dispose-start');
      await pause('dispose');
      if (overrides.failDispose === 'api') throw Error('secret-api-disposal');
      events.push('dispose-done');
    },
  } as unknown as APIRequestContext;
  const factory = overrides.factory ?? {
    async newContext(options: unknown) {
      clientCreates++;
      capturedStorage = options;
      await pause('creation');
      return api;
    },
  };
  const borrowed = {
    browser: () => ({ synthetic: true }),
    async cookies(origin: string) {
      assert.equal(origin, 'https://fanqienovel.com');
      cookieReads++;
      return [
        {
          name: 'synthetic',
          value: 'synthetic-value',
          domain: '.fanqienovel.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ];
    },
    get request() {
      throw Error('Primary request forbidden');
    },
    async close() {
      throw Error('Borrowed close forbidden');
    },
  } as unknown as BrowserContext;
  const options: NativeShortCoverApiOptions = {
    mode: 'write',
    uploadDir: '/synthetic-controlled-upload-root',
    businessRequest: business(),
    expectedOwner: { kind: 'account', id: ACCOUNT },
    deadline: performance.now() + 10_000,
    signal: controller.signal,
    assertLease: () => overrides.lease?.(),
    assertBorrowedActive() {},
    onBeforePlatformRead() {
      events.push('read-boundary');
    },
    onDurableIntent: callbacks.onDurableIntent,
    onBeforePlatformWrite: callbacks.onBeforePlatformWrite,
    onDurableAcknowledgement: callbacks.onDurableAcknowledgement,
    onVerifiedAccount(id) {
      assert.equal(id, ACCOUNT);
      ownerCallbacks++;
      events.push('owner-callback');
      overrides.onVerified?.();
    },
    onQuarantine() {
      quarantines++;
    },
  };
  const prepared = overrides.prepared ?? { asset: asset(), bytes: Buffer.from(JPEG) };
  const preparer = (async (_browser, _directory, reference, imageOptions) => {
    events.push('image');
    assert.equal(reference.sha256, digest(JPEG));
    assert(imageOptions?.signal);
    await pause('image');
    if (overrides.failDispose === 'image')
      throw new NativeShortCoverError('native_short_cover_image_cleanup_failed');
    return prepared;
  }) as typeof prepareNativeShortCoverImage;
  const run = new OwnedNativeShortCoverRun(borrowed, WORK, options, factory, preparer);
  return {
    run,
    options,
    events,
    calls,
    callbacks,
    controller,
    entered: entered.promise,
    release: () => gate.resolve(),
    get clientCreates() {
      return clientCreates;
    },
    get clientDisposes() {
      return clientDisposes;
    },
    get ownerCallbacks() {
      return ownerCallbacks;
    },
    get quarantines() {
      return quarantines;
    },
    get cookieReads() {
      return cookieReads;
    },
    get capturedStorage() {
      return capturedStorage;
    },
  };
}

export function failed(result: NativeShortCoverApiResult, reason: string) {
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, reason);
  assert.equal(result.proof.ownerCallback, false);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert(!JSON.stringify(result).includes('secret-'));
}
