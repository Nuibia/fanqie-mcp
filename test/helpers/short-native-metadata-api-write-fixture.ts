import {
  type WriteOverrides,
  type WriteRaw,
  type WriteHold,
} from './short-native-metadata-api-chapter-transport-fixture.js';

import {
  edit,
  ACCOUNT,
  WORK,
  catalog,
  fixture,
  deferred,
} from './short-native-metadata-api-deferred.js';

import {
  createNativeShortMetadataSnapshot,
  nativeShortMetadataEndpoints,
  type NativeShortMetadataRequest,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortMetadataDurableReceipt,
  type NativeShortMetadataApiWriteOptions,
  type NativeShortMetadataDurableReceiptFields,
  OwnedNativeShortMetadataWriteRun,
  type NativeShortMetadataApiWriteResult,
} from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import { type APIResponse, type APIRequestContext } from 'playwright';

export function writeFixture(overrides: WriteOverrides = {}) {
  let current: WriteRaw = { ...edit(), latest_version: 7, modify_time: '0000000123' },
    written = false;
  overrides.beforeMutation?.(current);
  if (overrides.emptyCategories) current.category = [];
  const before = createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: current,
    categoryData: catalog(),
  });
  const f = fixture({
    ...overrides,
    response: (url, index) => {
      const extra = overrides.response?.(url, index);
      if (extra && Object.keys(extra).length) return extra;
      if (url === nativeShortMetadataEndpoints(WORK).edit)
        return { envelope: { code: 0, data: current } };
      if (
        written &&
        overrides.afterRows &&
        url.startsWith('https://fanqienovel.com/api/author/short_article/draft_list/v0/')
      ) {
        const page = Number(new URL(url).searchParams.get('page_index'));
        return {
          envelope: {
            code: 0,
            data: {
              total_count: overrides.afterRows.length,
              item_list: overrides.afterRows
                .slice(page * 10, (page + 1) * 10)
                .map((item_id) => ({ item_id })),
            },
          },
        };
      }
      return {};
    },
  });
  const entered = deferred<void>(),
    release = deferred<void>();
  let holdSeen = false;
  const pause = async (stage: WriteHold) => {
    f.events.push(stage);
    if (overrides.writeHold === stage && !holdSeen) {
      holdSeen = true;
      entered.resolve();
      await release.promise;
    }
  };
  const posts: Array<{ url: string; options: Record<string, unknown> }> = [];
  let marks = 0,
    finalAt: string | null = null,
    lastReceipt: NativeShortMetadataDurableReceipt | null = null;
  const create = f.factory.newContext;
  f.factory.newContext = async (options) => {
    const api = await create(options);
    api.post = (async (url: string, options: Record<string, unknown>) => {
      posts.push({ url, options });
      await pause('post');
      const form = new URLSearchParams(options.data as string);
      current.multi_title = JSON.parse(form.get('multi_title')!);
      if (form.has('category'))
        current.category = form
          .get('category')!
          .split(',')
          .map((id) =>
            catalog().category_list.find((row) => String(row.category_id) === id)!,
          ) as typeof current.category;
      assert.equal(typeof current.latest_version, 'number');
      current.latest_version = (current.latest_version as number) + 1;
      written = true;
      overrides.afterMutation?.(current);
      if (overrides.lostAck) throw Error('private-lost-ack');
      return {
        status: () => 200,
        url: () => url,
        headers: () => ({ 'content-type': 'application/json' }),
        async body() {
          await pause('post_body');
          return Buffer.from(JSON.stringify(overrides.ack ?? { code: 0 }));
        },
        async dispose() {
          await pause('post_dispose');
          if (overrides.postDisposeFailure) throw Error('private-post-dispose');
        },
      } as unknown as APIResponse;
    }) as APIRequestContext['post'];
    return api;
  };
  const businessRequest: NativeShortMetadataRequest = {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    title: 'Changed synthetic title',
  };
  overrides.requestMutation?.(businessRequest);
  const options: NativeShortMetadataApiWriteOptions = {
    ...f.options,
    mode: 'write',
    businessRequest,
    onDurableBeforeWrite: async (held, confirm) => {
      f.events.push('held');
      assert.equal(held.cleanup.sessionDisposed, false);
      assert.equal(held.cleanup.pendingAtEnd, 0);
      assert.equal(f.apiCloses, 0);
      assert.equal(posts.length, 0);
      assert.equal(held.read.requests.own.disposed, 2);
      await pause('durable');
      if (overrides.callbackFault === 'durable') throw Error('private-durability');
      const at = new Date().toISOString();
      const fields: NativeShortMetadataDurableReceiptFields = {
        accountId: 'synthetic-service',
        jobId: '00000000-0000-4000-8000-000000000003',
        baseline: {
          id: '00000000-0000-4000-8000-000000000001',
          sha256: '1'.repeat(64),
          capturedAt: at,
        },
        intent: {
          id: '00000000-0000-4000-8000-000000000002',
          sha256: '2'.repeat(64),
          capturedAt: at,
        },
        target: { kind: 'short-story', id: WORK },
        expectedSnapshotVersionHash: held.snapshot.snapshotVersionHash,
        desiredContentHash: held.desiredContentHash,
      };
      overrides.receiptMutation?.(fields);
      const receipt = overrides.forgedReceipt
        ? { schema: 'native-short-metadata-durable-receipt/v1' as const, ...fields }
        : confirm(fields);
      lastReceipt = receipt;
      f.events.push('durable_done');
      return receipt;
    },
    onBeforePlatformWrite: async (receipt) => {
      assert.equal(receipt, lastReceipt);
      assert.equal(posts.length, 0);
      marks++;
      await pause('mark');
      if (overrides.callbackFault === 'mark') throw Error('private-mark');
      return new Date().toISOString();
    },
    onVerifiedAccount: async (id, at) => {
      assert.equal(id, ACCOUNT);
      assert.equal(f.apiCloses, 1);
      assert.equal(posts.length, 1);
      finalAt = at;
      await pause('final_owner');
      if (overrides.callbackFault === 'final_owner') throw Error('private-owner');
      overrides.callback?.();
    },
  };
  const run = new OwnedNativeShortMetadataWriteRun(f.internals.context, WORK, options, f.factory);
  const {
    deadline: _deadline,
    assertBorrowedActive: _source,
    onQuarantine: _quarantine,
    ...browserOptions
  } = options;
  return {
    ...f,
    options,
    browserOptions,
    run,
    before,
    posts,
    writeEntered: entered.promise,
    releaseWrite: () => release.resolve(),
    get marks() {
      return marks;
    },
    get finalAt() {
      return finalAt;
    },
    get current() {
      return current;
    },
    get apiCloses() {
      return f.apiCloses;
    },
    get borrowedCloses() {
      return f.borrowedCloses;
    },
    get pageTouches() {
      return f.pageTouches;
    },
    get callbacks() {
      return f.callbacks;
    },
    get quarantines() {
      return f.quarantines;
    },
    get contextOptions() {
      return f.contextOptions;
    },
  };
}

export function writeFailed(
  result: NativeShortMetadataApiWriteResult,
  reason: NativeShortMetadataApiWriteResult['reason'],
) {
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, reason);
  assert.equal(result.snapshot, null);
  assert.equal(result.held, null);
  assert.equal(result.receipt, null);
  assert.equal(result.comparison, null);
  assert.equal(result.desiredContentHash, null);
  assert.equal(result.observedContentHash, null);
  assert.equal(result.proof.ownerCallback, false);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(JSON.stringify(result).includes('private'), false);
}
