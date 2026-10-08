import { type Config } from '../config.js';
import {
  RuntimeError,
  GENERIC_SHORT_STATUS_PROTOCOL,
  type GenericShortTrustedContext,
} from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { AccountBinding, hash, record } from './shared.js';
import {
  type WriteOptionsOperation,
  type RuntimeTargetOperation,
} from './contracts/maintenance.js';
import {
  type GenericCaptureOperation,
  type PersistGenericShortObservationOperation,
  type AdvanceGenericShortStatusOperation,
  type BindGenericShortTargetOperation,
} from './contracts/generic-write.js';

interface Dependencies {
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  config: Config;
  browser: BrowserSession;
  bound: AccountBinding | undefined;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  genericCapture: GenericCaptureOperation;
  persistGenericShortObservation: PersistGenericShortObservationOperation;
  runtimeTarget: RuntimeTargetOperation;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  bindGenericShortTarget: BindGenericShortTargetOperation;
}

export function createWriteOptions(deps: Dependencies): WriteOptionsOperation {
  function writeOptions(ctx: JobContext, kind: 'short' | 'chapter'): writes.WriteOptions {
    return {
      profile: deps.writeProfiles?.[kind],
      uploadRoot: deps.config.uploadDir,
      timeoutMs: 20_000,
      verifyAccount: (page) => deps.browser.verifyCurrentAccount(page),
      identityType: deps.bound?.platformIdType ?? 'account',
      ...(deps.genericShortContexts.has(ctx.jobId)
        ? {
            onShortObservation: async (observation: writes.GenericShortObservation) => {
              const captured = deps.genericCapture(observation);
              if (
                Object.keys(captured).length !== 3 ||
                captured.schema !== 'fanqie-generic-short-editor-observation/v1'
              )
                throw new RuntimeError('capability_unavailable', 'Invalid writer observation.');
              deps.persistGenericShortObservation(
                ctx,
                { dataset: 'editable_snapshot', phase: captured.phase },
                captured.snapshot,
              );
            },
          }
        : {}),
      beforeSideEffect: async (intent) => {
        const desired = record(intent),
          marker = deps.genericShortContexts.has(ctx.jobId)
            ? { statusProtocol: GENERIC_SHORT_STATUS_PROTOCOL }
            : {};
        if (desired.desiredContentHash)
          ctx.saveEvidence(
            'write-intent',
            deps.genericCapture({
              ...marker,
              desiredContentHash: desired.desiredContentHash,
              expectedStates: (desired.expectedStates as string[]).map((state) =>
                state === 'draft' ? 'draft_saved' : state,
              ),
              ...(intent.target ? { target: deps.runtimeTarget(intent.target) } : {}),
            }),
          );
        else if (typeof desired.clientReference === 'string') {
          if (
            typeof desired.requestedContentHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(desired.requestedContentHash)
          )
            throw new RuntimeError(
              'invalid_creation_intent',
              'The creation entry must bind the requested content before entering the new-draft route',
            );
          ctx.saveEvidence(
            'write-intent',
            deps.genericCapture({
              ...marker,
              phase: 'creation-entry',
              capability: intent.capability,
              clientReferenceHash: hash({ kind, clientReference: desired.clientReference }),
              requestedContentHash: desired.requestedContentHash,
              ...(intent.target ? { target: deps.runtimeTarget(intent.target) } : {}),
            }),
          );
        }
        if (intent.target) ctx.recordTarget(deps.runtimeTarget(intent.target));
        ctx.beforePlatformWrite();
        if (deps.genericShortContexts.has(ctx.jobId))
          deps.advanceGenericShortStatus(
            ctx,
            desired.desiredContentHash ? 'save_marked' : 'allocation_marked',
          );
      },
      onTargetDiscovered: async (target) => {
        const actual = ctx.recordTarget(deps.runtimeTarget(target));
        deps.bindGenericShortTarget(ctx, actual);
      },
    };
  }
  return writeOptions;
}
