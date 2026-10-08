import test from 'node:test';

import { fixture, unavailable, lost } from './helpers/public-read-coordinator.js';

import { DatabaseSync } from 'node:sqlite';

import assert from 'node:assert/strict';

import { Store, RuntimeError } from '../src/runtime/store.js';

import path from 'node:path';

import { readFileSync, unlinkSync, writeFileSync, linkSync, symlinkSync } from 'node:fs';

test('public-read SQL prepare negatives retain static caught fallback and reject repaired observations', () => {
  for (const failure of [undefined, new Error('Synthetic prepare failure')])
    for (const repaired of [false, true]) {
      const f = fixture(),
        prepare = DatabaseSync.prototype.prepare;
      let unavailableNow = true,
        attempts = 0;
      try {
        DatabaseSync.prototype.prepare = function (sql: string) {
          if (sql === 'SELECT * FROM manifests WHERE account_id = ? AND job_id = ? LIMIT 2') {
            attempts++;
            if (unavailableNow) throw failure;
          }
          return prepare.call(this, sql);
        };
        let caught = false;
        try {
          f.store.getManifestForJob('owner', f.job.id);
        } catch (error) {
          caught = true;
          assert.equal(error, failure);
        }
        assert.equal(caught, true, 'default fresh path preserves the original prepare failure');
        const read = () =>
          f.store.withPublicProjectionRead('owner', 'jobs', () => {
            let caught = false;
            try {
              f.store.getManifestForJob('owner', f.job.id);
            } catch (error) {
              caught = true;
              assert.equal(error, failure);
            }
            assert.equal(caught, true);
            if (repaired) unavailableNow = false;
            return { staticFallback: true };
          });
        if (repaired) assert.throws(read, unavailable);
        else assert.deepEqual(read(), { staticFallback: true });
        assert(
          attempts >= 3,
          'prepare failure itself must be journaled and physically retried at final guard',
        );
      } finally {
        DatabaseSync.prototype.prepare = prepare;
        f.close();
      }
    }
});

test('public-read Store mutation entries reject before caller descriptors and leave SQL/files/lease untouched', () => {
  const f = fixture();
  let getters = 0;
  const malicious = Object.defineProperty({}, 'accountId', {
    get() {
      getters++;
      throw Error('caller must not be read');
    },
  });
  try {
    const before = f.ledger();
    const entries = [
      () => f.store.createJob(malicious as any),
      () => f.store.startJob(f.job.id),
      () => f.store.requestCancellation(f.job.id),
      () => f.store.markPlatformReadStarted(f.job.id),
      () => f.store.markPlatformWriteStarted(f.job.id),
      () => f.store.saveEvidence(f.job.id, 'works', malicious),
      () => f.store.addJobMetadata(f.job.id, malicious),
      () => f.store.recordTarget(f.job.id, malicious as any),
      () => f.store.completeReadJob(f.job.id, [f.ref]),
      () => f.store.completeWriteJob(f.job.id, malicious),
      () => f.store.failJob(f.job.id, malicious as any),
      () => f.store.reconcileWriteJob(f.job.id, f.job.id, malicious as any),
      () => f.store.registerNativeCompensationAttestation(malicious),
      () => f.store.onServiceLeaseLost(() => {}),
      () => f.store.close(),
    ];
    for (const entry of entries) {
      assert.throws(
        () =>
          f.store.withPublicProjectionRead('owner', 'jobs', () => {
            try {
              entry();
            } catch (error) {
              assert(unavailable(error));
            }
            return { mustStillReject: true };
          }),
        unavailable,
      );
      assert.deepEqual(f.ledger(), before);
    }
    assert.equal(getters, 0);
    f.store.assertLeaseOwnership();
  } finally {
    f.close();
  }
});

test('public-read owned index is exact, idempotent, query-effective and rejects an impostor without changing business rows', () => {
  const f = fixture();
  let reopened: Store | undefined;
  try {
    const before = f.db.prepare('SELECT * FROM jobs ORDER BY rowid').all();
    const info = f.db.prepare('PRAGMA index_info(evidence_job_id)').all(),
      listing = f.db.prepare('PRAGMA index_list(evidence)').all();
    assert.deepEqual(
      info.map((row) => row.name),
      ['job_id'],
    );
    const index = listing.find((row) => row.name === 'evidence_job_id')!;
    assert.equal(index.unique, 0);
    assert.equal(index.partial, 0);
    assert(
      f.db
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM evidence WHERE job_id=? ORDER BY rowid')
        .all(f.job.id)
        .some(
          (row) =>
            String(row.detail).includes('SEARCH') && String(row.detail).includes('evidence_job_id'),
        ),
    );
    f.store.close();
    reopened = new Store(f.options);
    reopened.close();
    reopened = undefined;
    assert.deepEqual(f.db.prepare('SELECT * FROM jobs ORDER BY rowid').all(), before);
    f.db.exec('DROP INDEX evidence_job_id; CREATE INDEX evidence_job_id ON evidence(account_id)');
    assert.throws(() => new Store(f.options));
    assert.equal(f.db.prepare('SELECT * FROM service_lease').all().length, 0);
    assert.deepEqual(f.db.prepare('SELECT * FROM jobs ORDER BY rowid').all(), before);
  } finally {
    reopened?.close();
    f.close();
  }
});

