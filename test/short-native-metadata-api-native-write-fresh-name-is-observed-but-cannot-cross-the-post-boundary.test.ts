import { edit } from './helpers/short-native-metadata-api-deferred.js';

import { type NativeShortMetadataRequest } from '../src/platform/short-native-metadata.js';

import test from 'node:test';

import { writeFixture, writeFailed } from './helpers/short-native-metadata-api-write-fixture.js';

import assert from 'node:assert/strict';

import { type WriteRaw } from './helpers/short-native-metadata-api-chapter-transport-fixture.js';

for (const [name, overrides] of [
  [
    'signed category lock',
    {
      beforeMutation: (raw: ReturnType<typeof edit>) => {
        raw.authorize_type = 1;
      },
      requestMutation: (value: NativeShortMetadataRequest) => {
        (value as any).metadata = { categories: ['c1', '2'] };
      },
    },
  ],
  [
    'source category maximum',
    {
      beforeMutation: (raw: ReturnType<typeof edit>) => {
        raw.category_max_count = 1;
      },
      requestMutation: (value: NativeShortMetadataRequest) => {
        (value as any).metadata = { categories: ['c1', '2'] };
      },
    },
  ],
  [
    'unknown catalog member',
    {
      requestMutation: (value: NativeShortMetadataRequest) => {
        (value as any).metadata = { categories: ['c1', 'missing'] };
      },
    },
  ],
] as const)
  test(`native write fresh ${name} is observed but cannot cross the POST boundary`, async () => {
    const f = writeFixture(overrides);
    writeFailed(await f.run.run(), 'unsupported_schema');
    assert.equal(f.calls.length, 5);
    assert.equal(f.posts.length, 0);
    assert.equal(f.marks, 0);
  });

