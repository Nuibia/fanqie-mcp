import test from 'node:test';

import { coordinator, unavailable, lost, fixture } from './helpers/public-read-coordinator.js';

import assert from 'node:assert/strict';

import { RuntimeError } from '../src/runtime/store.js';

import { PublicReadCoordinator } from '../src/runtime/public-read.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

test('public-read SQL and file journals recheck success, empty and caught negatives; guard does not append itself', () => {
  const stable = coordinator();
  let sqlReads = 0,
    fileReads = 0;
  const sql = () => {
    sqlReads++;
    return [{ id: 'a', raw: 'exact' }];
  };
  const file = (mark: (v: unknown) => void) => {
    fileReads++;
    mark({ path: 'synthetic', sha: 'a', nlink: 1 });
    stable.scope.sql('SELECT guard-only', 'get', [], () => null);
    return { verified: true };
  };
  stable.scope.run('owner', 'jobs', () => {
    for (let i = 0; i < 3; i++) {
      stable.scope.sql('SELECT exact', 'all', [], sql);
      stable.scope.file(['owner', 'ref', 'a'], file);
    }
    return { okay: true };
  });
  assert.equal(fileReads, 2);
  assert.equal(sqlReads, 2);
  assert.equal(stable.ledger.filter((v) => v === 'commit').length, 1);
  for (const kind of [
    'membership',
    'order',
    'caught-sql-repaired',
    'caught-file-repaired',
    'file-mark',
  ] as const) {
    const f = coordinator();
    let changed = false;
    assert.throws(
      () =>
        f.scope.run('owner', 'capabilities', () => {
          if (kind === 'membership')
            f.scope.sql('SELECT empty', 'all', [], () => (changed ? [{ id: 'new' }] : []));
          else if (kind === 'order')
            f.scope.sql('SELECT ordered', 'all', [], () =>
              changed ? [{ id: 'b' }, { id: 'a' }] : [{ id: 'a' }, { id: 'b' }],
            );
          else if (kind === 'caught-sql-repaired') {
            try {
              f.scope.sql('SELECT damaged', 'get', [], () => {
                if (!changed) throw new RuntimeError('invalid_json', 'Synthetic static damage');
                return { id: 'now-valid' };
              });
            } catch {}
          } else if (kind === 'caught-file-repaired') {
            try {
              f.scope.file(['negative'], (mark) => {
                mark({ path: 'same', exists: changed });
                if (!changed) throw new RuntimeError('evidence_missing', 'Synthetic missing');
                return {};
              });
            } catch {}
          } else
            f.scope.file(['success'], (mark) => {
              mark({ sha: changed ? 'b' : 'a', nlink: 1 });
              return { valid: true };
            });
          changed = true;
          return { caught: true };
        }),
      unavailable,
    );
  }
  const negative = coordinator();
  let reads = 0;
  assert.deepEqual(
    negative.scope.run('owner', 'jobs', () => {
      try {
        negative.scope.file('static', (mark) => {
          reads++;
          mark({ exists: false });
          throw new RuntimeError('evidence_missing', 'Same static failure');
        });
      } catch {}
      return { fallback: true };
    }),
    { fallback: true },
  );
  assert.equal(reads, 2);
  for (const kind of ['sql', 'file'] as const) {
    const f = coordinator();
    let repaired = false,
      caught = false;
    const read = () => {
      if (!repaired) throw undefined;
      return {};
    };
    assert.throws(
      () =>
        f.scope.run('owner', 'jobs', () => {
          try {
            if (kind === 'sql') f.scope.sql('SELECT undefined-failure', 'get', [], read);
            else
              f.scope.file('undefined-failure', (mark) => {
                mark({ repaired });
                return read();
              });
          } catch (error) {
            caught = true;
            assert.equal(error, undefined);
          }
          repaired = true;
          return { caught };
        }),
      unavailable,
    );
    assert.equal(caught, true);
  }
});

