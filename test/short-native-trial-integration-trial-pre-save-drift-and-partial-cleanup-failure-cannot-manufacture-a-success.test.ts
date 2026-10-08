import test from 'node:test';

import { fixture } from './helpers/short-native-trial-integration-fixture.js';

import { noPrivate, WORK } from './helpers/short-native-trial-integration-edit.js';

import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { rmSync } from 'node:fs';

import {
  NATIVE_SHORT_TRIAL_OPERATION,
  nativeShortTrialScope,
} from '../src/platform/short-native-trial-proof.js';

import { createMcpServer } from '../src/transport/mcp.js';

import { Client } from '@modelcontextprotocol/client';

import { InMemoryTransport } from '@modelcontextprotocol/server';

import { directStoreFixture } from './helpers/short-native-trial-integration-direct-store-fixture.js';

test('trial pre-save drift and partial cleanup failure cannot manufacture a success', async () => {
  for (const mode of ['pre-save-drift', 'cleanup-fails'] as const) {
    const f = fixture(true, mode);
    try {
      const output = await f.call();
      noPrivate(output);
      assert.notEqual(output.job.status, 'succeeded');
      assert.equal(f.writes, mode === 'pre-save-drift' ? 0 : 1, f.diagnose(output.job.id));
      if (mode === 'cleanup-fails') {
        assert.equal(output.job.status, 'uncertain');
        assert.equal(f.browser.hasUnsafeApiCleanup, true);
      }
      const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
      try {
        assert.equal(
          db
            .prepare('SELECT COUNT(*) n FROM evidence WHERE job_id=? AND dataset=?')
            .get(output.job.id, 'short_native_trial_after')!.n,
          1,
        );
      } finally {
        db.close();
      }
    } finally {
      await f.app.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  }
});

test('trial corrupt and unknown stored namespaces retain only a safe public task summary', async () => {
  const f = fixture();
  try {
    const written = await f.call();
    assert.equal(written.job.status, 'succeeded', f.diagnose(written.job.id));
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      db.prepare(
        'UPDATE jobs SET operation=?,scope=?,result_json=?,target_json=?,metadata_json=? WHERE id=?',
      ).run(
        'unfamiliar_trial_operation',
        'short_native_trial_unknown.v99',
        JSON.stringify({
          schema: 'fanqie-short-native-trial-business/v99',
          body: 'PRIVATE_BODY',
          status: 'succeeded',
        }),
        JSON.stringify({ kind: 'short-story', id: WORK, private: 'PRIVATE_TAIL' }),
        '{}',
        written.job.id,
      );
      for (const name of ['get_job', 'cancel_job']) {
        const output = await f.view(name, written.job.id);
        noPrivate(output);
        assert.equal(output.job.id, written.job.id);
        assert.equal(output.sourceMode, 'incomplete');
        assert.equal(output.job.projectionStatus, 'capability_unavailable');
        assert.equal(output.job.result, null);
        assert.equal(output.job.target, null);
        assert.equal(output.job.operation, null);
        assert.equal(output.job.scope, null);
        assert.equal(output.job.datasets, null);
        assert(output.data.every((item: any) => item.status !== 'succeeded'));
      }
      // Even undecodable JSON preserves the known task ID; the target and result
      // are unavailable rather than reconstructed from a namespace string.
      db.prepare(
        'UPDATE jobs SET operation=?,scope=?,result_json=?,metadata_json=? WHERE id=?',
      ).run(
        NATIVE_SHORT_TRIAL_OPERATION,
        nativeShortTrialScope(WORK),
        '{"schema":"native-short-trial/v99","body":"PRIVATE_BODY"',
        '{',
        written.job.id,
      );
      const corrupt = await f.view('get_job', written.job.id);
      noPrivate(corrupt);
      assert.equal(corrupt.job.id, written.job.id);
      assert.equal(corrupt.job.target, null);
      assert.equal(corrupt.job.result, null);
      assert.equal(corrupt.sourceMode, 'incomplete');
      assert.equal(corrupt.job.projectionStatus, 'capability_unavailable');
      const listing = (await f.app.dispatch(
        'GET',
        '/api/v1/jobs',
        new URLSearchParams(),
        undefined,
      )) as any;
      noPrivate(listing);
      assert.equal(listing.jobs[0].id, written.job.id);
      assert.equal(listing.jobs[0].target, null);
      assert.equal(listing.jobs[0].result, null);
      db.prepare('DELETE FROM native_short_trial_attempts WHERE job_id=?').run(written.job.id);
      db.prepare('DELETE FROM evidence WHERE job_id=?').run(written.job.id);
      db.prepare(
        'UPDATE jobs SET operation=?,scope=?,result_json=?,metadata_json=? WHERE id=?',
      ).run(
        'unfamiliar_operation',
        'account',
        null,
        '{"schema":"native-short-trial/v99","body":"PRIVATE_BODY"',
        written.job.id,
      );
      const metadataOnly = await f.view('get_job', written.job.id);
      noPrivate(metadataOnly);
      assert.equal(metadataOnly.job.id, written.job.id);
      assert.equal(metadataOnly.sourceMode, 'incomplete');
      assert.equal(metadataOnly.job.projectionStatus, 'capability_unavailable');
      assert.equal(metadataOnly.job.target, null);
      assert.equal(metadataOnly.job.result, null);
      assert.equal(f.writes, 1);
    } finally {
      db.close();
    }
  } finally {
    await f.close();
  }
});