test('public-read index acquisition rejects a foreign lease and rolls back DDL on pre/post ownership expiry', () => {
  for (const stage of ['foreign', 'before-ddl', 'after-ddl'] as const) {
    const f = fixture(),
      prepare = DatabaseSync.prototype.prepare,
      exec = DatabaseSync.prototype.exec;
    let ddl = 0;
    try {
      f.store.close();
      f.db.exec('DROP INDEX evidence_job_id');
      if (stage === 'foreign')
        f.db
          .prepare('INSERT INTO service_lease(id,owner_id,expires_at) VALUES(1,?,?)')
          .run('synthetic-successor', Date.now() + 60_000);
      const before = f.ledger();
      DatabaseSync.prototype.prepare = function (sql: string) {
        const statement = prepare.call(this, sql),
          database = this;
        if (stage === 'before-ddl' && sql.startsWith('INSERT INTO service_lease'))
          return {
            run(...params: any[]) {
              const result = statement.run(...params);
              exec.call(database, 'UPDATE service_lease SET expires_at=0 WHERE id=1');
              return result;
            },
          } as ReturnType<DatabaseSync['prepare']>;
        return statement;
      };
      DatabaseSync.prototype.exec = function (sql: string) {
        const result = exec.call(this, sql);
        if (sql === 'CREATE INDEX IF NOT EXISTS evidence_job_id ON evidence(job_id)') {
          ddl++;
          if (stage === 'after-ddl')
            exec.call(this, 'UPDATE service_lease SET expires_at=0 WHERE id=1');
        }
        return result;
      };
      try {
        assert.throws(
          () => new Store(f.options),
          stage === 'foreign' ? { code: 'service_already_running' } : lost,
        );
      } finally {
        DatabaseSync.prototype.prepare = prepare;
        DatabaseSync.prototype.exec = exec;
      }
      assert.equal(ddl, stage === 'after-ddl' ? 1 : 0);
      assert.equal(
        f.db.prepare("SELECT name FROM sqlite_master WHERE name='evidence_job_id'").get(),
        undefined,
      );
      assert.deepEqual(
        f.ledger(),
        before,
        'failed ownership cannot commit index, lease or business effects',
      );
    } finally {
      DatabaseSync.prototype.prepare = prepare;
      DatabaseSync.prototype.exec = exec;
      f.close();
    }
  }
});

test('public-read Store physical guards detect bytes, path/nlink, tuple and caught-negative repair before returning', () => {
  for (const kind of [
    'bytes',
    'hardlink',
    'symlink',
    'tuple',
    'negative-repaired',
    'empty-membership',
  ] as const) {
    const f = fixture(),
      file = path.join(f.options.evidenceDirectory, f.ref.path),
      bytes = readFileSync(file);
    try {
      const emptyJob =
        kind === 'empty-membership'
          ? f.store.createJob({
              accountId: 'owner',
              kind: 'read',
              operation: 'refresh',
              scope: 'empty',
              datasets: ['works'],
            }).job
          : null;
      if (kind === 'negative-repaired') unlinkSync(file);
      assert.throws(
        () =>
          f.store.withPublicProjectionRead('owner', 'jobs', () => {
            if (kind === 'negative-repaired') {
              try {
                f.store.readEvidence(f.ref);
              } catch (error) {
                assert.equal((error as RuntimeError).code, 'evidence_missing');
              }
              writeFileSync(file, bytes);
            } else if (kind === 'empty-membership') {
              assert.deepEqual(f.store.listEvidence(emptyJob!.id), []);
              f.db.prepare('UPDATE evidence SET job_id=? WHERE id=?').run(emptyJob!.id, f.ref.id);
            } else {
              f.store.readEvidence(f.ref);
              if (kind === 'bytes') writeFileSync(file, '{}\n');
              else if (kind === 'hardlink') linkSync(file, path.join(f.root, 'synthetic-hardlink'));
              else if (kind === 'symlink') {
                const target = path.join(f.root, 'synthetic-target');
                writeFileSync(target, bytes);
                unlinkSync(file);
                symlinkSync(target, file);
              } else
                f.db
                  .prepare('UPDATE evidence SET dataset=? WHERE id=?')
                  .run('synthetic_other', f.ref.id);
            }
            return { positiveMustBeDiscarded: true };
          }),
        unavailable,
      );
    } finally {
      f.close();
    }
  }
});