test('public-read active/guarding mutation denial is sticky and precedes ledger; closed ALS descendants stay denied', async () => {
  const f = coordinator();
  let ledger = 0;
  assert.throws(
    () =>
      f.scope.run('owner', 'status', () => {
        try {
          f.scope.assertMutationAllowed();
          ledger++;
        } catch {}
        return {};
      }),
    unavailable,
  );
  assert.equal(ledger, 0);
  let fileReads = 0;
  assert.throws(
    () =>
      f.scope.run('owner', 'jobs', () =>
        f.scope.file('guard', (mark) => {
          mark({ stable: true });
          if (++fileReads === 2) {
            f.scope.assertMutationAllowed();
            ledger++;
          }
          return {};
        }),
      ),
    unavailable,
  );
  assert.equal(ledger, 0);
  const errors: unknown[] = [];
  assert.throws(
    () =>
      f.scope.run('owner', 'jobs', () => {
        queueMicrotask(() => {
          for (const call of [
            () => f.scope.assertReadAllowed(),
            () => f.scope.assertMutationAllowed(),
            () => f.scope.run('owner', 'status', () => ({})),
          ])
            try {
              call();
              ledger++;
            } catch (error) {
              errors.push(error);
            }
        });
        return Promise.resolve({});
      }),
    unavailable,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 3);
  assert(errors.every(unavailable));
  assert.equal(ledger, 0);
  assert.deepEqual(
    f.scope.run('owner', 'status', () => ({ next: true })),
    { next: true },
  );
});

test('public-read fatal cleanup requires real private hook loss and cannot confer writer or read authority', () => {
  const f = coordinator();
  let cleanup = 0;
  assert.throws(
    () =>
      f.scope.run('owner', 'jobs', () => {
        try {
          f.scope.runFatalCleanup(() => cleanup++);
        } catch {}
        return {};
      }),
    unavailable,
  );
  assert.equal(cleanup, 0);
  assert.throws(
    () =>
      f.scope.run('owner', 'jobs', () => {
        f.lose();
        f.scope.runFatalCleanup(() => {
          f.scope.assertLifecycleCleanupAllowed();
          cleanup++;
          assert.throws(() => f.scope.assertMutationAllowed(), lost);
          assert.throws(() => f.scope.assertReadAllowed(), lost);
        });
        return {};
      }),
    lost,
  );
  assert.equal(cleanup, 1);
  assert.equal(f.ledger.filter((v) => v === 'rollback').length, 2); // one ordinary rejection, one invalidated owner transaction
});

test('public-read rollback failure cannot mask permanent lease loss or grant cleanup to a closed descendant', async () => {
  for (const failure of [undefined, new Error('Synthetic rollback failure')]) {
    let ownershipLost = false,
      cleanup = 0,
      rollbacks = 0;
    const late: unknown[] = [];
    const scope = new PublicReadCoordinator({
      begin() {},
      commit() {},
      rollback() {
        rollbacks++;
        throw failure;
      },
      assertLease() {
        if (ownershipLost) throw new RuntimeError('service_lease_lost', 'Synthetic permanent loss');
      },
      isLeaseLost: () => ownershipLost,
      leaseLostError: () => new RuntimeError('service_lease_lost', 'Synthetic permanent loss'),
    });
    assert.throws(
      () =>
        scope.run('owner', 'status', () => {
          ownershipLost = true;
          try {
            scope.runFatalCleanup(() => cleanup++);
          } catch {}
          assert.throws(() => scope.assertMutationAllowed(), lost);
          queueMicrotask(() => {
            for (const call of [
              () => scope.assertReadAllowed(),
              () => scope.assertLifecycleCleanupAllowed(),
            ])
              try {
                call();
              } catch (error) {
                late.push(error);
              }
          });
          return { cannotBeReturned: true };
        }),
      lost,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cleanup, 0);
    assert(rollbacks >= 1);
    assert.equal(late.length, 2);
    assert(late.every(lost));
    assert.throws(() => scope.run('owner', 'jobs', () => ({})), lost);
  }
});

test('public-read Store default path stays fresh and full ref identities remain strict after an overview', () => {
  const f = fixture();
  try {
    f.store.withPublicProjectionRead('owner', 'jobs', () => {
      assert.deepEqual(f.store.readEvidence(f.ref), f.store.readEvidence(f.ref));
      assert.equal(f.store.getJob(f.job.id, 'owner')!.status, 'succeeded');
      return {};
    });
    for (const key of ['accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256'] as const)
      assert.throws(() => f.store.readEvidence({ ...f.ref, [key]: 'synthetic-other' }));
    writeFileSync(path.join(f.options.evidenceDirectory, f.ref.path), '{}\n');
    assert.throws(() => f.store.readEvidence(f.ref), { code: 'evidence_hash_invalid' });
    f.db.prepare('UPDATE jobs SET status=? WHERE id=?').run('failed', f.job.id);
    assert.equal(f.store.getJob(f.job.id, 'owner')!.status, 'failed');
  } finally {
    f.close();
  }
});
