import {
  type NativeShortBodyPostObservation,
  type NativeShortBodyApiResult,
  type FixtureRunOwner,
  type FixtureRunGlobals,
} from '../short-native-body-api.js';
import { type APIResponse } from 'playwright';
import {
  nativeShortMetadataFixedReadUrl,
  readNativeShortMetadataFixedSnapshot,
  type NativeShortFixedReadKind,
} from '../short-native-metadata-api.js';
import {
  NATIVE_SHORT_BODY_SCOPE,
  createNativeShortBodySnapshot,
  type NativeShortBodySnapshot,
  type NativeShortBodyPlan,
} from '../short-native-body.js';

import { type NativeShortBodyTransport } from '../short-native-body-proof.js';

export function createFixtureRunTransport(
  deps: Pick<
    FixtureRunOwner,
    | 'check'
    | 'fail'
    | 'wait'
    | 'api'
    | 'options'
    | 'result'
    | 'binding'
    | 'workId'
    | 'ownResponse'
    | 'decode'
    | 'reason'
    | 'disposeResponse'
    | 'stopped'
    | 'json'
    | 'attemptBoundaryEntered'
    | 'links'
    | 'emit'
    | 'ack'
    | 'postReason'
  >,
  globals: Pick<FixtureRunGlobals, 'boundedJson' | 'STOPPED' | 'freeze'>,
) {
  async function decode(response: APIResponse, url: string): Promise<Record<string, unknown>> {
    deps.check();
    if (response.url() !== url) deps.fail('redirect_blocked');
    if (
      response.status() < 200 ||
      response.status() >= 300 ||
      !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
        response.headers()['content-type'] ?? '',
      )
    )
      deps.fail('response_unverified');
    const bytes = await deps.wait(response.body());
    deps.check();
    let root: Record<string, unknown>;
    try {
      root = globals.boundedJson(bytes);
    } catch {
      deps.fail(bytes.length > 3 * 1024 * 1024 ? 'bounded_unavailable' : 'response_unverified');
    }
    if (root.code !== 0) deps.fail('response_unverified');
    return root;
  }
  async function json(
    name: 'before' | 'preSave' | 'after',
    kind: NativeShortFixedReadKind,
    listIndex?: number,
  ): Promise<Record<string, unknown>> {
    deps.check();
    if (!deps.api || !deps.options) deps.fail('context_unavailable');
    const p = deps.result.phases[name],
      counter = p.requests[kind];
    if (Object.values(p.requests).reduce((sum, n) => sum + n.attempts, 0) >= 14)
      deps.fail('bounded_unavailable');
    try {
      deps.options.onBeforePlatformRead();
    } catch {
      deps.fail('callback_failed');
    }
    if (deps.binding) {
      try {
        deps.binding.beforeGet();
      } catch {
        deps.fail('durability_unverified');
      }
    }
    deps.check();
    p.proof.platformStarted = deps.result.proof.platformStarted = true;
    p.proof.readStartedAt ??= new Date().toISOString();
    counter.attempts++;
    const url = nativeShortMetadataFixedReadUrl(deps.workId, kind, listIndex);
    let response: APIResponse | null = null;
    try {
      const incoming = deps.api
        .get(url, {
          maxRedirects: 0,
          maxRetries: 0,
          timeout: Math.max(1, Math.ceil(deps.options.deadline - performance.now())),
        })
        .then((r) =>
          deps.ownResponse(r, () => {
            counter.disposed++;
          }),
        );
      response = await deps.wait(incoming);
      const root = await deps.decode(response, url);
      if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data))
        deps.fail('response_unverified');
      return root.data as Record<string, unknown>;
    } catch {
      if (!deps.reason) deps.fail('response_unavailable');
      throw globals.STOPPED;
    } finally {
      if (response) await Promise.race([deps.disposeResponse(response), deps.stopped]);
      deps.check();
    }
  }
  async function read(name: 'before' | 'preSave' | 'after'): Promise<NativeShortBodySnapshot> {
    if (!deps.options) deps.fail('invalid_input');
    const native = await readNativeShortMetadataFixedSnapshot({
      workId: deps.workId,
      expectedOwner: deps.options.expectedOwner,
      phase: deps.result.phases[name],
      check: () => deps.check(),
      fail: (reason) => deps.fail(reason),
      json: (kind, index) => deps.json(name, kind, index),
      captureReadProof: true,
    });
    deps.check();
    try {
      return createNativeShortBodySnapshot(native);
    } catch {
      deps.fail('unsupported_schema');
    }
  }
  async function post(plan: NativeShortBodyPlan, before: NativeShortBodySnapshot): Promise<void> {
    deps.check();
    if (!deps.api || !deps.options || deps.result.save.post.attempts)
      deps.fail('durability_unverified');
    if (Buffer.byteLength(plan.request.body, 'utf8') > 32 * 1024 * 1024)
      deps.fail('bounded_unavailable');
    let response: APIResponse | null = null;
    let stamp: string;
    if (deps.binding) {
      const transport: NativeShortBodyTransport = {
        method: 'POST',
        url: plan.request.url,
        contentType: plan.request.contentType,
        maxRedirects: 0,
        maxRetries: 0,
        maxAttempts: 1,
      };
      deps.attemptBoundaryEntered = true;
      try {
        const permit = deps.binding.beginAttempt(transport);
        deps.links.attempt = deps.binding.consumeAttempt(permit);
      } catch {
        deps.fail('durability_unverified');
      }
      deps.check();
      stamp = new Date().toISOString();
    } else {
      stamp = new Date().toISOString();
      await deps.emit('attempt', { simulatedOrdinal: 1, eventAt: stamp }, stamp);
      deps.check();
    }
    deps.result.save.post.attempts = 1;
    deps.result.save.post.startedAt = stamp;
    deps.result.save.outcome = 'fixture_unknown';
    try {
      const incoming = deps.api
        .post(plan.request.url, {
          data: plan.request.body,
          headers: { 'content-type': plan.request.contentType },
          maxRedirects: 0,
          maxRetries: 0,
          timeout: Math.max(1, Math.ceil(deps.options.deadline - performance.now())),
        })
        .then((r) =>
          deps.ownResponse(r, () => {
            deps.result.save.post.disposed++;
          }),
        );
      response = await deps.wait(incoming);
      const root = await deps.decode(response, plan.request.url);
      deps.ack(root, before);
      deps.check();
      const acknowledgedAt = new Date().toISOString();
      const observation: NativeShortBodyPostObservation = globals.freeze({
        schema: 'native-short-body-fixture-acknowledgement/v1',
        binding: before.binding,
        scope: NATIVE_SHORT_BODY_SCOPE,
        sourceVersionHash: plan.expectation.sourceVersionHash,
        desiredContentHash: plan.desiredContentHash,
        acknowledgedAt,
      });
      if (deps.binding)
        await deps.emit(
          'acknowledgement',
          { observation: { ...observation, schema: 'native-short-body-acknowledgement/v1' } },
          acknowledgedAt,
        );
      deps.result.save.observation = observation;
      deps.result.save.post.acknowledgedAt = acknowledgedAt;
      deps.result.save.post.acknowledged = true;
      if (!deps.binding) await deps.emit('acknowledgement', { observation }, acknowledgedAt);
    } catch {
      deps.postReason ??= deps.reason ?? 'response_unavailable';
      // A transport/ACK contradiction permits fresh evidence, never a replacement POST.
      if (
        [
          'response_unavailable',
          'response_unverified',
          'redirect_blocked',
          'bounded_unavailable',
          'acknowledgement_unverified',
        ].includes(deps.postReason)
      )
        deps.reason = null;
      else deps.reason ??= deps.postReason;
    } finally {
      if (response) await Promise.race([deps.disposeResponse(response), deps.stopped]);
    }
  }
  function snapshotResult(): NativeShortBodyApiResult {
    // Freeze only detached result data, never the ownership cell that late promises mutate.
    return globals.freeze({
      ...deps.result,
      phases: {
        before: structuredClone(deps.result.phases.before),
        preSave: structuredClone(deps.result.phases.preSave),
        after: structuredClone(deps.result.phases.after),
      },
      snapshots: { ...deps.result.snapshots },
      save: { ...deps.result.save, post: { ...deps.result.save.post } },
      cleanup: { ...deps.result.cleanup },
      proof: { ...deps.result.proof },
    });
  }
  return { decode, json, read, post, snapshotResult };
}
