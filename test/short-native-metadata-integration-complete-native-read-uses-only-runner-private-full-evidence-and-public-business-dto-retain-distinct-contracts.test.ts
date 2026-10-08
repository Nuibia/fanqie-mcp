import test from 'node:test';

import {
  fixture,
  noPrivate,
  fixtureProvenance,
  PRIVATE,
  SCOPE,
  WORK,
  ACCOUNT,
} from './helpers/short-native-metadata-integration-snapshot.js';

import assert from 'node:assert/strict';

import { NATIVE_SHORT_HASH_BASES } from '../src/platform/short-native-metadata.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { readFileSync } from 'node:fs';

test('complete native read uses only runner; private full evidence and public business DTO retain distinct contracts', async () => {
  const f = fixture();
  try {
    const tool = f.app.tools.find((tool) => tool.name === 'fanqie_get_short_metadata_snapshot')!;
    assert.equal(tool.readOnly, true);
    assert.equal(f.app.tools.length, 40);
    const before = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.deepEqual(
      [before.reads[0].available, before.reads[0].availabilityStatus],
      [null, 'conditional-unobserved'],
    );
    const live = await f.call();
    assert.equal(live.job.status, 'succeeded');
    assert.equal(live.sourceMode, 'fixture');
    assert.equal(live.job.platformWriteStartedAt, null);
    assert.equal(f.calls, 1);
    const dto = live.data[0];
    assert.equal(dto.firstTitle, 'Authorized title');
    assert.equal(dto.catalog.length, 3);
    assert.equal(dto.currentSelection[0].category_id, 10);
    assert.equal(dto.currentSelection[1].category_id, 'r1');
    assert.deepEqual(dto.hashBases, NATIVE_SHORT_HASH_BASES);
    assert.equal(dto.tailTitles.count, 1);
    assert.equal(dto.covers.length, 2);
    assert.equal(
      dto.requests.own.attempts +
        dto.requests.list.attempts +
        dto.requests.edit.attempts +
        dto.requests.catalog.attempts,
      5,
    );
    assert.equal(dto.cleanup.pendingAtEnd, 0);
    noPrivate(live);
    const manifest = live.job.result.manifest,
      ref = manifest.evidence[0];
    assert.equal('path' in ref, false);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      const row = db.prepare('SELECT path FROM evidence WHERE id=?').get(ref.id)!;
      const doc = JSON.parse(
        readFileSync(path.join(f.config.dataDir, 'evidence', String(row.path)), 'utf8'),
      );
      assert.equal(doc.collectionMode, 'live');
      assert.deepEqual(doc.payload.provenance, fixtureProvenance);
      for (const marker of PRIVATE)
        assert.equal(
          JSON.stringify(doc.payload).includes(marker),
          true,
          `private evidence lost ${marker}`,
        );
    } finally {
      db.close();
    }
    const saved = (await f.app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: SCOPE }),
      undefined,
    )) as any;
    assert.equal(saved.sourceMode, 'saved');
    assert.deepEqual(saved.data, live.data);
    assert.equal(saved.manifest.id, manifest.id);
    for (const scope of ['account', 'short_works', 'chapter_drafts.' + WORK])
      assert.equal(
        (
          (await f.app.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope }),
            undefined,
          )) as any
        ).manifest,
        null,
      );
    const jobs = (await f.app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(jobs.jobs.length, 1);
    noPrivate(jobs);
    for (const name of ['get_job', 'cancel_job']) {
      const viewed = await f.app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_' + name,
        new URLSearchParams(),
        { jobId: live.job.id },
      );
      noPrivate(viewed);
      assert.deepEqual((viewed as any).data, live.data);
    }
    const history = await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_list_saved_history',
      new URLSearchParams(),
      { scope: SCOPE },
    );
    noPrivate(history);
    assert.deepEqual((history as any).manifests[0].data, live.data);
    assert.equal(f.calls, 1);
    const cap = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.reads[0].verificationStatus, 'not-verified-live');
    await assert.rejects(
      f.app.dispatch('POST', '/api/v1/tools/fanqie_get_editable_snapshot', new URLSearchParams(), {
        target: { kind: 'short', workId: WORK },
      }),
      { code: 'writes_disabled' },
    );
    assert.equal(f.calls, 1);
  } finally {
    await f.close();
  }
});

test('strict native input and typed binding reject without runner/login/Page', async (t) => {
  const f = fixture();
  try {
    for (const args of [
      { workId: WORK, scope: 'other' },
      { workId: WORK, kind: 'short' },
      { workId: WORK, chapterId: WORK },
      { workId: '0' + WORK },
      { workId: 7000000001 },
      { workId: '7'.repeat(23) },
    ])
      await assert.rejects(f.call(args), { code: 'invalid_input' });
    assert.equal(f.calls, 0);
  } finally {
    await f.close();
  }
  for (const [name, binding] of [
    ['missing', null],
    ['author', { accountId: 'owner', platformId: ACCOUNT, platformIdType: 'author' }],
    ['untyped', { accountId: 'owner', platformId: ACCOUNT }],
    ['cross-account', { accountId: 'other', platformId: ACCOUNT, platformIdType: 'account' }],
    ['trimmed', { accountId: 'owner', platformId: ' ' + ACCOUNT, platformIdType: 'account' }],
  ] as const)
    await t.test(name, async () => {
      const invalid = fixture(binding);
      try {
        const response = await invalid.call();
        assert.equal(response.job.status, 'failed');
        assert.equal(invalid.calls, 0);
        noPrivate(response);
        const cap = (await invalid.app.dispatch(
          'GET',
          '/api/v1/capabilities',
          new URLSearchParams(),
          undefined,
        )) as any;
        assert.equal(cap.reads[0].available, false);
      } finally {
        await invalid.close();
      }
    });
});

