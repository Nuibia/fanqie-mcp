import test from 'node:test';

import { fixture } from './helpers/short-native-body-public-fixture.js';

import {
  sdk,
  checkPhysical,
  noPrivate,
} from './helpers/short-native-body-public-check-physical.js';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
} from '../src/platform/short-native-body.js';

import { NATIVE_SHORT_HASH_BASES } from '../src/platform/short-native-metadata.js';

import { WORK, DESIRED } from './helpers/short-native-body-public-account.js';

test('body public SDK lists exact strict read and write schemas', async () => {
  const f = fixture(),
    wire = await sdk(f);
  try {
    const tools = (await wire.client.listTools()).tools;
    assert.equal(tools.length, 40);
    const read = tools.find((item) => item.name === 'fanqie_get_short_body_snapshot')!,
      write = tools.find((item) => item.name === 'fanqie_update_short_body')!;
    assert.equal(read.annotations!.readOnlyHint, true);
    assert.equal(write.annotations!.readOnlyHint, false);
    assert.equal(write.annotations!.destructiveHint, true);
    assert.equal(read.inputSchema.additionalProperties, false);
    assert.equal(write.inputSchema.additionalProperties, false);
    assert.deepEqual(read.inputSchema.required, ['workId']);
    assert.deepEqual(
      Object.keys(write.inputSchema.properties!).sort(),
      [
        'comparisonPolicy',
        'expectedSnapshotVersionHash',
        'expectedState',
        'hashBasis',
        'idempotencyKey',
        'paragraphs',
        'representation',
        'snapshotScope',
        'target',
        'trial',
      ].sort(),
    );
    const schema = write.inputSchema.properties as Record<string, any>;
    assert.equal(schema.snapshotScope.const, NATIVE_SHORT_BODY_SCOPE);
    assert.equal(schema.representation.const, NATIVE_SHORT_BODY_REPRESENTATION);
    assert.equal(schema.expectedState.const, 'draft');
    assert.equal(schema.hashBasis.const, NATIVE_SHORT_HASH_BASES.snapshot);
    assert.equal(schema.target.additionalProperties, false);
    assert.equal(schema.paragraphs.items.additionalProperties, false);
    for (const args of [
      { ...f.request(), unknown: true },
      { ...f.request(), trial: { action: 'unknown' } },
      { ...f.request(), target: { kind: 'chapter', workId: WORK } },
    ]) {
      const result = await wire.client.callTool({ name: write.name, arguments: args });
      assert.equal(result.isError, true);
    }
    assert.equal(f.jobs().length, 0);
    assert.deepEqual(f.counters, {
      gets: 0,
      posts: 0,
      contexts: 0,
      disposals: 0,
      readCalls: 0,
      forbidden: 0,
      peak: 0,
    });
  } finally {
    await wire.close();
    await f.close();
  }
});

test('body public SDK explicitly selects validated derived word count policy and preserves legacy contract', async () => {
  const f = fixture({ derivedCount: true }),
    wire = await sdk(f);
  try {
    const tools = (await wire.client.listTools()).tools,
      schema = tools.find((t) => t.name === 'fanqie_update_short_body')!.inputSchema;
    const property = (schema.properties as Record<string, any>).comparisonPolicy;
    assert.equal(property.const, 'native-short-body-derived-word-number/v2');
    assert.equal(schema.required!.includes('comparisonPolicy'), false);
    for (const comparisonPolicy of [
      'unknown/v2',
      null,
      false,
      { policy: 'native-short-body-derived-word-number/v2' },
    ]) {
      const rejected = await wire.client.callTool({
        name: 'fanqie_update_short_body',
        arguments: { ...f.request(), comparisonPolicy },
      });
      assert.equal(rejected.isError, true);
    }
    assert.equal(f.jobs().length, 0);
    assert.equal(f.counters.gets + f.counters.posts + f.counters.contexts, 0);
    const args = { ...f.request(), comparisonPolicy: 'native-short-body-derived-word-number/v2' };
    const result = await wire.call('update_short_body', args);
    assert.equal(result.job.status, 'succeeded');
    assert.equal(result.data[0].status, 'matched');
    assert.equal(result.data[0].durable, true);
    assert.equal(result.data[0].verifiedLive, false);
    assert.equal(result.sourceMode, 'incomplete');
    assert.equal(f.current.word_number, 27);
    assert.equal(f.current.content, DESIRED);
    assert.equal(f.current.latest_version, 8);
    assert.equal(f.counters.posts, 1);
    assert.equal(f.attempts(result.job.id).length, 1);
    checkPhysical(f, result.job.id);
    noPrivate(result);
    const before = f.counters,
      jobs = f.jobs().length,
      replay = await wire.call('update_short_body', args);
    assert.equal(replay.retrievalMode, 'saved');
    assert.deepEqual(replay.job, result.job);
    assert.deepEqual(replay.evidence, result.evidence);
    assert.deepEqual(replay.data, result.data);
    assert.deepEqual(f.counters, before);
    assert.equal(f.jobs().length, jobs);
    const conflict = await wire.client.callTool({
      name: 'fanqie_update_short_body',
      arguments: f.request(),
    });
    assert.equal(conflict.isError, true);
    const conflictText = conflict.content.find((item) => item.type === 'text');
    assert(conflictText && conflictText.type === 'text');
    assert.equal(JSON.parse(conflictText.text).code, 'idempotency_conflict');
    assert.deepEqual(f.counters, before);
    assert.equal(f.jobs().length, jobs);
    const read = await wire.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(read.bodySnapshot.marker.characterCount, 27);
    assert.equal(read.bodySnapshot.bodyHash.length, 64);
    const { bodySnapshot, ...safe } = read;
    noPrivate(safe);
  } finally {
    await wire.close();
    await f.close();
  }
});

