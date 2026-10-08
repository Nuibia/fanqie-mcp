import {
  type Faults,
  deferred,
  PLAIN,
  SET,
  business,
  WORK,
  ACCOUNT,
  catalog,
  edit,
} from './short-native-body-api-edit.js';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import {
  type APIResponse,
  type APIRequestContext,
  type APIRequest,
  type BrowserContext,
} from 'playwright';

import assert from 'node:assert/strict';

import { nativeShortMetadataEndpoints } from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortBodyApiOptions,
  createOwnedNativeShortBodyFixtureRun,
  prepareNativeShortBodyProductionStart,
} from '../../src/platform/short-native-body-api.js';

import { Store } from '../../src/runtime/store.js';

import { DatabaseSync } from 'node:sqlite';

export function fixture(faults: Faults = {}) {
  const controller = new AbortController(),
    gate = deferred(),
    entered = deferred();
  const calls: Array<{ method: 'GET' | 'POST'; url: string; options: Record<string, unknown> }> =
      [],
    stages: string[] = [];
  let creates = 0,
    disposes = 0,
    quarantines = 0,
    callbacks = 0,
    editReads = 0,
    held = false,
    capturedStorage: unknown;
  const source = faults.source ?? PLAIN,
    desired = faults.desired ?? SET,
    request = faults.request ?? business(source);
  async function pause(kind: Faults['hold']) {
    if (faults.hold === kind && !held) {
      held = true;
      entered.resolve();
      await gate.promise;
    }
  }
  function data(url: string): unknown {
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'own'))
      return { id: faults.owner ?? ACCOUNT };
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
      return faults.duplicate
        ? { total_count: 2, item_list: [{ item_id: WORK }, { item_id: WORK }] }
        : { total_count: faults.total ?? 1, item_list: [{ item_id: WORK }] };
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog'))
      return faults.drift === 'catalog' && editReads === 2
        ? { ...catalog(), unknown_catalog: { keep: false } }
        : catalog();
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
      editReads++;
      if (editReads === 3) {
        if (faults.afterFail) throw Error('private-after');
        return {
          ...edit(source),
          content: faults.afterContent ?? desired,
          latest_version: 8,
          modify_time: '1789450001',
        };
      }
      if (editReads === 2) {
        const e = edit(source);
        if (faults.drift === 'unknown') return { ...e, unknown: { keep: ['changed'] } };
        if (faults.drift === 'cover') return { ...e, thumb_uri: 'changed' };
        if (faults.drift === 'revision') return { ...e, latest_version: 8 };
        if (faults.drift === 'title') return { ...e, multi_title: ['changed'] };
      }
      return edit(source);
    }
    throw Error('Unexpected fixture endpoint');
  }
  function response(url: string, read: unknown, post = false): APIResponse {
    return {
      url: () => (post && faults.response === 'url' ? url + '?foreign=1' : url),
      status: () => (post && faults.response === 'status' ? 302 : 200),
      headers: () => ({
        'content-type':
          post && faults.response === 'mime' ? 'text/html' : 'application/json; charset=utf-8',
      }),
      async body() {
        if (post && faults.response === 'utf8') return Buffer.from([0xc3, 0x28]);
        if (post && faults.response === 'json') return Buffer.from('{');
        if (post && faults.response === 'bytes') return Buffer.alloc(3 * 1024 * 1024 + 1, 0x20);
        let payload: unknown = faults.ackData;
        if (post && faults.response === 'depth') {
          payload = null;
          for (let i = 0; i < 66; i++) payload = { next: payload };
        }
        if (post && faults.response === 'nodes') payload = Array(100_001).fill(null);
        return Buffer.from(
          JSON.stringify({
            code: post && faults.response === 'code' ? '0' : 0,
            ...(post ? (payload === undefined ? {} : { data: payload }) : { data: read }),
            ...(post ? (faults.ack ?? {}) : {}),
          }),
        );
      },
      async dispose() {
        if (post && faults.dispose === 'response') throw Error('private-response-disposal');
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
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      assert.equal(
        (options.headers as Record<string, string>)['content-type'],
        'application/x-www-form-urlencoded;charset=UTF-8',
      );
      assert.equal(typeof options.data, 'string');
      const form = new URLSearchParams(options.data as string);
      assert.deepEqual(Object.fromEntries(form), {
        item_id: WORK,
        content: desired,
        thumb_uri: 'fixture/head&+%',
        book_thumb_uri: 'fixture/cover',
        item_version: '-1',
        multi_title: '["Synthetic title","","Synthetic tail"]',
        sign_type: '1',
        activity_flag: '0',
        category: 'c1',
      });
      assert.equal(form.has('use_ai'), false);
      assert.equal(form.has('description'), false);
      await pause('post');
      if (faults.lostAck) throw Error('private-ACK-loss');
      return response(url, null, true);
    },
    async dispose() {
      disposes++;
      await pause('dispose');
      if (faults.dispose === 'api') throw Error('private-api-disposal');
    },
  } as unknown as APIRequestContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext(options) {
      creates++;
      capturedStorage = options;
      await pause('creation');
      return api;
    },
  };
  const borrowed = {
    async cookies(origin: string) {
      assert.equal(origin, 'https://fanqienovel.com');
      await pause('cookies');
      return [
        {
          name: 'fixture',
          value: 'synthetic',
          domain: '.fanqienovel.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
        {
          name: 'foreign',
          value: 'synthetic',
          domain: 'example.invalid',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ];
    },
    get request() {
      throw Error('Borrowed request forbidden');
    },
    async newPage() {
      throw Error('Page forbidden');
    },
    async close() {
      throw Error('Borrowed close forbidden');
    },
  } as unknown as BrowserContext;
  const options: NativeShortBodyApiOptions = {
    accountId: 'owner',
    expectedOwner: { kind: 'account', id: ACCOUNT },
    businessRequest: request,
    deadline: performance.now() + (faults.deadlineMs ?? 5000),
    signal: controller.signal,
    assertLease: () => faults.lease?.(),
    assertBorrowedActive() {},
    onBeforePlatformRead() {},
    onVerifiedAccount(id) {
      assert.equal(id, ACCOUNT);
      callbacks++;
    },
    onQuarantine() {
      quarantines++;
    },
    onStage(stage) {
      stages.push(stage.kind);
      return faults.onStage?.(stage);
    },
  };
  const run = createOwnedNativeShortBodyFixtureRun(borrowed, WORK, options, factory);
  return {
    run,
    borrowed,
    factory,
    options,
    calls,
    stages,
    controller,
    entered: entered.promise,
    release: () => gate.resolve(),
    get creates() {
      return creates;
    },
    get disposes() {
      return disposes;
    },
    get quarantines() {
      return quarantines;
    },
    get callbacks() {
      return callbacks;
    },
    get capturedStorage() {
      return capturedStorage;
    },
  };
}

export function deniedProduction(input: unknown) {
  const decision = prepareNativeShortBodyProductionStart(input);
  assert.ok(!decision.allowed);
  return decision.result;
}

export function postCount(f: ReturnType<typeof fixture>): number {
  return f.calls.filter((call) => call.method === 'POST').length;
}

export function safeFailure(
  result: Awaited<ReturnType<ReturnType<typeof fixture>['run']['run']>>,
  reason: string,
) {
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, reason);
  assert.equal(result.verifiedLive, false);
  assert.equal(result.durable, false);
  assert(!JSON.stringify(result).includes('private-'));
}

