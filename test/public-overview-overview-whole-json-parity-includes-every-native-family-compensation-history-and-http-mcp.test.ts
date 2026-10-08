import test from 'node:test';

import {
  seedOverview,
  frozenOrFreshBaseline,
  OverviewBrowser,
  capture,
  noNativePrivate,
  routes,
} from './helpers/public-overview-materialize-graph.js';

import { createApplication } from '../src/application.js';

import { createHttpServer } from '../src/transport/http.js';

import { createMcpServer } from '../src/transport/mcp.js';

import { Client } from '@modelcontextprotocol/client';

import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/server';

import { DatabaseSync } from 'node:sqlite';

import { unlinkSync, writeFileSync, readFileSync } from 'node:fs';

import path from 'node:path';

import { Store, canonicalJson } from '../src/runtime/store.js';

import { randomUUID, createHash } from 'node:crypto';

test('overview: whole JSON parity includes every native family, compensation history and HTTP/MCP', async (t) => {
  const f = await seedOverview();
  const expected = await frozenOrFreshBaseline(f);
  t.diagnostic(
    process.env.F04_PUBLIC_BASELINE_SOURCE
      ? 'external frozen public source parity; manifest 967502d1b898d9d4b7e31af8d5c067c109340df13d771edcd6fef714c99a4723'
      : 'internal scope-disabled strict parity (not external frozen baseline)',
  );
  const browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
    app = createApplication(f.config, { browser });
  const http = createHttpServer({ ...f.config, host: '127.0.0.1', port: 0 }, app),
    mcp = createMcpServer(app.tools),
    client = new Client(
      { name: 'public-overview-synthetic', version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } },
    );
  try {
    const actual = await capture(app);
    assert.deepEqual(actual, expected);
    noNativePrivate(actual);
    const listed = actual['/api/v1/jobs'].jobs;
    for (const id of Object.values(f.familyIds)) assert(listed.some((job: any) => job.id === id));
    assert.equal(listed.find((job: any) => job.id === f.familyIds.body).status, 'succeeded');
    assert.deepEqual(Object.keys(listed.find((job: any) => job.id === f.familyIds.body)).sort(), [
      'endedAt',
      'id',
      'operation',
      'requestedAt',
      'status',
    ]);
    assert.equal(
      listed.find((job: any) => job.id === f.familyIds.trial).projectionStatus,
      'validated',
    );
    assert.equal(
      listed.find((job: any) => job.id === f.familyIds.cover).projectionStatus,
      'validated',
    );
    const address = await http.listen();
    assert(address && typeof address === 'object');
    for (const route of routes) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        headers: { authorization: `Bearer ${f.config.token}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected[route]);
    }
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    await client.connect(ct);
    for (const [name, route] of [
      ['fanqie_get_service_status', routes[0]],
      ['fanqie_get_capabilities', routes[1]],
    ] as const) {
      const response = await client.callTool({ name, arguments: {} });
      const block = response.content.find((item: any) => item.type === 'text');
      assert(block && block.type === 'text');
      const structured = JSON.parse(JSON.stringify((response.structuredContent as any).result));
      assert.deepEqual(JSON.parse(block.text), structured);
      assert.deepEqual(structured, expected[route]);
    }
    assert.equal(browser.platformCalls, 0);
  } finally {
    await client.close();
    await mcp.close();
    await http.close();
    await f.close();
  }
});

test('overview: static damage retains original family fallback and hidden namespace classification', async (t) => {
  for (const kind of [
    'legacy-missing',
    'body-bad-json',
    'trial-missing',
    'metadata-cycle',
    'cover-hidden',
    'metadata-hidden',
  ] as const)
    await t.test(kind, async () => {
      const f = await seedOverview();
      const db = new DatabaseSync(f.storage.databasePath);
      try {
        if (kind === 'legacy-missing')
          unlinkSync(path.join(f.storage.evidenceDirectory, f.legacyRef.path));
        else if (kind === 'body-bad-json')
          db.prepare('UPDATE jobs SET result_json=? WHERE id=?').run(
            '{broken native-short-body',
            f.familyIds.body!,
          );
        else if (kind === 'trial-missing') {
          const ref = db
            .prepare('SELECT path FROM evidence WHERE job_id=? LIMIT 1')
            .get(f.familyIds.trial!)!;
          unlinkSync(path.join(f.storage.evidenceDirectory, String(ref.path)));
        } else if (kind === 'metadata-cycle')
          db.prepare(
            'UPDATE write_reconciliations SET read_job_id=original_job_id WHERE id=(SELECT id FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid LIMIT 1)',
          ).run(f.familyIds.metadata!);
        else {
          const family = kind === 'cover-hidden' ? 'cover' : 'metadata';
          const store = new Store(f.storage);
          try {
            const job = store.createJob({
              accountId: 'owner',
              kind: 'write',
              operation: 'generic_synthetic',
              scope: 'generic',
              idempotencyKey: randomUUID(),
              inputHash: '1'.repeat(64),
            }).job;
            store.startJob(job.id);
            store.markPlatformReadStarted(job.id);
            store.saveEvidence(job.id, 'synthetic', {
              nested: {
                schema: `native-short-${family}-private/v999`,
                content: 'PRIVATE_HIDDEN_NATIVE_BODY',
              },
            });
            db.prepare('UPDATE jobs SET status=?,result_json=? WHERE id=?').run(
              'succeeded',
              canonicalJson({ safe: true }),
              job.id,
            );
          } finally {
            store.close();
          }
        }
        const expected = await frozenOrFreshBaseline(f),
          browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
          app = createApplication(f.config, { browser });
        try {
          assert.deepEqual(await capture(app), expected);
          noNativePrivate(expected);
          assert.equal(JSON.stringify(expected).includes('PRIVATE_HIDDEN_NATIVE_BODY'), false);
          assert.equal(browser.platformCalls, 0);
        } finally {
          await app.close();
        }
      } finally {
        db.close();
        await f.close();
      }
    });
});

test('overview: detail/saved defaults re-read changed bytes and current quarantine is never memoized', async () => {
  const f = await seedOverview(),
    browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
    app = createApplication(f.config, { browser }),
    db = new DatabaseSync(f.storage.databasePath);
  try {
    const before = await capture(app);
    assert.equal(before[routes[0]].status, 'ready');
    writeFileSync(path.join(f.storage.evidenceDirectory, f.legacyRef.path), '{}\n');
    await assert.rejects(
      app.dispatch('GET', '/api/v1/jobs/' + f.legacy.id, new URLSearchParams(), undefined),
      { code: 'evidence_hash_invalid' },
    );
    await assert.rejects(
      app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: f.legacy.scope }),
        undefined,
      ),
      { code: 'evidence_hash_invalid' },
    );
    db.prepare('UPDATE jobs SET status=? WHERE id=?').run('failed', f.legacy.id);
    const next = await capture(app);
    assert.notDeepEqual(next[routes[0]].jobCounts, before[routes[0]].jobCounts);
    const state = browser as unknown as { apiQuarantined: boolean };
    state.apiQuarantined = true;
    const quarantined = await capture(app);
    assert.equal(quarantined[routes[0]].status, 'unavailable');
    assert.equal(quarantined[routes[1]].writes.nativeShortBody.available, false);
    assert.equal(browser.platformCalls, 0);
  } finally {
    db.close();
    await app.close();
    await f.close();
  }
});

test('overview: public close reasons and a forged hasLost result cannot mint private fatal cleanup in scope', async () => {
  const f = await seedOverview(),
    browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
    app = createApplication(f.config, { browser }),
    db = new DatabaseSync(f.storage.databasePath);
  const scope = Store.prototype.withPublicProjectionRead,
    hasLost = Store.prototype.hasLostServiceLease;
  const ledger = () => ({
    rows: [
      'jobs',
      'evidence',
      'manifests',
      'current_manifests',
      'write_reconciliations',
      'native_short_body_attempts',
      'native_short_trial_attempts',
      'native_short_cover_attempts',
      'service_lease',
    ].map((table) => db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()),
    files: db
      .prepare('SELECT path FROM evidence ORDER BY rowid')
      .all()
      .map((row) => [
        row.path,
        createHash('sha256')
          .update(readFileSync(path.join(f.storage.evidenceDirectory, String(row.path))))
          .digest('hex'),
      ]),
  });
  let cleanup = 0;
  try {
    const before = ledger();
    for (const forged of [false, true])
      for (const action of ['normal-close', 'lease-close', 'store-cleanup'] as const) {
        let entered = false;
        Store.prototype.hasLostServiceLease = forged ? () => true : hasLost;
        Store.prototype.withPublicProjectionRead = function <T>(
          account: string,
          purpose: any,
          callback: () => T,
        ): T {
          return scope.call(this, account, purpose, () => {
            entered = true;
            this.assertLeaseOwnership();
            assert.throws(
              () =>
                action === 'store-cleanup'
                  ? this.runLeaseLossCleanup(() => {
                      cleanup++;
                      this.close();
                    })
                  : app.close(action === 'lease-close' ? 'lease_lost' : undefined),
              { code: 'capability_unavailable' },
            );
            return callback();
          }) as T;
        };
        const result = (await app.dispatch(
          'GET',
          routes[0],
          new URLSearchParams(),
          undefined,
        )) as any;
        assert.equal(entered, true);
        assert.equal(result.status, 'unavailable');
        assert.deepEqual(result.jobCounts, {});
        assert.equal(cleanup, 0);
        assert.equal(browser.closeCalls, 0);
        assert.deepEqual(
          ledger(),
          before,
          'controlled App cleanup must reject before SQL, file, browser or queue shutdown',
        );
      }
    Store.prototype.withPublicProjectionRead = scope;
    Store.prototype.hasLostServiceLease = hasLost;
    assert.equal(
      ((await app.dispatch('GET', routes[0], new URLSearchParams(), undefined)) as any).status,
      'ready',
      'rejected cleanup cannot poison the next owned request',
    );
    assert.equal(browser.platformCalls, 0);
  } finally {
    Store.prototype.withPublicProjectionRead = scope;
    Store.prototype.hasLostServiceLease = hasLost;
    db.close();
    await app.close();
    await f.close();
  }
});
