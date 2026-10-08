import {
  type EvidenceRef,
  type StoreReadPort,
  type EvidenceObservation,
  existingGenericReads,
  RuntimeError,
} from '../runtime-error.js';
import { PublicReadCoordinator, capturePublicReadJson } from '../../public-read.js';
import { lstatSync } from 'node:fs';
import {
  type PublicEvidenceFileSizeOperation,
  type ReadEvidenceFreshOperation,
  type BindEvidenceReadOperation,
  type PrefetchPublicRowsOperation,
  type EnsurePublicEvidenceIndexOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { canonicalJson } from '../native-closure-signal.js';

import { captureShortStatusJson } from '../../../platform/short-status.js';
import { genericUnavailable } from '../has-generic-short-status-signal.js';
import {
  type BindExistingSqlReadOperation,
  type RawAccountAttemptRowsOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type EnsureOpenOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { DatabaseSync } from 'node:sqlite';

interface PublicEvidenceFileSizeDependencies {
  publicReads: PublicReadCoordinator;
}

export function createPublicEvidenceFileSize(
  deps: PublicEvidenceFileSizeDependencies,
): PublicEvidenceFileSizeOperation {
  function publicEvidenceFileSize(ref: EvidenceRef, file: string): number {
    return deps.publicReads.file(['evidence-size', ref, file], (mark) => {
      mark({ ref, attempt: file });
      const stat = lstatSync(file);
      mark({
        file,
        dev: stat.dev,
        ino: stat.ino,
        mode: stat.mode,
        nlink: stat.nlink,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      });
      return stat.size;
    });
  }
  return publicEvidenceFileSize;
}

interface BindEvidenceReadDependencies {
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  bindExistingSqlRead: BindExistingSqlReadOperation;
  readEvidenceFresh: ReadEvidenceFreshOperation;
  ensureOpen: EnsureOpenOperation;
  publicReads: PublicReadCoordinator;
}

export function createBindEvidenceRead(
  deps: BindEvidenceReadDependencies,
): BindEvidenceReadOperation {
  function bindEvidenceRead(ref: EvidenceRef): StoreReadPort<EvidenceObservation> {
    const reference = captureShortStatusJson(ref) as EvidenceRef,
      scope = deps.genericReadScope,
      key = canonicalJson(reference);
    const existing = scope?.files.get(key);
    if (existing) return existing;
    const durable = deps.bindExistingSqlRead(existingGenericReads.durableRef, 'get', [
      reference.id,
    ]);
    const physical = (forward: (input: unknown) => void): EvidenceObservation => {
      const marks: unknown[] = [];
      const mark = (input: unknown) => {
        const value = capturePublicReadJson(input, true);
        marks.push(value);
        forward(value);
      };
      const document = deps.readEvidenceFresh(reference, mark, durable.native);
      return { document, marks };
    };
    const native = () => {
      deps.ensureOpen();
      if (scope && (!scope.open || deps.genericReadScope !== scope)) return genericUnavailable();
      return physical(() => {});
    };
    const port = Object.freeze({
      native,
      tracked: () => {
        durable.tracked();
        return deps.publicReads.file(reference, physical);
      },
    });
    scope?.files.set(key, port);
    return port;
  }
  return bindEvidenceRead;
}

interface PrefetchPublicRowsDependencies {
  rawAccountAttemptRows: RawAccountAttemptRowsOperation;
  prepare: PrepareOperation;
  publicReads: PublicReadCoordinator;
  bindExistingSqlRead: BindExistingSqlReadOperation;
}

export function createPrefetchPublicRows(
  deps: PrefetchPublicRowsDependencies,
): PrefetchPublicRowsOperation {
  function prefetchPublicRows(accountId: string): void {
    let rows: ReturnType<ReturnType<DatabaseSync['prepare']>['all']>, allRefs: typeof rows;
    try {
      rows = deps.rawAccountAttemptRows(accountId);
      allRefs = deps
        .prepare(
          'SELECT e.* FROM evidence e JOIN jobs j ON e.job_id=j.id WHERE j.account_id=? ORDER BY e.rowid',
        )
        .all(accountId);
    } catch {
      return;
    } // A failed optimization is journaled; the original strict family path decides its static fallback.
    const groups = new Map<string, typeof allRefs>();
    for (const ref of allRefs) {
      const id = String(ref.job_id);
      const group = groups.get(id) ?? [];
      group.push(ref);
      groups.set(id, group);
    }
    deps.publicReads.seedSql(
      existingGenericReads.accountIds,
      'all',
      [accountId],
      rows.map((row) => ({ id: row.id })),
      deps.bindExistingSqlRead(existingGenericReads.accountIds, 'all', [accountId]).native,
    );
    for (const row of rows) {
      const id = String(row.id);
      for (const sql of [
        existingGenericReads.rawJob,
        existingGenericReads.filteredJob,
        existingGenericReads.compactFilteredJob,
      ]) {
        const params = sql.includes('account_id') ? [id, accountId] : [id];
        deps.publicReads.seedSql(
          sql,
          'get',
          params,
          row,
          deps.bindExistingSqlRead(sql, 'get', params).native,
        );
      }
      const sql = existingGenericReads.refs;
      deps.publicReads.seedSql(
        sql,
        'all',
        [id],
        groups.get(id) ?? [],
        deps.bindExistingSqlRead(sql, 'all', [id]).native,
      );
    }
  }
  return prefetchPublicRows;
}

interface EnsurePublicEvidenceIndexDependencies {
  db: DatabaseSync;
}

export function createEnsurePublicEvidenceIndex(
  deps: EnsurePublicEvidenceIndexDependencies,
): EnsurePublicEvidenceIndexOperation {
  function ensurePublicEvidenceIndex(): void {
    const check = () => {
      const index = deps.db
        .prepare("SELECT type,tbl_name,sql FROM sqlite_master WHERE name='evidence_job_id'")
        .get();
      if (!index) return false;
      const listed = deps.db
        .prepare("PRAGMA index_list('evidence')")
        .all()
        .find((row) => row.name === 'evidence_job_id');
      const columns = deps.db.prepare("PRAGMA index_info('evidence_job_id')").all();
      const keys = deps.db
        .prepare("PRAGMA index_xinfo('evidence_job_id')")
        .all()
        .filter((row) => row.key === 1);
      if (
        index.type !== 'index' ||
        index.tbl_name !== 'evidence' ||
        typeof index.sql !== 'string' ||
        !listed ||
        listed.unique !== 0 ||
        listed.partial !== 0 ||
        columns.length !== 1 ||
        columns[0]?.name !== 'job_id' ||
        Number(columns[0]?.cid) < 0 ||
        keys.length !== 1 ||
        keys[0]?.name !== 'job_id' ||
        keys[0]?.desc !== 0 ||
        keys[0]?.coll !== 'BINARY'
      )
        throw new RuntimeError(
          'invalid_configuration',
          'The public evidence index is unavailable.',
        );
      return true;
    };
    check();
    deps.db.exec('CREATE INDEX IF NOT EXISTS evidence_job_id ON evidence(job_id)');
    if (!check())
      throw new RuntimeError('invalid_configuration', 'The public evidence index is unavailable.');
  }
  return ensurePublicEvidenceIndex;
}
