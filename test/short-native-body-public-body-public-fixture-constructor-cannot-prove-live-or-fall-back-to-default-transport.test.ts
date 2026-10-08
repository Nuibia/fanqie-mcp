import test from 'node:test';

import { fixture } from './helpers/short-native-body-public-fixture.js';

import assert from 'node:assert/strict';

import { WORK, OWNER, TOKEN } from './helpers/short-native-body-public-account.js';

import {
  checkPhysical,
  noPrivate,
  sdk,
} from './helpers/short-native-body-public-check-physical.js';

import { readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import { NATIVE_SHORT_BODY_DATASETS } from '../src/platform/short-native-body-proof.js';

import { createApplication } from '../src/application.js';

import { createHttpServer } from '../src/transport/http.js';

test('body public fixture constructor cannot prove live or fall back to default transport', async () => {
  const f = fixture({ withFactory: false });
  try {
    await assert.rejects(f.call('update_short_body', f.request()), {
      code: 'capability_unavailable',
    });
    assert.equal(f.jobs().length, 0);
    assert.equal(f.counters.contexts, 0);
    const read = await f.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(read.job.status, 'succeeded');
    assert.equal(read.bodySnapshot.bodyIncluded, true);
    assert.equal(read.bodySnapshot.verifiedLive, false);
    const refs = f.refs(read.job.id);
    assert.equal(refs.length, 1);
    checkPhysical(f, read.job.id);
    const document = JSON.parse(
      readFileSync(path.join(f.evidenceDirectory, String(refs[0]!.path)), 'utf8'),
    );
    assert.equal(document.collectionMode, 'fixture');
    assert.equal(document.payload.source.mode, 'fixture');
    assert.deepEqual(document.payload.provenance, {
      executor: 'dependency-injected-browser/v1',
      mode: 'fixture',
    });
    assert.equal(f.counters.readCalls, 1);
    assert.equal(f.counters.contexts, 0);
    assert.equal(f.counters.gets, 0);
    assert.equal(f.counters.posts, 0);
    assert.equal(f.counters.disposals, 0);
    assert.equal(f.counters.forbidden, 0);
    const { bodySnapshot, ...bodyFree } = read;
    noPrivate(bodyFree);
    const saved = await f.call('get_job', { jobId: read.job.id });
    noPrivate(saved);
    assert.equal(Object.hasOwn(saved, 'bodySnapshot'), false);
    noPrivate(await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    noPrivate(await f.app.dispatch('GET', '/api/v1/history', new URLSearchParams(), undefined));
    const counters = f.counters,
      jobs = f.jobs().length;
    await assert.rejects(f.call('update_short_body', f.request()), {
      code: 'capability_unavailable',
    });
    assert.deepEqual(f.counters, counters);
    assert.equal(f.jobs().length, jobs);
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
  const g = fixture();
  try {
    const saved = await g.call('update_short_body', g.request());
    assert.equal(
      saved.data[0].durable,
      true,
      JSON.stringify({
        diagnostic: 'synthetic-body-constructor-g',
        state: [
          'queued',
          'running',
          'waiting_for_login',
          'succeeded',
          'partial',
          'failed',
          'uncertain',
          'cancelled',
        ].includes(saved.job?.status)
          ? saved.job.status
          : 'unrecognized',
        reason: [
          'durability_unverified',
          'match',
          'fixture_not_live',
          'readback_mismatch',
          'response_unverified',
          'not_applied',
          'cleanup_failed',
          'owner_unverified',
        ].includes(saved.data[0]?.reason)
          ? saved.data[0].reason
          : 'unrecognized',
        stageCount: g.refs(saved.job.id).length,
        stages: g
          .refs(saved.job.id)
          .map((ref) =>
            Object.values(NATIVE_SHORT_BODY_DATASETS).includes(String(ref.dataset) as any) ||
            ref.dataset === 'write-intent' ||
            ref.dataset === 'write-result'
              ? ref.dataset
              : 'unrecognized',
          ),
        attemptCount: g.attempts(saved.job.id).length,
        counters: g.counters,
      }),
    );
    assert.equal(saved.data[0].verifiedLive, false);
    const before = g.counters.contexts;
    assert.throws(() => createApplication(g.config, { nativeShortBodyFixtureFactory: g.factory }), {
      code: 'invalid_configuration',
    });
    assert.equal(g.counters.contexts, before);
  } finally {
    await g.close();
  }
  const h = fixture({ mode: 'ack-lost' });
  try {
    const original = await h.call('update_short_body', h.request());
    assert.equal(original.job.status, 'uncertain');
    await h.reopen(false, OWNER, false);
    const counters = h.counters,
      jobs = h.jobs().length;
    await assert.rejects(h.call('reconcile_write', { jobId: original.job.id }), {
      code: 'capability_unavailable',
    });
    assert.deepEqual(h.counters, counters);
    assert.equal(h.jobs().length, jobs);
  } finally {
    await h.close();
  }
});

test('body public explicit body read uses current physical metadata context only', async () => {
  const f = fixture({ writes: false });
  try {
    const first = await f.call('get_short_body_snapshot', { workId: WORK }),
      second = await f.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(first.bodySnapshot.schema, 'fanqie-short-native-body-snapshot/v1');
    assert.equal(first.bodySnapshot.bodyIncluded, true);
    assert.equal(first.bodySnapshot.verifiedLive, false);
    assert.notEqual(first.bodySnapshot.sourceRef, second.bodySnapshot.sourceRef);
    assert.notEqual(first.job.id, second.job.id);
    assert.equal(f.counters.readCalls, 2);
    assert.deepEqual(first.bodySnapshot.paragraphs[0], {
      sourceIndex: 0,
      lines: ['PRIVATE_BODY甲'],
    });
    for (const row of first.bodySnapshot.paragraphs)
      assert.deepEqual(Object.keys(row).sort(), ['lines', 'sourceIndex']);
    checkPhysical(f, first.job.id);
    checkPhysical(f, second.job.id);
    const ordinary = await f.call('get_job', { jobId: first.job.id });
    noPrivate(ordinary);
    assert.equal(Object.hasOwn(ordinary, 'bodySnapshot'), false);
    noPrivate(await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    noPrivate(await f.app.dispatch('GET', '/api/v1/history', new URLSearchParams(), undefined));
    f.nextPartial();
    const partial = await f.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(partial.job.status, 'failed');
    assert.equal(Object.hasOwn(partial, 'bodySnapshot'), false);
    noPrivate(partial);
    for (const mutate of [
      (raw: any) => {
        raw.snapshot!.binding.account.id = '9002';
      },
      (raw: any) => {
        raw.cleanup.pendingAtEnd = 1;
      },
      (raw: any) => {
        raw.proof.proofCapturedAt = '2030-01-01T00:00:00.000Z';
      },
    ]) {
      f.mutateRead(mutate);
      const bad = await f.call('get_short_body_snapshot', { workId: WORK });
      assert.equal(Object.hasOwn(bad, 'bodySnapshot'), false);
      noPrivate(bad);
    }
  } finally {
    await f.close();
  }
});

test('body capabilities keep fixture and saved reads unverified without creating work', async () => {
  const f = fixture({ writes: false, withFactory: false });
  let http = createHttpServer(f.config, f.app);
  try {
    const initialCounters = f.counters,
      initialJobs = f.jobs();
    const initial = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    const bodyRead = initial.reads.filter(
      (item: any) => item.dataset === 'short_native_body_snapshot',
    );
    assert.equal(bodyRead.length, 1);
    assert.equal(bodyRead[0].verificationStatus, 'not-verified-live');
    assert.deepEqual(f.counters, initialCounters);
    assert.deepEqual(f.jobs(), initialJobs);
    let address = await http.listen();
    const observe = async () => {
      const jobs = f.jobs(),
        refs = jobs.flatMap((job) => f.refs(String(job.id))),
        counters = f.counters;
      const wire = await sdk(f);
      try {
        assert(address && typeof address === 'object');
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/capabilities`, {
          headers: { authorization: 'Bearer ' + TOKEN },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const rest = await response.json();
        const protocol = await wire.client.callTool({
          name: 'fanqie_get_capabilities',
          arguments: {},
        });
        assert.notEqual(protocol.isError, true);
        assert(protocol.structuredContent);
        assert.equal(protocol.content.length, 1);
        const text = protocol.content[0]!;
        assert(text.type === 'text');
        assert.deepEqual(JSON.parse(text.text), rest);
        assert.deepEqual((protocol.structuredContent as any).result, rest);
        assert.deepEqual(rest, initial);
        noPrivate(protocol);
        noPrivate(rest);
        assert.deepEqual(f.jobs(), jobs);
        assert.deepEqual(
          jobs.flatMap((job) => f.refs(String(job.id))),
          refs,
        );
        assert.deepEqual(f.counters, counters);
      } finally {
        await wire.close();
      }
    };
    await observe();
    for (const input of [
      { workId: WORK },
      { workId: WORK, snapshotScope: 'short-native-trial/v1' },
    ]) {
      const read = await f.call('get_short_metadata_snapshot', input);
      assert.equal(read.job.status, 'succeeded');
      await observe();
    }
    const read = await f.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(read.job.status, 'succeeded');
    assert.equal(read.bodySnapshot.verifiedLive, false);
    await observe();
    const originalMetadata = f.jobs().find((job) => job.id === read.job.id)!.metadata_json;
    assert.equal(typeof originalMetadata, 'string');
    f.dbMutate((db) =>
      db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
        JSON.stringify({
          ...JSON.parse(String(originalMetadata)),
          shortDraftDirectorySchema: 'short-draft-directory-job/v1',
        }),
        read.job.id,
      ),
    );
    await observe();
    f.dbMutate((db) =>
      db
        .prepare('UPDATE jobs SET metadata_json=? WHERE id=?')
        .run(String(originalMetadata), read.job.id),
    );
    await observe();
    await http.close();
    await f.reopen(false, OWNER, false);
    http = createHttpServer(f.config, f.app);
    address = await http.listen();
    await observe();
    const ref = f.refs(read.job.id)[0]!;
    assert(ref);
    writeFileSync(path.join(f.evidenceDirectory, String(ref.path)), '{}\n');
    await observe();
  } finally {
    await http.close();
    await f.close();
  }
});
