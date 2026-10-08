import test from 'node:test';

import {
  type NativeShortTrialReceiptFields,
  type NativeShortTrialReceipt,
} from '../src/platform/short-native-trial-api.js';

import { fixture, unavailable } from './helpers/short-native-trial-api-fixture.js';

import assert from 'node:assert/strict';

test('duplicate acknowledgement confirmation and an escaped ACK callback cannot create a second receipt or second POST', async () => {
  let escapedConfirm:
    ((fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt) | undefined;
  let escapedFields: NativeShortTrialReceiptFields | undefined;
  const duplicate = fixture({
    transform(stage, fields, confirm) {
      const receipt = confirm(fields);
      if (stage === 'acknowledgement') confirm(fields);
      return receipt;
    },
  });
  const bad = await duplicate.run.run();
  unavailable(bad, 'durability_unverified');
  assert.equal(bad.save.post.attempts, 1);
  assert.equal(bad.save.acknowledgementReceipt, null);
  assert.equal(duplicate.events.filter((event) => event === 'acknowledgement').length, 1);
  const f = fixture({
    transform(stage, fields, confirm) {
      if (stage === 'acknowledgement') {
        escapedConfirm = confirm;
        escapedFields = fields;
      }
      return confirm(fields);
    },
  });
  const good = await f.run.run();
  assert.equal(good.status, 'success');
  assert.equal(f.receipts.filter((receipt) => receipt.stage === 'acknowledgement').length, 1);
  assert(escapedConfirm);
  assert(escapedFields);
  assert.throws(() => escapedConfirm!(escapedFields!));
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

test('mismatching or incomplete after snapshots preserve the sole attempt and ACK without fabricating verification', async () => {
  const mismatch = fixture({ mismatch: true }),
    m = await mismatch.run.run();
  unavailable(m, 'readback_mismatch');
  assert(m.save.acknowledgementReceipt);
  assert.equal(m.save.post.attempts, 1);
  assert.equal(m.save.outcome, 'acknowledged');
  assert.equal(m.comparison?.matches, false);
  const partial = fixture({ afterFault: true }),
    p = await partial.run.run();
  unavailable(p, 'response_unavailable');
  assert(p.save.acknowledgementReceipt);
  assert.equal(p.snapshots.after, null);
  assert.equal(p.phases.after.proof.fixedSourceVerified, false);
  assert.equal(p.save.post.attempts, 1);
});

test('duplicate draft IDs, owner drift and GET redirects fail fixed C1 before a save', async (t) => {
  for (const [fault, reason] of [
    ['duplicateList', 'pagination_inconsistent'],
    ['ownerChanged', 'owner_changed'],
    ['redirectGet', 'redirect_blocked'],
  ] as const)
    await t.test(fault, async () => {
      const f = fixture({ [fault]: true }),
        result = await f.run.run();
      unavailable(result, reason);
      assert.equal(result.save.post.attempts, 0);
      assert.equal(f.clientDisposes, 1);
    });
});

test('late context creation after cancellation remains owned until disposal and performs no platform GET or POST', async () => {
  const f = fixture({ hold: 'creation' }),
    running = f.run.run();
  await f.entered;
  f.controller.abort();
  f.release();
  const result = await running;
  unavailable(result, 'cancelled');
  assert.equal(f.clientCreates, 1);
  assert.equal(f.clientDisposes, 1);
  assert.equal(f.calls.length, 0);
});

test('cancellation during the unique save never retries and drains the pending response before returning', async () => {
  const f = fixture({ hold: 'post' }),
    running = f.run.run();
  await f.entered;
  f.controller.abort();
  f.release();
  const result = await running;
  unavailable(result, 'cancelled');
  assert.equal(result.save.post.attempts, 1);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(f.clientDisposes, 1);
});

test('response or client cleanup failures quarantine the owner and cannot call final verified-account callback', async (t) => {
  for (const kind of ['response', 'api'] as const)
    await t.test(kind, async () => {
      const f = fixture({ failDispose: kind }),
        result = await f.run.run();
      unavailable(result, 'cleanup_failed');
      assert.equal(result.cleanup.quarantined, true);
      assert.equal(f.quarantines, 1);
      assert.equal(f.ownerCallbacks, 0);
      assert.equal(result.save.post.attempts, 1);
    });
});

test('final owner callback cannot bypass a revoked lease after clean disposal', async () => {
  let revoked = false;
  const f = fixture({
      lease() {
        if (revoked) throw Error('private-revoked-lease');
      },
      onVerified() {
        revoked = true;
      },
    }),
    result = await f.run.run();
  unavailable(result, 'lease_unavailable');
  assert.equal(result.cleanup.sessionDisposed, true);
  assert.equal(f.ownerCallbacks, 1);
  assert.equal(result.save.outcome, 'acknowledged');
});
