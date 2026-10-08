import test from 'node:test';

import {
  nativeSaveFixture,
  writeBusiness,
} from './helpers/short-native-metadata-integration-native-write-snapshot.js';

import { Store, canonicalJson } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import {
  persistNativeLater,
  publicNativeFixture,
} from './helpers/short-native-metadata-integration-persist-native-later.js';

import assert from 'node:assert/strict';

import { projectNativeShortReconciliationEvidenceContext } from '../src/platform/short-native-metadata-proof.js';

import { createApplication } from '../src/application.js';

import { noPrivate } from './helpers/short-native-metadata-integration-snapshot.js';

import { createMcpServer } from '../src/transport/mcp.js';

import { Client } from '@modelcontextprotocol/client';

import { InMemoryTransport } from '@modelcontextprotocol/server';

import { DatabaseSync } from 'node:sqlite';

test('C3 native closed write is independently projected with external read on saved, restart and same-key; SQL corruption stays safe', async () => {
  // These typed live-contract observations exercise local proof and SQLite only.
  // An injected production App collector still owns fixture provenance.
  const live = { executor: 'application-default-browser/v1', mode: 'live' } as const;
  const f = await nativeSaveFixture('acklost', 'live'),
    store = new Store(f.storage),
    queue = new JobQueue(store);
  let readId = '',
    expected: unknown;
  try {
    f.setTitle('Authorized title');
    const unknown = await persistNativeLater(f, store, queue, live);
    assert.equal(unknown.verified.status, 'uncertain');
    const firstUnknown = store.reconcileWriteJob(f.job.id, unknown.context.readJob.id, {
      status: 'uncertain',
      result: unknown.verified.result,
    });
    assert.equal(firstUnknown.status, 'uncertain');
    assert.equal((firstUnknown.result as any).originalAudit.originalEndedAt, f.job.endedAt);
    f.setTitle('Changed title');
    const later = await persistNativeLater(f, store, queue, live);
    readId = later.context.readJob.id;
    assert.equal(later.verified.evidence.originalAudit.phase, 'continuation');
    assert.equal(later.verified.evidence.originalAudit.priorEndedAt, firstUnknown.endedAt);
    const closed = store.reconcileWriteJob(f.job.id, readId, {
      status: later.verified.status,
      result: later.verified.result,
    });
    assert.equal(closed.status, 'succeeded');
    assert.equal((closed.result as any).schema, 'native-short-metadata-closure/v2');
    assert.equal((closed.result as any).originalAudit.originalEndedAt, f.job.endedAt);
    assert(closed.endedAt! >= later.context.readJob.endedAt!);
    // Stored settlement retains its original canonical operation result.
    assert.equal(
      canonicalJson((closed.result as any).result),
      canonicalJson(later.verified.result),
    );
    expected = projectNativeShortReconciliationEvidenceContext(later.context);
  } finally {
    await queue.drainAndStop();
    store.close();
  }
  let app = createApplication({ ...f.config, writesEnabled: true }, { browser: f.createBrowser() });
  try {
    const output = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: f.job.id },
    )) as any;
    assert.equal(output.job.status, 'succeeded');
    assert.equal(output.job.projectionStatus, 'validated');
    assert.equal(output.job.result.schema, 'native-short-metadata-closure/v2');
    assert.equal('originalAudit' in output.job.result, false);
    assert.deepEqual(output.data, [expected]);
    noPrivate(output);
    assert.equal(output.evidence.length, 2);
    assert.equal(
      output.evidence.some((ref: any) => ref.dataset === 'write-intent'),
      false,
    );
    const saved = (await app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: 'reconciliation' }),
      undefined,
    )) as any;
    assert.deepEqual(saved.data, [expected]);
    noPrivate(saved);
    const history = (await app.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams({ scope: 'reconciliation' }),
      undefined,
    )) as any;
    assert.equal(history.manifests.length, 2);
    assert.equal(
      history.manifests.every(
        (row: any) =>
          row.data[0]?.schema === 'fanqie-short-native-metadata-reconciliation-business/v2',
      ),
      true,
    );
    noPrivate(history);
    noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    const mcp = createMcpServer(app.tools),
      client = new Client(
        { name: 'native-reconciliation-unit', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } },
      );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await mcp.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 40);
      assert.equal(
        tools.tools.find((tool) => tool.name === 'fanqie_reconcile_write')!.annotations!
          .readOnlyHint,
        false,
      );
      assert.equal(
        tools.tools.find((tool) => tool.name === 'fanqie_get_short_metadata_snapshot')!.annotations!
          .readOnlyHint,
        true,
      );
      for (const [name, args] of [
        ['fanqie_get_job', { jobId: f.job.id }],
        ['fanqie_get_job', { jobId: readId }],
        ['fanqie_get_saved_snapshot', { scope: 'reconciliation' }],
        ['fanqie_list_saved_history', { scope: 'reconciliation' }],
      ] as const) {
        const response = await client.callTool({ name, arguments: args });
        noPrivate(response);
        const text = response.content.find((item) => item.type === 'text');
        assert(text?.type === 'text');
        const structured = response.structuredContent as Record<string, unknown>;
        assert(structured);
        assert.deepEqual(JSON.parse(text.text), JSON.parse(JSON.stringify(structured.result)));
      }
    } finally {
      await client.close();
      await mcp.close();
    }
    const beforeCounts = [f.getCount, f.postCount];
    const replay = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_update_work_metadata',
      new URLSearchParams(),
      { ...writeBusiness(), idempotencyKey: 'native-save-production-key' },
    )) as any;
    assert.equal(replay.job.id, f.job.id);
    assert.deepEqual(replay.data, [expected]);
    assert.deepEqual([f.getCount, f.postCount], beforeCounts);
    noPrivate(replay);
    await app.close();
    app = createApplication({ ...f.config, writesEnabled: true }, { browser: f.createBrowser() });
    const restarted = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: f.job.id },
    )) as any;
    assert.deepEqual(restarted.data, output.data);
    noPrivate(restarted);
    const db = new DatabaseSync(f.storage.databasePath);
    db.prepare('UPDATE write_reconciliations SET result_json=? WHERE original_job_id=?').run(
      '{}',
      f.job.id,
    );
    db.close();
    for (const action of [
      () =>
        app.dispatch('POST', '/api/v1/tools/fanqie_get_job', new URLSearchParams(), {
          jobId: f.job.id,
        }),
      () =>
        app.dispatch('POST', '/api/v1/tools/fanqie_update_work_metadata', new URLSearchParams(), {
          ...writeBusiness(),
          idempotencyKey: 'native-save-production-key',
        }),
      () => app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
    ])
      await assert.rejects(
        action(),
        (error: any) =>
          error.code === 'capability_unavailable' && !JSON.stringify(error).includes('PRIVATE'),
      );
    assert.deepEqual([f.getCount, f.postCount], beforeCounts);
  } finally {
    await app.close();
    await f.close();
  }
});