test('body public descriptor capture rejects invalid carriers before side effects', async () => {
  const f = fixture();
  let getters = 0;
  try {
    const accessor = { ...f.request() };
    Object.defineProperty(accessor, 'paragraphs', {
      enumerable: true,
      get() {
        getters++;
        return [];
      },
    });
    const nested = {
      ...f.request(),
      paragraphs: [
        {
          sourceIndex: null,
          get lines() {
            getters++;
            return ['PRIVATE'];
          },
        },
      ],
    };
    const symbol = { ...f.request(), [Symbol('hidden')]: true },
      prototype = Object.assign(
        Object.create({ snapshotScope: NATIVE_SHORT_BODY_SCOPE }),
        f.request(),
      ),
      sparse = { ...f.request(), paragraphs: new Array(2) };
    const invalid = [
      accessor,
      nested,
      symbol,
      prototype,
      sparse,
      { ...f.request(), extra: true },
      { ...f.request(), paragraphs: [{ sourceIndex: null, lines: ['\ud800'] }] },
      { ...f.request(), trial: { action: 'set', beforeParagraph: 1, metadata: { trial: true } } },
      { ...f.request(), metadata: { cover: 'PRIVATE' } },
      null,
      [],
      1,
    ];
    for (const raw of invalid) {
      await assert.rejects(
        f.app.tools.find((item) => item.name === 'fanqie_update_short_body')!.run(raw as any),
        { code: 'invalid_input' },
      );
      await assert.rejects(f.call('update_short_body', raw), { code: 'invalid_input' });
    }
    for (const raw of [
      { workId: WORK, extra: true },
      { workId: WORK, snapshotScope: NATIVE_SHORT_BODY_SCOPE },
      Object.create({ workId: WORK }),
      null,
    ])
      await assert.rejects(f.call('get_short_body_snapshot', raw), { code: 'invalid_input' });
    assert.equal(getters, 0);
    assert.equal(f.jobs().length, 0);
    assert.equal(
      f.counters.contexts + f.counters.gets + f.counters.posts + f.counters.readCalls,
      0,
    );
  } finally {
    await f.close();
  }
});

test('body public writes disabled rejects before enqueue while fresh read remains available', async () => {
  const f = fixture({ writes: false });
  try {
    await assert.rejects(f.call('update_short_body', f.request()), { code: 'writes_disabled' });
    assert.equal(f.jobs().length, 0);
    const read = await f.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(read.bodySnapshot.bodyIncluded, true);
    assert.equal(read.bodySnapshot.versionScope, 'author-edit-current');
    assert.equal(read.bodySnapshot.publishedVersionVerified, false);
    assert.equal(f.counters.readCalls, 1);
    assert.equal(f.counters.posts, 0);
    const capabilities = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(capabilities.writes.nativeShortBody.available, false);
    assert.equal(capabilities.writes.nativeShortBody.verificationStatus, 'not-verified-live');
  } finally {
    await f.close();
  }
});
