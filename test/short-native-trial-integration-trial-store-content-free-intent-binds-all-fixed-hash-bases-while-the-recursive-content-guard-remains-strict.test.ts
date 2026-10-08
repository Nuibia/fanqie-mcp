import test from 'node:test';

import { fixture } from './helpers/short-native-trial-integration-fixture.js';

import { Store, canonicalJson } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import {
  noPrivate,
  PRIVATE,
  ACCOUNT,
  WORK,
  snapshot,
  edit,
} from './helpers/short-native-trial-integration-edit.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { readFileSync, unlinkSync, rmSync } from 'node:fs';

import { createHash, randomUUID } from 'node:crypto';

import {
  NATIVE_SHORT_TRIAL_HASH_BASES,
  createNativeShortTrialSnapshot,
} from '../src/platform/short-native-trial.js';

import {
  NATIVE_SHORT_TRIAL_OPERATION,
  nativeShortTrialScope,
} from '../src/platform/short-native-trial-proof.js';

import { nativeShortMetadataEndpoints } from '../src/platform/short-native-metadata.js';

import { createApplication } from '../src/application.js';

test('trial Store content-free intent binds all fixed hash bases while the recursive content guard remains strict', async () => {
  const f = fixture();
  let store: Store | null = null;
  try {
    const written = await f.call();
    assert.equal(written.job.status, 'succeeded', f.diagnose(written.job.id));
    noPrivate(written);
    assert.equal(f.writes, 1);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      const rows = db
        .prepare('SELECT path,sha256 FROM evidence WHERE job_id=? AND dataset=?')
        .all(written.job.id, 'write-intent');
      assert.equal(rows.length, 1);
      const bytes = readFileSync(
        path.join(f.config.dataDir, 'evidence', String(rows[0]!.path)),
        'utf8',
      );
      assert.equal(createHash('sha256').update(bytes).digest('hex'), rows[0]!.sha256);
      const document = JSON.parse(bytes),
        intent = document.payload;
      assert.equal(document.evidenceKind, 'local-intent');
      assert.deepEqual(
        Object.keys(intent).sort(),
        [
          'schema',
          'scope',
          'baselineEvidence',
          'previousEvidence',
          'binding',
          'hashBasesHash',
          'sourceVersionHash',
          'desiredContentHash',
          'checkedAt',
        ].sort(),
      );
      assert.equal(
        intent.hashBasesHash,
        createHash('sha256')
          .update(
            canonicalJson({
              basis: 'native-short-trial-full-hash-bases/v1',
              hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
            }),
          )
          .digest('hex'),
      );
      assert.equal(Object.hasOwn(intent, 'hashBases'), false);
      assert.equal(
        /"(?:body|content|text|html|markdown|args|arguments|cookie|cookies|authorization|token|accessToken|refreshToken|password|secret|credentials|headers|storageState)"\s*:/i.test(
          canonicalJson(intent),
        ),
        false,
      );
      for (const marker of PRIVATE.filter((value) => value !== ACCOUNT))
        assert.equal(bytes.includes(marker), false);
      const afterRows = db
        .prepare('SELECT path FROM evidence WHERE job_id=? AND dataset=?')
        .all(written.job.id, 'short_native_trial_after');
      assert.equal(afterRows.length, 1);
      const after = JSON.parse(
        readFileSync(path.join(f.config.dataDir, 'evidence', String(afterRows[0]!.path)), 'utf8'),
      ).payload;
      assert.deepEqual(after.result.save.intentReceipt.hashBases, NATIVE_SHORT_TRIAL_HASH_BASES);
      assert.deepEqual(after.result.save.attemptReceipt.hashBases, NATIVE_SHORT_TRIAL_HASH_BASES);
      assert.deepEqual(
        after.result.save.acknowledgementReceipt.hashBases,
        NATIVE_SHORT_TRIAL_HASH_BASES,
      );
    } finally {
      db.close();
    }
    await f.app.close();
    store = new Store({
      databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
      evidenceMode: 'fixture',
    });
    const { job } = store.createJob({
      accountId: f.config.accountId,
      kind: 'write',
      operation: NATIVE_SHORT_TRIAL_OPERATION,
      scope: nativeShortTrialScope(WORK),
      idempotencyKey: randomUUID(),
      inputHash: '1'.repeat(64),
    });
    store.startJob(job.id);
    assert.throws(
      () =>
        store!.saveEvidence(job.id, 'write-intent', { hashBases: NATIVE_SHORT_TRIAL_HASH_BASES }),
      { code: 'invalid_write_intent' },
    );
    assert.equal(store.listEvidence(job.id).length, 0);
    assert.equal(store.getJob(job.id)!.platformWriteStartedAt, null);
    store.failJob(job.id, {
      code: 'synthetic_guard_complete',
      message: 'Synthetic guard check complete.',
    });
  } finally {
    store?.close();
    await f.close();
  }
});