test('C3 public native save delivers title-only absent/empty metadata and nonempty categories without fixture verification upgrade', async () => {
  const f = publicNativeFixture();
  try {
    const initial = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(initial.writes.nativeShortMetadata.available, null);
    assert.equal(initial.writes.nativeShortMetadata.availabilityStatus, 'conditional-unobserved');
    assert.equal(initial.reads[0].metadataWritesAvailable, null);
    assert.equal(initial.writes.nativeShortMetadata.verificationStatus, 'not-verified-live');
    assert.doesNotMatch(initial.writes.nativeShortMetadata.reason, /not yet delivered/);
    const variants = [
      { title: 'Title only' },
      { title: 'Title with empty metadata', metadata: {} },
      { metadata: { categories: ['11', 'r1'] } },
    ];
    for (const [index, patch] of variants.entries()) {
      const input = {
        ...writeBusiness(patch),
        expectedSnapshotVersionHash: f.current.snapshotVersionHash,
        idempotencyKey: 'native-public-supported-' + index,
      };
      const output = (await f.app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_update_work_metadata',
        new URLSearchParams(),
        input,
      )) as any;
      assert.equal(output.job.status, 'succeeded', JSON.stringify(output.job.error));
      assert.equal(output.job.projectionStatus, 'validated');
      assert.equal(output.sourceMode, 'fixture');
      assert.equal(output.data[0].status, 'success');
      noPrivate(output);
      if (patch.title) assert.equal(output.data[0].firstTitle, patch.title);
      if (patch.metadata?.categories)
        assert.deepEqual(
          output.data[0].currentSelection.map((row: any) => String(row.category_id)),
          ['11', 'r1'],
        );
      const before = f.counts;
      const replay = (await f.app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_update_work_metadata',
        new URLSearchParams(),
        input,
      )) as any;
      assert.equal(replay.job.id, output.job.id);
      assert.deepEqual(replay.data, output.data);
      assert.deepEqual(f.counts, before);
      noPrivate(replay);
    }
    assert.equal(f.counts.postCount, 3);
    assert.equal(f.counts.getCount, 30);
    assert.equal(f.counts.sessions, 3);
    const cap = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.writes.nativeShortMetadata.implementationStatus, 'implemented');
    assert.equal(cap.writes.nativeShortMetadata.verificationStatus, 'not-verified-live');
    assert.equal(cap.writes.nativeShortMetadata.available, null);
    assert.equal(cap.reads[0].verificationStatus, 'not-verified-live');
  } finally {
    await f.close();
  }
});

test('C3 public save unknown prohibits a new key, never replays same key, and native reconcile stays zero POST', async () => {
  const f = publicNativeFixture(true, 'acklost');
  try {
    const input = {
      ...writeBusiness(),
      expectedSnapshotVersionHash: f.current.snapshotVersionHash,
      idempotencyKey: 'native-public-lost-ack',
    };
    const unknown = (await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_update_work_metadata',
      new URLSearchParams(),
      input,
    )) as any;
    assert.equal(unknown.job.status, 'uncertain');
    assert.equal(f.counts.postCount, 1);
    assert.equal(f.counts.getCount, 5);
    noPrivate(unknown);
    const replay = (await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_update_work_metadata',
      new URLSearchParams(),
      input,
    )) as any;
    assert.equal(replay.job.id, unknown.job.id);
    assert.equal(f.counts.postCount, 1);
    assert.equal(f.counts.getCount, 5);
    noPrivate(replay);
    const blocked = (await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_update_work_metadata',
      new URLSearchParams(),
      {
        ...input,
        expectedSnapshotVersionHash: f.current.snapshotVersionHash,
        idempotencyKey: 'native-public-new-key-blocked',
      },
    )) as any;
    assert.equal(blocked.job.status, 'failed');
    assert.equal(f.counts.postCount, 1);
    assert.equal(f.counts.getCount, 5);
    noPrivate(blocked);
    const later = (await f.app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_reconcile_write',
      new URLSearchParams(),
      { jobId: unknown.job.id },
    )) as any;
    assert.equal(later.reconciliation.job.status, 'succeeded');
    assert.equal(later.original.job.status, 'uncertain');
    assert.equal(f.counts.postCount, 1);
    assert.equal(f.counts.getCount, 10);
    noPrivate(later);
  } finally {
    await f.close();
  }
});
