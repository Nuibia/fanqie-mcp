import test from 'node:test';

import { fixture } from './helpers/short-native-body-public-fixture.js';

import {
  sdk,
  noPrivate,
  checkPhysical,
} from './helpers/short-native-body-public-check-physical.js';

import assert from 'node:assert/strict';

import { NATIVE_SHORT_BODY_DATASETS } from '../src/platform/short-native-body-proof.js';

import { edit, WORK, DESIRED } from './helpers/short-native-body-public-account.js';

test('body public SDK save creates one real SQL attempt and seven-stage graph', async () => {
  const f = fixture(),
    wire = await sdk(f);
  try {
    const saved = await wire.call('update_short_body', f.request());
    assert.equal(saved.job.status, 'succeeded');
    assert.equal(saved.data[0].durable, true);
    assert.equal(saved.data[0].verifiedLive, false);
    noPrivate(saved);
    const refs = f.refs(saved.job.id);
    assert.deepEqual(
      refs.map((ref) => ref.dataset),
      [
        NATIVE_SHORT_BODY_DATASETS.baseline,
        NATIVE_SHORT_BODY_DATASETS.preSave,
        'write-intent',
        NATIVE_SHORT_BODY_DATASETS.attempt,
        NATIVE_SHORT_BODY_DATASETS.acknowledgement,
        NATIVE_SHORT_BODY_DATASETS.after,
        'write-result',
      ],
    );
    checkPhysical(f, saved.job.id);
    const row = f.jobs()[0]!,
      attempts = f.attempts(saved.job.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.ordinal, 1);
    assert.equal(attempts[0]!.event_at, row.write_started_at);
    assert.equal(f.counters.posts, 1);
    assert.equal(f.counters.gets, 15);
    assert.equal(f.counters.contexts, 1);
    assert.equal(f.counters.disposals, 1);
    assert.equal(f.counters.forbidden, 0);
  } finally {
    await wire.close();
    await f.close();
  }
});

test('body public exact no change has zero effect and safe replay', async () => {
  const f = fixture(),
    wire = await sdk(f);
  try {
    const value = await wire.call('update_short_body', f.request(true));
    assert.equal(value.job.status, 'succeeded');
    assert.equal(value.data[0].reason, 'no_change');
    assert.equal(value.data[0].verifiedLive, false);
    assert.equal(f.jobs()[0]!.write_started_at, null);
    assert.equal(f.attempts(value.job.id).length, 0);
    assert.deepEqual(
      f.refs(value.job.id).map((ref) => ref.dataset),
      [NATIVE_SHORT_BODY_DATASETS.baseline, 'write-result'],
    );
    assert.equal(f.counters.posts, 0);
    assert.equal(f.counters.gets, 5);
    const counters = f.counters,
      again = await wire.call('update_short_body', f.request(true));
    assert.equal(again.job.id, value.job.id);
    assert.equal(again.retrievalMode, 'saved');
    assert.deepEqual(f.counters, counters);
    noPrivate(again);
  } finally {
    await wire.close();
    await f.close();
  }
});

test('body public one key replays saved and changed input conflicts before owned access', async () => {
  for (const mode of ['success', 'ack-lost'] as const) {
    const f = fixture({ mode });
    try {
      const initial = await f.call('update_short_body', f.request()),
        counters = f.counters;
      assert.equal((await f.call('update_short_body', f.request())).job.id, initial.job.id);
      for (const changed of [
        { ...f.request(), paragraphs: [{ sourceIndex: null, lines: ['Different'] }] },
        { ...f.request(), expectedSnapshotVersionHash: 'f'.repeat(64) },
        { ...f.request(), trial: { action: 'preserve' } },
        { ...f.request(), target: { kind: 'short', workId: '8000000001' } },
      ])
        await assert.rejects(f.call('update_short_body', changed), {
          code: 'idempotency_conflict',
        });
      assert.deepEqual(f.counters, counters);
      assert.equal(f.jobs().length, 1);
    } finally {
      await f.close();
    }
  }
});

