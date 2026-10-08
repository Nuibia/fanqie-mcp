import test from 'node:test';

import { fixture } from './helpers/short-native-cover-integration-fixture.js';

import assert from 'node:assert/strict';

import {
  noPrivate,
  UPLOAD,
  WORK,
  privateAfter,
} from './helpers/short-native-cover-integration-jpeg.js';

import { nativeShortMetadataEndpoints } from '../src/platform/short-native-metadata.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { readFileSync } from 'node:fs';

import { nativeShortCoverScope } from '../src/platform/short-native-cover-proof.js';

import { createMcpServer } from '../src/transport/mcp.js';

import { Client } from '@modelcontextprotocol/client';

import { InMemoryTransport } from '@modelcontextprotocol/server';

test('cover public branch rejects disabled writes before job, image or browser; tool count remains 37', async () => {
  const f = fixture(false);
  try {
    assert.equal(f.app.tools.length, 40);
    await assert.rejects(f.call(), { code: 'writes_disabled' });
    assert.deepEqual([f.coverCalls, f.imagePreparations, f.reads, f.writes], [0, 0, 0, 0]);
    const jobs = (await f.app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(jobs.jobs.length, 0);
    const capabilities = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(capabilities.writes.nativeShortRecommendedCover.available, false);
    assert.equal(
      capabilities.writes.nativeShortRecommendedCover.verificationStatus,
      'not-verified-live',
    );
  } finally {
    await f.close();
  }
});

test('cover input is one controlled reference and full source version; mixed patches and external paths never queue', async () => {
  const f = fixture();
  try {
    const valid = f.request();
    const invalid = [
      { ...valid, title: 'Mixed title' },
      { ...valid, metadata: { ...valid.metadata, categories: ['c1'] } },
      { ...valid, metadata: { cover: { ...valid.metadata.cover, uri: 'PRIVATE_NEW_URI' } } },
      {
        ...valid,
        metadata: {
          cover: { ...valid.metadata.cover, uploadPath: '/private/PRIVATE_UPLOAD_PATH' },
        },
      },
      {
        ...valid,
        metadata: { cover: { ...valid.metadata.cover, uploadPath: '../PRIVATE_UPLOAD_PATH.jpg' } },
      },
      { ...valid, metadata: { cover: { ...valid.metadata.cover, fit: 'stretch' } } },
      { ...valid, expectedContentHash: 'a'.repeat(64) },
      { ...valid, expectedState: 'published' },
      { ...valid, hashBasis: 'plain-html/v1' },
      { ...valid, snapshotScope: 'short-native-recommended-cover/v99' },
    ];
    for (const input of invalid) await assert.rejects(f.call(input), { code: 'invalid_input' });
    assert.equal(f.coverCalls, 0);
    assert.equal(
      ((await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any).jobs
        .length,
      0,
    );
  } finally {
    await f.close();
  }
});

test('complete synthetic cover runs two POSTs with durable independent attempts and safe saved outputs', async () => {
  const f = fixture();
  try {
    const output = await f.call();
    assert.equal(output.job.status, 'succeeded');
    assert.equal(output.sourceMode, 'fixture');
    noPrivate(output);
    assert.deepEqual(f.posts, [UPLOAD, nativeShortMetadataEndpoints(WORK).save]);
    assert.equal(f.writes, 2);
    assert.equal(f.coverCalls, 1);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      const evidence = db
        .prepare('SELECT dataset,path FROM evidence WHERE job_id=?')
        .all(output.job.id);
      assert.equal(evidence.length, 10);
      assert.equal(
        evidence.filter((row) => row.dataset === 'short_native_cover_upload_attempt').length,
        1,
      );
      assert.equal(
        evidence.filter((row) => row.dataset === 'short_native_cover_save_attempt').length,
        1,
      );
      assert.ok(
        evidence.some((row) =>
          JSON.stringify(
            JSON.parse(
              readFileSync(path.join(f.config.dataDir, 'evidence', String(row.path)), 'utf8'),
            ),
          ).includes('PRIVATE_HTML'),
        ),
      );
    } finally {
      db.close();
    }
    const repeated = await f.call();
    assert.deepEqual(repeated.data, output.data);
    assert.equal(f.writes, 2);
    assert.equal(f.coverCalls, 1);
    noPrivate(repeated);
    for (const name of ['get_job', 'cancel_job']) {
      const saved = await f.view(name, output.job.id);
      noPrivate(saved);
      assert.deepEqual(saved.data, output.data);
    }
    noPrivate(await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    const capabilities = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(
      capabilities.writes.nativeShortRecommendedCover.verificationStatus,
      'not-verified-live',
    );
    assert.equal(
      (
        (await f.app.dispatch(
          'GET',
          '/api/v1/snapshot',
          new URLSearchParams({ scope: nativeShortCoverScope(WORK) }),
          undefined,
        )) as any
      ).manifest,
      null,
    );
  } finally {
    await f.close();
  }
});

test('lost upload ACK persists unknown asset with zero save; old idempotency key never reuploads', async () => {
  const f = fixture(true, 'upload-ack-lost');
  try {
    const output = await f.call();
    assert.equal(output.job.status, 'uncertain');
    noPrivate(output);
    assert.deepEqual(f.posts, [UPLOAD]);
    const after = privateAfter(f.config, output.job.id);
    assert.equal(after.result.upload.post.attempts, 1);
    assert.equal(after.result.save.post.attempts, 0);
    assert.equal(after.result.upload.observation, null);
    const repeated = await f.call();
    assert.equal(repeated.job.id, output.job.id);
    assert.equal(f.writes, 1);
    assert.equal(f.coverCalls, 1);
    noPrivate(repeated);
    const reconciliation = await f.view('reconcile_write', output.job.id);
    noPrivate(reconciliation);
    assert.equal(reconciliation.original.job.status, 'uncertain');
    assert.equal(f.writes, 1);
    assert.equal(reconciliation.settlement.reason, 'reconciliation_not_live');
    for (const name of ['get_job', 'cancel_job']) noPrivate(await f.view(name, output.job.id));
    noPrivate(
      await f.app.dispatch(
        'GET',
        '/api/v1/history',
        new URLSearchParams({ scope: 'reconciliation' }),
        undefined,
      ),
    );
  } finally {
    await f.close();
  }
});

test('MCP text and structured cover outputs match REST saved views without replay or private fields', async () => {
  const f = fixture(),
    mcp = createMcpServer(f.app.tools);
  const client = new Client(
    { name: 'native-cover-synthetic', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const unwrap = (response: Awaited<ReturnType<Client['callTool']>>) => {
    noPrivate(response);
    const text = response.content.find((item) => item.type === 'text');
    assert(text?.type === 'text');
    const structured = response.structuredContent as Record<string, any>;
    assert(structured);
    assert.deepEqual(JSON.parse(text.text), JSON.parse(JSON.stringify(structured.result)));
    return structured.result as any;
  };
  try {
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 40);
    assert.equal(
      tools.tools.find((tool) => tool.name === 'fanqie_update_work_metadata')!.annotations!
        .readOnlyHint,
      false,
    );
    const written = unwrap(
      await client.callTool({ name: 'fanqie_update_work_metadata', arguments: f.request() }),
    );
    assert.equal(written.job.status, 'succeeded');
    assert.equal(written.sourceMode, 'fixture');
    assert.equal(f.writes, 2);
    const repeated = unwrap(
      await client.callTool({ name: 'fanqie_update_work_metadata', arguments: f.request() }),
    );
    const rest = (await f.app.dispatch(
      'GET',
      '/api/v1/jobs/' + written.job.id,
      new URLSearchParams(),
      undefined,
    )) as any;
    noPrivate(rest);
    assert.deepEqual(repeated, rest);
    const saved = unwrap(
      await client.callTool({ name: 'fanqie_get_job', arguments: { jobId: written.job.id } }),
    );
    assert.deepEqual(saved, rest);
    for (const [name, args, route] of [
      ['fanqie_get_saved_snapshot', { scope: nativeShortCoverScope(WORK) }, '/api/v1/snapshot'],
      ['fanqie_list_saved_history', { scope: nativeShortCoverScope(WORK) }, '/api/v1/history'],
    ] as const) {
      const output = unwrap(await client.callTool({ name, arguments: args }));
      assert.deepEqual(
        output,
        await f.app.dispatch('GET', route, new URLSearchParams(args), undefined),
      );
    }
    assert.equal(f.writes, 2);
    assert.equal(f.coverCalls, 1);
  } finally {
    await client.close();
    await mcp.close();
    await f.close();
  }
});

test('durable upload ACK with pre-save drift records no save attempt and no false success', async () => {
  const f = fixture(true, 'pre-save-drift');
  try {
    const output = await f.call();
    assert.equal(output.job.status, 'uncertain');
    noPrivate(output);
    assert.equal(f.writes, 1);
    const after = privateAfter(f.config, output.job.id);
    assert.equal(after.result.save.post.attempts, 0);
    assert.equal(after.result.observedPreSaveSnapshot.editData.opaque.changed, true);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      assert.equal(
        db
          .prepare('SELECT COUNT(*) count FROM evidence WHERE job_id=? AND dataset=?')
          .get(output.job.id, 'short_native_cover_save_attempt')!.count,
        0,
      );
    } finally {
      db.close();
    }
    const reconciliation = await f.view('reconcile_write', output.job.id);
    noPrivate(reconciliation);
    assert.equal(reconciliation.original.job.status, 'uncertain');
    assert.equal(reconciliation.settlement.reason, 'reconciliation_not_live');
    assert.equal(f.writes, 1);
  } finally {
    await f.close();
  }
});

test('lost save ACK keeps original acknowledgement absent; fixture full read cannot close a live unknown', async () => {
  const f = fixture(true, 'save-ack-lost');
  try {
    const output = await f.call();
    assert.equal(output.job.status, 'uncertain');
    noPrivate(output);
    assert.equal(f.writes, 2);
    const after = privateAfter(f.config, output.job.id);
    assert.equal(after.result.save.post.attempts, 1);
    assert.equal(after.result.save.observation, null);
    assert.equal(after.result.save.acknowledgementReceipt, null);
    const reconciliation = await f.view('reconcile_write', output.job.id);
    noPrivate(reconciliation);
    assert.equal(reconciliation.original.job.status, 'uncertain');
    assert.equal(reconciliation.settlement.reason, 'reconciliation_not_live');
    assert.equal(f.writes, 2);
    noPrivate(
      await f.app.dispatch(
        'GET',
        '/api/v1/history',
        new URLSearchParams({ scope: 'reconciliation' }),
        undefined,
      ),
    );
  } finally {
    await f.close();
  }
});
