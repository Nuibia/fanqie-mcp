import {
  type NativeShortCoverPhase,
  type NativeShortCoverTransport,
  type OwnedNativeShortCoverRunOwner,
  type OwnedNativeShortCoverRunGlobals,
} from '../short-native-cover-api.js';

import { request, type APIResponse } from 'playwright';
import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  nativeShortMetadataEndpoints,
} from '../short-native-metadata.js';
import {
  nativeShortMetadataFixedReadUrl,
  readNativeShortMetadataFixedSnapshot,
  type NativeShortApiReason,
  type NativeShortFixedReadKind,
  type NativeShortMetadataWriteReadPhase,
} from '../short-native-metadata-api.js';
import { planNativeShortCoverSave, type NativeShortCoverPlan } from '../short-native-cover.js';

export function createOwnedNativeShortCoverRunTransport(
  deps: Pick<
    OwnedNativeShortCoverRunOwner,
    | 'workId'
    | 'check'
    | 'fail'
    | 'track'
    | 'result'
    | 'options'
    | 'api'
    | 'httpOptions'
    | 'responseJson'
    | 'reason'
    | 'stop'
    | 'disposalFailed'
    | 'startDispose'
    | 'json'
    | 'copiedBytes'
    | 'transport'
    | 'observation'
  >,
  globals: Pick<OwnedNativeShortCoverRunGlobals, 'freeze' | 'UPLOAD_URL' | 'fields' | 'hashBytes'>,
) {
  function transport(phase: NativeShortCoverPhase): NativeShortCoverTransport {
    return globals.freeze({
      schema:
        phase === 'upload'
          ? 'native-short-cover-upload-transport/v1'
          : 'native-short-cover-save-transport/v1',
      provenance: 'static-unobserved',
      method: 'POST',
      url: phase === 'upload' ? globals.UPLOAD_URL : nativeShortMetadataEndpoints(deps.workId).save,
      encoding:
        phase === 'upload'
          ? 'multipart-file-temp-image-jpeg'
          : 'application/x-www-form-urlencoded;charset=UTF-8',
    });
  }
  async function responseJson(
    response: APIResponse,
    url: string,
    requireData = true,
  ): Promise<Record<string, unknown>> {
    deps.check();
    const status = response.status();
    if (status >= 300 && status < 400) deps.fail('redirect_blocked');
    if (response.url() !== url || status < 200 || status >= 300) deps.fail('response_unverified');
    const headers = response.headers();
    if (
      !/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '') ||
      (headers['content-length'] !== undefined &&
        (!/^\d+$/.test(headers['content-length']) ||
          Number(headers['content-length']) > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes))
    )
      deps.fail('response_unverified');
    const bytes = await deps.track(response.body());
    deps.check();
    if (bytes.length > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes)
      deps.fail('response_unverified');
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const envelope = globals.fields(parsed, Object.keys(parsed as object), ['code']);
      const data = envelope.data;
      if (
        envelope.code !== 0 ||
        (requireData && (!data || typeof data !== 'object' || Array.isArray(data)))
      )
        deps.fail('response_unverified');
      return data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    } catch {
      deps.fail('response_unverified');
    }
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
      throw Error('Fixed cover read unavailable');
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
  function httpOptions() {
    return {
      maxRedirects: 0,
      maxRetries: 0,
      failOnStatusCode: false,
      timeout: Math.max(1, Math.ceil(deps.options.deadline - performance.now())),
    };
  }
  function read(phase: NativeShortMetadataWriteReadPhase) {
    return readNativeShortMetadataFixedSnapshot({
      workId: deps.workId,
      expectedOwner: deps.options.expectedOwner,
      phase,
      check: () => deps.check(),
      fail: (reason: NativeShortApiReason) => deps.fail(reason),
      json: (kind, index) => deps.json(phase, kind, index),
      captureReadProof: true,
    });
  }
  async function post(
    phase: NativeShortCoverPhase,
    plan?: NativeShortCoverPlan,
  ): Promise<Record<string, unknown>> {
    deps.check();
    const state = deps.result[phase];
    if (state.post.attempts !== 0 || !state.attemptReceipt) deps.fail('durability_unverified');
    if (
      phase === 'upload' &&
      (!deps.copiedBytes ||
        deps.copiedBytes.length !== deps.result.asset!.preparedSize ||
        globals.hashBytes(deps.copiedBytes) !== deps.result.asset!.preparedSha256)
    )
      deps.fail('image_unavailable');
    state.post.startedAt = new Date().toISOString();
    state.post.attempts++;
    state.outcome = 'unknown';
    const url = deps.transport(phase).url;
    let response: APIResponse | null = null;
    try {
      response = await deps.track(
        deps.api!.post(
          url,
          phase === 'upload'
            ? {
                ...deps.httpOptions(),
                multipart: {
                  file: { name: 'temp', mimeType: 'image/jpeg', buffer: deps.copiedBytes! },
                },
              }
            : {
                ...deps.httpOptions(),
                data: plan!.request.body,
                headers: { 'content-type': plan!.request.contentType },
              },
        ),
      );
      deps.check();
      const data = await deps.responseJson(response, url, phase === 'upload');
      deps.check();
      if (phase === 'upload') {
        let provisional: NativeShortCoverPlan;
        try {
          const ack = globals.fields(data, Object.keys(data), ['pic_uri', 'pic_url']);
          provisional = planNativeShortCoverSave(
            deps.result.upload.held!.snapshot,
            deps.result.uploadIntent!,
            { picUri: ack.pic_uri as string, picUrl: ack.pic_url as string },
          );
        } catch {
          deps.fail('response_unverified');
        }
        deps.result.upload.observation = deps.observation(
          'upload',
          provisional,
          data.pic_uri as string,
          data.pic_url as string,
        );
      } else deps.result.save.observation = deps.observation('save', plan!, null, null);
      return data;
    } catch {
      if (!deps.reason) deps.stop('response_unavailable');
      throw Error('Cover POST unavailable');
    } finally {
      if (response) {
        try {
          await deps.track(response.dispose());
          state.post.disposed++;
        } catch {
          deps.disposalFailed();
          deps.startDispose();
        }
      }
    }
  }
  return { transport, responseJson, json, httpOptions, read, post };
}
