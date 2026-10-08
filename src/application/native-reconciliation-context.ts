import { type NativeShortReconciliationContext } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import {
  Store,
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  type Job,
} from '../runtime/store.js';
import { record } from './shared.js';
import {
  type NativeReconciliationContextOperation,
  type NativeOriginalContextOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  nativeOriginalContext: NativeOriginalContextOperation;
  config: Config;
}

export function createNativeReconciliationContext(
  deps: Dependencies,
): NativeReconciliationContextOperation {
  function nativeReconciliationContext(
    original: Job,
    readJob: Job,
    manifest: Manifest | null,
    refs: EvidenceRef[],
    documents: EvidenceDocument[],
  ): NativeShortReconciliationContext {
    return deps.store.memoPublicProjection(
      'nativeReconciliationContext',
      [original, readJob, manifest, refs, documents],
      () => {
        if (record(original.result).schema === 'native-short-metadata-compensated-closure/v1') {
          const source = deps.store.getNativeCompensationContext(original.id),
            prior = source?.history.previous;
          if (!source || !prior || prior.row.status !== 'uncertain')
            throw new Error('Missing compensated historical context');
          original = {
            ...original,
            status: 'uncertain',
            result: JSON.parse(prior.row.resultJson),
            error: {
              code: 'outcome_unknown',
              message: 'The later platform read still cannot determine the write outcome.',
            },
            endedAt: prior.row.createdAt,
            updatedAt: prior.row.createdAt,
          };
        }
        if (
          !manifest ||
          refs.length !== 1 ||
          documents.length !== 1 ||
          refs[0]!.dataset !== 'reconciliation'
        )
          throw new Error('Invalid native later read links');
        const before = deps.nativeOriginalContext(original);
        return {
          accountId: deps.config.accountId,
          originalJob: original,
          originalRefs: before.refs,
          originalDocuments: before.documents,
          readJob,
          manifest,
          ref: refs[0]!,
          document: documents[0]!,
        };
      },
    );
  }
  return nativeReconciliationContext;
}
