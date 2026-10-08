import test from 'node:test';

import {
  fixture,
  ACCOUNT,
  WORK,
  PLATFORM,
  prefix,
  finish,
  factory,
  modernTuple4,
  native,
  phase,
} from './helpers/short-native-body-store-business.js';

import { nativeShortBodyBusinessInputHash } from '../src/platform/short-native-body.js';

import assert from 'node:assert/strict';

import { resolveNativeShortBodyStoreAuthority, Store, RuntimeError } from '../src/runtime/store.js';

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import { createHash } from 'node:crypto';

import { DatabaseSync } from 'node:sqlite';

import {
  NATIVE_SHORT_BODY_DATASETS,
  type NativeShortBodyWriteResultEvidence,
  nativeShortBodyHashBasesHash,
} from '../src/platform/short-native-body-proof.js';

test('body Store opaque issuance is tied to genuine leased construction and constructor policy', () => {
  const f = fixture();
  try {
    const authority = f.issue(),
      expected = {
        accountId: ACCOUNT,
        workId: WORK,
        inputHash: nativeShortBodyBusinessInputHash(ACCOUNT, f.input),
      };
    assert(resolveNativeShortBodyStoreAuthority(authority, expected));
    for (const fake of [
      {},
      structuredClone(authority),
      Object.create(Object.getPrototypeOf(authority)),
      new Proxy(authority, {}),
    ])
      assert.equal(resolveNativeShortBodyStoreAuthority(fake, expected), null);
    for (const fake of [
      Object.create(Store.prototype),
      Object.assign(Object.create(Store.prototype), f.store),
      new Proxy(f.store, {}),
    ])
      assert.throws(() =>
        Store.prototype.issueNativeShortBodyWriteAuthority.call(
          fake,
          f.job.id,
          ACCOUNT,
          f.input,
          PLATFORM,
        ),
      );
    assert.equal(
      resolveNativeShortBodyStoreAuthority(authority, { ...expected, accountId: 'foreign' }),
      null,
    );
    f.store.close();
    assert.equal(resolveNativeShortBodyStoreAuthority(authority, expected), null);
  } finally {
    f.close();
  }
  const disabled = fixture({ enabled: false });
  try {
    assert.throws(disabled.issue);
  } finally {
    disabled.close();
  }
});

test('body Store physical attempt and ordinal publish in one transaction then permit consumes once', () => {
  const f = fixture();
  try {
    const p = prefix(f),
      permit = p.b.beginAttempt(p.transport),
      rows = f.store.listNativeShortBodyAttempts(f.job.id, ACCOUNT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.ordinal, 1);
    assert.equal(rows[0]!.eventAt, f.store.getJob(f.job.id)!.platformWriteStartedAt);
    const ref = f.store.listEvidence(f.job.id).find((item) => item.id === rows[0]!.evidence.id);
    assert(ref);
    const bytes = readFileSync(path.join(f.evidenceDirectory, ref.path));
    assert.equal(bytes.at(-1), 10);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256);
    assert.deepEqual(p.b.consumeAttempt(permit), rows[0]!.evidence);
    assert.throws(() => p.b.consumeAttempt(permit));
    assert.throws(() => p.b.beginAttempt(p.transport));
    assert.throws(() => p.b.consumeAttempt(structuredClone(permit)));
    assert.equal(f.store.listNativeShortBodyAttempts(f.job.id, ACCOUNT).length, 1);
  } finally {
    f.close();
  }
});

