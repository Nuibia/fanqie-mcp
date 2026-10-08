import { type CapturedGenericShortGraph } from '../runtime-error.js';

import {
  genericObject,
  genericSame,
  hasGenericShortStatusSignal,
} from '../has-generic-short-status-signal.js';

import { type GenericAssociationDependencies } from '../operations/generic-status-generic-association.js';
interface Ports {
  graph: CapturedGenericShortGraph;
  checkPointer: (
    value: unknown,
    ownerId: string,
    row?: import('../native-closure-signal.js').NativeReconciliationRow,
  ) => boolean;
  deps: GenericAssociationDependencies;
}
export function createAssociationPrefixChecker(ports: Ports) {
  return (value: unknown, ownerId: string): number | null => {
    const prefix = genericObject(value, ['rowCount', 'first', 'last', 'rowsHash']),
      owner = ports.graph.jobs[ownerId],
      count = Number(prefix.rowCount);
    if (
      !owner ||
      !Number.isSafeInteger(prefix.rowCount) ||
      count < 1 ||
      count > owner.ledger.length ||
      typeof prefix.rowsHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(prefix.rowsHash)
    )
      return null;
    const rows = owner.ledger.slice(0, count);
    if (
      !ports.checkPointer(prefix.first, ownerId, rows[0]) ||
      !ports.checkPointer(prefix.last, ownerId, rows.at(-1)) ||
      rows.some((row) => hasGenericShortStatusSignal(ports.graph.jobs[row.readJobId]?.documents)) ||
      !genericSame(prefix, ports.deps.genericPrefix(rows, ports.graph))
    )
      return null;
    return count;
  };
}
