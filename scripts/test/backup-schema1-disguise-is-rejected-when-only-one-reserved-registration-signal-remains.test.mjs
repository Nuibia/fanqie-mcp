import test from 'node:test';

import { temporary, registrationAt } from './helpers/backup-mock-docker.mjs';

import { registrationArchiveFixture } from './helpers/backup-registration-archive-fixture.mjs';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import assert from 'node:assert/strict';

import { verifyDataDirectory } from '../lib/verify-data.mjs';

test('schema1 disguise is rejected when only one reserved registration signal remains', async (t) => {
  const cases = [
    ['operation', (f) => (f.manifest.operation = 'register_native_compensation_attestation')],
    ['scope', (f) => (f.manifest.scope = 'native_compensation_attestation.disguised')],
    [
      'dataset',
      (f) => {
        f.manifest.datasets = ['native_compensation_attestation'];
        f.ref.dataset = f.doc.dataset = 'native_compensation_attestation';
      },
    ],
    ['manifest datasets', (f) => (f.manifest.datasets = ['native_compensation_attestation'])],
    [
      'database row scope',
      () => {},
      (db, f) =>
        db
          .prepare('UPDATE manifests SET scope=? WHERE id=?')
          .run('native_compensation_attestation.disguised', f.manifest.id),
    ],
    [
      'manifest evidence dataset',
      (f) => (f.manifest.evidence = [{ ...f.ref, dataset: 'native_compensation_attestation' }]),
    ],
    [
      'stored evidence dataset',
      (f) => {
        f.manifest.evidence = [{ ...f.ref }];
        f.ref.dataset = f.doc.dataset = 'native_compensation_attestation';
      },
    ],
    [
      'database job operation',
      (f) => (f.job.operation = 'register_native_compensation_attestation'),
    ],
  ];
  for (const [name, restoreSignal, mutateRow] of cases)
    await t.test(name, async () =>
      temporary(async (root) => {
        const fixture = await registrationArchiveFixture(root);
        delete fixture.manifest.schema;
        fixture.manifest.schemaVersion = 1;
        fixture.manifest.platformReadStartedAt = registrationAt(14);
        fixture.manifest.operation = fixture.job.operation = 'refresh';
        fixture.manifest.scope = 'short_works';
        fixture.manifest.datasets = ['short_works'];
        fixture.ref.dataset = fixture.doc.dataset = 'short_works';
        restoreSignal(fixture);
        await fixture.persist();
        if (mutateRow) {
          const db = new DatabaseSync(path.join(root, 'operations.sqlite'));
          try {
            mutateRow(db, fixture);
          } finally {
            db.close();
          }
        }
        assert.throws(() => verifyDataDirectory(root), { code: 'manifest_schema_invalid' });
      }),
    );
});
