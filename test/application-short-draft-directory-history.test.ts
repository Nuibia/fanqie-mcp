import test from 'node:test';

import {
  directoryStoreFixture,
  directoryStoreObservation,
  directoryApplicationFixture,
  assertDirectoryPublicPrivacy,
} from './helpers/application-directory-application-fixture.js';

import {
  canonicalJson as directoryCanonicalJson,
  Store as DirectoryStore,
} from '../src/runtime/store.js';

import { createHash } from 'node:crypto';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import { DatabaseSync as DirectoryDatabase } from 'node:sqlite';

import assert from 'node:assert/strict';

import * as directoryDomain from '../src/platform/short-draft-directory.js';

import { DIRECTORY_PRIVATE_MARKER } from './helpers/application-a6-unclosed.js';

import { createHttpServer as createDirectoryHttpServer } from '../src/transport/http.js';

import {
  Client as DirectoryMcpClient,
  StreamableHTTPClientTransport as DirectoryMcpTransport,
} from '@modelcontextprotocol/client';

import { completeDiagnosticPrivacyFixture } from './helpers/application-complete-diagnostic-privacy-fixture.js';

import { diagnosticPrivacyScan } from './helpers/application-diagnostic-privacy-scan.js';

test('F02 directory Store: fixture cannot replace a structurally valid synthetic historical live current', async () => {
  const f = directoryStoreFixture();
  try {
    const prior = await directoryStoreObservation(f.store),
      original = f.store.completeReadJob(prior.job.id, [prior.ref]);
    // This deliberately constructed historical fixture tests the protected-current
    // policy; it does not assert that a fixture request was genuinely live.
    const document = f.store.readEvidence(prior.ref) as any;
    document.collectionMode = 'live';
    document.payload.source = {
      mode: 'live',
      transport: 'default-request',
      application: 'default',
      origin: 'https://fanqienovel.com',
      path: '/api/author/short_article/draft_list/v0/',
    };
    const bytes = Buffer.from(`${directoryCanonicalJson(document)}\n`),
      sha256 = createHash('sha256').update(bytes).digest('hex'),
      liveRef = { ...prior.ref, sha256 },
      liveManifest = { ...original, evidence: [liveRef] };
    writeFileSync(path.join(f.evidenceDirectory, prior.ref.path), bytes);
    const sql = new DirectoryDatabase(f.databasePath);
    try {
      sql.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(sha256, prior.ref.id);
      sql
        .prepare('UPDATE manifests SET manifest_json=? WHERE id=?')
        .run(directoryCanonicalJson(liveManifest), original.id);
      sql.prepare('UPDATE jobs SET result_json=?, metadata_json=? WHERE id=?').run(
        directoryCanonicalJson({ manifest: liveManifest }),
        directoryCanonicalJson({
          ...f.store.getJob(prior.job.id)!.metadata,
          shortDraftDirectorySource: 'live',
        }),
        prior.job.id,
      );
    } finally {
      sql.close();
    }
    const priorJob = f.store.getJob(prior.job.id)!;
    assert.equal(
      directoryDomain.projectShortDraftDirectoryContext({
        accountId: priorJob.accountId,
        job: priorJob,
        manifest: liveManifest,
        refs: [liveRef],
        documents: [f.store.readEvidence(liveRef)],
        evaluationAt: new Date().toISOString(),
      }).verifiedLive,
      true,
    );
    const next = await directoryStoreObservation(f.store);
    await assert.rejects(async () => f.store.completeReadJob(next.job.id, [next.ref]), {
      code: 'capability_unavailable',
      message: 'Short draft directory is unavailable.',
    });
    assert.deepEqual(
      f.store.getCurrent(next.job.accountId, 'native_short_draft_directory.v1'),
      liveManifest,
    );
    assert.equal(f.store.history(next.job.accountId).length, 1);
  } finally {
    f.close();
  }
});

