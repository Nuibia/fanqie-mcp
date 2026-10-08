import test from 'node:test';

import { r6RuntimeFixture, r6Begin, r6Db } from './helpers/runtime-native-compensation-later.js';

import {
  r6SavedRead,
  r6LegacyUnknownRoot,
  r6Advance,
  r6Unavailable,
  r6RewriteReadDocument,
} from './helpers/runtime-r6-advance.js';

import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';

import { digest } from './helpers/runtime-deferred.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

test('R6 standalone read projects literal facts and actual opaque source while withholding private proof', async () => {
  const f = r6RuntimeFixture();
  try {
    const saved = r6SavedRead(f, undefined, 4),
      tuple = {
        state: 'reviewing',
        statusFacts: saved.snapshot.statusFacts,
        statusSource: {
          phase: 'snapshot_read',
          sourceRef: saved.ref.id,
          evidenceHash: saved.ref.sha256,
          evidenceCapturedAt: saved.ref.capturedAt,
        },
        statusEvidence: {
          id: saved.ref.id,
          jobId: saved.job.id,
          dataset: 'editable_snapshot',
          sha256: saved.ref.sha256,
          capturedAt: saved.ref.capturedAt,
        },
      };
    assert.deepEqual(f.store.genericShortPublication(saved.job.id, 'author'), tuple);
    const projection = f.store.genericShortProjection(saved.job.id, 'author');
    assert.deepEqual(projection.tuple, tuple);
    assert.deepEqual(projection.evidence, [saved.ref]);
    assert.deepEqual(projection.manifest, saved.manifest);
    assert.deepEqual(
      Object.keys(projection.job).sort(),
      [...Object.keys(saved.job), 'state', 'statusFacts', 'statusSource', 'statusEvidence'].sort(),
    );
    assert.deepEqual(projection.job.metadata, {});
    assert.deepEqual(
      Object.keys(projection.data[0]!).sort(),
      [
        'title',
        'body',
        'metadata',
        'accountId',
        'target',
        'state',
        'contentHash',
        'sourceUrl',
        'platformReadAt',
        'statusFacts',
        'source',
        'sourceRef',
        'evidenceHash',
        'evidenceCapturedAt',
        'dataset',
        'statusSource',
      ].sort(),
    );
    for (const key of [
      'genericShortStatus',
      'statusInput',
      'statusProof',
      'statusProtocol',
      'originalAudit',
      'path',
    ])
      assert.equal(Object.hasOwn(projection.data[0]!, key), false);
    assert.equal(projection.data[0]!.body, 'R6 synthetic body');
    assert.equal(Object.hasOwn(projection.data[0]!, 'statusEvidence'), false);
    const history = f.store.genericShortProjection(saved.job.id, 'author', false);
    assert.equal(Object.hasOwn(history.data[0]!, 'dataset'), false);
    assert.deepEqual(history.tuple, tuple);
  } finally {
    await f.cleanup();
  }
});

for (const failure of ['capture_failed', 'persist_failed', 'ended_pending'] as const)
  test(`R6 associated no-M11 ${failure} refuses old valid A instead of falling back`, async () => {
    const f = r6RuntimeFixture();
    try {
      const original = r6LegacyUnknownRoot(f),
        a = r6SavedRead(f, original, 1);
      assert.equal(
        f.store.genericShortPublication(original.id, 'author').statusEvidence?.id,
        a.ref.id,
      );
      const b = r6Begin(f, original);
      if (failure !== 'ended_pending') r6Advance(f, b, failure, undefined, 'later_read', failure);
      f.store.failJob(b.job.id, {
        code: 'capability_unavailable',
        message: 'Synthetic newer read has no manifest.',
      });
      assert.equal(f.store.getManifestForJob('author', b.job.id), null);
      assert.deepEqual(f.store.listEvidence(b.job.id), []);
      assert.throws(() => f.store.genericShortPublication(original.id, 'author'), r6Unavailable);
      assert.throws(() => f.store.genericShortProjection(original.id, 'author'), r6Unavailable);
      assert.equal(f.store.getJob(original.id)!.status, 'uncertain');
      assert.equal(
        Number(r6Db(f).prepare('SELECT COUNT(*) AS n FROM write_reconciliations').get()!.n),
        0,
      );
    } finally {
      await f.cleanup();
    }
  });

test('R6 legal unobserved associated failure and current-owner active prefix keep valid A', async () => {
  const f = r6RuntimeFixture();
  try {
    const original = r6LegacyUnknownRoot(f),
      a = r6SavedRead(f, original, 1),
      failed = r6Begin(f, original);
    r6Advance(f, failed, 'source_unavailable', undefined, 'later_read', 'source_unavailable');
    f.store.failJob(failed.job.id, {
      code: 'capability_unavailable',
      message: 'Synthetic pre-read source missing.',
    });
    assert.equal(
      f.store.genericShortPublication(original.id, 'author').statusEvidence?.id,
      a.ref.id,
    );
    const active = r6Begin(f, original);
    assert.equal(f.store.getJob(active.job.id)!.status, 'running');
    assert.equal(
      f.store.genericShortPublication(original.id, 'author').statusEvidence?.id,
      a.ref.id,
    );
    r6Db(f).prepare('UPDATE jobs SET owner_id=? WHERE id=?').run(randomUUID(), active.job.id);
    assert.throws(() => f.store.genericShortPublication(original.id, 'author'), r6Unavailable);
  } finally {
    await f.cleanup();
  }
});

