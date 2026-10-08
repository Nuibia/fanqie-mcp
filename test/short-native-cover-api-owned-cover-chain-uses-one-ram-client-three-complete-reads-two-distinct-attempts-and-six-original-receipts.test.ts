import test from 'node:test';

import { fixture, failed } from './helpers/short-native-cover-api-fixture.js';

import assert from 'node:assert/strict';

import {
  beforeSnapshot,
  edit,
  business,
  UPLOAD,
  JPEG,
  receiptCallbacks,
  type Stage,
  asset,
} from './helpers/short-native-cover-api-deferred.js';

import {
  captureNativeShortCoverWriteRequest,
  type NativeShortCoverReceipt,
  type NativeShortCoverReceiptFields,
} from '../src/platform/short-native-cover-api.js';

import { setImmediate as turn } from 'node:timers/promises';

test('owned cover chain uses one RAM client, three complete reads, two distinct attempts and six original receipts', async () => {
  const f = fixture(),
    result = await f.run.run();
  assert.equal(result.status, 'success');
  assert.equal(result.reason, null);
  assert.equal(f.clientCreates, 1);
  assert.equal(f.clientDisposes, 1);
  assert.equal(f.calls.filter((call) => call.method === 'GET').length, 15);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 2);
  assert.deepEqual(
    f.events.filter((event) => event.includes(':')),
    [
      'upload:intent',
      'upload:attempt',
      'POST:upload',
      'upload:acknowledgement',
      'save:intent',
      'save:attempt',
      'POST:save',
      'save:acknowledgement',
    ],
  );
  assert.equal(f.events.filter((event) => event === 'read-boundary').length, 1);
  assert.equal(f.callbacks.receipts.length, 6);
  assert.equal(new Set(f.callbacks.receipts.map((receipt) => receipt.schema)).size, 6);
  for (const receipt of f.callbacks.receipts) {
    assert(Object.isFrozen(receipt));
    assert(Object.isFrozen(receipt.evidence));
    assert.equal(receipt.sourceVersionHash, beforeSnapshot().snapshotVersionHash);
  }
  for (const phase of Object.values(result.phases)) {
    assert.equal(phase.proof.fixedSourceVerified, true);
    assert.equal(phase.requests.own.attempts, 2);
    assert.equal(phase.requests.own.disposed, 2);
    assert(phase.proof.proofCapturedAt);
  }
  assert.equal(result.upload.outcome, 'acknowledged');
  assert.equal(result.save.outcome, 'verified');
  assert.equal(result.upload.post.attempts, 1);
  assert.equal(result.save.post.attempts, 1);
  assert.equal(result.upload.post.disposed, 1);
  assert.equal(result.save.post.disposed, 1);
  assert.equal(result.desiredContentHash, result.observedContentHash);
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.snapshot?.savedFields.content, edit().content);
  assert.equal(result.snapshot?.savedFields.thumb_uri, edit().thumb_uri);
  assert(f.events.indexOf('dispose-done') < f.events.indexOf('owner-callback'));
  assert.equal(f.ownerCallbacks, 1);
  assert.equal(f.quarantines, 0);
  assert(Object.isFrozen(result));
  assert.equal(result.cleanup.sessionDisposed, true);
  for (const call of f.calls) {
    assert.equal(call.options.maxRedirects, 0);
    assert.equal(call.options.maxRetries, 0);
  }
  assert.deepEqual(Object.keys(f.capturedStorage as object), ['storageState']);
});

