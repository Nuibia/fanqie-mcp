import test from 'node:test';

import {
  routes,
  seedOverview,
  OverviewBrowser,
} from './helpers/public-overview-materialize-graph.js';

import { createApplication } from '../src/application.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import { Store, type EvidenceRef } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import { PublicReadCoordinator } from '../src/runtime/public-read.js';

import { createHash } from 'node:crypto';

test('overview: dynamic SQL/file and caught-negative changes cross existing catch boundaries with fixed refusal', async (t) => {
  for (const route of routes)
    for (const kind of ['bytes', 'negative-repaired', 'manifest', 'related-closure'] as const)
      await t.test(route + ' ' + kind, async () => {
        const f = await seedOverview(),
          browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
          app = createApplication(f.config, { browser }),
          db = new DatabaseSync(f.storage.databasePath),
          file = path.join(f.storage.evidenceDirectory, f.legacyRef.path),
          bytes = readFileSync(file);
        const original = Store.prototype.readEvidence;
        let changed = false;
        if (kind === 'negative-repaired') unlinkSync(file);
        Store.prototype.readEvidence = function (ref) {
          try {
            const value = original.call(this, ref);
            if (
              !changed &&
              (kind === 'manifest'
                ? ref.jobId === f.familyIds.compensation
                : ref.id === f.legacyRef.id)
            ) {
              changed = true;
              if (kind === 'bytes') writeFileSync(file, '{}\n');
              else if (kind === 'manifest')
                db.prepare('UPDATE manifests SET manifest_json=? WHERE job_id=?').run(
                  '{}',
                  f.familyIds.compensation!,
                );
              else if (kind === 'related-closure')
                db.prepare(
                  'UPDATE write_reconciliations SET result_json=? WHERE original_job_id=?',
                ).run('{}', f.familyIds.metadata!);
            }
            return value;
          } catch (error) {
            if (!changed && kind === 'negative-repaired' && ref.id === f.legacyRef.id) {
              changed = true;
              writeFileSync(file, bytes);
            }
            throw error;
          }
        };
        try {
          if (route === routes[0]) {
            const value = (await app.dispatch(
              'GET',
              route,
              new URLSearchParams(),
              undefined,
            )) as any;
            assert.equal(value.status, 'unavailable');
            assert.deepEqual(value.jobCounts, {});
          } else
            await assert.rejects(app.dispatch('GET', route, new URLSearchParams(), undefined), {
              code: 'capability_unavailable',
              message:
                route === routes[2]
                  ? 'Saved data is unavailable.'
                  : 'Public overview data is unavailable.',
            });
          assert.equal(
            changed,
            true,
            'the oracle must actually change an already consumed physical input',
          );
          assert.equal(browser.platformCalls, 0);
        } finally {
          Store.prototype.readEvidence = original;
          db.close();
          await app.close();
          await f.close();
        }
      });
});

test('overview: budget-contained full validation/projection keys build once and physical refs validate at first and final reads', async (t) => {
  const f = await seedOverview(),
    browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
    app = createApplication(f.config, { browser });
  const memo = PublicReadCoordinator.prototype.memo,
    physical = (Store.prototype as any).readEvidenceFresh;
  assert.equal(typeof physical, 'function');
  let builds = new Map<string, number>(),
    reads = new Map<string, number>();
  PublicReadCoordinator.prototype.memo = function <T>(
    namespace: string,
    key: unknown,
    compute: () => T,
  ): T {
    const active = this.isActive();
    const identity =
      namespace + ':' + createHash('sha256').update(JSON.stringify(key)).digest('hex');
    return memo.call(this, namespace, key, () => {
      const value = compute();
      if (active) builds.set(identity, (builds.get(identity) ?? 0) + 1);
      return value;
    }) as T;
  };
  (Store.prototype as any).readEvidenceFresh = function (ref: EvidenceRef, ...args: any[]) {
    reads.set(ref.id, (reads.get(ref.id) ?? 0) + 1);
    return physical.call(this, ref, ...args);
  };
  try {
    for (const route of routes) {
      builds = new Map();
      reads = new Map();
      await app.dispatch('GET', route, new URLSearchParams(), undefined);
      assert(builds.size > 0);
      assert(
        [...builds.values()].every((count) => count === 1),
        'successful complete graph/projection keys must not rebuild within this budget-contained scope',
      );
      assert(reads.size > 0);
      assert(
        [...reads.values()].every((count) => count >= 2),
        'first and final physical validation are both required',
      );
      t.diagnostic(
        route +
          ': memoKeys=' +
          builds.size +
          ', uniquePhysicalRefs=' +
          reads.size +
          ', physicalReads=' +
          [...reads.values()].reduce((a, b) => a + b, 0),
      );
    }
    const before = new Map(reads);
    await app.dispatch('GET', routes[2], new URLSearchParams(), undefined);
    for (const [id, count] of before)
      assert(
        (reads.get(id) ?? 0) >= count + 2,
        'next request must re-read, not reuse previous authority',
      );
    assert.equal(browser.platformCalls, 0);
  } finally {
    PublicReadCoordinator.prototype.memo = memo;
    (Store.prototype as any).readEvidenceFresh = physical;
    await app.close();
    await f.close();
  }
});
