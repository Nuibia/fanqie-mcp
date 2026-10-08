import {
  type SourceKey,
  type NativeShortSubmissionApiReason,
  type NativeShortSubmissionTransport,
  type NativeShortSubmissionApiResult,
  type OwnedNativeShortSubmissionRunOwner,
  type OwnedNativeShortSubmissionRunGlobals,
} from '../short-native-submission-api.js';
import { createHash } from 'node:crypto';
import { request, type APIResponse } from 'playwright';
import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_RESOURCE_LIMITS,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';
import {
  nativeShortMetadataFixedReadUrl,
  readNativeShortMetadataFixedSnapshot,
  type NativeShortFixedReadKind,
} from '../short-native-metadata-api.js';
import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  validateNativeShortSubmissionContract,
  verifyNativeShortSubmissionSources,
  planNativeShortSubmission,
  type NativeShortSubmissionBusinessInput,
  type NativeShortSubmissionContract,
  type NativeShortSubmissionSourceDocuments,
} from '../short-native-submission.js';

export function createOwnedNativeShortSubmissionRunTransport(
  deps: Pick<
    OwnedNativeShortSubmissionRunOwner,
    | 'options'
    | 'fail'
    | 'check'
    | 'wait'
    | 'begin'
    | 'result'
    | 'workId'
    | 'api'
    | 'httpOptions'
    | 'ownResponse'
    | 'bytes'
    | 'reason'
    | 'disposeResponse'
    | 'json'
    | 'owner'
    | 'business'
    | 'checkFreshPublication'
    | 'postFailure'
  >,
  globals: Pick<
    OwnedNativeShortSubmissionRunGlobals,
    'PostObservationFailure' | 'fields' | 'copy' | 'STOPPED' | 'SOURCE_KEYS' | 'FIXTURES' | 'freeze'
  >,
) {
  function httpOptions() {
    return {
      maxRedirects: 0,
      maxRetries: 0,
      failOnStatusCode: false,
      timeout: Math.max(1, Math.ceil(deps.options!.deadline - performance.now())),
    };
  }
  async function bytes(
    response: APIResponse,
    url: string,
    kind: 'json' | 'source',
    post = false,
  ): Promise<Buffer> {
    const reject = (reason: NativeShortSubmissionApiReason): never => {
      if (post) throw new globals.PostObservationFailure(reason);
      return deps.fail(reason);
    };
    deps.check();
    const status = response.status();
    if (status >= 300 && status < 400) reject('redirect_blocked');
    if (response.url() !== url || status < 200 || status >= 300) reject('response_unverified');
    const headers = response.headers(),
      limit = kind === 'source' ? 8 * 1024 * 1024 : NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes;
    if (
      (kind === 'json' && !/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) ||
      (kind === 'source' &&
        !/^(?:text\/html|(?:application|text)\/(?:javascript|x-javascript))(?:\s*;|$)/i.test(
          headers['content-type'] ?? '',
        )) ||
      (headers['content-length'] !== undefined &&
        (!/^\d+$/.test(headers['content-length']) || Number(headers['content-length']) > limit))
    )
      reject('response_unverified');
    const bytes = await deps.wait(response.body());
    if (bytes.length > limit) reject('bounded_unavailable');
    return bytes;
  }
  async function json(
    name: keyof NativeShortSubmissionApiResult['phases'],
    kind: NativeShortFixedReadKind,
    index?: number,
  ): Promise<Record<string, unknown>> {
    deps.begin();
    const read = deps.result.phases[name];
    if (!read.proof.platformStarted) {
      read.proof.platformStarted = true;
      read.proof.readStartedAt = new Date().toISOString();
    }
    const url = nativeShortMetadataFixedReadUrl(deps.workId, kind, index);
    read.requests[kind].attempts++;
    let response: APIResponse | null = null;
    try {
      response = await deps.wait(
        deps.api!.get(url, deps.httpOptions()).then((r) =>
          deps.ownResponse(r, () => {
            read.requests[kind].disposed++;
          }),
        ),
      );
      const raw: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            await deps.bytes(response!, url, 'json'),
          ),
        ),
        envelope = globals.fields(raw, Object.keys(raw as object), ['code', 'data']);
      if (
        envelope.code !== 0 ||
        !envelope.data ||
        typeof envelope.data !== 'object' ||
        Array.isArray(envelope.data)
      )
        deps.fail('response_unverified');
      return globals.copy(envelope.data) as Record<string, unknown>;
    } catch {
      if (!deps.reason) deps.fail('response_unavailable');
      throw globals.STOPPED;
    } finally {
      if (response) await deps.wait(deps.disposeResponse(response));
    }
  }
  async function read(
    name: 'before' | 'preSubmit' | 'after',
    draftMembership: boolean,
  ): Promise<NativeShortMetadataSnapshot> {
    const read = deps.result.phases[name];
    if (draftMembership)
      return readNativeShortMetadataFixedSnapshot({
        workId: deps.workId,
        expectedOwner: deps.options!.expectedOwner,
        phase: read,
        check: () => deps.check(),
        fail: (reason) => deps.fail(reason),
        json: (kind, index) => deps.json(name, kind, index),
        captureReadProof: true,
      });
    // Publication can remove a target from draft_list. Its original authenticated ID remains the read boundary.
    const own = async () => {
      const value = await deps.json(name, 'own');
      if (value.id !== deps.options!.expectedOwner.id) deps.fail('owner_changed');
    };
    await own();
    read.proof.ownerBefore = true;
    const editData = await deps.json(name, 'edit'),
      categoryData = await deps.json(name, 'catalog');
    await own();
    read.proof.ownerAfter = true;
    let snapshot: NativeShortMetadataSnapshot;
    try {
      snapshot = createNativeShortMetadataSnapshot({
        binding: {
          account: { kind: 'account_id', id: deps.options!.expectedOwner.id },
          work: { kind: 'short', id: deps.workId },
        },
        editData,
        categoryData,
      });
    } catch {
      deps.fail('unsupported_schema');
    }
    // Exact target is mandatory after submit; draft-era sentinel cannot authenticate a publication observation.
    if (snapshot.responseBinding !== 'exact') deps.fail('target_unverified');
    read.proof.targetUnique = true;
    read.proof.fixedSourceVerified = true;
    read.proof.readFinishedAt = new Date().toISOString();
    read.proof.proofCapturedAt = read.proof.readFinishedAt;
    return snapshot;
  }
  async function sources(): Promise<NativeShortSubmissionContract> {
    deps.begin();
    deps.result.sourceReadStartedAt = new Date().toISOString();
    const documents: Partial<Record<SourceKey, NativeShortSubmissionSourceDocuments[SourceKey]>> =
      {};
    for (const key of globals.SOURCE_KEYS) {
      deps.check();
      const pin = NATIVE_SHORT_SUBMISSION_SOURCE_PINS[key],
        url = typeof pin === 'string' ? pin : pin.url,
        read = deps.result.sourceReads[key];
      read.attempts++;
      read.url = url;
      read.requestedAt = new Date().toISOString();
      let response: APIResponse | null = null;
      try {
        response = await deps.wait(
          deps.api!.get(url, deps.httpOptions()).then((r) =>
            deps.ownResponse(r, () => {
              read.disposed++;
            }),
          ),
        );
        const bytes = await deps.bytes(response!, url, 'source');
        read.sha256 = createHash('sha256').update(bytes).digest('hex');
        const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        read.completedAt = new Date().toISOString();
        documents[key] = { url, body, observedAt: read.completedAt };
      } catch {
        if (!deps.reason) deps.fail('response_unavailable');
        throw globals.STOPPED;
      } finally {
        if (response) await deps.wait(deps.disposeResponse(response));
      }
    }
    deps.result.sourceReadFinishedAt = new Date().toISOString();
    const fixture = globals.FIXTURES.get(deps.owner);
    let contract: NativeShortSubmissionContract;
    try {
      contract = fixture
        ? validateNativeShortSubmissionContract({
            ...fixture.contract,
            observedAt: documents.writer!.observedAt,
            sources: Object.fromEntries(
              globals.SOURCE_KEYS.map((key) => [
                key,
                { ...fixture.contract.sources[key], observedAt: documents[key]!.observedAt },
              ]),
            ),
          })
        : verifyNativeShortSubmissionSources(documents);
    } catch {
      deps.fail('source_changed');
    }
    deps.result.proof.fixedSourcesVerified = !fixture;
    return contract;
  }
  function business(): NativeShortSubmissionBusinessInput {
    if (!deps.options || deps.options.mode === 'read') deps.fail('invalid_input');
    return {
      ...deps.options.businessRequest,
      target: { kind: 'short', workId: deps.workId },
      snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
    };
  }
  function checkFreshPublication(): void {
    deps.check();
    const held = deps.result.publish.held;
    if (!held) deps.fail('durability_unverified');
    try {
      planNativeShortSubmission(
        held.snapshot,
        held.contract,
        deps.business(),
        held.servicePrepared.prepared,
        new Date().toISOString(),
      );
    } catch {
      deps.fail('version_conflict');
    }
  }
  function transport(): NativeShortSubmissionTransport {
    return globals.freeze({
      schema: 'native-short-submission-publish-transport/v1',
      provenance: 'static-unobserved',
      method: 'POST',
      url: deps.result.plan!.request.url,
      encoding: 'application/x-www-form-urlencoded;charset=UTF-8',
    });
  }
  async function post(): Promise<void> {
    deps.checkFreshPublication();
    const publish = deps.result.publish,
      plan = deps.result.plan!;
    if (
      publish.post.attempts ||
      !publish.attemptReceipt ||
      publish.attemptReceipt.eventAt !== publish.post.markedAt ||
      Buffer.byteLength(plan.request.body) > 32 * 1024 * 1024
    )
      deps.fail('durability_unverified');
    publish.post.attempts = 1;
    publish.post.startedAt = new Date().toISOString();
    publish.outcome = 'unknown';
    let response: APIResponse | null = null;
    try {
      response = await deps.wait(
        deps
          .api!.post(plan.request.url, {
            ...deps.httpOptions(),
            data: plan.request.body,
            headers: { 'content-type': plan.request.contentType },
          })
          .then((r) =>
            deps.ownResponse(r, () => {
              publish.post.disposed++;
            }),
          ),
      );
      const bytes = await deps.bytes(response!, plan.request.url, 'json', true),
        raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        root = globals.fields(raw, Object.keys(raw as object), ['code']);
      if (
        typeof root.code !== 'number' ||
        !Number.isSafeInteger(root.code) ||
        Object.is(root.code, -0) ||
        (root.message !== undefined && typeof root.message !== 'string')
      )
        throw new globals.PostObservationFailure('acknowledgement_unverified');
      const data =
        root.data === undefined || root.data === null
          ? null
          : globals.fields(root.data, Object.keys(root.data as object), []);
      let itemId: string | null = null;
      if (data && Object.hasOwn(data, 'item_id')) {
        if (typeof data.item_id !== 'string' || data.item_id !== deps.workId)
          throw new globals.PostObservationFailure('acknowledgement_unverified');
        itemId = data.item_id;
      }
      const acknowledgedAt = new Date().toISOString();
      publish.post.acknowledged = true;
      publish.post.acknowledgedAt = acknowledgedAt;
      publish.observation = globals.freeze({
        schema: 'native-short-submission-acknowledgement-observation/v1',
        binding: plan.expectation.binding,
        sourceVersionHash: plan.expectation.sourceVersionHash,
        desiredSubmissionHash: plan.prepared.desiredSubmissionHash,
        useAi: plan.expectation.useAi,
        code: root.code,
        message: (root.message as string) ?? null,
        itemId,
        accepted: root.code === 0,
        acknowledgedAt,
      });
      publish.outcome = root.code === 0 ? 'acknowledged' : 'rejected';
    } catch (error) {
      deps.postFailure =
        error instanceof globals.PostObservationFailure
          ? error.reason
          : (deps.reason ?? 'response_unavailable');
    } finally {
      if (response) {
        try {
          await deps.wait(deps.disposeResponse(response));
        } catch {
          deps.postFailure ??= deps.reason ?? 'cleanup_failed';
        }
      }
    }
  }
  return {
    httpOptions,
    bytes,
    json,
    read,
    sources,
    business,
    checkFreshPublication,
    transport,
    post,
  };
}
