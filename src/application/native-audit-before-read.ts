import {
  projectNativeShortWriteEvidence,
  createNativeShortOriginalAudit,
  validateNativeShortOriginalAudit,
  projectNativeShortClosure,
  type NativeShortClosure,
  type NativeShortOriginalAudit,
} from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { Store, type Job } from '../runtime/store.js';
import { record } from './shared.js';
import { type NativeAuditBeforeReadOperation } from './contracts/reconciliation.js';
import {
  type NativeOriginalContextOperation,
  type NativeClosureContextOperation,
  type RefsForOperation,
  type JobManifestOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  nativeOriginalContext: NativeOriginalContextOperation;
  nativeClosureContext: NativeClosureContextOperation;
  store: Store;
  config: Config;
  refsFor: RefsForOperation;
  jobManifest: JobManifestOperation;
}

export function createNativeAuditBeforeRead(deps: Dependencies): NativeAuditBeforeReadOperation {
  function nativeAuditBeforeRead(original: Job) {
    const context = deps.nativeOriginalContext(original),
      closed = record(original.result);
    // Authenticate the complete immutable original graph before inspecting its
    // carrier version. Historical read qualification grants no writer permit.
    const stored = [
      'native-short-metadata-closure/v1',
      'native-short-metadata-closure/v2',
    ].includes(String(closed.schema))
      ? projectNativeShortClosure(deps.nativeClosureContext(original))
      : projectNativeShortWriteEvidence(context);
    if (!stored.validated) throw new Error('Incomplete native original');
    const version = String(record(context.documents[0]!.payload).schema).endsWith('/v2') ? 2 : 1;
    let audit: NativeShortOriginalAudit;
    if (
      ['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
        String(closed.schema),
      )
    ) {
      const pointer = record(closed.originalAttemptEvidence);
      const first =
        typeof pointer.readJobId === 'string'
          ? deps.store.getJob(pointer.readJobId, deps.config.accountId)
          : null;
      if (!first || first.accountId !== deps.config.accountId)
        throw new Error('Missing initial native audit');
      const firstRefs = deps.refsFor(first),
        firstManifest = deps.jobManifest(first);
      if (
        !firstManifest ||
        firstRefs.length !== 1 ||
        firstRefs[0]!.id !== pointer.evidenceId ||
        firstRefs[0]!.sha256 !== pointer.evidenceHash
      )
        throw new Error('Invalid initial native audit link');
      const firstAudit = validateNativeShortOriginalAudit(
        record(deps.store.readEvidence(firstRefs[0]!).payload).originalAudit,
      );
      audit = createNativeShortOriginalAudit(
        original,
        context.refs,
        { firstAudit, previousClosure: original.result as NativeShortClosure },
        version,
      );
    } else audit = createNativeShortOriginalAudit(original, context.refs, undefined, version);
    const projection = projectNativeShortWriteEvidence({
      ...context,
      job: {
        ...original,
        status: 'uncertain',
        result: { evidence: context.refs },
        error: audit.priorError,
        endedAt: audit.originalEndedAt,
        updatedAt: audit.originalEndedAt,
      },
    });
    if (!projection.validated || projection.result !== null)
      throw new Error('Incomplete native original');
    return { context, audit };
  }
  return nativeAuditBeforeRead;
}
