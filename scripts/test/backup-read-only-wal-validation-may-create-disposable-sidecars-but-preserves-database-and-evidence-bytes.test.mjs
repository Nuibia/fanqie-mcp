import test from 'node:test';

import {
  temporary,
  databaseFixture,
  registrationAt,
  registrationIds,
  registrationRefId,
} from './helpers/backup-mock-docker.mjs';

import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

import assert from 'node:assert/strict';

import { digest, canonical } from '../lib/backup-core.mjs';

import { readFile, writeFile } from 'node:fs/promises';

import { verifyDataDirectory } from '../lib/verify-data.mjs';

import { registrationArchiveFixture } from './helpers/backup-registration-archive-fixture.mjs';

test('readOnly WAL validation may create disposable sidecars but preserves database and evidence bytes', async () =>
  temporary(async (root) => {
    const { reference } = await databaseFixture(root);
    const filename = path.join(root, 'operations.sqlite');
    const db = new DatabaseSync(filename);
    assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
    db.close();
    const databaseBefore = digest(await readFile(filename));
    const evidenceBefore = digest(await readFile(path.join(root, 'evidence', reference.path)));
    assert.deepEqual(verifyDataDirectory(root), {
      jobs: 1,
      evidence: 1,
      manifests: 1,
      currentPointers: 1,
      profileFiles: 1,
      profileLinks: 0,
    });
    assert.equal(digest(await readFile(filename)), databaseBefore);
    assert.equal(
      digest(await readFile(path.join(root, 'evidence', reference.path))),
      evidenceBefore,
    );
  }));

test('validator refuses corrupted evidence hash, document schema, manifest references and path escape', async () => {
  for (const kind of ['hash', 'schema', 'manifest', 'path'])
    await temporary(async (root) => {
      const { doc, manifest } = await databaseFixture(root);
      const db = new DatabaseSync(path.join(root, 'operations.sqlite'));
      if (kind === 'hash')
        await writeFile(path.join(root, 'evidence', 'fixture/evidence.json'), 'corrupt');
      if (kind === 'schema') {
        delete doc.schemaVersion;
        const bytes = Buffer.from(`${canonical(doc)}\n`);
        await writeFile(path.join(root, 'evidence', 'fixture/evidence.json'), bytes);
        db.prepare('UPDATE evidence SET sha256=?').run(digest(bytes));
      }
      if (kind === 'manifest') {
        manifest.evidence[0].sha256 = '0'.repeat(64);
        db.prepare('UPDATE manifests SET manifest_json=?').run(canonical(manifest));
      }
      if (kind === 'path') db.prepare('UPDATE evidence SET path=?').run('../private.json');
      db.close();
      assert.throws(() => verifyDataDirectory(root));
    });
});

test('read-only archive accepts exact administrative registration alongside ordinary platform read and outputs counts only', async () =>
  temporary(async (root) => {
    const fixture = await registrationArchiveFixture(root),
      before = digest(await readFile(path.join(root, 'operations.sqlite'))),
      evidenceBefore = digest(await readFile(path.join(root, 'evidence', fixture.ref.path)));
    assert.equal(Object.hasOwn(fixture.manifest, 'schemaVersion'), false);
    assert.equal(fixture.manifest.platformReadStartedAt, null);
    assert.equal(fixture.manifest.platformWriteStartedAt, null);
    assert.deepEqual(verifyDataDirectory(root), {
      jobs: 5,
      evidence: 9,
      manifests: 2,
      currentPointers: 1,
      profileFiles: 1,
      profileLinks: 0,
    });
    assert.equal(digest(await readFile(path.join(root, 'operations.sqlite'))), before);
    assert.equal(
      digest(await readFile(path.join(root, 'evidence', fixture.ref.path))),
      evidenceBefore,
    );
    assert(!JSON.stringify(verifyDataDirectory(root)).includes('PRIVATE_'));
  }));

test('ordinary platform manifests still reject null read time and unknown or future schema', async () => {
  for (const mutate of [
    (manifest) => (manifest.platformReadStartedAt = null),
    (manifest) => (manifest.schema = 'unrecognized-manifest/v1'),
    (manifest) => (manifest.schema = 'native-short-metadata-compensation-registration-manifest/v2'),
  ])
    await temporary(async (root) => {
      const { manifest } = await databaseFixture(root);
      mutate(manifest);
      const db = new DatabaseSync(path.join(root, 'operations.sqlite'));
      try {
        db.prepare('UPDATE manifests SET manifest_json=?').run(canonical(manifest));
      } finally {
        db.close();
      }
      assert.throws(() => verifyDataDirectory(root), { code: 'manifest_schema_invalid' });
    });
});