test('body public same account serializes while independent accounts isolate', async () => {
  const f = fixture(),
    g = fixture({ owner: 'independent-public-owner' });
  const a = await sdk(f),
    b = await sdk(f),
    c = await sdk(g);
  try {
    const [one, two, other] = await Promise.all([
      a.call('update_short_body', f.request()),
      b.call('update_short_body', f.request(false, 'another-public-body-key')),
      c.call('update_short_body', g.request()),
    ]);
    assert.equal(one.job.status, 'succeeded');
    assert.equal(two.job.status, 'failed');
    assert.equal(two.data[0].reason, 'version_conflict');
    assert.equal(f.attempts(two.job.id).length, 0);
    assert.equal(f.jobs()[1]!.write_started_at, null);
    assert.deepEqual(
      f.refs(two.job.id).map((ref) => ref.dataset),
      [NATIVE_SHORT_BODY_DATASETS.baseline, 'write-result'],
    );
    noPrivate(two);
    assert.equal(other.job.status, 'succeeded');
    assert.equal(f.counters.peak, 1);
    assert.equal(f.counters.posts, 1);
    assert.equal(g.counters.posts, 1);
    assert.notEqual(one.job.id, other.job.id);
    assert(String(f.jobs()[1]!.started_at) >= String(f.jobs()[0]!.ended_at));
    await assert.rejects(g.call('get_job', { jobId: one.job.id }), { code: 'not_found' });
    await f.reopen(false, 'foreign-public-owner');
    await assert.rejects(f.call('get_job', { jobId: one.job.id }), { code: 'not_found' });
    assert.deepEqual(
      ((await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any).jobs,
      [],
    );
  } finally {
    await a.close();
    await b.close();
    await c.close();
    await f.close();
    await g.close();
  }
});

test('body public full vector preserves trial anchor and all metadata', async () => {
  const first = '&lt;&amp;' + '甲'.repeat(90),
    tail = '丙'.repeat(150),
    second = '乙'.repeat(60);
  const marker = `<div class="" data-para-nums="3" data-min-radio="0.3" data-min-paragraphs="3" data-min-text="200" data-fanqie-type="pay_tag" data-percentage="${String(92 / 302)}"></div>`;
  const changedMarker = `<div data-percentage="${String(92 / 303)}" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class=""></div>`;
  const plain = `<p>${first}</p><p>${second}</p><p>${tail}</p><p></p>`;
  for (const action of ['preserve', 'clear', 'set'] as const) {
    const source =
      action === 'set' ? plain : `<p>${first}</p>${marker}<p>${second}</p><p>${tail}</p><p></p>`;
    const canonicalSet = `<div data-percentage="${String(92 / 303)}" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class="fq-pay-node-animation"></div>`;
    const expected = `<p>${first}</p>${action === 'clear' ? '' : action === 'set' ? canonicalSet : changedMarker}<p>${second}丁</p><p>${tail}</p><p></p>`;
    const f = fixture({ source, expectedHtml: expected });
    try {
      const request = {
        ...f.request(),
        paragraphs: [
          { sourceIndex: 0, lines: ['<&' + '甲'.repeat(90)] },
          { sourceIndex: 1, lines: [second + '丁'] },
          { sourceIndex: 2, lines: [tail] },
        ],
        trial: action === 'set' ? { action, beforeParagraph: 1 } : { action },
      };
      const saved = await f.call('update_short_body', request);
      assert.equal(saved.job.status, 'succeeded');
      assert.equal(f.current.content, expected);
      const expectedFields = {
        ...edit(source),
        content: expected,
        latest_version: 8,
        modify_time: '1789450001',
      };
      assert.deepEqual(f.current, expectedFields);
      const read = await f.call('get_short_body_snapshot', { workId: WORK });
      assert.equal(read.bodySnapshot.marker.boundary, action === 'clear' ? null : 1);
      assert.equal(read.bodySnapshot.marker.markerCount, action === 'clear' ? 0 : 1);
      assert.equal(f.counters.posts, 1);
      noPrivate(saved);
    } finally {
      await f.close();
    }
  }
});

test('body public preSave version owner and lease drift deny POST', async () => {
  for (const mode of [
    'pre-save-drift',
    'version-drift',
    'owner-drift',
    'lease-drift',
    'cancel',
  ] as const) {
    const f = fixture({ mode });
    try {
      const response = await f
        .call('update_short_body', f.request())
        .catch((error: any) => ({ job: { status: 'failed' }, error }));
      assert.notEqual(response.job.status, 'succeeded');
      assert.equal(f.counters.posts, 0);
      assert.equal(f.attempts(String(f.jobs()[0]!.id)).length, 0);
      assert.equal(f.jobs()[0]!.write_started_at, null);
      if (!response.error) noPrivate(response);
    } finally {
      if (mode === 'lease-drift')
        f.dbMutate((db) => {
          const owner = f.jobs()[0]!.owner_id;
          assert.ok(typeof owner === 'string');
          db.prepare('UPDATE service_lease SET owner_id=? WHERE id=1').run(owner);
        });
      await f.close();
    }
  }
});

test('body public ACK loss cannot upgrade matching same-run after', async () => {
  for (const mode of ['ack-lost', 'ack-contradiction'] as const) {
    const f = fixture({ mode }),
      wire = await sdk(f);
    try {
      const response = await wire.call('update_short_body', f.request());
      assert.equal(response.job.status, 'uncertain');
      assert.equal(f.counters.posts, 1);
      assert.equal(f.attempts(response.job.id).length, 1);
      assert.equal(f.current.content, DESIRED);
      assert.equal(response.data[0].verifiedLive, false);
      const before = f.jobs()[0]!,
        refs = f.refs(response.job.id);
      await f.call('get_job', { jobId: response.job.id });
      assert.equal(f.jobs()[0]!.error_json, before.error_json);
      assert.deepEqual(f.refs(response.job.id), refs);
      noPrivate(response);
    } finally {
      await wire.close();
      await f.close();
    }
  }
});

test('body public uncertain reconciliation is GET only with writes disabled', async () => {
  const f = fixture({ mode: 'ack-lost' });
  try {
    const original = await f.call('update_short_body', f.request()),
      before = f.jobs()[0]!,
      refs = f.refs(original.job.id);
    await f.reopen(false);
    f.nextPartial();
    const partial = await f.call('reconcile_write', { jobId: original.job.id });
    assert.equal(partial.settlement.status, 'uncertain');
    assert.equal(partial.reconciliation.job.status, 'succeeded');
    assert.equal(partial.reconciliation.sourceMode, 'incomplete');
    assert.equal(partial.reconciliation.data[0].verifiedLive, false);
    noPrivate(partial);
    const matching = await f.call('reconcile_write', { jobId: original.job.id });
    assert.equal(matching.settlement.status, 'succeeded');
    assert.equal(f.counters.posts, 1);
    assert.equal(f.attempts(original.job.id).length, 1);
    assert.deepEqual(f.refs(original.job.id), refs);
    const later = f.jobs().filter((row) => row.kind === 'read');
    assert.equal(later.length, 2);
    assert(String(later[0]!.requested_at) > String(before.ended_at));
    assert.equal(
      f.dbRead(
        (db) =>
          db
            .prepare('SELECT count(*) AS n FROM write_reconciliations WHERE original_job_id=?')
            .get(original.job.id)!.n,
      ),
      2,
    );
    await f.reopen(false);
    const counters = f.counters,
      saved = await f.call('reconcile_write', { jobId: original.job.id });
    assert.equal(saved.reconciliation.retrievalMode, 'saved');
    assert.deepEqual(f.counters, counters);
    noPrivate(saved);
  } finally {
    await f.close();
  }
});

test('body public untouched later read settles not applied but revision drift stays unknown', async () => {
  for (const drift of [false, true]) {
    const f = fixture({ mode: 'ack-lost' });
    try {
      const original = await f.call('update_short_body', f.request());
      f.setCurrent(drift ? { ...edit(), latest_version: 9 } : edit());
      const observed = await f.call('reconcile_write', { jobId: original.job.id });
      assert.equal(observed.settlement.status, drift ? 'uncertain' : 'failed');
      if (!drift) assert.equal(observed.settlement.reason, 'not_applied');
      assert.equal(f.counters.posts, 1);
      noPrivate(observed);
    } finally {
      await f.close();
    }
  }
});
