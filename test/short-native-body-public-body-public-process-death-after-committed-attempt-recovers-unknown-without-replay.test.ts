import test from 'node:test';

import {
  publicDeath,
  checkPhysical,
  noPrivate,
  sdk,
} from './helpers/short-native-body-public-check-physical.js';

import { fixture } from './helpers/short-native-body-public-fixture.js';

import assert from 'node:assert/strict';

import { rmSync, writeFileSync } from 'node:fs';

import { edit, DESIRED, OWNER, TOKEN, WORK } from './helpers/short-native-body-public-account.js';

import {
  NATIVE_SHORT_BODY_DATASETS,
  nativeShortBodyReconciliationScope,
} from '../src/platform/short-native-body-proof.js';

import path from 'node:path';

import { createHttpServer } from '../src/transport/http.js';

test('body public process death after committed attempt recovers unknown without replay', async () => {
  const died = await publicDeath('death-attempt'),
    f = fixture({ dir: died.dir, keep: true });
  try {
    assert.equal(died.receipt.posts, 0);
    const original = f.jobs()[0]!;
    assert.equal(original.status, 'uncertain');
    assert.notEqual(original.write_started_at, null);
    assert.equal(f.attempts(String(original.id)).length, 1);
    checkPhysical(f, String(original.id));
    const counters = f.counters,
      saved = await f.call('get_job', { jobId: original.id });
    assert.equal(saved.job.status, 'uncertain');
    assert.deepEqual(f.counters, counters);
    const resolved = await f.call('reconcile_write', { jobId: original.id });
    assert.equal(resolved.settlement.reason, 'not_applied');
    assert.equal(f.counters.posts, 0);
  } finally {
    await f.close();
    rmSync(died.dir, { recursive: true, force: true });
  }
});

test('body public process death after POST ACK and before completion reopens safely', async () => {
  const died = await publicDeath('death-ack'),
    f = fixture({ dir: died.dir, keep: true });
  try {
    assert.equal(died.receipt.posts, 1);
    f.setCurrent({ ...edit(DESIRED), latest_version: 8, modify_time: '1789450001' });
    const original = f.jobs()[0]!;
    assert.equal(original.status, 'uncertain');
    assert.equal(f.attempts(String(original.id)).length, 1);
    assert(
      f
        .refs(String(original.id))
        .some((ref) => ref.dataset === NATIVE_SHORT_BODY_DATASETS.acknowledgement),
    );
    const result = await f.call('reconcile_write', { jobId: original.id });
    assert.equal(result.settlement.status, 'succeeded');
    assert.equal(f.counters.posts, 0);
    await f.reopen(false);
    const counters = f.counters;
    const saved = await f.call('reconcile_write', { jobId: original.id });
    assert.equal(saved.reconciliation.retrievalMode, 'saved');
    assert.deepEqual(f.counters, counters);
    noPrivate(saved);
  } finally {
    await f.close();
    rmSync(died.dir, { recursive: true, force: true });
  }
});