// These additions use real Store SQL and evidence files, with a fixed synthetic transport.
// They prove persistence mechanics, never a live platform submission.
export class CommitReadFailureStore extends Store {
  private injected = false;
  constructor(
    options: ConstructorParameters<typeof Store>[0],
    private readonly failAfterCommit: boolean,
  ) {
    super(options);
  }
  get committedReadFailureInjected(): boolean {
    return this.injected;
  }
  override readEvidence(
    reference: Parameters<Store['readEvidence']>[0],
  ): ReturnType<Store['readEvidence']> {
    const actual = super.readEvidence(reference);
    if (
      this.failAfterCommit &&
      !this.injected &&
      reference.dataset === 'short_native_body_attempt'
    ) {
      const reader = new DatabaseSync(this.databasePath, { readOnly: true });
      try {
        // This separate connection sees no uncommitted attempt. Only a genuine COMMIT arms the fault.
        const committed = reader
          .prepare(
            'SELECT evidence_id FROM native_short_body_attempts WHERE job_id=? AND account_id=? AND evidence_id=?',
          )
          .get(reference.jobId, reference.accountId, reference.id);
        if (committed) {
          this.injected = true;
          throw Error('synthetic committed-attempt read failure');
        }
      } finally {
        reader.close();
      }
    }
    return actual;
  }
}
