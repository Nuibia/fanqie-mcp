import {
  RuntimeError,
  type GenericShortTrustedContext,
  type EvidenceRef,
  type EvidenceDocument,
  existingGenericReads,
} from '../runtime-error.js';
import { canonicalJson, datasetName, hash, timestamp } from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator, capturePublicReadJson } from '../../public-read.js';
import path from 'node:path';
import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  existsSync,
  renameSync,
  unlinkSync,
  lstatSync,
  readFileSync,
} from 'node:fs';
import { hasReservedNativeShortSubmissionSignal } from '../../../platform/short-native-submission-proof.js';
import {
  NATIVE_SHORT_READ_DATASET,
  NATIVE_SHORT_READ_OPERATION,
} from '../../../platform/short-native-metadata-proof.js';
import {
  type AssertOwnershipOperation,
  type TransactionOperation,
  type PrepareOperation,
  type EnsureOpenOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import { type RunningJobOperation } from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type SaveEvidenceOperation,
  type InsertPhysicalEvidenceOperation,
  type ListEvidenceOperation,
  type BindEvidenceReadOperation,
  type ReadEvidenceOperation,
  type ReadEvidenceFreshOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

interface SaveEvidenceDependencies {
  publicReads: PublicReadCoordinator;
  assertOwnership: AssertOwnershipOperation;
  runningJob: RunningJobOperation;
  nativeShortSubmissionEvidenceMode: 'live' | 'fixture';
  genericShortStatusContext: ((jobId: string) => GenericShortTrustedContext | null) | undefined;
  evidenceMode: 'live' | 'fixture';
  explicitBodyReadEvidenceMode: 'live' | 'fixture';
  evidenceDirectory: string;
  transaction: TransactionOperation;
  prepare: PrepareOperation;
}

export function createSaveEvidence(deps: SaveEvidenceDependencies): SaveEvidenceOperation {
  function saveEvidence(jobId: string, dataset: string, payload: unknown): EvidenceRef {
    deps.publicReads.assertMutationAllowed();
    deps.assertOwnership();
    const job = deps.runningJob(jobId);
    if (!datasetName.test(dataset) || (job.kind === 'read' && !job.datasets.includes(dataset)))
      throw new RuntimeError('invalid_dataset', 'Evidence is outside this job dataset scope.');
    const isIntent = job.kind === 'write' && dataset === 'write-intent';
    if (!isIntent && !job.platformReadStartedAt && !job.platformWriteStartedAt)
      throw new RuntimeError(
        'platform_not_accessed',
        'Mark the real platform access boundary before saving evidence.',
      );
    if (isIntent) {
      const serialized = canonicalJson(payload);
      const prohibited =
        /"(?:body|content|text|html|markdown|args|arguments|cookie|cookies|authorization|token|accessToken|refreshToken|password|secret|credentials|headers|storageState)"\s*:/i;
      if (prohibited.test(serialized) || Buffer.byteLength(serialized) > 16384)
        throw new RuntimeError(
          'invalid_write_intent',
          'Write intent stores hashes, stable target and expected states, never content or credentials.',
        );
    }
    const id = randomUUID();
    const capturedAt = timestamp();
    const collectionMode = hasReservedNativeShortSubmissionSignal([job, payload])
      ? deps.nativeShortSubmissionEvidenceMode
      : Object.hasOwn(job.metadata, 'genericShortStatus')
        ? (deps.genericShortStatusContext?.(job.id)?.provenance.mode ?? deps.evidenceMode)
        : job.kind === 'read' &&
            job.operation === NATIVE_SHORT_READ_OPERATION &&
            dataset === NATIVE_SHORT_READ_DATASET &&
            job.metadata.explicitBodyRead === true
          ? deps.explicitBodyReadEvidenceMode
          : deps.evidenceMode;
    const document: EvidenceDocument = {
      schemaVersion: 1,
      evidenceId: id,
      accountId: job.accountId,
      jobId,
      dataset,
      capturedAt,
      collectionMode,
      evidenceKind: isIntent ? 'local-intent' : 'observation',
      payload,
    };
    const bytes = Buffer.from(`${canonicalJson(document)}\n`, 'utf8');
    const relative = path.join(hash(job.accountId).slice(0, 24), dataset, `${id}.json`);
    const destination = path.join(deps.evidenceDirectory, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (existsSync(destination))
        throw new RuntimeError('evidence_exists', 'Immutable evidence already exists.');
      renameSync(temporary, destination);
      const directory = openSync(path.dirname(destination), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    const reference: EvidenceRef = {
      id,
      accountId: job.accountId,
      jobId,
      dataset,
      capturedAt,
      path: relative.split(path.sep).join('/'),
      sha256: hash(bytes),
    };
    deps.transaction(() => {
      deps.runningJob(jobId);
      deps
        .prepare(
          'INSERT INTO evidence(id, account_id, job_id, dataset, captured_at, path, sha256) VALUES(?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, job.accountId, jobId, dataset, capturedAt, reference.path, reference.sha256);
    });
    return reference;
  }
  return saveEvidence;
}

interface InsertPhysicalEvidenceDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
}

export function createInsertPhysicalEvidence(
  deps: InsertPhysicalEvidenceDependencies,
): InsertPhysicalEvidenceOperation {
  function insertPhysicalEvidence(ref: EvidenceRef): void {
    deps.publicReads.assertMutationAllowed();
    deps
      .prepare(
        'INSERT INTO evidence(id,account_id,job_id,dataset,captured_at,path,sha256) VALUES(?,?,?,?,?,?,?)',
      )
      .run(ref.id, ref.accountId, ref.jobId, ref.dataset, ref.capturedAt, ref.path, ref.sha256);
  }
  return insertPhysicalEvidence;
}

interface ListEvidenceDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createListEvidence(deps: ListEvidenceDependencies): ListEvidenceOperation {
  function listEvidence(jobId: string): EvidenceRef[] {
    return deps.publicReads.memo('store.listEvidence', [jobId], () => {
      deps.ensureOpen();
      return deps
        .prepare(existingGenericReads.refs)
        .all(jobId)
        .map((row) => ({
          id: String(row.id),
          accountId: String(row.account_id),
          jobId: String(row.job_id),
          dataset: String(row.dataset),
          capturedAt: String(row.captured_at),
          path: String(row.path),
          sha256: String(row.sha256),
        }));
    });
  }
  return listEvidence;
}

interface ReadEvidenceDependencies {
  publicReads: PublicReadCoordinator;
  bindEvidenceRead: BindEvidenceReadOperation;
}

export function createReadEvidence(deps: ReadEvidenceDependencies): ReadEvidenceOperation {
  function readEvidence(reference: EvidenceRef): EvidenceDocument {
    deps.publicReads.assertReadAllowed();
    const captured = deps.publicReads.isActive() ? capturePublicReadJson(reference) : reference;
    return deps.bindEvidenceRead(captured).tracked().document;
  }
  return readEvidence;
}

interface ReadEvidenceFreshDependencies {
  ensureOpen: EnsureOpenOperation;
  evidenceDirectory: string;
}

export function createReadEvidenceFresh(
  deps: ReadEvidenceFreshDependencies,
): ReadEvidenceFreshOperation {
  function readEvidenceFresh(
    reference: EvidenceRef,
    mark: (input: unknown) => void,
    readStored: () => unknown,
  ): EvidenceDocument {
    deps.ensureOpen();
    mark({ reference });
    const durable = readStored() as Record<string, unknown> | undefined;
    mark({ stored: durable });
    if (
      !durable ||
      String(durable.path) !== reference.path ||
      String(durable.sha256) !== reference.sha256 ||
      String(durable.account_id) !== reference.accountId ||
      String(durable.job_id) !== reference.jobId ||
      String(durable.dataset) !== reference.dataset ||
      String(durable.captured_at) !== reference.capturedAt
    ) {
      throw new RuntimeError(
        'evidence_binding_invalid',
        'Evidence reference does not match its durable record.',
      );
    }
    const file = path.resolve(deps.evidenceDirectory, reference.path);
    const relative = path.relative(deps.evidenceDirectory, file);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new RuntimeError(
        'evidence_path_invalid',
        'Evidence path escapes the evidence directory.',
      );
    mark({ file, relative });
    let bytes: Buffer;
    try {
      let cursor = deps.evidenceDirectory;
      for (const component of relative.split(path.sep)) {
        cursor = path.join(cursor, component);
        mark({ attempt: cursor });
        const observed = lstatSync(cursor);
        mark({
          path: cursor,
          dev: observed.dev,
          ino: observed.ino,
          mode: observed.mode,
          nlink: observed.nlink,
          size: observed.size,
          mtimeMs: observed.mtimeMs,
          ctimeMs: observed.ctimeMs,
        });
        if (observed.isSymbolicLink())
          throw new RuntimeError(
            'evidence_path_invalid',
            'Evidence paths must not contain symbolic links.',
          );
      }
      mark({ attempt: file });
      const metadata = lstatSync(file);
      mark({
        path: file,
        dev: metadata.dev,
        ino: metadata.ino,
        mode: metadata.mode,
        nlink: metadata.nlink,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        ctimeMs: metadata.ctimeMs,
      });
      if (!metadata.isFile() || metadata.nlink !== 1)
        throw new RuntimeError(
          'evidence_path_invalid',
          'Evidence must be an ordinary file without hard links.',
        );
      bytes = readFileSync(file);
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('evidence_missing', 'Evidence file is missing.', {
        evidenceId: reference.id,
      });
    }
    const bytesHash = hash(bytes);
    mark({ bytesHash });
    if (bytesHash !== reference.sha256)
      throw new RuntimeError('evidence_hash_invalid', 'Evidence bytes failed SHA-256 validation.', {
        evidenceId: reference.id,
      });
    const document = JSON.parse(bytes.toString('utf8')) as EvidenceDocument;
    if (
      document.schemaVersion !== 1 ||
      document.evidenceId !== reference.id ||
      document.accountId !== reference.accountId ||
      document.jobId !== reference.jobId ||
      document.dataset !== reference.dataset ||
      document.capturedAt !== reference.capturedAt
    ) {
      throw new RuntimeError(
        'evidence_binding_invalid',
        'Evidence document identity does not match its reference.',
      );
    }
    return document;
  }
  return readEvidenceFresh;
}