test('body Store SQLite abort leaves only orphan physical evidence and never issues a permit', () => {
  const f = fixture();
  try {
    const p = prefix(f),
      db = new DatabaseSync(f.databasePath);
    db.exec(
      "CREATE TRIGGER body_abort BEFORE INSERT ON native_short_body_attempts BEGIN SELECT RAISE(ABORT,'synthetic abort'); END",
    );
    db.close();
    assert.throws(() => p.b.beginAttempt(p.transport));
    assert.equal(f.store.getJob(f.job.id)!.platformWriteStartedAt, null);
    assert.equal(f.store.listNativeShortBodyAttempts(f.job.id, ACCOUNT).length, 0);
    assert.equal(f.store.listEvidence(f.job.id).length, 3);
    const files = readdirSync(
      path.join(
        f.evidenceDirectory,
        createHash('sha256').update(ACCOUNT).digest('hex').slice(0, 24),
        NATIVE_SHORT_BODY_DATASETS.attempt,
      ),
    );
    assert.equal(files.length, 1);
    assert.equal(p.b.readCommittedAttempt(), null);
    assert.throws(() => p.b.beginAttempt(p.transport));
  } finally {
    f.close();
  }
});

test('body Store committed attempt readback failure cannot reissue POST authority', () => {
  const f = fixture();
  try {
    const p = prefix(f),
      original = f.store.readEvidence.bind(f.store);
    let attemptReads = 0;
    f.store.readEvidence = (ref) => {
      if (ref.dataset === NATIVE_SHORT_BODY_DATASETS.attempt && ++attemptReads === 2)
        throw new RuntimeError('evidence_hash_invalid', 'Synthetic failure');
      return original(ref);
    };
    assert.throws(() => p.b.beginAttempt(p.transport));
    f.store.readEvidence = original;
    const rows = f.store.listNativeShortBodyAttempts(f.job.id, ACCOUNT);
    assert.equal(rows.length, 1);
    assert.notEqual(f.store.getJob(f.job.id)!.platformWriteStartedAt, null);
    const attempt = p.b.readCommittedAttempt();
    assert(attempt);
    assert.deepEqual(attempt, rows[0]!.evidence);
    assert.deepEqual(p.b.readCommittedAttempt(), attempt);
    assert.throws(() => p.b.beginAttempt(p.transport));
    assert.throws(() => p.b.consumeAttempt(Object.freeze(Object.create(null))));
    const checkedAt = new Date().toISOString(),
      result: NativeShortBodyWriteResultEvidence = {
        schema: 'native-short-body-write-result/v1',
        outcome: 'unknown',
        reason: 'durability_unverified',
        source: { mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' },
        desiredContentHash: p.plan.desiredContentHash,
        preservationHash: 'bd921826b26dad792826dce5ce230fc85af52bddace3896f23fc4ca8f27abc7b',
        hashBasesHash: 'fcb2726382d9f0fbdb7c065588e3b2ef253b1ea64cd0cb7cd42fec5ed7f4084a',
        evidence: {
          baseline: p.baseline,
          preSave: p.preSave,
          intent: p.intent,
          attempt,
          acknowledgement: null,
          after: null,
        },
        post: {
          attempts: 0,
          disposed: 0,
          startedAt: null,
          acknowledgedAt: null,
          acknowledged: false,
        },
        ownerCheckedAt: null,
        cleanup: {
          sessionCreated: true,
          sessionDisposed: true,
          disposalFailures: 0,
          pendingAtEnd: 0,
          quarantined: false,
          checkedAt,
        },
        atomicRevision: false,
      };
    p.b.recordResult(result);
    assert.equal(f.store.listEvidence(f.job.id).length, 5);
    assert.equal(
      f.store.failJob(f.job.id, {
        code: 'capability_unavailable',
        message: 'Native short body is unavailable.',
      }).status,
      'uncertain',
    );
    assert.throws(() => p.b.readCommittedAttempt());
  } finally {
    f.close();
  }
  const damaged = fixture();
  try {
    const p = prefix(damaged),
      permit = p.b.beginAttempt(p.transport),
      ref = damaged.store
        .listEvidence(damaged.job.id)
        .find((item) => item.dataset === NATIVE_SHORT_BODY_DATASETS.attempt);
    assert(ref);
    writeFileSync(path.join(damaged.evidenceDirectory, ref.path), '{}\n');
    assert.throws(() => p.b.readCommittedAttempt());
    assert.throws(() => p.b.consumeAttempt(permit));
    assert.throws(() => p.b.beginAttempt(p.transport));
  } finally {
    damaged.close();
  }
  const cancelled = fixture();
  try {
    const p = prefix(cancelled);
    p.b.beginAttempt(p.transport);
    cancelled.store.requestCancellation(cancelled.job.id);
    assert.throws(() => p.b.readCommittedAttempt());
    assert.equal(cancelled.store.listNativeShortBodyAttempts(cancelled.job.id, ACCOUNT).length, 1);
  } finally {
    cancelled.close();
  }
});

test('body Store complete graph persists actual files and rejects physical tampering on reopen', () => {
  const f = fixture();
  try {
    assert.equal(
      nativeShortBodyHashBasesHash(),
      'fcb2726382d9f0fbdb7c065588e3b2ef253b1ea64cd0cb7cd42fec5ed7f4084a',
    );
    const p = prefix(f),
      done = finish(f, p);
    assert.equal(f.store.completeWriteJob(f.job.id, done.result).status, 'succeeded');
    assert.equal(f.store.listEvidence(f.job.id).length, 7);
    f.store.close();
    const reopened = new Store({
      databasePath: f.databasePath,
      evidenceDirectory: f.evidenceDirectory,
      evidenceMode: 'fixture',
      nativeShortBodyFixtureFactory: factory,
    });
    try {
      assert.equal(reopened.getJob(f.job.id)!.status, 'succeeded');
      const ref = reopened.listEvidence(f.job.id)[0]!;
      writeFileSync(path.join(f.evidenceDirectory, ref.path), '{}\n');
      assert.throws(() => reopened.getJob(f.job.id));
      const safe = reopened.getJobForPublicProjection(f.job.id, ACCOUNT);
      assert(safe);
      assert.equal(safe.id, f.job.id);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test('body Store ACK loss remains uncertain after matching observation and preserves initial safe cause', () => {
  const f = fixture();
  try {
    const p = prefix(f),
      done = finish(f, p, true);
    assert.throws(() => f.store.completeWriteJob(f.job.id, done.result));
    const job = f.store.failJob(f.job.id, {
      code: 'capability_unavailable',
      message: 'Native short body is unavailable.',
    });
    assert.equal(job.status, 'uncertain');
    assert.deepEqual(job.result, { evidence: f.store.listEvidence(f.job.id) });
    const audit = f.store.getNativeShortBodyOriginalAudit(job.id, ACCOUNT);
    assert.deepEqual(audit.originalError, {
      code: 'outcome_unknown',
      message: 'The platform write may have happened; reconcile before retrying.',
      details: {
        cause: { code: 'capability_unavailable', message: 'Native short body is unavailable.' },
      },
    });
    assert.throws(() => f.store.getNativeShortBodyOriginalAudit(job.id, 'foreign'));
  } finally {
    f.close();
  }
});

test('body Store actual cancellation deadline target and intent privacy fences deny unsafe progression', () => {
  const f = fixture();
  try {
    const b = f.binding();
    b.beforeGet();
    b.recordBaseline(modernTuple4(native()), phase());
    assert.throws(() => f.store.saveEvidence(f.job.id, 'write-intent', { body: 'private' }));
    assert.throws(() =>
      f.store.saveEvidence(f.job.id, 'write-intent', { hash: 'a'.repeat(17000) }),
    );
    f.store.requestCancellation(f.job.id);
    assert.throws(() => b.beforeGet());
    assert.throws(() => b.recordPreSave(modernTuple4(native()), phase()));
  } finally {
    f.close();
  }
  const g = fixture();
  try {
    g.store.markPlatformReadStarted(g.job.id);
    g.store.recordTarget(g.job.id, { kind: 'short-story', id: '7000000002' });
    assert.throws(g.issue);
  } finally {
    g.close();
  }
  const h = fixture();
  try {
    const b = h.binding(),
      db = new DatabaseSync(h.databasePath);
    db.prepare('UPDATE jobs SET deadline_at=? WHERE id=?').run(
      '2026-01-01T00:00:00.000Z',
      h.job.id,
    );
    db.close();
    assert.throws(() => b.beforeGet());
  } finally {
    h.close();
  }
});
