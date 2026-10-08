import { realpathSync, lstatSync, readFileSync } from 'node:fs';

import path from 'node:path';

import {
  fail,
  REGISTRATION_OPERATION,
  identifier,
  dataset,
  timestamp,
  hash,
  parse,
  plain,
  REGISTRATION_DATASET,
  REGISTRATION_SCHEMA,
  registrationSignal,
} from './parse.mjs';

import { DatabaseSync } from 'node:sqlite';

import {
  inside,
  validateRegistrationManifest,
  countProfile,
} from './validate-registration-manifest.mjs';

/** Read-only validator. Only returns counts; no payload, account IDs, names, or profile bytes. */
export function verifyDataDirectory(directory) {
  const root = realpathSync(directory);
  const databasePath = path.join(root, 'operations.sqlite');
  const dbInfo = lstatSync(databasePath);
  if (!dbInfo.isFile() || dbInfo.isSymbolicLink()) fail('database_file_invalid');
  const evidenceRoot = path.join(root, 'evidence');
  if (!lstatSync(evidenceRoot).isDirectory() || lstatSync(evidenceRoot).isSymbolicLink())
    fail('evidence_directory_invalid');
  const resolvedEvidenceRoot = realpathSync(evidenceRoot);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok')
      fail('sqlite_integrity_failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) fail('sqlite_foreign_keys_failed');
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of ['jobs', 'evidence', 'manifests', 'current_manifests'])
      if (!tables.has(table)) fail('database_schema_invalid');
    const jobs = db.prepare('SELECT id, account_id FROM jobs').all();
    const jobAccounts = new Map(jobs.map((job) => [String(job.id), String(job.account_id)]));
    const registrationJobs = new Set(
      db
        .prepare('PRAGMA table_info(jobs)')
        .all()
        .some((column) => column.name === 'operation')
        ? db
            .prepare('SELECT id FROM jobs WHERE operation=?')
            .all(REGISTRATION_OPERATION)
            .map((job) => String(job.id))
        : [],
    );
    const evidence = db.prepare('SELECT * FROM evidence').all();
    const references = new Map();
    const registrationDocuments = new Map();
    for (const row of evidence) {
      const ref = {
        id: String(row.id),
        accountId: String(row.account_id),
        jobId: String(row.job_id),
        dataset: String(row.dataset),
        capturedAt: String(row.captured_at),
        path: String(row.path),
        sha256: String(row.sha256),
      };
      if (
        !identifier.test(ref.id) ||
        !identifier.test(ref.accountId) ||
        !identifier.test(ref.jobId) ||
        !dataset.test(ref.dataset) ||
        !timestamp(ref.capturedAt) ||
        !/^[a-f0-9]{64}$/.test(ref.sha256) ||
        jobAccounts.get(ref.jobId) !== ref.accountId
      )
        fail('evidence_reference_schema_invalid');
      if (
        !ref.path ||
        path.isAbsolute(ref.path) ||
        ref.path.includes('\\') ||
        ref.path.split('/').some((part) => !part || part === '.' || part === '..')
      )
        fail('evidence_path_invalid');
      const filename = path.join(evidenceRoot, ref.path);
      const info = lstatSync(filename);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !inside(resolvedEvidenceRoot, realpathSync(filename))
      )
        fail('evidence_file_invalid');
      const bytes = readFileSync(filename);
      if (hash(bytes) !== ref.sha256) fail('evidence_hash_mismatch');
      const doc = parse(bytes.toString('utf8'));
      if (
        !plain(doc) ||
        doc.schemaVersion !== 1 ||
        doc.evidenceId !== ref.id ||
        doc.accountId !== ref.accountId ||
        doc.jobId !== ref.jobId ||
        doc.dataset !== ref.dataset ||
        doc.capturedAt !== ref.capturedAt ||
        !['live', 'fixture'].includes(doc.collectionMode) ||
        !['observation', 'local-intent'].includes(doc.evidenceKind) ||
        !Object.hasOwn(doc, 'payload')
      )
        fail('evidence_document_schema_invalid');
      if ((ref.dataset === 'write-intent') !== (doc.evidenceKind === 'local-intent'))
        fail('evidence_provenance_invalid');
      references.set(ref.id, ref);
      if (ref.dataset === REGISTRATION_DATASET) {
        registrationDocuments.set(ref.id, { document: doc, bytes });
        registrationJobs.add(ref.jobId);
      }
    }
    const manifests = db.prepare('SELECT * FROM manifests').all();
    const manifestLookup = new Map();
    const registrationManifestIds = new Set();
    for (const row of manifests) {
      const manifest = parse(String(row.manifest_json));
      const exactRegistrationSchema = plain(manifest) && manifest.schema === REGISTRATION_SCHEMA;
      const registration = registrationSignal(manifest, row, registrationJobs);
      if (
        !exactRegistrationSchema &&
        (registration || (plain(manifest) && Object.hasOwn(manifest, 'schema')))
      )
        fail('manifest_schema_invalid');
      if (registration) {
        validateRegistrationManifest(
          db,
          row,
          manifest,
          jobAccounts,
          references,
          registrationDocuments,
        );
        registrationManifestIds.add(String(row.id));
      } else if (
        !plain(manifest) ||
        manifest.schemaVersion !== 1 ||
        manifest.id !== row.id ||
        manifest.accountId !== row.account_id ||
        manifest.jobId !== row.job_id ||
        manifest.scope !== row.scope ||
        manifest.committedAt !== row.committed_at ||
        jobAccounts.get(manifest.jobId) !== manifest.accountId ||
        !identifier.test(manifest.id) ||
        !identifier.test(manifest.operation) ||
        !identifier.test(manifest.scope) ||
        !timestamp(manifest.requestedAt) ||
        !timestamp(manifest.platformReadStartedAt) ||
        !timestamp(manifest.committedAt)
      )
        fail('manifest_schema_invalid');
      if (
        !Array.isArray(manifest.datasets) ||
        !manifest.datasets.length ||
        manifest.datasets.some((name) => typeof name !== 'string' || !dataset.test(name)) ||
        new Set(manifest.datasets).size !== manifest.datasets.length ||
        !Array.isArray(manifest.evidence) ||
        manifest.evidence.length !== manifest.datasets.length
      )
        fail('manifest_coverage_invalid');
      const found = new Set();
      for (const ref of manifest.evidence) {
        const stored = plain(ref) ? references.get(ref.id) : undefined;
        if (
          !stored ||
          stored.jobId !== manifest.jobId ||
          stored.accountId !== manifest.accountId ||
          !manifest.datasets.includes(stored.dataset) ||
          found.has(stored.dataset)
        )
          fail('manifest_reference_invalid');
        for (const key of ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256'])
          if (ref[key] !== stored[key]) fail('manifest_reference_mismatch');
        found.add(stored.dataset);
      }
      manifestLookup.set(String(row.id), manifest);
    }
    const pointers = db.prepare('SELECT * FROM current_manifests').all();
    for (const pointer of pointers) {
      const manifest = manifestLookup.get(String(pointer.manifest_id));
      if (
        !manifest ||
        registrationManifestIds.has(String(pointer.manifest_id)) ||
        manifest.accountId !== pointer.account_id ||
        manifest.scope !== pointer.scope
      )
        fail('current_pointer_invalid');
    }
    return {
      jobs: jobs.length,
      evidence: evidence.length,
      manifests: manifests.length,
      currentPointers: pointers.length,
      ...countProfile(path.join(root, 'profile')),
    };
  } finally {
    db.close();
  }
}