test('body public broken physical closure SQL and mixed namespace fail closed everywhere', async () => {
  for (const tamper of [
    'physical',
    'closure-json',
    'job-json',
    'mixed-schema',
    'current',
  ] as const) {
    const f = fixture({ mode: 'ack-lost' }),
      wire = await sdk(f);
    try {
      const original = await f.call('update_short_body', f.request()),
        closure = await f.call('reconcile_write', { jobId: original.job.id });
      if (tamper === 'physical') {
        const ref = f.refs(closure.reconciliation.job.id)[0]!;
        writeFileSync(path.join(f.evidenceDirectory, String(ref.path)), '{}\n');
      }
      if (tamper === 'closure-json')
        f.dbMutate((db) => {
          db.prepare('UPDATE write_reconciliations SET result_json=? WHERE original_job_id=?').run(
            '{bad-json',
            original.job.id,
          );
        });
      if (tamper === 'job-json')
        f.dbMutate((db) => {
          db.prepare('UPDATE jobs SET result_json=? WHERE id=?').run('{bad-json', original.job.id);
        });
      if (tamper === 'mixed-schema')
        f.dbMutate((db) => {
          db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
            JSON.stringify({ schema: 'native-short-cover-future/v99', raw: 'PRIVATE_BODY' }),
            original.job.id,
          );
        });
      if (tamper === 'current') {
        const scope = nativeShortBodyReconciliationScope(original.job.id),
          dangling = '11111111-1111-4111-8111-111111111111';
        f.dbMutate((db) => {
          db.exec('PRAGMA foreign_keys = OFF');
          try {
            assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 0);
            assert.equal(
              db.prepare('SELECT id FROM manifests WHERE id=?').get(dangling),
              undefined,
            );
            const changed = db
              .prepare('UPDATE current_manifests SET manifest_id=? WHERE account_id=? AND scope=?')
              .run(dangling, OWNER, scope);
            assert.equal(Number(changed.changes), 1);
          } finally {
            db.exec('PRAGMA foreign_keys = ON');
          }
          assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
        });
        const current = f.dbRead((db) =>
          db
            .prepare(
              'SELECT c.manifest_id,m.id AS existing_manifest_id FROM current_manifests c LEFT JOIN manifests m ON m.id=c.manifest_id WHERE c.account_id=? AND c.scope=?',
            )
            .get(OWNER, scope),
        );
        assert(current);
        assert.equal(current.manifest_id, dangling);
        assert.equal(current.existing_manifest_id, null);
      }
      for (const query of [
        () => f.call('get_job', { jobId: original.job.id }),
        () => f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
        () => f.app.dispatch('GET', '/api/v1/history', new URLSearchParams(), undefined),
        () =>
          f.app.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope: nativeShortBodyReconciliationScope(original.job.id) }),
            undefined,
          ),
        () => f.call('reconcile_write', { jobId: original.job.id }),
      ]) {
        try {
          noPrivate(await query());
        } catch (error) {
          assert(['capability_unavailable', 'invalid_input'].includes(String((error as any).code)));
          assert.equal(String((error as any).message).includes('PRIVATE'), false);
        }
      }
      const protocol = await wire.client.callTool({
        name: 'fanqie_get_job',
        arguments: { jobId: original.job.id },
      });
      noPrivate(protocol);
      try {
        noPrivate(
          await f.app.tools
            .find((item) => item.name === 'fanqie_get_job')!
            .run({ jobId: original.job.id }),
        );
      } catch (error) {
        assert.equal((error as any).code, 'capability_unavailable');
      }
      assert.equal(f.counters.posts, 1);
    } finally {
      await wire.close();
      await f.close();
    }
  }
});

test('body public SDK REST and reopened saved DTOs share task evidence', async () => {
  const f = fixture(),
    wire = await sdk(f),
    http = createHttpServer(f.config, f.app);
  let httpClosed = false;
  try {
    const sdkSaved = await wire.call('update_short_body', f.request()),
      address = await http.listen();
    assert(address && typeof address === 'object');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/tools/fanqie_update_short_body`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(f.request()),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const rest = (await response.json()) as any;
    assert.equal(rest.job.id, sdkSaved.job.id);
    assert.deepEqual(rest.evidence, sdkSaved.evidence);
    assert.deepEqual(rest.data, sdkSaved.data);
    noPrivate(rest);
    await http.close();
    httpClosed = true;
    await f.reopen(false);
    const counters = f.counters,
      reopened = await f.call('get_job', { jobId: sdkSaved.job.id });
    assert.equal(reopened.retrievalMode, 'saved');
    assert.deepEqual(reopened.evidence, sdkSaved.evidence);
    assert.deepEqual(reopened.data, sdkSaved.data);
    assert.deepEqual(f.counters, counters);
    noPrivate(reopened);
    const read = await f.call('get_short_body_snapshot', { workId: WORK });
    assert.equal(read.bodySnapshot.paragraphs[0].lines[0], 'PRIVATE_BODY修改');
    const { bodySnapshot, ...bodyFree } = read;
    noPrivate(bodyFree);
    assert.equal(bodySnapshot.bodyIncluded, true);
  } finally {
    await wire.close();
    if (!httpClosed) await http.close();
    await f.close();
  }
});