test('narrow descriptor capture rejects side channels/getters and constructor aliases cannot mutate the run', async () => {
  const valid = business();
  let getters = 0;
  for (const input of [
    { ...valid, uploadDir: '/secret-path' },
    { ...valid, url: UPLOAD },
    { ...valid, cover: { ...valid.cover, bytes: JPEG } },
    { ...valid, cover: { ...valid.cover, uploadPath: '../outside.jpg' } },
    {
      ...valid,
      cover: {
        ...valid.cover,
        fit: {
          toString() {
            getters++;
            return 'cover';
          },
        },
      },
    },
    {
      ...valid,
      get cover() {
        getters++;
        return valid.cover;
      },
    },
  ])
    assert.equal(captureNativeShortCoverWriteRequest(input), null);
  assert.equal(getters, 0);
  const f = fixture({ hold: 'image' }),
    running = f.run.run();
  await f.entered;
  f.options.expectedOwner.id = '9999';
  f.options.businessRequest.cover.uploadPath = '../outside.jpg';
  f.options.onDurableIntent = () => {
    throw Error('secret-mutated-callback');
  };
  f.release();
  assert.equal((await running).status, 'success');
});

test('phase brands reject cloned, swapped, duplicate, wrong binding and future reference receipts before the next POST', async (t) => {
  const cases: Array<{ name: string; mutate: Parameters<typeof receiptCallbacks>[1] }> = [
    {
      name: 'clone',
      mutate: (key, fields, confirm) =>
        key === 'upload:intent' ? structuredClone(confirm(fields)) : confirm(fields),
    },
    {
      name: 'wrong phase',
      mutate: (key, fields, confirm) =>
        confirm(key === 'upload:intent' ? { ...fields, phase: 'save' } : fields),
    },
    {
      name: 'duplicate mint',
      mutate: (key, fields, confirm) => {
        const receipt = confirm(fields);
        if (key === 'upload:intent') confirm(fields);
        return receipt;
      },
    },
    {
      name: 'wrong typed binding',
      mutate: (key, fields, confirm) =>
        confirm(
          key === 'upload:intent'
            ? {
                ...fields,
                binding: { ...fields.binding, account: { kind: 'account_id', id: '9999' } },
              }
            : fields,
        ),
    },
    {
      name: 'future ref',
      mutate: (key, fields, confirm) =>
        confirm(
          key === 'upload:intent'
            ? {
                ...fields,
                evidence: { ...fields.evidence, capturedAt: '2099-01-01T00:00:00.000Z' },
              }
            : fields,
        ),
    },
    {
      name: 'save cannot return upload receipt',
      mutate: (() => {
        let upload: NativeShortCoverReceipt;
        return (
          key: Stage,
          fields: NativeShortCoverReceiptFields,
          confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
        ) => {
          const receipt = confirm(fields);
          if (key === 'upload:intent') upload = receipt;
          return key === 'save:intent' ? upload : receipt;
        };
      })(),
    },
  ];
  for (const value of cases)
    await t.test(value.name, async () => {
      const f = fixture({ transform: value.mutate }),
        result = await f.run.run();
      failed(result, 'durability_unverified');
      assert.equal(result.save.post.attempts, 0);
      assert.equal(result.upload.post.attempts, value.name.startsWith('save') ? 1 : 0);
      assert.equal(f.clientDisposes, 1);
    });
});

test('preSave full-source drift preserves upload ACK and performs no save; POST ACK loss is never retried', async () => {
  const drift = fixture({ drift: true }),
    d = await drift.run.run();
  failed(d, 'version_conflict');
  assert.equal(d.upload.outcome, 'acknowledged');
  assert(d.upload.acknowledgementReceipt);
  assert(d.snapshots.preSave);
  assert.equal(d.save.post.attempts, 0);
  for (const phase of ['upload', 'save'] as const) {
    const f = fixture({ loseAck: phase }),
      result = await f.run.run();
    failed(result, 'response_unavailable');
    assert.equal(result[phase].outcome, 'unknown');
    assert.equal(result[phase].post.attempts, 1);
    assert.equal(result[phase].post.acknowledged, false);
    assert.equal(result.save.post.attempts, phase === 'save' ? 1 : 0);
    assert.equal(f.clientDisposes, 1);
    if (phase === 'save') assert(result.upload.acknowledgementReceipt);
  }
});