test('category maximum is supported only for valid source or true absence; illegal raw remains private', async (t) => {
  for (const [name, value, absent, expected] of [
    ['valid', 10000, false, { status: 'supported', value: 10000, basis: 'source' }],
    [
      'absent',
      undefined,
      true,
      { status: 'supported', value: 8, basis: 'public-client-default-8' },
    ],
    ['null', null, false, { status: 'unsupported', value: null, basis: 'unsupported-source' }],
    [
      'string',
      'PRIVATE_UNKNOWN_VALUE',
      false,
      { status: 'unsupported', value: null, basis: 'unsupported-source' },
    ],
    ['zero', 0, false, { status: 'unsupported', value: null, basis: 'unsupported-source' }],
    ['over', 10001, false, { status: 'unsupported', value: null, basis: 'unsupported-source' }],
    ['fraction', 1.5, false, { status: 'unsupported', value: null, basis: 'unsupported-source' }],
  ] as const)
    await t.test(name, async () => {
      const f = fixture();
      try {
        f.setMax(value, absent);
        const output = await f.call();
        assert.equal(output.job.status, 'succeeded');
        assert.deepEqual(output.data[0].categoryMaximum, expected);
        noPrivate(output);
      } finally {
        await f.close();
      }
    });
});

test('failure/forged proof never saves raw or replaces an existing complete native current', async (t) => {
  const mutations: [string, (r: any) => void][] = [
    ['cleanup pending', (r) => (r.cleanup.pendingAtEnd = 1)],
    ['wrong owner', (r) => (r.snapshot.binding.account.id = '1002')],
    ['wrong target', (r) => (r.snapshot.binding.work.id = '8000000001')],
    ['wrong hash', (r) => (r.snapshot.documentHash = '0'.repeat(64))],
    ['wrong label', (r) => (r.snapshot.catalog[0].name = 'Wrong label')],
    ['trimmed tail', (r) => r.snapshot.savedFields.multi_title.pop()],
    ['wrong URI', (r) => (r.snapshot.savedFields.thumb_uri = 'replacement')],
    ['false proof', (r) => (r.proof.ownerAfter = false)],
    ['unknown schema', (r) => (r.schema = 'native-short-metadata-api-read/v2')],
    ['extra field', (r) => (r.PRIVATE_UNKNOWN_KEY = 'PRIVATE_UNKNOWN_VALUE')],
    ['wrong dispose', (r) => (r.requests.edit.disposed = 0)],
    ['wrong count', (r) => (r.list.rowsRead = 2)],
    ['wrong basis', (r) => (r.snapshot.hashBases.document = 'plainHTMLstrip')],
    ['callback time', (r) => (r.proof.proofCapturedAt = '2030-01-01T00:00:00.000Z')],
  ];
  const f = fixture();
  try {
    const baseline = await f.call();
    for (const [name, mutate] of mutations)
      await t.test(name, async () => {
        f.mutate(mutate);
        const output = await f.call();
        assert.equal(output.job.status, 'failed');
        assert.deepEqual(output.evidence, []);
        noPrivate(output);
        const saved = (await f.app.dispatch(
          'GET',
          '/api/v1/snapshot',
          new URLSearchParams({ scope: SCOPE }),
          undefined,
        )) as any;
        assert.equal(saved.manifest.id, baseline.job.result.manifest.id);
      });
  } finally {
    await f.close();
  }
  for (const mode of ['throw', 'unavailable', 'missing-owner', 'repeated-owner', 'repeated-before'])
    await t.test(mode, async () => {
      const invalid = fixture();
      try {
        invalid.mode(mode);
        const response = await invalid.call();
        assert.equal(response.job.status, 'failed');
        assert.deepEqual(response.evidence, []);
        noPrivate(response);
        assert.equal(
          (
            (await invalid.app.dispatch(
              'GET',
              '/api/v1/snapshot',
              new URLSearchParams({ scope: SCOPE }),
              undefined,
            )) as any
          ).manifest,
          null,
        );
      } finally {
        await invalid.close();
      }
    });
});

test('real pending cancellation holds until collector settles; raw never enters cancelled job views', async () => {
  const f = fixture();
  try {
    f.mode('hold');
    const pending = f.call();
    while (!f.held) await new Promise<void>((resolve) => setImmediate(resolve));
    const jobs = (await f.app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    const id = jobs.jobs[0].id;
    const cancelled = (await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_cancel_job',
      new URLSearchParams(),
      { jobId: id },
    )) as any;
    assert.equal(cancelled.job.status, 'running');
    noPrivate(cancelled);
    f.release();
    const output = await pending;
    assert.equal(output.job.status, 'cancelled');
    assert.equal(output.evidence.length, 0);
    noPrivate(output);
  } finally {
    await f.close();
  }
});
