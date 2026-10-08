import { type NativeShortProvenance } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { Store, RuntimeError, type GenericShortTrustedContext } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { type LoginState } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { datasets, AccountBinding, GenericShortExecution } from './shared.js';
import {
  type BeginGenericShortStatusOperation,
  type ModernShortProfileOperation,
  type GenericCaptureOperation,
} from './contracts/generic-write.js';

interface Dependencies {
  store: Store;
  config: Config;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  modernShortProfile: ModernShortProfileOperation;
  bound: AccountBinding | undefined;
  login: LoginState | null;
  genericCapture: GenericCaptureOperation;
  nativeProvenance: NativeShortProvenance;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
}

export function createBeginGenericShortStatus(
  deps: Dependencies,
): BeginGenericShortStatusOperation {
  function beginGenericShortStatus(ctx: JobContext, execution: GenericShortExecution): void {
    const job = deps.store.getJob(ctx.jobId, deps.config.accountId),
      profile = deps.writeProfiles?.short;
    if (
      !job ||
      !deps.modernShortProfile() ||
      !profile ||
      !deps.bound ||
      deps.bound.accountId !== deps.config.accountId ||
      deps.login?.status !== 'authenticated' ||
      (deps.bound.platformIdType === 'author'
        ? deps.login.identity?.authorId
        : deps.login.identity?.accountId) !== deps.bound.platformId
    )
      throw new RuntimeError(
        'capability_unavailable',
        'An actual authenticated generic short execution context is required.',
      );
    const context: GenericShortTrustedContext = deps.genericCapture({
      jobId: job.id,
      accountId: job.accountId,
      kind: job.kind,
      operation: job.operation,
      scope: job.scope,
      datasets: job.datasets,
      inputHash: job.inputHash,
      target: execution.target,
      creationContext: execution.creationContext,
      requestBindings: execution.requestBindings,
      identityType: deps.bound.platformIdType ?? 'account',
      platformOwnerId: deps.bound.platformId,
      profileId: profile.id,
      profileVerifiedAt: profile.verifiedAt,
      provenance: deps.nativeProvenance,
    });
    const witness = deps.genericCapture({
      schema: 'fanqie-generic-short-execution/v1',
      operation: job.operation,
      target: context.target,
      creationContext: context.creationContext,
      requestBindings: context.requestBindings,
      identityType: context.identityType,
      platformOwnerId: context.platformOwnerId,
      profileId: context.profileId,
      profileVerifiedAt: context.profileVerifiedAt,
      provenance: context.provenance,
      startedAt: new Date().toISOString(),
      stage: 'before_first_read',
      observations: [],
      failure: null,
    });
    deps.genericShortContexts.set(job.id, { context, witness, sticky: null });
    try {
      ctx.addMetadata({ genericShortStatus: witness });
    } catch (error) {
      deps.genericShortContexts.get(job.id)!.sticky = 'persist_failed';
      throw error;
    }
  }
  return beginGenericShortStatus;
}
