import test from 'node:test';

import { fixture } from './helpers/short-native-trial-integration-fixture.js';

import assert from 'node:assert/strict';

import { WORK, noPrivate } from './helpers/short-native-trial-integration-edit.js';

import { NATIVE_SHORT_TRIAL_SCOPE } from '../src/platform/short-native-trial.js';

test('trial public branch rejects disabled writes before queue and retains 37 tool names', async () => {
  const f = fixture(false);
  try {
    assert.equal(f.app.tools.length, 40);
    await assert.rejects(f.call(), { code: 'writes_disabled' });
    assert.deepEqual([f.reads, f.writes, f.trialCalls, f.contexts], [0, 0, 0, 0]);
    assert.equal(
      ((await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any).jobs
        .length,
      0,
    );
    const capabilities = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(capabilities.writes.nativeShortTrial.available, false);
    assert.equal(capabilities.writes.nativeShortTrial.verificationStatus, 'not-verified-live');
    const read = (await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_short_metadata_snapshot',
      new URLSearchParams(),
      { workId: WORK, snapshotScope: NATIVE_SHORT_TRIAL_SCOPE },
    )) as any;
    assert.equal(read.job.status, 'succeeded');
    assert.equal(read.sourceMode, 'fixture');
    noPrivate(read);
    assert.equal(f.writes, 0);
  } finally {
    await f.close();
  }
});

test('trial strict reserved input never falls into legacy or mixed maintenance', async () => {
  const f = fixture();
  try {
    const valid = f.request();
    const invalid = [
      { ...valid, title: 'Mixed title' },
      { ...valid, expectedState: 'published' },
      { ...valid, expectedContentHash: 'a'.repeat(64) },
      { ...valid, metadata: { ...valid.metadata, categories: ['c1'] } },
      { ...valid, metadata: { trial: { action: 'set', beforeParagraph: 4, trialRatio: 50 } } },
      { ...valid, metadata: { trial: { action: 'clear', beforeParagraph: 4 } } },
      { ...valid, metadata: { trial: { action: 'set', beforeParagraph: -0 } } },
      {
        ...valid,
        metadata: { trial: { action: 'set', beforeParagraph: 4, html: '<p>PRIVATE_BODY</p>' } },
      },
      { ...valid, snapshotScope: 'short-native-trial/v99' },
      { ...valid, hashBasis: 'caller-percent/v1' },
      { ...valid, target: { kind: 'chapter', workId: WORK, chapterId: WORK } },
    ];
    for (const input of invalid) await assert.rejects(f.call(input), { code: 'invalid_input' });
    assert.deepEqual([f.reads, f.writes, f.trialCalls], [0, 0, 0]);
    assert.equal(
      ((await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any).jobs
        .length,
      0,
    );
    await assert.rejects(
      f.app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_get_short_metadata_snapshot',
        new URLSearchParams(),
        { workId: WORK, snapshotScope: 'short-native-trial/v99' },
      ),
      { code: 'invalid_input' },
    );
  } finally {
    await f.close();
  }
});