test('publication changes veto cover upload/save and leave independent ACK events intact after readback fails', async () => {
  for (const nonDraftRead of [1, 2, 3] as const) {
    const f = fixture({ nonDraftRead }),
      result = await f.run.run();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(f.clientDisposes, 1);
    assert.equal(result.upload.post.attempts, nonDraftRead === 1 ? 0 : 1);
    assert.equal(result.save.post.attempts, nonDraftRead === 3 ? 1 : 0);
    const observed =
      result.snapshots[nonDraftRead === 1 ? 'before' : nonDraftRead === 2 ? 'preSave' : 'after'];
    assert.equal(observed?.state, 'distribution_stopped');
    assert.equal(observed?.statusFacts.draftEditable, false);
    if (nonDraftRead > 1) {
      assert(result.upload.acknowledgementReceipt);
      assert.equal(result.upload.post.acknowledged, true);
    }
    if (nonDraftRead === 3) {
      assert(result.save.acknowledgementReceipt);
      assert.equal(result.save.post.acknowledged, true);
      assert.equal(result.comparison?.reason, 'state_not_draft');
    }
  }
});

test('upload envelope URL/code/UTF8/URI faults stop before save and keep independent counters', async (t) => {
  for (const responseFault of ['url', 'code', 'utf8', 'uri'] as const)
    await t.test(responseFault, async () => {
      const f = fixture({ responseFault }),
        result = await f.run.run();
      failed(result, 'response_unverified');
      assert.equal(result.upload.post.attempts, 1);
      assert.equal(result.upload.post.disposed, 1);
      assert.equal(result.save.post.attempts, 0);
    });
});

test('image/response/client disposal failures quarantine; verified ACK observations survive failed cleanup', async (t) => {
  for (const failDispose of ['image', 'response', 'api'] as const)
    await t.test(failDispose, async () => {
      const f = fixture({ failDispose }),
        result = await f.run.run();
      failed(result, 'cleanup_failed');
      assert.equal(f.quarantines, 1);
      assert.equal(result.cleanup.quarantined, true);
      if (failDispose === 'response') {
        assert(result.upload.observation);
        assert.equal(result.upload.post.acknowledged, true);
        assert.equal(result.save.post.attempts, 0);
      }
      if (failDispose === 'image') {
        assert.equal(f.clientCreates, 0);
        assert.equal(f.cookieReads, 0);
      }
    });
});

test('cancellation retains late image/client/POST/dispose ownership until actual drain', async (t) => {
  for (const hold of ['image', 'creation', 'upload', 'dispose'] as const)
    await t.test(hold, async () => {
      const f = fixture({ hold });
      let settled = false;
      const running = f.run.run().then((result) => {
        settled = true;
        return result;
      });
      await f.entered;
      f.controller.abort();
      await turn();
      assert.equal(settled, false);
      f.release();
      const result = await running;
      failed(result, 'cancelled');
      assert.equal(f.clientDisposes, hold === 'image' ? 0 : 1);
      assert.equal(f.ownerCallbacks, 0);
      assert.equal(result.cleanup.pendingAtEnd, 0);
    });
});

test('owner/read and final callback lease changes veto writes or success; prepared bytes are rehashed and copied', async () => {
  const other = fixture({ ownerChanged: true });
  failed(await other.run.run(), 'owner_changed');
  assert.equal(other.calls.filter((call) => call.method === 'POST').length, 0);
  let revoked = false;
  const final = fixture({
    lease: () => {
      if (revoked) throw Error('secret-lease');
    },
    onVerified: () => {
      revoked = true;
    },
  });
  failed(await final.run.run(), 'lease_unavailable');
  assert.equal(final.clientDisposes, 1);
  const wrong = fixture({
    prepared: { asset: { ...asset(), preparedSha256: '0'.repeat(64) }, bytes: Buffer.from(JPEG) },
  });
  failed(await wrong.run.run(), 'image_unavailable');
  assert.equal(wrong.clientCreates, 0);
  const original = Buffer.from(JPEG),
    f = fixture({
      prepared: { asset: asset(original), bytes: original },
      transform: (key, fields, confirm) => {
        if (key === 'upload:intent') original.fill(255);
        return confirm(fields);
      },
    });
  assert.equal((await f.run.run()).status, 'success'); // transport receives the private copy, not the altered preparer alias.
});