test('F02 directory App: corrupt evidence and malformed private job JSON are closed across all saved outputs', async () => {
  const f = directoryApplicationFixture();
  try {
    const fresh = await f.fresh();
    await f.application.close();
    const sql = new DirectoryDatabase(path.join(f.config.dataDir, 'operations.sqlite'));
    let originalMetadata: string, evidencePath: string;
    try {
      originalMetadata = String(
        sql.prepare('SELECT metadata_json FROM jobs WHERE id=?').get(fresh.job.id)!.metadata_json,
      );
      evidencePath = String(
        sql.prepare('SELECT path FROM evidence WHERE job_id=?').get(fresh.job.id)!.path,
      );
      sql
        .prepare('UPDATE jobs SET metadata_json=? WHERE id=?')
        .run(
          `{"shortDraftDirectorySchema":"short-draft-directory-job/v1","secret":"${DIRECTORY_PRIVATE_MARKER}"`,
          fresh.job.id,
        );
    } finally {
      sql.close();
    }
    await f.reopen();
    for (const result of [
      await f.get(fresh.job.id),
      await f.snapshot(),
      (await f.history()).manifests[0],
      await f.application.dispatch(
        'POST',
        '/api/v1/tools/fanqie_cancel_job',
        new URLSearchParams(),
        { jobId: fresh.job.id },
      ),
    ]) {
      const value = result as any;
      assert.equal(value.sourceMode, 'incomplete');
      assert.deepEqual(value.data[0].records, []);
      assert.equal(value.verifiedLive, false);
      assertDirectoryPublicPrivacy(value);
    }
    const jobs = (
      (await f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any
    ).jobs;
    assert.equal(jobs[0].status, null);
    assertDirectoryPublicPrivacy({ job: jobs[0] });
    assert.equal(f.calls, 3);
    await f.application.close();
    const restore = new DirectoryDatabase(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      restore
        .prepare('UPDATE jobs SET metadata_json=? WHERE id=?')
        .run(originalMetadata, fresh.job.id);
    } finally {
      restore.close();
    }
    writeFileSync(path.join(f.config.dataDir, 'evidence', evidencePath), DIRECTORY_PRIVATE_MARKER);
    await f.reopen();
    for (const value of [
      await f.get(fresh.job.id),
      await f.snapshot(),
      (await f.history()).manifests[0],
    ]) {
      const result = value as any;
      assert.equal(result.sourceMode, 'incomplete');
      assert.deepEqual(result.data[0].records, []);
      assertDirectoryPublicPrivacy(result);
    }
    assert.equal(f.calls, 3);
  } finally {
    await f.close();
  }
});

test('F02 directory App: unknown legacy short_drafts remains byte intact and cannot contaminate new scope', async () => {
  const f = directoryApplicationFixture();
  try {
    const fresh = await f.fresh();
    await f.application.close();
    const seed = new DirectoryStore({
      databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
    });
    const old = seed.createJob({
      accountId: f.config.accountId,
      kind: 'read',
      operation: 'legacy_directory',
      scope: 'legacy_scope',
      datasets: ['legacy_directory'],
    }).job;
    seed.startJob(old.id);
    seed.markPlatformReadStarted(old.id);
    const oldRef = seed.saveEvidence(old.id, 'legacy_directory', {
      schema: 'unknown-old-directory/v1',
      private: DIRECTORY_PRIVATE_MARKER,
    });
    const original = seed.completeReadJob(old.id, [oldRef]);
    const oldManifest = { ...original, scope: 'short_drafts', datasets: ['short_drafts'] };
    seed.close();
    const sql = new DirectoryDatabase(path.join(f.config.dataDir, 'operations.sqlite'));
    let originalBytes: string;
    try {
      originalBytes = directoryCanonicalJson(oldManifest);
      sql
        .prepare('UPDATE jobs SET scope=?, datasets_json=?, result_json=? WHERE id=?')
        .run(
          'short_drafts',
          '["short_drafts"]',
          directoryCanonicalJson({ manifest: oldManifest }),
          old.id,
        );
      sql
        .prepare('UPDATE manifests SET scope=?, manifest_json=? WHERE id=?')
        .run('short_drafts', originalBytes, original.id);
      sql
        .prepare('UPDATE current_manifests SET scope=? WHERE manifest_id=?')
        .run('short_drafts', original.id);
    } finally {
      sql.close();
    }
    await f.reopen();
    const legacy = await f.snapshot('short_drafts');
    assert.equal(legacy.sourceMode, 'incomplete');
    assert.equal(legacy.manifest, null);
    assert.deepEqual(legacy.data[0].records, []);
    assertDirectoryPublicPrivacy(legacy);
    assert.deepEqual((await f.snapshot()).data, fresh.data);
    const history = await f.history('short_drafts');
    assert.equal(history.manifests[0].sourceMode, 'incomplete');
    assertDirectoryPublicPrivacy(history);
    await f.application.close();
    const verify = new DirectoryDatabase(path.join(f.config.dataDir, 'operations.sqlite'), {
      readOnly: true,
    });
    try {
      assert.equal(
        verify.prepare('SELECT manifest_json FROM manifests WHERE id=?').get(original.id)!
          .manifest_json,
        originalBytes,
      );
      assert.equal(
        verify
          .prepare('SELECT count(*) AS n FROM current_manifests WHERE scope=? AND manifest_id=?')
          .get('short_drafts', original.id)!.n,
        1,
      );
    } finally {
      verify.close();
    }
  } finally {
    await f.close();
  }
});

test('F02 directory App: MCP text and structured serializers match closed DTO and REST saved with zero extra GET', async () => {
  const f = directoryApplicationFixture(),
    http = createDirectoryHttpServer(f.config, f.application),
    client = new DirectoryMcpClient({ name: 'f02-directory-synthetic', version: '1.0.0' });
  try {
    const address = await http.listen();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    await client.connect(
      new DirectoryMcpTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: 'Bearer synthetic-f02-directory-service-token' } },
      }),
    );
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 40);
    assert.equal(
      tools.find((item) => item.name === 'fanqie_list_short_drafts')!.annotations!.readOnlyHint,
      true,
    );
    const output = await client.callTool({ name: 'fanqie_list_short_drafts', arguments: {} }),
      structured = (output.structuredContent as any).result,
      text = output.content.find((item) => item.type === 'text');
    assert(text && text.type === 'text');
    assert.deepEqual(JSON.parse(text.text), structured);
    assert.equal(structured.job.status, 'succeeded');
    assert.equal(structured.sourceMode, 'fixture');
    assertDirectoryPublicPrivacy(structured);
    const savedOutput = await client.callTool({
      name: 'fanqie_get_job',
      arguments: { jobId: structured.job.id },
    });
    const saved = (savedOutput.structuredContent as any).result;
    assert.deepEqual(saved.data, structured.data);
    assertDirectoryPublicPrivacy(saved);
    const rest = await fetch(`${base}/api/v1/jobs/${structured.job.id}`, {
      headers: { authorization: 'Bearer synthetic-f02-directory-service-token' },
    });
    assert.equal(rest.status, 200);
    assert.deepEqual(await rest.json(), saved);
    assert.equal(f.calls, 3);
    const refusal = await client.callTool({
      name: 'fanqie_list_short_drafts',
      arguments: { mode: 'fixture' },
    });
    assert.equal(refusal.isError, true);
    assert.equal(f.calls, 3);
  } finally {
    await client.close();
    await http.close();
    await f.close();
  }
});

test('diagnostic privacy exact opaque UUID and hash containing 1001 remain legitimate', () => {
  const jobId = '00001001-1111-4111-8111-111111111111',
    id = '22221001-2222-4222-8222-222222222222',
    sha256 = 'a'.repeat(30) + '1001' + 'b'.repeat(30),
    at = '2026-10-04T00:00:00.000Z';
  for (const api of [false, true]) {
    const f = completeDiagnosticPrivacyFixture(api, jobId, id, sha256, at);
    diagnosticPrivacyScan(f.result, f.identity, ['PRIVATE', '1001', 'raw-token', '<p>']);
    diagnosticPrivacyScan({ ...f.result, retrievalMode: 'live', sourceMode: 'live' }, f.identity, [
      'PRIVATE',
      '1001',
      'raw-token',
      '<p>',
    ]);
  }
});