test('trial one owned save and safe REST saved projections have a unique durable attempt', async () => {
  const f = fixture();
  try {
    const output = await f.call();
    assert.equal(output.job.status, 'succeeded', f.diagnose(output.job.id));
    assert.equal(output.sourceMode, 'fixture');
    noPrivate(output);
    assert.deepEqual(f.posts, [nativeShortMetadataEndpoints(WORK).save]);
    assert.deepEqual([f.writes, f.trialCalls, f.contexts], [1, 1, 1]);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      const attempts = db
        .prepare('SELECT * FROM native_short_trial_attempts WHERE job_id=?')
        .all(output.job.id);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]!.ordinal, 1);
      const rows = db.prepare('SELECT * FROM evidence WHERE job_id=?').all(output.job.id);
      assert.equal(rows.length, 7);
      assert.equal(rows.filter((row) => row.dataset === 'short_native_trial_attempt').length, 1);
      assert.ok(
        rows.some((row) =>
          readFileSync(path.join(f.config.dataDir, 'evidence', String(row.path)), 'utf8').includes(
            'PRIVATE_BODY',
          ),
        ),
      );
      assert.equal(
        attempts[0]!.event_at,
        db.prepare('SELECT write_started_at FROM jobs WHERE id=?').get(output.job.id)!
          .write_started_at,
      );
    } finally {
      db.close();
    }
    const repeated = await f.call();
    assert.deepEqual(repeated.data, output.data);
    assert.equal(f.writes, 1);
    assert.equal(f.trialCalls, 1);
    noPrivate(repeated);
    for (const name of ['get_job', 'cancel_job']) {
      const saved = await f.view(name, output.job.id);
      noPrivate(saved);
      assert.deepEqual(saved.data, output.data);
    }
    noPrivate(await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    noPrivate(
      await f.app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: nativeShortTrialScope(WORK) }),
        undefined,
      ),
    );
    const capabilities = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(capabilities.writes.nativeShortTrial.verificationStatus, 'not-verified-live');
  } finally {
    await f.close();
  }
});

test('trial ACK loss remains unknown despite matching after and fixture reconciliation cannot claim live', async () => {
  const f = fixture(true, 'ack-lost');
  try {
    const output = await f.call();
    assert.equal(output.job.status, 'uncertain', f.diagnose(output.job.id));
    noPrivate(output);
    assert.equal(f.writes, 1);
    const repeated = await f.call();
    assert.equal(repeated.job.id, output.job.id);
    assert.equal(f.writes, 1);
    assert.equal(f.trialCalls, 1);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      const rows = db
        .prepare('SELECT path FROM evidence WHERE job_id=? AND dataset=?')
        .all(output.job.id, 'short_native_trial_after');
      assert.equal(rows.length, 1);
      const after = JSON.parse(
        readFileSync(path.join(f.config.dataDir, 'evidence', String(rows[0]!.path)), 'utf8'),
      ).payload;
      assert.equal(after.result.save.post.acknowledged, false);
      assert.equal(after.result.comparison.matches, true);
    } finally {
      db.close();
    }
    const reconciled = await f.view('reconcile_write', output.job.id);
    noPrivate(reconciled);
    assert.equal(reconciled.original.job.status, 'uncertain');
    assert.equal(reconciled.settlement.reason, 'reconciliation_not_live');
    assert.equal(f.writes, 1);
  } finally {
    await f.close();
  }
});