test('R6 safely disjoint same-account same-target no-M11 read is not a blanket account refusal', async () => {
  const f = r6RuntimeFixture();
  try {
    const root = r6LegacyUnknownRoot(f),
      a = r6SavedRead(f, root, 1),
      other = r6LegacyUnknownRoot(f),
      noManifest = r6Begin(f, other);
    r6Advance(f, noManifest, 'capture_failed', undefined, 'later_read', 'capture_failed');
    f.store.failJob(noManifest.job.id, {
      code: 'capability_unavailable',
      message: 'Synthetic disjoint capture failure.',
    });
    assert.deepEqual(other.target, root.target);
    assert.equal(other.accountId, root.accountId);
    assert.notEqual(other.id, root.id);
    assert.equal(f.store.genericShortPublication(root.id, 'author').statusEvidence?.id, a.ref.id);
  } finally {
    await f.cleanup();
  }
});

for (const variant of [
  'sql_input_hash',
  'sql_scope',
  'raw_status',
  'ref_hash',
  'file_bytes',
] as const)
  test(`R6 newer B ${variant} corruption stays associated through its immutable audit and rejects A`, async () => {
    const f = r6RuntimeFixture();
    try {
      const root = r6LegacyUnknownRoot(f),
        a = r6SavedRead(f, root, 1),
        b = r6SavedRead(f, root, 4);
      assert.equal(f.store.genericShortPublication(root.id, 'author').statusEvidence?.id, b.ref.id);
      if (variant === 'sql_input_hash')
        r6Db(f)
          .prepare('UPDATE jobs SET input_hash=? WHERE id=?')
          .run(digest('disguised-other-root'), b.job.id);
      else if (variant === 'sql_scope')
        r6Db(f)
          .prepare('UPDATE jobs SET scope=? WHERE id=?')
          .run('synthetic-disguised-scope', b.job.id);
      else if (variant === 'raw_status')
        r6RewriteReadDocument(f, b.ref, (payload) => {
          payload.statusSnapshot.statusInput.display_status = 1;
        });
      else if (variant === 'ref_hash')
        r6Db(f)
          .prepare('UPDATE evidence SET sha256=? WHERE id=?')
          .run(digest('not-the-file'), b.ref.id);
      else
        writeFileSync(
          path.join(f.options.evidenceDirectory, b.ref.path),
          'SYNTHETIC_R6_CHANGED_PHYSICAL_BYTES',
        );
      assert.throws(() => f.store.genericShortPublication(root.id, 'author'), r6Unavailable);
      assert.throws(() => f.store.genericShortProjection(root.id, 'author'), r6Unavailable);
      assert.notEqual(a.ref.id, b.ref.id);
      assert.equal(f.store.getJob(root.id)!.status, 'uncertain');
    } finally {
      await f.cleanup();
    }
  });

test('R6 seeded public memo still executes actual raw SQL and physical evidence before projection copy', async (t) => {
  const f = r6RuntimeFixture();
  try {
    const saved = r6SavedRead(f, undefined, 1),
      db = r6Db(f),
      prepare = db.prepare.bind(db);
    let rawReads = 0,
      fileReads = 0;
    t.mock.method(db, 'prepare', (sql: string) => {
      if (sql === 'SELECT * FROM jobs WHERE id = ?') rawReads++;
      return prepare(sql);
    });
    const privateStore = f.store as unknown as { readEvidenceFresh: (...args: any[]) => unknown };
    const physical = privateStore.readEvidenceFresh.bind(f.store);
    t.mock.method(privateStore, 'readEvidenceFresh', (...args: any[]) => {
      fileReads++;
      return physical(...args);
    });
    const observed = f.store.withPublicProjectionRead('author', 'jobs', () => {
      f.store.listJobsForPublicProjection('author');
      const seededReads = rawReads,
        seededFiles = fileReads;
      const value = f.store.genericShortProjection(saved.job.id, 'author');
      assert.ok(
        rawReads > seededReads,
        'R6 final source must execute native raw SQL beyond seeded memo',
      );
      assert.ok(fileReads > seededFiles, 'R6 final source must read physical evidence');
      return value;
    });
    assert.equal(observed.tuple.statusEvidence?.id, saved.ref.id);
    assert.ok(rawReads >= 2);
    assert.ok(fileReads >= 2);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
});

test('R6 final native snapshot and original post-COMMIT SQL journal remain separate barriers', async (t) => {
  const f = r6RuntimeFixture();
  const { DatabaseSync } = await import('node:sqlite');
  const external = new DatabaseSync(f.options.databasePath);
  try {
    const saved = r6SavedRead(f, undefined, 1),
      db = r6Db(f),
      exec = db.exec.bind(db),
      prepare = db.prepare.bind(db);
    let armed = true,
      rawBeforeCommit = 0,
      committed = false;
    t.mock.method(db, 'prepare', (sql: string) => {
      if (!committed && sql === 'SELECT * FROM jobs WHERE id = ?') rawBeforeCommit++;
      return prepare(sql);
    });
    t.mock.method(db, 'exec', (sql: string) => {
      exec(sql);
      if (armed && sql === 'COMMIT') {
        armed = false;
        committed = true;
        external
          .prepare('UPDATE jobs SET input_hash=? WHERE id=?')
          .run(digest('external-after-native-snapshot'), saved.job.id);
      }
    });
    assert.throws(() => f.store.genericShortProjection(saved.job.id, 'author'), {
      code: 'capability_unavailable',
    });
    assert.ok(
      rawBeforeCommit >= 2,
      'the fixed source was reread inside the SQLite snapshot before commit',
    );
    assert.equal(committed, true);
    assert.equal(
      external.prepare('SELECT input_hash FROM jobs WHERE id=?').get(saved.job.id)!.input_hash,
      digest('external-after-native-snapshot'),
    );
  } finally {
    t.mock.restoreAll();
    external.close();
    await f.cleanup();
  }
});
