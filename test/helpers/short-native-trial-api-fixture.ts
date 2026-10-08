import {
  type Faults,
  deferred,
  before,
  business,
  WORK,
  ACCOUNT,
  catalog,
  edit,
} from './short-native-trial-api-edit.js';

import { randomUUID } from 'node:crypto';

import {
  type NativeShortTrialHeldIntent,
  type NativeShortTrialReceipt,
  type NativeShortTrialReceiptStage,
  type NativeShortTrialReceiptFields,
  type NativeShortTrialApiWriteOptions,
  type NativeShortTrialApiOptions,
  OwnedNativeShortTrialRun,
  type NativeShortTrialApiResult,
} from '../../src/platform/short-native-trial-api.js';

import {
  planNativeShortTrialUpdate,
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
} from '../../src/platform/short-native-trial.js';

import assert from 'node:assert/strict';

import { nativeShortMetadataEndpoints } from '../../src/platform/short-native-metadata.js';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import {
  type APIResponse,
  type APIRequestContext,
  type APIRequest,
  type BrowserContext,
} from 'playwright';

export function fixture(faults: Faults = {}) {
  const events: string[] = [],
    calls: Array<{ method: string; url: string; options: Record<string, unknown> }> = [];
  const controller = new AbortController(),
    gate = deferred(),
    entered = deferred();
  const jobId = randomUUID(),
    baseline = { id: randomUUID(), sha256: 'b'.repeat(64), capturedAt: '' };
  let held: NativeShortTrialHeldIntent | null = null,
    didHold = false,
    clientCreates = 0,
    clientDisposes = 0,
    quarantines = 0,
    ownerCallbacks = 0,
    editReads = 0;
  let capturedStorage: unknown;
  const receipts: NativeShortTrialReceipt[] = [];
  const planned = planNativeShortTrialUpdate(before(), business());
  async function pause(stage: Faults['hold']) {
    if (faults.hold === stage && !didHold) {
      didHold = true;
      entered.resolve();
      await gate.promise;
    }
  }
  function confirmStage(
    stage: NativeShortTrialReceiptStage,
    confirm: (fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt,
    acknowledgedAt?: string,
  ) {
    events.push(stage);
    assert(held);
    // These are explicitly synthetic callback references. Real fsync/readback is
    // exercised independently by runtime/Store integration, not by this fixture.
    const eventAt =
      stage === 'intent'
        ? held.checkedAt
        : stage === 'acknowledgement'
          ? acknowledgedAt!
          : new Date().toISOString();
    const fields: NativeShortTrialReceiptFields = {
      stage,
      accountId: 'fixture-service',
      jobId,
      target: { kind: 'short-story', id: WORK },
      binding: held.snapshot.binding,
      scope: NATIVE_SHORT_TRIAL_SCOPE,
      hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
      baseline: { ...baseline },
      evidence: { id: randomUUID(), sha256: 'e'.repeat(64), capturedAt: new Date().toISOString() },
      sourceVersionHash: held.expectation.sourceVersionHash,
      desiredContentHash: held.desiredContentHash,
      ordinal: stage === 'attempt' ? 1 : null,
      transport:
        stage === 'attempt'
          ? {
              schema: 'native-short-trial-save-transport/v1',
              provenance: 'static-unobserved',
              method: 'POST',
              url: nativeShortMetadataEndpoints(WORK).save,
              encoding: 'application/x-www-form-urlencoded;charset=UTF-8',
            }
          : null,
      eventAt,
    };
    const receipt = faults.transform ? faults.transform(stage, fields, confirm) : confirm(fields);
    receipts.push(receipt);
    return receipt;
  }
  function readData(url: string): unknown {
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'own'))
      return { id: faults.ownerChanged ? '9999' : ACCOUNT };
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
      return faults.duplicateList
        ? { total_count: 2, item_list: [{ item_id: WORK }, { item_id: WORK }] }
        : { total_count: 1, item_list: [{ item_id: WORK }] };
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) return catalog();
    if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
      editReads++;
      const status =
        faults.nonDraftRead === editReads ? { publish_status: 1, display_status: 12 } : {};
      if (editReads === 3) {
        if (faults.afterFault) throw Error('private-after-transport-error');
        return {
          ...edit(),
          content: faults.mismatch
            ? planned.form.content!.replace('丙', '丁')
            : planned.form.content,
          latest_version: 8,
          modify_time: '1789450001',
          ...status,
        };
      }
      return faults.drift && editReads === 2
        ? { ...edit(), unknown: { drift: true }, ...status }
        : { ...edit(), ...status };
    }
    throw Error('Unexpected fixture read');
  }
  function response(url: string, data: unknown, post = false): APIResponse {
    return {
      url: () => (post && faults.responseFault === 'url' ? url + '&unexpected=1' : url),
      status: () =>
        (post && faults.responseFault === 'redirect') || (!post && faults.redirectGet) ? 302 : 200,
      headers: () => ({
        'content-type':
          post && faults.responseFault === 'content-type'
            ? 'text/html'
            : 'application/json;charset=utf-8',
      }),
      async body() {
        return post && faults.responseFault === 'utf8'
          ? Buffer.from([0xc3, 0x28])
          : Buffer.from(
              JSON.stringify({
                code: post && faults.responseFault === 'code' ? '0' : 0,
                ...(post
                  ? faults.ackData === undefined
                    ? {}
                    : { data: faults.ackData }
                  : { data }),
                ...(post ? (faults.ackEnvelope ?? {}) : {}),
              }),
            );
      },
      async dispose() {
        if (post && faults.failDispose === 'response')
          throw Error('private-response-disposal-error');
        events.push('response-disposed');
      },
    } as unknown as APIResponse;
  }
  const api = {
    async get(url: string, options: Record<string, unknown>) {
      calls.push({ method: 'GET', url, options });
      return response(url, readData(url));
    },
    async post(url: string, options: Record<string, unknown>) {
      calls.push({ method: 'POST', url, options });
      events.push('POST');
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      assert.equal(options.data, planned.request.body);
      assert.equal(
        (options.headers as Record<string, string>)['content-type'],
        planned.request.contentType,
      );
      await pause('post');
      if (faults.acknowledgementLost) throw Error('private-acknowledgement-loss');
      return response(url, {}, true);
    },
    async dispose() {
      clientDisposes++;
      events.push('dispose-start');
      await pause('dispose');
      if (faults.failDispose === 'api') throw Error('private-api-disposal-error');
      events.push('dispose-done');
    },
  } as unknown as APIRequestContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext(options) {
      clientCreates++;
      capturedStorage = options;
      await pause('creation');
      return api;
    },
  };
  const borrowed = {
    async cookies(origin: string) {
      assert.equal(origin, 'https://fanqienovel.com');
      return [
        {
          name: 'fixture',
          value: 'fixture-cookie-value',
          domain: '.fanqienovel.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
        {
          name: 'foreign',
          value: 'foreign-fixture',
          domain: 'example.invalid',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ];
    },
    get request() {
      throw Error('Shared request forbidden');
    },
    async close() {
      throw Error('Borrowed close forbidden');
    },
    async newPage() {
      throw Error('Page forbidden');
    },
  } as unknown as BrowserContext;
  const common = {
    expectedOwner: { kind: 'account' as const, id: ACCOUNT },
    deadline: performance.now() + 10_000,
    signal: controller.signal,
    assertLease: () => faults.lease?.(),
    assertBorrowedActive() {},
    onBeforePlatformRead() {
      events.push('read-boundary');
    },
    onVerifiedAccount(id: string) {
      assert.equal(id, ACCOUNT);
      ownerCallbacks++;
      events.push('owner-callback');
      faults.onVerified?.();
    },
    onQuarantine() {
      quarantines++;
    },
  };
  const writeOptions: NativeShortTrialApiWriteOptions = {
    ...common,
    mode: 'write',
    businessRequest: business(),
    onBaseline(value) {
      events.push('baseline');
      assert.equal(value.snapshot.snapshotVersionHash, before().snapshotVersionHash);
      baseline.capturedAt = new Date().toISOString();
      if (faults.baselineFails) throw Error('private-baseline-failure');
    },
    onDurableIntent(value, confirm) {
      held = value;
      return confirmStage('intent', confirm);
    },
    onBeforePlatformWrite(_receipt, confirm) {
      return confirmStage('attempt', confirm);
    },
    onDurableAcknowledgement(value, confirm) {
      return confirmStage('acknowledgement', confirm, value.acknowledgedAt);
    },
  };
  const options: NativeShortTrialApiOptions = faults.read
    ? { ...common, mode: 'read' }
    : writeOptions;
  const run = new OwnedNativeShortTrialRun(borrowed, WORK, options, factory);
  return {
    run,
    options,
    writeOptions,
    events,
    calls,
    receipts,
    controller,
    entered: entered.promise,
    release: () => gate.resolve(),
    get clientCreates() {
      return clientCreates;
    },
    get clientDisposes() {
      return clientDisposes;
    },
    get quarantines() {
      return quarantines;
    },
    get ownerCallbacks() {
      return ownerCallbacks;
    },
    get capturedStorage() {
      return capturedStorage;
    },
  };
}

export function unavailable(result: NativeShortTrialApiResult, reason: string) {
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, reason);
  assert.equal(result.proof.ownerCallback, false);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert(!JSON.stringify(result).includes('private-'));
}
