import { writeTaskUuid, writeTaskTime, type CapturedGenericShortGraph } from '../runtime-error.js';
import { type NativeReconciliationRow } from '../native-closure-signal.js';

import { genericObject, genericSame } from '../has-generic-short-status-signal.js';

import { type GenericAssociationDependencies } from '../operations/generic-status-generic-association.js';
interface Ports {
  graph: CapturedGenericShortGraph;
  deps: GenericAssociationDependencies;
}
export function createAssociationPointerChecker(ports: Ports) {
  return (value: unknown, ownerId: string, row?: NativeReconciliationRow): boolean => {
    const pointer = genericObject(value, [
      'sequence',
      'id',
      'originalJobId',
      'readJobId',
      'evidenceId',
      'status',
      'createdAt',
      'resultHash',
      'evidenceHash',
    ]);
    if (
      !Number.isSafeInteger(pointer.sequence) ||
      Number(pointer.sequence) < 1 ||
      pointer.originalJobId !== ownerId ||
      !writeTaskUuid(pointer.id) ||
      !writeTaskUuid(pointer.readJobId) ||
      !writeTaskUuid(pointer.evidenceId) ||
      !['succeeded', 'uncertain', 'failed'].includes(String(pointer.status)) ||
      !writeTaskTime(pointer.createdAt) ||
      typeof pointer.resultHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(pointer.resultHash) ||
      typeof pointer.evidenceHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(pointer.evidenceHash)
    )
      return false;
    const actualRow =
      row ?? ports.graph.jobs[ownerId]?.ledger.find((item) => item.sequence === pointer.sequence);
    return !!actualRow && genericSame(ports.deps.genericPointer(actualRow, ports.graph), pointer);
  };
}