test('trial clear restores content hashes and no-change actions never POST', async () => {
  const f = fixture();
  try {
    const emptyClear = await f.call({
      ...f.request('synthetic-empty-clear'),
      metadata: { trial: { action: 'clear' } },
    });
    assert.equal(emptyClear.job.status, 'failed');
    assert.equal(f.writes, 0);
    noPrivate(emptyClear);
    const before = createNativeShortTrialSnapshot(snapshot());
    const set = await f.call();
    assert.equal(set.job.status, 'succeeded', f.diagnose(set.job.id));
    const setVersion = snapshot(f.posted).snapshotVersionHash;
    const same = await f.call({
      ...f.request('synthetic-same-boundary'),
      expectedSnapshotVersionHash: setVersion,
    });
    assert.equal(same.job.status, 'failed');
    assert.equal(f.writes, 1);
    noPrivate(same);
    const clear = await f.call({
      ...f.request('synthetic-clear-key'),
      expectedSnapshotVersionHash: setVersion,
      metadata: { trial: { action: 'clear' } },
    });
    assert.equal(clear.job.status, 'succeeded', f.diagnose(clear.job.id));
    assert.equal(f.writes, 2);
    noPrivate(clear);
    const restored = createNativeShortTrialSnapshot(snapshot(f.posted));
    assert.equal(restored.documentHash, before.documentHash);
    assert.equal(restored.savedFieldsHash, before.savedFieldsHash);
    assert.equal(restored.trialDocumentHash, before.trialDocumentHash);
    assert.notEqual(restored.snapshotVersionHash, before.snapshotVersionHash);
    assert.equal(restored.document.rawHtml, edit().content);
  } finally {
    await f.close();
  }
});

test('trial foreign account job is SQL-filtered before any evidence file read', async () => {
  const f = fixture();
  await f.app.close();
  const options = {
    databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
    evidenceMode: 'fixture' as const,
  };
  const seed = new Store(options);
  let foreignId = '';
  try {
    const { job } = seed.createJob({
      accountId: 'synthetic_foreign_account',
      kind: 'write',
      operation: NATIVE_SHORT_TRIAL_OPERATION,
      scope: nativeShortTrialScope(WORK),
      idempotencyKey: randomUUID(),
      inputHash: '1'.repeat(64),
    });
    foreignId = job.id;
    seed.startJob(job.id);
    seed.markPlatformReadStarted(job.id);
    seed.recordTarget(job.id, { kind: 'short-story', id: WORK });
    const ref = seed.saveEvidence(job.id, 'short_native_trial_baseline', {
      schema: 'native-short-trial-malformed/v99',
      content: 'PRIVATE_BODY',
    });
    seed.failJob(job.id, { code: 'synthetic', message: 'Synthetic only' });
    unlinkSync(path.join(options.evidenceDirectory, ref.path));
  } finally {
    seed.close();
  }
  const app = createApplication(f.config, { browser: f.browser });
  const actualRead = Store.prototype.readEvidence;
  let evidenceReads = 0;
  Store.prototype.readEvidence = function (...args) {
    evidenceReads++;
    return actualRead.apply(this, args);
  };
  try {
    await assert.rejects(
      app.dispatch('POST', '/api/v1/tools/fanqie_get_job', new URLSearchParams(), {
        jobId: foreignId!,
      }),
      { code: 'not_found' },
    );
    await assert.rejects(
      app.dispatch('GET', '/api/v1/jobs/' + foreignId!, new URLSearchParams(), undefined),
      { code: 'not_found' },
    );
    assert.equal(evidenceReads, 0);
    assert.equal(f.reads, 0);
    assert.equal(f.writes, 0);
  } finally {
    Store.prototype.readEvidence = actualRead;
    await app.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
