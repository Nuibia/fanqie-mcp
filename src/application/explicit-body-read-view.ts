import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import { isCanonicalNativeTime } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import {
  Store,
  canonicalJson,
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  type Job,
} from '../runtime/store.js';
import { type ExplicitBodyReadViewOperation } from './contracts/evidence-context.js';

interface Dependencies {
  config: Config;
  store: Store;
}

export function createExplicitBodyReadView(deps: Dependencies): ExplicitBodyReadViewOperation {
  function explicitBodyReadView(
    job: Job | null,
    manifest: Manifest | null,
    refs: EvidenceRef[],
    documents: Map<string, EvidenceDocument>,
    readFailure?: unknown,
  ) {
    let validated = false,
      verifiedLive = false,
      collectionMode: 'live' | 'fixture' | null = null;
    let evidence: Array<{ id: string; dataset: string; sha256: string; capturedAt: string }> = [];
    try {
      if (
        !job ||
        readFailure ||
        job.accountId !== deps.config.accountId ||
        job.metadata.explicitBodyRead !== true ||
        typeof job.idempotencyKey !== 'string' ||
        !/^explicit_body_read\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          job.idempotencyKey,
        ) ||
        !manifest ||
        refs.length !== 1 ||
        documents.size !== 1
      )
        throw Error('Invalid explicit read context');
      const ref = refs[0]!,
        document = documents.get(ref.id)!;
      const actual = deps.store.getJob(job.id, deps.config.accountId),
        physicalManifest = deps.store.getManifestForJob(deps.config.accountId, job.id);
      if (
        !actual ||
        canonicalJson(actual) !== canonicalJson(job) ||
        !physicalManifest ||
        canonicalJson(physicalManifest) !== canonicalJson(manifest)
      )
        throw Error('Changed explicit read context');
      const body = bodyRuntime.projectNativeShortBodyReadContext({
        accountId: deps.config.accountId,
        job: actual,
        manifest: physicalManifest,
        ref,
        document,
      });
      verifiedLive = body.verifiedLive;
      collectionMode = document.collectionMode;
      validated = true;
      evidence = [
        { id: ref.id, dataset: ref.dataset, sha256: ref.sha256, capturedAt: ref.capturedAt },
      ];
    } catch {
      /* Ordinary outputs keep a fixed content-free unavailable view. */
    }
    const stamp = (value: unknown) => (isCanonicalNativeTime(value) ? value : null);
    const safeJob = {
      id:
        job && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(job.id)
          ? job.id
          : null,
      kind: 'read',
      operation: 'get_short_body_snapshot',
      status:
        job &&
        [
          'queued',
          'running',
          'succeeded',
          'failed',
          'cancelled',
          'waiting_for_login',
          'partial',
        ].includes(job.status) &&
        (job.status !== 'succeeded' || validated)
          ? job.status
          : null,
      projectionStatus: validated ? 'validated' : 'capability_unavailable',
      requestedAt: stamp(job?.requestedAt),
      startedAt: stamp(job?.startedAt),
      platformReadStartedAt: stamp(job?.platformReadStartedAt),
      platformWriteStartedAt: null,
      endedAt: stamp(job?.endedAt),
    };
    return {
      native: true,
      bodyRead: true,
      valid: validated,
      verifiedLive,
      collectionMode,
      safeJob,
      evidence,
      manifest:
        validated && manifest
          ? {
              id: manifest.id,
              jobId: manifest.jobId,
              operation: 'get_short_body_snapshot',
              committedAt: manifest.committedAt,
              evidence,
            }
          : null,
      data: [
        {
          schema: 'fanqie-short-body-read-summary/v1',
          status: validated ? 'success' : 'capability_unavailable',
          reason: validated ? null : 'response_unverified',
          source: collectionMode ? { mode: collectionMode } : null,
          verifiedLive,
          bodyIncluded: false,
        },
      ],
    };
  }
  return explicitBodyReadView;
}