test('trial MCP text and structured outputs match safe saved REST without replay', async () => {
  const f = fixture(),
    mcp = createMcpServer(f.app.tools),
    client = new Client(
      { name: 'native-trial-synthetic', version: '1.0.0' },
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
    assert.equal((await client.listTools()).tools.length, 40);
    const written = unwrap(
      await client.callTool({ name: 'fanqie_update_work_metadata', arguments: f.request() }),
    );
    assert.equal(written.job.status, 'succeeded', f.diagnose(written.job.id));
    assert.equal(f.writes, 1);
    const saved = unwrap(
      await client.callTool({ name: 'fanqie_get_job', arguments: { jobId: written.job.id } }),
    );
    const rest = await f.app.dispatch(
      'GET',
      '/api/v1/jobs/' + written.job.id,
      new URLSearchParams(),
      undefined,
    );
    noPrivate(rest);
    assert.deepEqual(saved, rest);
    const repeated = unwrap(
      await client.callTool({ name: 'fanqie_update_work_metadata', arguments: f.request() }),
    );
    assert.deepEqual(repeated, rest);
    assert.equal(f.writes, 1);
  } finally {
    await client.close();
    await mcp.close();
    await f.close();
  }
});

test('trial Store immutable closure survives restart and saved replay performs zero reads', async () => {
  const d = await directStoreFixture();
  try {
    const { f, original } = d,
      refs = d.store.listEvidence(original.id);
    assert.equal(refs.length, 5);
    assert.equal(d.store.listNativeShortTrialAttempts(original.id).length, 1);
    for (const ref of refs) assert.equal(d.store.readEvidence(ref).evidenceId, ref.id); // Actual hash/read-back through fsynced files.
    f.nextReadIncomplete();
    const first = await d.reconcile(original.id);
    noPrivate(first);
    assert.equal(first.original.job.status, 'uncertain');
    const firstRead = first.reconciliation.job.id;
    const firstRefs = d.store.listEvidence(firstRead);
    assert.equal(firstRefs.length, 1);
    const firstRef = firstRefs[0]!;
    const partial = d.store.readEvidence(firstRef).payload as any;
    assert.equal(partial.result.status, 'capability_unavailable');
    assert.equal(partial.result.reason, 'response_unavailable');
    assert.equal(partial.result.snapshot, null);
    assert.equal(partial.comparison, null);
    assert.equal(partial.result.proof.platformStarted, true);
    assert.equal(partial.result.proof.ownerCallback, false);
    assert.equal(partial.result.proof.proofCapturedAt, null);
    assert.equal(partial.result.requests.own.attempts, 1);
    assert.equal(first.reconciliation.data[0].snapshotVersionHash, null);
    assert.equal(first.reconciliation.data[0].comparison, null);
    assert.equal(first.original.data[0].originalSaveAcknowledged, false);
    assert.equal(first.original.data[0].originalOutcome, 'unknown');
    const firstClosed = d.store.getJob(original.id)!;
    assert.equal((firstClosed.result as any).status, 'uncertain');
    const firstEndedAt = firstClosed.endedAt;
    const initialDb = new DatabaseSync(d.storeOptions.databasePath);
    let firstRow: Record<string, unknown> | null = null;
    try {
      const rows = initialDb
        .prepare('SELECT * FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid')
        .all(original.id);
      assert.equal(rows.length, 1);
      firstRow = { ...rows[0]! };
      assert.equal(firstRow.read_job_id, firstRead);
      assert.equal(firstRow.evidence_id, firstRef.id);
      assert.equal(firstRow.status, 'uncertain');
      assert.equal(firstRow.created_at, firstEndedAt);
    } finally {
      initialDb.close();
    }
    f.setCurrent(f.posted);
    const matched = await d.reconcile(original.id);
    noPrivate(matched);
    assert.equal(matched.original.job.status, 'succeeded');
    assert.equal(matched.original.data[0].reason, 'saved_by_later_read');
    assert.equal(matched.original.data[0].originalSaveAcknowledged, false);
    assert.equal(matched.original.data[0].originalSaveDurableAcknowledged, false);
    assert.equal(matched.original.data[0].originalOutcome, 'unknown');
    assert.equal(f.writes, 1);
    const closed = d.store.getJob(original.id)!;
    const checkedAt = matched.original.data[0].checkedAt;
    const immutableOriginalEndedAt = (closed.result as any).originalAudit.originalEndedAt;
    assert.equal(immutableOriginalEndedAt, original.endedAt);
    assert.equal((closed.result as any).originalAttemptEvidence.readJobId, firstRead);
    assert.equal((closed.result as any).originalAttemptEvidence.evidenceId, firstRef.id);
    assert.equal((closed.result as any).originalAttemptEvidence.evidenceHash, firstRef.sha256);
    assert.equal((closed.result as any).originalAudit.priorEndedAt, firstEndedAt);
    await d.restart();
    assert.deepEqual(d.completed(d.store.getJob(original.id)!), matched.original);
    noPrivate(d.completed(d.store.getJob(firstRead)!));
    assert.deepEqual(d.store.listEvidence(firstRead), firstRefs);
    const reopenedPartial = d.store.readEvidence(firstRef).payload as any;
    assert.deepEqual(reopenedPartial, partial);
    assert.equal(reopenedPartial.result.snapshot, null);
    const before = [
      f.reads,
      f.writes,
      f.trialCalls,
      f.contexts,
      d.store.listJobs(f.config.accountId).length,
    ];
    for (let i = 0; i < 2; i++) {
      const saved = await d.reconcile(original.id);
      noPrivate(saved);
      assert.equal(saved.settlement.status, 'saved');
      assert.deepEqual(saved.original, matched.original);
      assert.equal(saved.original.data[0].checkedAt, checkedAt);
    }
    assert.deepEqual(
      [f.reads, f.writes, f.trialCalls, f.contexts, d.store.listJobs(f.config.accountId).length],
      before,
    );
    const db = new DatabaseSync(d.storeOptions.databasePath);
    try {
      const rows = db
        .prepare('SELECT * FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid')
        .all(original.id);
      assert.equal(rows.length, 2);
      assert.deepEqual({ ...rows[0]! }, firstRow!); // Immutable first closure bytes, ref, status and time survive settlement/reopen.
      assert.equal(
        db
          .prepare('SELECT COUNT(*) n FROM write_reconciliations WHERE original_job_id=?')
          .get(original.id)!.n,
        2,
      );
    } finally {
      db.close();
    }
  } finally {
    await d.close();
  }
});