test('administrative registration refuses malformed keys, hashes, references, jobs and platform boundaries', async (t) => {
  const cases = [
    ['hybrid schemaVersion', (f) => (f.manifest.schemaVersion = 1)],
    ['future schema', (f) => (f.manifest.schema += '/private')],
    ['operation', (f) => (f.manifest.operation = 'refresh')],
    ['scope', (f) => (f.manifest.scope += '.wrong')],
    ['dataset', (f) => (f.manifest.datasets = ['short_works'])],
    ['unknown key', (f) => (f.manifest.extra = 'PRIVATE_UNKNOWN')],
    ['platform read', (f) => (f.manifest.platformReadStartedAt = registrationAt(14))],
    ['platform write', (f) => (f.manifest.platformWriteStartedAt = registrationAt(14))],
    ['noncanonical time', (f) => (f.manifest.startedAt = '2020-01-01T00:00:15Z')],
    ['time order', (f) => (f.manifest.startedAt = registrationAt(16))],
    ['input hash', (f) => (f.manifest.inputHash = '0'.repeat(64))],
    ['authority hash', (f) => (f.manifest.authorityHash = '0'.repeat(64))],
    ['policy hash', (f) => (f.payload.policyHash = f.payload.authority.policy.sha256)],
    ['receipt raw hash', (f) => (f.payload.authority.receipts.actor.sha256 = '0'.repeat(64))],
    ['authority shape', (f) => (f.payload.authority.extra = true)],
    ['ref hash', (f) => (f.manifest.evidence = [{ ...f.ref, sha256: '0'.repeat(64) }])],
    ['ref job', (f) => (f.manifest.evidence = [{ ...f.ref, jobId: registrationIds.operator }])],
    ['ref missing', (f) => (f.manifest.evidence = [])],
    ['ref extra key', (f) => (f.manifest.evidence = [{ ...f.ref, extra: true }])],
    ['payload schema', (f) => (f.payload.schema += '/private')],
    ['payload account', (f) => (f.payload.accountId = 'foreign-fixture')],
    ['payload original job', (f) => (f.payload.originalJobId = registrationIds.operator)],
    ['original input hash', (f) => (f.payload.originalInputHash = '0'.repeat(64))],
    ['nested ref hash', (f) => (f.payload.operatorEvidence[0].sha256 = '0'.repeat(64))],
    ['nested ref job', (f) => (f.payload.operatorBeforeEvidence.jobId = registrationIds.operator)],
    [
      'nested ref duplicate',
      (f) => (f.payload.operatorEvidence[1] = f.payload.operatorEvidence[0]),
    ],
    ['nested path forbidden', (f) => (f.payload.originalEvidence[0].path = 'PRIVATE_PATH')],
    ['approval order', (f) => (f.payload.approvedAt = registrationAt(16))],
    ['document fixture', (f) => (f.doc.collectionMode = 'fixture')],
    ['job status', (f) => (f.job.status = 'queued')],
    ['job kind', (f) => (f.job.kind = 'write')],
    ['job input hash', (f) => (f.job.input_hash = '0'.repeat(64))],
    ['job operation', (f) => (f.job.operation = 'refresh')],
    ['job datasets', (f) => (f.job.datasets_json = canonical(['short_works']))],
    ['job original binding', (f) => (f.job.idempotency_key = registrationIds.operator)],
    ['job metadata', (f) => (f.job.metadata.operatorJobId = registrationIds.before)],
    [
      'job result',
      (f) => (f.job.result = { manifest: { ...f.manifest, authorityHash: '0'.repeat(64) } }),
    ],
    ['job read boundary', (f) => (f.job.read_started_at = registrationAt(14))],
    ['job write boundary', (f) => (f.job.write_started_at = registrationAt(14))],
    ['job error', (f) => (f.job.error_json = canonical({ code: 'PRIVATE_FAILURE' }))],
    ['job cancellation', (f) => (f.job.cancellation_requested_at = registrationAt(14))],
    [
      'job target',
      (f) => (f.job.target_json = canonical({ kind: 'short-story', id: '7000000002' })),
    ],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async () =>
      temporary(async (root) => {
        const fixture = await registrationArchiveFixture(root);
        mutate(fixture);
        await fixture.persist();
        assert.throws(() => verifyDataDirectory(root));
      }),
    );
});