test('trial App and direct tool reject original descriptors before Zod with zero getters or jobs', async () => {
  const f = fixture();
  let getters = 0;
  const hit = () => {
    getters++;
  };
  const accessor = (raw: any, key: string) => {
    const value = raw[key];
    Object.defineProperty(raw, key, {
      enumerable: true,
      get() {
        hit();
        return value;
      },
    });
    return raw;
  };
  const writeCases: [string, (raw: any) => any][] = [
    ['top target getter', (raw) => accessor(raw, 'target')],
    ['top scope getter', (raw) => accessor(raw, 'snapshotScope')],
    ['top metadata getter', (raw) => accessor(raw, 'metadata')],
    ['top key getter', (raw) => accessor(raw, 'idempotencyKey')],
    [
      'nested work getter',
      (raw) => {
        accessor(raw.target, 'workId');
        return raw;
      },
    ],
    [
      'nested trial getter',
      (raw) => {
        accessor(raw.metadata, 'trial');
        return raw;
      },
    ],
    [
      'nested action getter',
      (raw) => {
        accessor(raw.metadata.trial, 'action');
        return raw;
      },
    ],
    [
      'top symbol',
      (raw) => {
        raw[Symbol('untrusted')] = true;
        return raw;
      },
    ],
    [
      'nested symbol',
      (raw) => {
        raw.metadata.trial[Symbol('untrusted')] = true;
        return raw;
      },
    ],
    [
      'top non-enumerable',
      (raw) => {
        Object.defineProperty(raw, 'hidden', { value: true });
        return raw;
      },
    ],
    [
      'nested non-enumerable',
      (raw) => {
        Object.defineProperty(raw.metadata, 'hidden', { value: true });
        return raw;
      },
    ],
    [
      'non-enumerable scope',
      (raw) => {
        Object.defineProperty(raw, 'snapshotScope', {
          value: raw.snapshotScope,
          enumerable: false,
        });
        return raw;
      },
    ],
    ['top non-plain', (raw) => Object.setPrototypeOf(raw, { syntheticPrototype: true })],
    [
      'nested non-plain',
      (raw) => {
        Object.setPrototypeOf(raw.target, { syntheticPrototype: true });
        return raw;
      },
    ],
    ['inherited trial request', (raw) => Object.create(raw)],
    [
      'unknown trial namespace',
      (raw) => {
        raw.snapshotScope = 'short-native-trial/v99';
        return raw;
      },
    ],
    [
      'reserved ratio getter without scope',
      (raw) => {
        delete raw.snapshotScope;
        raw.metadata = {};
        Object.defineProperty(raw.metadata, 'trialRatio', {
          enumerable: true,
          get() {
            hit();
            return 50;
          },
        });
        return raw;
      },
    ],
    [
      'unreadable metadata without scope',
      (raw) => {
        delete raw.snapshotScope;
        return accessor(raw, 'metadata');
      },
    ],
  ];
  const readCases: [string, (raw: any) => any][] = [
    ['scope getter', (raw) => accessor(raw, 'snapshotScope')],
    ['work getter', (raw) => accessor(raw, 'workId')],
    [
      'symbol',
      (raw) => {
        raw[Symbol('untrusted')] = true;
        return raw;
      },
    ],
    [
      'non-enumerable',
      (raw) => {
        Object.defineProperty(raw, 'hidden', { value: true });
        return raw;
      },
    ],
    ['non-plain', (raw) => Object.setPrototypeOf(raw, { syntheticPrototype: true })],
    ['inherited trial read', (raw) => Object.create(raw)],
    [
      'unknown scope',
      (raw) => {
        raw.snapshotScope = 'short-native-trial/v99';
        return raw;
      },
    ],
  ];
  try {
    for (const entry of ['tool', 'App'] as const) {
      const writeTool = f.app.tools.find((item) => item.name === 'fanqie_update_work_metadata');
      assert(writeTool);
      const readTool = f.app.tools.find(
        (item) => item.name === 'fanqie_get_short_metadata_snapshot',
      );
      assert(readTool);
      for (const [label, make] of writeCases) {
        const raw = make(structuredClone(f.request()));
        await assert.rejects(
          entry === 'tool' ? writeTool.run(raw) : f.call(raw),
          { code: 'invalid_input' },
          `${entry}: ${label}`,
        );
        assert.equal(getters, 0, `${entry}: ${label} evaluated a getter`);
      }
      for (const [label, make] of readCases) {
        const raw = make({ workId: WORK, snapshotScope: NATIVE_SHORT_TRIAL_SCOPE });
        await assert.rejects(
          entry === 'tool'
            ? readTool.run(raw)
            : f.app.dispatch(
                'POST',
                '/api/v1/tools/fanqie_get_short_metadata_snapshot',
                new URLSearchParams(),
                raw,
              ),
          { code: 'invalid_input' },
          `${entry} read: ${label}`,
        );
        assert.equal(getters, 0, `${entry} read: ${label} evaluated a getter`);
      }
    }
    assert.equal(getters, 0);
    assert.deepEqual([f.reads, f.writes, f.trialCalls, f.contexts], [0, 0, 0, 0]);
    assert.equal(
      ((await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any).jobs
        .length,
      0,
    );
  } finally {
    await f.close();
  }
});
