import {
  type CapturedGenericShortGraph,
  type RuntimeFailure,
  type EvidenceRef,
  type GenericGraphNode,
  writeTaskTime,
} from '../runtime-error.js';
import {
  hash,
  type NativeReconciliationRow,
  nativeUnknownError,
  canonicalJson,
  identifier,
} from '../native-closure-signal.js';
import {
  genericUnavailable,
  genericDigest,
  genericObject,
  genericSame,
  genericJobKeys,
  hasGenericShortStatusSignal,
  genericRefKeys,
} from '../has-generic-short-status-signal.js';
import {
  type GenericPointerOperation,
  type GenericPrefixOperation,
  type GenericSettlementErrorOperation,
  type GenericWitnessOperation,
  type GenericModernObservationsOperation,
  type GenericLegacySnapshotOperation,
  type GenericHistoricalOperation,
} from '../contracts/generic-status-generic-refs.js';

import {
  type ModernShortSnapshot,
  validateGenericShortSnapshot,
  isModernShortSnapshot,
  hashDraftContent,
} from '../../../platform/writes.js';

interface GenericPointerDependencies {}

export function createGenericPointer(deps: GenericPointerDependencies): GenericPointerOperation {
  function genericPointer(row: NativeReconciliationRow, graph: CapturedGenericShortGraph) {
    const node = graph.jobs[row.readJobId],
      ref = node?.refs.find((value) => value.id === row.evidenceId);
    if (!ref) return genericUnavailable();
    return {
      sequence: row.sequence,
      id: row.id,
      originalJobId: row.originalJobId,
      readJobId: row.readJobId,
      evidenceId: row.evidenceId,
      status: row.status,
      createdAt: row.createdAt,
      resultHash: hash(row.resultJson),
      evidenceHash: ref.sha256,
    };
  }
  return genericPointer;
}

interface GenericPrefixDependencies {
  genericPointer: GenericPointerOperation;
}

export function createGenericPrefix(deps: GenericPrefixDependencies): GenericPrefixOperation {
  function genericPrefix(rows: NativeReconciliationRow[], graph: CapturedGenericShortGraph) {
    if (!rows.length) return genericUnavailable();
    const pointers = rows.map((row) => deps.genericPointer(row, graph));
    return {
      rowCount: rows.length,
      first: pointers[0],
      last: pointers.at(-1),
      rowsHash: genericDigest(pointers),
    };
  }
  return genericPrefix;
}

interface GenericSettlementErrorDependencies {}

export function createGenericSettlementError(
  deps: GenericSettlementErrorDependencies,
): GenericSettlementErrorOperation {
  function genericSettlementError(status: string): RuntimeFailure | null {
    return status === 'succeeded'
      ? null
      : status === 'uncertain'
        ? nativeUnknownError
        : status === 'failed'
          ? {
              code: 'reconciled_not_applied',
              message:
                'The platform read confirms the requested write was not applied; this idempotency key will not be replayed.',
            }
          : genericUnavailable();
  }
  return genericSettlementError;
}

interface GenericModernObservationsDependencies {
  genericWitness: GenericWitnessOperation;
}

export function createGenericModernObservations(
  deps: GenericModernObservationsDependencies,
): GenericModernObservationsOperation {
  function genericModernObservations(node: GenericGraphNode, production = false) {
    const witness = deps.genericWitness(node.job, node.refs, node.documents, production);
    const observations: Array<{ ref: EvidenceRef; snapshot: ModernShortSnapshot; phase: string }> =
      [];
    if (witness)
      for (let i = 0; i < node.refs.length; i++) {
        const ref = node.refs[i]!,
          payload = genericObject(node.documents[i]!.payload);
        const snapshot =
          ref.dataset === 'reconciliation' ? payload.statusSnapshot : payload.snapshot;
        if (snapshot !== undefined && isModernShortSnapshot(snapshot))
          observations.push({
            ref,
            snapshot: validateGenericShortSnapshot(snapshot),
            phase:
              ref.dataset === 'reconciliation'
                ? 'later_read'
                : ref.dataset === 'creation-repair-verification'
                  ? 'after'
                  : String(payload.phase ?? 'baseline'),
          });
      }
    return { witness, observations };
  }
  return genericModernObservations;
}

interface GenericHistoricalDependencies {
  genericLegacySnapshot: GenericLegacySnapshotOperation;
}