test('administrative registration rejects foreign related job, extra registration row and any current pointer', async () => {
  for (const kind of ['foreign-job', 'extra-evidence', 'extra-manifest', 'current-pointer'])
    await temporary(async (root) => {
      const fixture = await registrationArchiveFixture(root),
        db = new DatabaseSync(path.join(root, 'operations.sqlite'));
      try {
        if (kind === 'foreign-job')
          db.prepare('UPDATE jobs SET account_id=? WHERE id=?').run(
            'foreign-fixture',
            registrationIds.operator,
          );
        if (kind === 'extra-evidence') {
          const doc = { ...fixture.doc, evidenceId: registrationRefId(9) },
            bytes = Buffer.from(`${canonical(doc)}\n`),
            ref = {
              ...fixture.ref,
              id: doc.evidenceId,
              path: 'fixture/registration-extra.json',
              sha256: digest(bytes),
            };
          await writeFile(path.join(root, 'evidence', ref.path), bytes);
          db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)').run(
            ref.id,
            ref.accountId,
            ref.jobId,
            ref.dataset,
            ref.capturedAt,
            ref.path,
            ref.sha256,
          );
        }
        if (kind === 'extra-manifest')
          db.prepare('INSERT INTO manifests VALUES(?,?,?,?,?,?)').run(
            '43000000-0000-4000-8000-000000000001',
            fixture.accountId,
            registrationIds.job,
            fixture.manifest.scope,
            fixture.manifest.committedAt,
            canonical({ ...fixture.manifest, id: '43000000-0000-4000-8000-000000000001' }),
          );
        if (kind === 'current-pointer')
          db.prepare('INSERT INTO current_manifests VALUES(?,?,?)').run(
            fixture.accountId,
            fixture.manifest.scope,
            fixture.manifest.id,
          );
      } finally {
        db.close();
      }
      assert.throws(() => verifyDataDirectory(root));
    });
});

test('administrative registration accepts raw receipt whitespace beyond 32KiB when parsed JSON remains bounded and all outer hashes match', async () =>
  temporary(async (root) => {
    const fixture = await registrationArchiveFixture(root),
      authority = fixture.payload.authority,
      descriptor = authority.receipts.controller;
    descriptor.bytes += ' '.repeat(33 * 1024);
    descriptor.sha256 = digest(descriptor.bytes);
    assert(Buffer.byteLength(descriptor.bytes) > 32 * 1024);
    assert(Buffer.byteLength(canonical(JSON.parse(descriptor.bytes))) < 32 * 1024);
    assert(Buffer.byteLength(canonical(authority)) < 64 * 1024);
    const authorityHash = digest(canonical(authority));
    fixture.payload.authorityHash =
      fixture.manifest.authorityHash =
      fixture.job.metadata.authorityHash =
        authorityHash;
    const input = {
      schema: 'native-short-metadata-compensation-registration-input/v1',
      accountId: fixture.payload.accountId,
      originalJobId: fixture.payload.originalJobId,
      operatorJobId: fixture.payload.operatorJobId,
      authority,
      approvedAt: fixture.payload.approvedAt,
      effectsEndedAt: fixture.payload.effectsEndedAt,
    };
    fixture.manifest.inputHash = fixture.job.input_hash = digest(canonical(input));
    assert(Buffer.byteLength(`${canonical(fixture.doc)}\n`) <= 64 * 1024);
    await fixture.persist();
    const before = digest(await readFile(path.join(root, 'operations.sqlite'))),
      evidenceBefore = digest(await readFile(path.join(root, 'evidence', fixture.ref.path)));
    assert.deepEqual(verifyDataDirectory(root), {
      jobs: 5,
      evidence: 9,
      manifests: 2,
      currentPointers: 1,
      profileFiles: 1,
      profileLinks: 0,
    });
    assert.equal(digest(await readFile(path.join(root, 'operations.sqlite'))), before);
    assert.equal(
      digest(await readFile(path.join(root, 'evidence', fixture.ref.path))),
      evidenceBefore,
    );
  }));

test('administrative registration rejects deleted schema and schema1 disguise, including current pointers', async (t) => {
  for (const downgrade of [false, true])
    for (const currentPointer of [false, true])
      await t.test(
        `${downgrade ? 'schema1 disguise' : 'deleted schema'}${currentPointer ? ' with current pointer' : ''}`,
        async () =>
          temporary(async (root) => {
            const fixture = await registrationArchiveFixture(root);
            delete fixture.manifest.schema;
            if (downgrade) {
              fixture.manifest.schemaVersion = 1;
              fixture.manifest.platformReadStartedAt = registrationAt(14);
            }
            await fixture.persist();
            if (currentPointer) {
              const db = new DatabaseSync(path.join(root, 'operations.sqlite'));
              try {
                db.prepare('INSERT INTO current_manifests VALUES(?,?,?)').run(
                  fixture.accountId,
                  fixture.manifest.scope,
                  fixture.manifest.id,
                );
              } finally {
                db.close();
              }
            }
            assert.throws(() => verifyDataDirectory(root), { code: 'manifest_schema_invalid' });
          }),
      );
});
