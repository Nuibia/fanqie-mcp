import test from 'node:test';

import { fixture, preissuedBody, unavailable, lost } from './helpers/public-read-coordinator.js';

import assert from 'node:assert/strict';

test('public-read preissued body authority/factory and late descendants cannot change an attempt or acquire transport', async () => {
  const f = fixture();
  try {
    const held = preissuedBody(f),
      before = f.ledger();
    const calls = [
      () => held.binding.check(),
      () => held.binding.beforeGet(),
      () => held.binding.beginAttempt({} as any),
      () => held.binding.consumeAttempt({} as any),
      () => held.binding.readCommittedAttempt(),
      () => held.binding.recordAcknowledgement({} as any),
      () => held.binding.recordResult({} as any),
      () =>
        f.store.issueNativeShortBodyWriteAuthority(held.job.id, 'owner', held.business, '001001'),
    ];
    for (const call of calls) {
      assert.throws(
        () =>
          f.store.withPublicProjectionRead('owner', 'jobs', () => {
            try {
              call();
            } catch (error) {
              assert(unavailable(error));
            }
            return {};
          }),
        unavailable,
      );
      assert.deepEqual(f.ledger(), before);
    }
    let late: unknown[] = [];
    assert.throws(
      () =>
        f.store.withPublicProjectionRead('owner', 'jobs', () => {
          queueMicrotask(() => {
            for (const call of [
              () => f.store.saveEvidence(held.job.id, 'synthetic', {}),
              () => held.binding.beforeGet(),
            ])
              try {
                call();
              } catch (error) {
                late.push(error);
              }
          });
          return Promise.resolve({});
        }),
      unavailable,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(late.length, 2);
    assert(late.every(unavailable));
    assert.deepEqual(f.ledger(), before);
    // A public factory is captured at construction; its delegate must never run in scope.
    assert.throws(
      () =>
        f.store.withPublicProjectionRead('owner', 'jobs', () => {
          void held.binding.requestFactory.newContext({});
          return {};
        }),
      unavailable,
    );
    assert.deepEqual(f.ledger(), before);
  } finally {
    f.close();
  }
});

test('public-read Store permanent lease loss is sticky, revokes the transaction and preserves successor rows', () => {
  const f = fixture();
  let notifications = 0;
  try {
    f.store.onServiceLeaseLost(() => notifications++);
    assert.throws(
      () =>
        f.store.withPublicProjectionRead('owner', 'jobs', () => {
          f.store.getJob(f.job.id, 'owner');
          f.db
            .prepare('UPDATE service_lease SET owner_id=?,expires_at=? WHERE id=1')
            .run('synthetic-successor', Date.now() + 60_000);
          return { cannotBeCertified: true };
        }),
      lost,
    );
    assert.throws(() => f.store.assertLeaseOwnership(), lost);
    f.store.close();
    assert.equal(
      f.db.prepare('SELECT owner_id FROM service_lease WHERE id=1').get()!.owner_id,
      'synthetic-successor',
    );
    assert.equal(notifications, 0); // once notification remains queued outside the synchronous operation
  } finally {
    f.close();
  }
});
