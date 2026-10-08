import {
  type NativeShortTrialApiReason,
  type NativeShortTrialTransport,
  type OwnedNativeShortTrialRunOwner,
  type OwnedNativeShortTrialRunGlobals,
} from '../short-native-trial-api.js';
import { request, type APIResponse } from 'playwright';
import {
  nativeShortMetadataEndpoints,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../short-native-metadata.js';
import {
  nativeShortMetadataFixedReadUrl,
  readNativeShortMetadataFixedSnapshot,
  type NativeShortApiReason,
  type NativeShortFixedReadKind,
  type NativeShortMetadataWriteReadPhase,
} from '../short-native-metadata-api.js';
import {
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  createNativeShortTrialSnapshot,
  type NativeShortTrialSnapshot,
  type NativeShortTrialPlan,
} from '../short-native-trial.js';

export function createOwnedNativeShortTrialRunTransport(
  deps: Pick<
    OwnedNativeShortTrialRunOwner,
    | 'options'
    | 'fail'
    | 'check'
    | 'track'
    | 'result'
    | 'workId'
    | 'api'
    | 'httpOptions'
    | 'responseJson'
    | 'reason'
    | 'stop'
    | 'disposalFailed'
    | 'startDispose'
    | 'json'
    | 'assertSaveAcknowledgement'
    | 'postFailure'
  >,
  globals: Pick<OwnedNativeShortTrialRunGlobals, 'PostObservationFailure' | 'fields' | 'freeze'>,
) {
  function httpOptions() {
    return {
      maxRedirects: 0,
      maxRetries: 0,
      failOnStatusCode: false,
      timeout: Math.max(1, Math.ceil(deps.options.deadline - performance.now())),
    };
  }
  async function responseJson(
    response: APIResponse,
    url: string,
    post = false,
  ): Promise<Record<string, unknown>> {
    const fail = (reason: NativeShortTrialApiReason): never => {
      if (post) throw new globals.PostObservationFailure(reason);
      return deps.fail(reason);
    };
    deps.check();
    const status = response.status();
    if (status >= 300 && status < 400) fail('redirect_blocked');
    if (response.url() !== url || status < 200 || status >= 300) fail('response_unverified');
    const headers = response.headers();
    if (
      !/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '') ||
      (headers['content-length'] !== undefined &&
        (!/^\d+$/.test(headers['content-length']) ||
          Number(headers['content-length']) > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes))
    )
      fail('response_unverified');
    const bytes = await deps.track(response.body());
    deps.check();
    if (bytes.length > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes) fail('response_unverified');
    let envelope: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      envelope = globals.fields(parsed, Object.keys(parsed as object), ['code']);
    } catch {
      return fail('response_unverified');
    }
    if (envelope.code !== 0) fail('response_unverified');
    if (post) return envelope;
    const data = envelope.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('response_unverified');
    return data as Record<string, unknown>;
  }
  async function json(
    phase: NativeShortMetadataWriteReadPhase,
    kind: NativeShortFixedReadKind,
    index?: number,
  ): Promise<Record<string, unknown>> {
    deps.check();
    if (!deps.result.proof.platformStarted) {
      try {
        deps.options.onBeforePlatformRead();
      } catch {
        deps.fail('callback_failed');
      }
      deps.check();
      deps.result.proof.platformStarted = true;
    }
    if (!phase.proof.platformStarted) {
      phase.proof.platformStarted = true;
      phase.proof.readStartedAt = new Date().toISOString();
    }
    const url = nativeShortMetadataFixedReadUrl(deps.workId, kind, index);
    phase.requests[kind].attempts++;
    let response: APIResponse | null = null;
    try {
      response = await deps.track(deps.api!.get(url, deps.httpOptions()));
      deps.check();
      return await deps.responseJson(response, url);
    } catch {
      if (!deps.reason) deps.stop('response_unavailable');
      throw Error('Fixed trial read unavailable');
    } finally {
      if (response) {
        try {
          await deps.track(response.dispose());
          phase.requests[kind].disposed++;
        } catch {
          deps.disposalFailed();
          deps.startDispose();
        }
      }
    }
  }
  async function read(phase: NativeShortMetadataWriteReadPhase): Promise<NativeShortTrialSnapshot> {
    const native = await readNativeShortMetadataFixedSnapshot({
      workId: deps.workId,
      expectedOwner: deps.options.expectedOwner,
      phase,
      check: () => deps.check(),
      fail: (reason: NativeShortApiReason) => deps.fail(reason),
      json: (kind, index) => deps.json(phase, kind, index),
      captureReadProof: true,
    });
    try {
      return createNativeShortTrialSnapshot(native);
    } catch {
      deps.fail('unsupported_schema');
    }
  }
  function transport(): NativeShortTrialTransport {
    return globals.freeze({
      schema: 'native-short-trial-save-transport/v1',
      provenance: 'static-unobserved',
      method: 'POST',
      url: nativeShortMetadataEndpoints(deps.workId).save,
      encoding: 'application/x-www-form-urlencoded;charset=UTF-8',
    });
  }
  async function post(plan: NativeShortTrialPlan): Promise<void> {
    deps.check();
    const save = deps.result.save;
    if (
      save.post.attempts !== 0 ||
      !save.attemptReceipt ||
      save.attemptReceipt.eventAt !== save.post.markedAt
    )
      deps.fail('durability_unverified');
    save.post.startedAt = new Date().toISOString();
    save.post.attempts++;
    save.outcome = 'unknown';
    let response: APIResponse | null = null;
    try {
      response = await deps.track(
        deps.api!.post(plan.request.url, {
          ...deps.httpOptions(),
          data: plan.request.body,
          headers: { 'content-type': plan.request.contentType },
        }),
      );
      deps.check();
      const envelope = await deps.responseJson(response, plan.request.url, true);
      deps.check();
      deps.assertSaveAcknowledgement(envelope, plan);
      const acknowledgedAt = new Date().toISOString();
      save.post.acknowledged = true;
      save.post.acknowledgedAt = acknowledgedAt;
      save.outcome = 'acknowledged';
      save.observation = globals.freeze({
        schema: 'native-short-trial-acknowledgement-observation/v1',
        binding: plan.expectation.binding,
        scope: NATIVE_SHORT_TRIAL_SCOPE,
        hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
        sourceVersionHash: plan.expectation.sourceVersionHash,
        desiredContentHash: plan.desiredContentHash,
        acknowledgedAt,
      });
    } catch (error) {
      // Unknown acknowledgement keeps the original task uncertain, yet permits
      // an independent complete GET observation with this same owned client.
      deps.postFailure =
        error instanceof globals.PostObservationFailure
          ? error.reason
          : (deps.reason ?? 'response_unavailable');
    } finally {
      if (response) {
        try {
          await deps.track(response.dispose());
          save.post.disposed++;
        } catch {
          deps.disposalFailed();
          deps.startDispose();
        }
      }
    }
  }
  return { httpOptions, responseJson, json, read, transport, post };
}