export function createGenericHistorical(
  deps: GenericHistoricalDependencies,
): GenericHistoricalOperation {
  function genericHistorical(node: GenericGraphNode): void {
    if (hasGenericShortStatusSignal([node.job, node.documents, node.manifest]))
      return genericUnavailable();
    genericObject(node.job, genericJobKeys);
    if (node.refs.length !== node.documents.length || node.refs.length > 6)
      return genericUnavailable();
    const metadata = genericObject(node.job.metadata);
    for (const [key, value] of Object.entries(metadata))
      if (
        !identifier.test(key) ||
        !(
          value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && value.length <= 512)
        )
      )
        return genericUnavailable();
    if (Buffer.byteLength(canonicalJson(metadata)) > 8192) return genericUnavailable();
    const inspect = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(inspect);
      const object = genericObject(value);
      return Object.keys(object).some(
        (key) =>
          key === 'statusFacts' ||
          key === 'shortObservation' ||
          key === 'statusProtocol' ||
          key === 'statusProof' ||
          key === 'statusInput' ||
          inspect(object[key]),
      );
    };
    if (inspect(node.job.error)) return genericUnavailable();
    for (let i = 0; i < node.refs.length; i++) {
      const ref = node.refs[i]!,
        doc = node.documents[i]!;
      genericObject(ref, genericRefKeys);
      genericObject(doc, [
        'schemaVersion',
        'evidenceId',
        'accountId',
        'jobId',
        'dataset',
        'capturedAt',
        'collectionMode',
        'evidenceKind',
        'payload',
      ]);
      if (
        doc.schemaVersion !== 1 ||
        doc.evidenceId !== ref.id ||
        doc.jobId !== node.job.id ||
        doc.accountId !== node.job.accountId ||
        ref.jobId !== doc.jobId ||
        ref.accountId !== doc.accountId ||
        doc.dataset !== ref.dataset ||
        doc.capturedAt !== ref.capturedAt ||
        !writeTaskTime(ref.capturedAt) ||
        !/^[a-f0-9]{64}$/.test(ref.sha256) ||
        (node.job.platformReadStartedAt && ref.capturedAt < node.job.platformReadStartedAt) ||
        (node.job.endedAt && ref.capturedAt > node.job.endedAt) ||
        doc.evidenceKind !== (ref.dataset === 'write-intent' ? 'local-intent' : 'observation')
      )
        return genericUnavailable();
      const p = genericObject(doc.payload);
      if (ref.dataset === 'write-result') {
        genericObject(p, [
          'status',
          'capability',
          'target',
          'contentHash',
          'platformState',
          'verifiedAt',
          'sourceUrl',
        ]);
        if (
          p.status !== 'succeeded' ||
          !writeTaskTime(p.verifiedAt) ||
          p.verifiedAt > ref.capturedAt
        )
          return genericUnavailable();
      } else if (ref.dataset === 'write-intent') {
        if (p.phase === 'creation-entry')
          genericObject(
            p,
            ['phase', 'capability', 'clientReferenceHash', 'requestedContentHash'],
            ['target'],
          );
        else genericObject(p, ['desiredContentHash', 'expectedStates', 'target']);
      } else if (ref.dataset === 'reconciliation') {
        genericObject(
          p,
          ['source', 'reconciliation', 'sourceUrl', 'platformReadAt'],
          ['repairVerification'],
        );
        genericObject(p.reconciliation, [
          'originalJobId',
          'target',
          'inputHash',
          'observedContentHash',
          'observedStatus',
        ]);
        if (p.repairVerification !== undefined) deps.genericLegacySnapshot(p.repairVerification);
      } else if (ref.dataset === 'editable_snapshot') {
        const fields = Object.keys(p).filter((key) => key !== 'source');
        deps.genericLegacySnapshot(Object.fromEntries(fields.map((key) => [key, p[key]])));
      } else if (ref.dataset === 'creation-resume-baseline') {
        genericObject(p, ['originalJobId', 'requestedContentHash', 'target', 'snapshot', 'source']);
        deps.genericLegacySnapshot(p.snapshot);
      } else if (ref.dataset === 'creation-repair-baseline') {
        genericObject(p, [
          'originalJobId',
          'recoveryJobId',
          'requestedContentHash',
          'expectedContentHash',
          'target',
          'snapshot',
          'source',
        ]);
        deps.genericLegacySnapshot(p.snapshot);
      } else if (ref.dataset === 'creation-repair-verification') {
        genericObject(p, ['originalJobId', 'recoveryJobId', 'target', 'snapshot', 'source']);
        deps.genericLegacySnapshot(p.snapshot);
      } else return genericUnavailable();
      if (
        ref.dataset !== 'write-intent' &&
        ref.dataset !== 'write-result' &&
        !genericSame(p.source, { mode: 'live', origin: 'https://fanqienovel.com' })
      )
        return genericUnavailable();
    }
  }
  return genericHistorical;
}

interface GenericLegacySnapshotDependencies {}

export function createGenericLegacySnapshot(
  deps: GenericLegacySnapshotDependencies,
): GenericLegacySnapshotOperation {
  function genericLegacySnapshot(input: unknown): void {
    const s = genericObject(
      input,
      [
        'title',
        'body',
        'accountId',
        'target',
        'state',
        'contentHash',
        'sourceUrl',
        'platformReadAt',
      ],
      ['metadata'],
    );
    if (
      typeof s.title !== 'string' ||
      typeof s.body !== 'string' ||
      typeof s.accountId !== 'string' ||
      !/^\d{1,30}$/.test(s.accountId) ||
      !writeTaskTime(s.platformReadAt) ||
      typeof s.contentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(s.contentHash) ||
      !['draft', 'reviewing', 'submitted', 'published', 'rejected'].includes(String(s.state))
    )
      return genericUnavailable();
    const target = genericObject(s.target, ['kind', 'workId']);
    if (
      target.kind !== 'short' ||
      typeof target.workId !== 'string' ||
      !/^\d{10,22}$/.test(target.workId)
    )
      return genericUnavailable();
    if (s.metadata !== undefined)
      genericObject(
        s.metadata,
        [],
        ['description', 'categories', 'aiDeclaration', 'trialRatio', 'cover'],
      );
    if (
      s.contentHash !==
      hashDraftContent({
        title: s.title,
        body: s.body,
        ...(s.metadata === undefined ? {} : { metadata: s.metadata as Record<string, unknown> }),
      })
    )
      return genericUnavailable();
  }
  return genericLegacySnapshot;
}