for (const [name, mutate] of [
  [
    'missing version',
    (raw: WriteRaw) => {
      delete raw.latest_version;
    },
  ],
  [
    'missing token',
    (raw: WriteRaw) => {
      delete raw.modify_time;
    },
  ],
  [
    'version string',
    (raw: WriteRaw) => {
      raw.latest_version = '7';
    },
  ],
  [
    'version null',
    (raw: WriteRaw) => {
      raw.latest_version = null;
    },
  ],
  [
    'version negative',
    (raw: WriteRaw) => {
      raw.latest_version = -1;
    },
  ],
  [
    'version fractional',
    (raw: WriteRaw) => {
      raw.latest_version = 7.5;
    },
  ],
  [
    'version unsafe',
    (raw: WriteRaw) => {
      raw.latest_version = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'no increment space',
    (raw: WriteRaw) => {
      raw.latest_version = Number.MAX_SAFE_INTEGER;
    },
  ],
  [
    'token numeric',
    (raw: WriteRaw) => {
      raw.modify_time = 123;
    },
  ],
  [
    'token null',
    (raw: WriteRaw) => {
      raw.modify_time = null;
    },
  ],
  [
    'token short',
    (raw: WriteRaw) => {
      raw.modify_time = '000000123';
    },
  ],
  [
    'token long',
    (raw: WriteRaw) => {
      raw.modify_time = '00000000123';
    },
  ],
  [
    'token nonASCII',
    (raw: WriteRaw) => {
      raw.modify_time = '０００００００１２３';
    },
  ],
  [
    'token trailing newline',
    (raw: WriteRaw) => {
      raw.modify_time = '0000000123\n';
    },
  ],
] as const)
  test(`native v2 write ${name} before cannot mark or POST`, async () => {
    const f = writeFixture({ beforeMutation: mutate });
    const value = await f.run.run();
    writeFailed(value, 'unsupported_schema');
    assert.equal(value.schema, 'native-short-metadata-api-write/v2');
    assert.equal(f.marks, 0);
    assert.equal(f.posts.length, 0);
    assert.equal(value.proof.writeMarked, false);
    assert.equal(f.apiCloses, 1);
  });

for (const [name, mutate] of [
  [
    'no revision effect',
    (raw: WriteRaw) => {
      raw.latest_version = 7;
    },
  ],
  [
    'double revision effect',
    (raw: WriteRaw) => {
      raw.latest_version = 9;
    },
  ],
  [
    'revision decreased',
    (raw: WriteRaw) => {
      raw.latest_version = 6;
    },
  ],
  [
    'revision missing',
    (raw: WriteRaw) => {
      delete raw.latest_version;
    },
  ],
  [
    'revision wrong type',
    (raw: WriteRaw) => {
      raw.latest_version = '8';
    },
  ],
  [
    'revision unsafe',
    (raw: WriteRaw) => {
      raw.latest_version = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'token decreased',
    (raw: WriteRaw) => {
      raw.modify_time = '0000000122';
    },
  ],
  [
    'token missing',
    (raw: WriteRaw) => {
      delete raw.modify_time;
    },
  ],
  [
    'token coercion',
    (raw: WriteRaw) => {
      raw.modify_time = 123;
    },
  ],
  [
    'token nondigits',
    (raw: WriteRaw) => {
      raw.modify_time = '000000012x';
    },
  ],
  [
    'token trailing newline',
    (raw: WriteRaw) => {
      raw.modify_time = '0000000123\n';
    },
  ],
  [
    'another timestamp changed',
    (raw: WriteRaw) => {
      (raw as unknown as Record<string, unknown>).unknown_time = 'server-generated-looking';
    },
  ],
] as const)
  test(`native v2 write ${name} after retains one POST and cannot verify`, async () => {
    const f = writeFixture({ afterMutation: mutate });
    const value = await f.run.run();
    writeFailed(value, 'readback_mismatch');
    assert.equal(f.posts.length, 1);
    assert.equal(f.marks, 1);
    assert.equal(value.post.acknowledged, true);
    assert.equal(value.post.disposed, 1);
    assert.equal(f.apiCloses, 1);
  });

test('native v2 real POST proves equal and increasing opaque tokens without changing C2 read fixtures', async () => {
  assert.equal(Object.hasOwn(edit(), 'latest_version'), false);
  assert.equal(Object.hasOwn(edit(), 'modify_time'), false);
  for (const token of ['0000000123', '0000000124']) {
    const f = writeFixture({
      afterMutation: (raw) => {
        raw.modify_time = token;
      },
    });
    const value = await f.run.run();
    assert.equal(value.status, 'success');
    assert.equal(value.schema, 'native-short-metadata-api-write/v2');
    assert(
      value.schema === 'native-short-metadata-api-write/v2' &&
        value.held &&
        value.comparison &&
        value.snapshot,
    );
    assert.deepEqual(value.held.expectation.serverRevisionBefore, {
      latestVersion: 7,
      modifyTime: '0000000123',
    });
    assert.deepEqual(
      { ...value.comparison.actual.serverRevisionBefore },
      { ...value.held.expectation.serverRevisionBefore },
    );
    assert.deepEqual(value.comparison.actual.serverRevisionAfter, {
      latestVersion: 8,
      modifyTime: token,
    });
    assert.equal(value.snapshot.editData.latest_version, 8);
    assert.notEqual(value.snapshot.snapshotVersionHash, f.before.snapshotVersionHash);
    assert.equal(value.desiredContentHash, value.observedContentHash);
    assert.equal(f.posts.length, 1);
    assert.equal(f.marks, 1);
    assert.equal(new URLSearchParams(f.posts[0]!.options.data as string).get('item_version'), '-1');
    assert.equal(
      new URLSearchParams(f.posts[0]!.options.data as string).has('latest_version'),
      false,
    );
  }
});

test('native v2 ACK loss records the one synthetic server effect without retry or verification', async () => {
  const f = writeFixture({ lostAck: true });
  const value = await f.run.run();
  writeFailed(value, 'response_unavailable');
  assert.equal(f.current.latest_version, 8);
  assert.equal(f.current.modify_time, '0000000123');
  assert.equal(f.posts.length, 1);
  assert.equal(f.marks, 1);
});
