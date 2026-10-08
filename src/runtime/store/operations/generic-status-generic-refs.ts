import {
  type EvidenceRef,
  existingGenericReads,
  type Manifest,
  type GenericGraphNode,
  existingGenericLedgerSql,
  writeTaskUuid,
  type CapturedGenericShortGraph,
  type StoreReadPort,
  type EvidenceObservation,
  type PrivateGenericShortReadPlan,
} from '../runtime-error.js';
import path from 'node:path';
import {
  genericUnavailable,
  genericObject,
  genericSqlCapture,
} from '../has-generic-short-status-signal.js';
import {
  type GenericRefsOperation,
  type GenericRawNodeOperation,
  type GenericReadGraphOperation,
  type CaptureGenericShortPublicationGraphOperation,
} from '../contracts/generic-status-generic-refs.js';

import { type NativeReconciliationRow } from '../native-closure-signal.js';
import { captureShortStatusJson } from '../../../platform/short-status.js';
import {
  type BindExistingSqlReadOperation,
  type DecodeJobOperation,
  type RawAccountAttemptRowsOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import { type BindEvidenceReadOperation } from '../contracts/evidence-public-evidence-file-size.js';

import { type Store } from '../authority.js';

interface GenericRefsDependencies {}

export function createGenericRefs(deps: GenericRefsDependencies): GenericRefsOperation {
  function genericRefs(rows: unknown): EvidenceRef[] {
    if (!Array.isArray(rows)) return genericUnavailable();
    return rows.map((value) => {
      const row = genericObject(value);
      return {
        id: String(row.id),
        accountId: String(row.account_id),
        jobId: String(row.job_id),
        dataset: String(row.dataset),
        capturedAt: String(row.captured_at),
        path: String(row.path),
        sha256: String(row.sha256),
      };
    });
  }
  return genericRefs;
}

interface GenericRawNodeDependencies {
  bindExistingSqlRead: BindExistingSqlReadOperation;
  decodeJob: DecodeJobOperation;
  genericRefs: GenericRefsOperation;
  bindEvidenceRead: BindEvidenceReadOperation;
}

export function createGenericRawNode(deps: GenericRawNodeDependencies): GenericRawNodeOperation {
  function genericRawNode(
    id: string,
    accountId: string,
    mode: 'tracked' | 'native' = 'tracked',
  ): GenericGraphNode | null {
    const row = deps
      .bindExistingSqlRead<Record<string, unknown> | undefined>(
        existingGenericReads.rawJob,
        'get',
        [id],
      )
      [mode]();
    if (!row) return null;
    const job = deps.decodeJob(genericObject(row));
    if (job.accountId !== accountId) return genericUnavailable();
    const refs = deps.genericRefs(
      deps.bindExistingSqlRead(existingGenericReads.refs, 'all', [id])[mode](),
    );
    const documents = refs.map((ref) => deps.bindEvidenceRead(ref)[mode]().document);
    const rows = deps
      .bindExistingSqlRead<Record<string, unknown>[]>(existingGenericReads.manifest, 'all', [
        accountId,
        id,
      ])
      [mode]();
    if (rows.length > 1) return genericUnavailable();
    let manifest: Manifest | null = null;
    if (rows.length) {
      const row = rows[0]!;
      manifest = captureShortStatusJson(JSON.parse(String(row.manifest_json))) as Manifest;
      if (
        row.id !== manifest.id ||
        row.account_id !== manifest.accountId ||
        row.job_id !== manifest.jobId ||
        row.scope !== manifest.scope ||
        row.committed_at !== manifest.committedAt
      )
        return genericUnavailable();
    }
    const ledger: NativeReconciliationRow[] = [];
    let before: number | undefined;
    for (;;) {
      const row = deps
        .bindExistingSqlRead<Record<string, unknown> | undefined>(
          existingGenericLedgerSql('last', before),
          'get',
          before === undefined ? [id] : [id, before],
        )
        [mode]();
      if (!row) break;
      const value = {
        sequence: Number(row.sequence),
        id: String(row.id),
        originalJobId: String(row.original_job_id),
        readJobId: String(row.read_job_id),
        evidenceId: String(row.evidence_id),
        status: String(row.status),
        createdAt: String(row.created_at),
        resultJson: String(row.result_json),
      };
      if (
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 1 ||
        (before !== undefined && value.sequence >= before) ||
        ledger.length >= 100_000
      )
        return genericUnavailable();
      ledger.push(value);
      before = value.sequence;
    }
    ledger.reverse();
    // Presence and absence of each original relationship read are captured too.
    const relations: Record<string, unknown> = {};
    for (const [name, sql] of [
      ['recovery', existingGenericReads.recovery],
      ['recoverySummary', existingGenericReads.recoverySummary],
      ['repairSummary', existingGenericReads.repairSummary],
      ['successor', existingGenericReads.successor],
      ['successorSummary', existingGenericReads.successorSummary],
      ['repairById', existingGenericReads.repairById],
    ] as const) {
      const value = deps.bindExistingSqlRead(sql, 'get', [id])[mode]();
      relations[name] = value ?? null;
    }
    return { job, refs, documents, manifest, ledger, relations };
  }
  return genericRawNode;
}

interface GenericReadGraphDependencies {
  rawAccountAttemptRows: RawAccountAttemptRowsOperation;
  bindExistingSqlRead: BindExistingSqlReadOperation;
  genericRawNode: GenericRawNodeOperation;
}

export function createGenericReadGraph(
  deps: GenericReadGraphDependencies,
): GenericReadGraphOperation {
  function genericReadGraph(
    originalId: string,
    accountId: string,
    mode: 'tracked' | 'native',
  ): CapturedGenericShortGraph {
    const rawJobs = deps.rawAccountAttemptRows(accountId, mode);
    const rawManifests = deps
      .bindExistingSqlRead<unknown[]>(existingGenericReads.accountManifests, 'all', [accountId])
      [mode]();
    const safeJobs = captureShortStatusJson(rawJobs) as Record<string, unknown>[],
      safeManifests = captureShortStatusJson(rawManifests) as Record<string, unknown>[];
    const ids = new Set<string>();
    for (const row of safeJobs) {
      if (!writeTaskUuid(row.id)) return genericUnavailable();
      ids.add(row.id);
    }
    for (const row of safeManifests) {
      const value = genericObject(JSON.parse(String(row.manifest_json)));
      if (!writeTaskUuid(value.jobId)) return genericUnavailable();
      ids.add(value.jobId);
    }
    ids.add(originalId);
    const jobs: Record<string, GenericGraphNode> = {};
    for (const id of ids) {
      const node = deps.genericRawNode(id, accountId, mode);
      if (node) jobs[id] = node;
      else return genericUnavailable();
    }
    // Bind all branch-specific creation sources using the original statements.
    for (const node of Object.values(jobs)) {
      const recovery = node.relations.recovery as Record<string, unknown> | null;
      const root = node.job.id;
      if (recovery) {
        const rid = String(recovery.resume_job_id);
        const rootResult = genericObject(node.job.result ?? {}),
          repairLink = Object.hasOwn(rootResult, 'creationRepair')
            ? genericObject(rootResult.creationRepair)
            : null;
        if (repairLink && typeof repairLink.repairJobId === 'string')
          node.relations.closedSuccessor =
            deps
              .bindExistingSqlRead(existingGenericReads.closedSuccessor, 'get', [
                rid,
                root,
                repairLink.repairJobId,
              ])
              [mode]() ?? null;
        for (const [name, sql, params] of [
          ['firstRepair', existingGenericReads.firstRepair, [root, rid]],
          ['closedRepair', existingGenericReads.closedRepair, [rid, root]],
        ] as const)
          node.relations[name] = deps.bindExistingSqlRead(sql, 'get', params)[mode]() ?? null;
      }
      const witness = genericObject(node.job.metadata).genericShortStatus;
      if (witness !== undefined) {
        const w = genericObject(witness),
          context = w.creationContext === null ? null : genericObject(w.creationContext);
        if (
          context &&
          typeof context.originalJobId === 'string' &&
          typeof context.recoveryJobId === 'string'
        ) {
          node.relations.closedSuccessor =
            deps
              .bindExistingSqlRead(existingGenericReads.closedSuccessor, 'get', [
                context.recoveryJobId,
                context.originalJobId,
                node.job.id,
              ])
              [mode]() ?? null;
          if (typeof context.previousRepairJobId === 'string')
            node.relations.successorByIds =
              deps
                .bindExistingSqlRead(existingGenericReads.successorByIds, 'get', [
                  node.job.id,
                  context.previousRepairJobId,
                ])
                [mode]() ?? null;
        }
      }
      for (const row of node.ledger) {
        node.relations['ledger.' + row.sequence] =
          deps
            .bindExistingSqlRead(existingGenericReads.ledgerJoin, 'get', [
              node.job.id,
              row.readJobId,
              row.status,
            ])
            [mode]() ?? null;
      }
    }
    return captureShortStatusJson({
      originalId,
      accountId,
      jobs,
      rawJobs,
      rawManifests,
    }) as CapturedGenericShortGraph;
  }
  return genericReadGraph;
}

interface CaptureGenericShortPublicationGraphDependencies {
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  genericReadGraph: GenericReadGraphOperation;
  owner: Store;
}

export function createCaptureGenericShortPublicationGraph(
  deps: CaptureGenericShortPublicationGraphDependencies,
): CaptureGenericShortPublicationGraphOperation {
  function captureGenericShortPublicationGraph(
    originalId: string,
    accountId: string,
  ): PrivateGenericShortReadPlan {
    const scope = deps.genericReadScope;
    if (!scope || !scope.open || scope.accountId !== accountId) return genericUnavailable();
    const first = deps.genericReadGraph(originalId, accountId, 'tracked');
    const sql = [...scope.ports.values()].map((port) => ({
      port,
      value: genericSqlCapture(port.tracked()),
    }));
    const files = [...scope.files.values()].map((port) => ({
      port,
      value: captureShortStatusJson(port.tracked()) as EvidenceObservation,
    }));
    return Object.freeze({
      store: deps.owner,
      scope: scope.token,
      originalId,
      accountId,
      first,
      sql,
      files,
    });
  }
  return captureGenericShortPublicationGraph;
}
