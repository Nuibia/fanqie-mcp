import {
  type SubmissionFixtureFaults,
  submissionFixtureSetup,
  deferred,
  SUBMISSION_FIXTURE_WORK,
  SUBMISSION_FIXTURE_OWNER,
  submissionFixtureEdit,
} from './submission-fixture-edit.js';

import {
  type NativeShortSubmissionReceipt,
  type NativeShortSubmissionHeldIntent,
  type NativeShortSubmissionReceiptStage,
  type NativeShortSubmissionReceiptFields,
  NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES,
  type NativeShortSubmissionApiSubmitOptions,
  type NativeShortSubmissionApiOptions,
  createOwnedNativeShortSubmissionFixtureRun,
} from '../../src/platform/short-native-submission-api.js';

import { randomUUID } from 'node:crypto';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
} from '../../src/platform/short-native-submission.js';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import {
  type APIResponse,
  type APIRequestContext,
  type APIRequest,
  type BrowserContext,
} from 'playwright';

export function createSubmissionFixture(faults: SubmissionFixtureFaults = {}) {
  const setup = submissionFixtureSetup(
      1,
      {
        ...faults.editChanges,
        ...(faults.content === undefined ? {} : { content: faults.content }),
      },
      faults.catalogChanges,
    ),
    events: string[] = [],
    calls: Array<{ method: 'GET' | 'POST'; url: string; options: Record<string, unknown> }> = [],
    receipts: NativeShortSubmissionReceipt[] = [];
  const controller = new AbortController(),
    gate = deferred(),
    entered = deferred(),
    jobId = randomUUID(),
    baseline = { id: randomUUID(), sha256: 'b'.repeat(64), capturedAt: '' };
  let held: NativeShortSubmissionHeldIntent | null = null,
    didHold = false,
    clientCreates = 0,
    clientDisposes = 0,
    quarantines = 0,
    ownerCallbacks = 0,
    editReads = 0,
    capturedStorage: unknown;
  async function pause(stage: SubmissionFixtureFaults['hold']) {
    if (faults.hold === stage && !didHold) {
      didHold = true;
      entered.resolve();
      await gate.promise;
    }
  }
  function confirmStage(
    stage: NativeShortSubmissionReceiptStage,
    confirm: (fields: NativeShortSubmissionReceiptFields) => NativeShortSubmissionReceipt,
    acknowledgedAt?: string,
  ) {
    assert(held);
    events.push(stage);
    const eventAt =
      stage === 'intent'
        ? held.checkedAt
        : stage === 'acknowledgement'
          ? acknowledgedAt!
          : new Date().toISOString();
    const fields: NativeShortSubmissionReceiptFields = {
      stage,
      accountId: 'fixture-service',
      jobId,
      target: { kind: 'short-story', id: SUBMISSION_FIXTURE_WORK },
      binding: held.snapshot.binding,
      scope: NATIVE_SHORT_SUBMISSION_SCOPE,
      hashBases: NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES,
      baseline: { ...baseline },
      evidence: { id: randomUUID(), sha256: 'e'.repeat(64), capturedAt: new Date().toISOString() },
      sourceVersionHash: held.expectation.sourceVersionHash,
      desiredSubmissionHash: held.desiredSubmissionHash,
      preparationJobId: held.servicePrepared.preparationJobId,
      preparationEvidence: held.servicePrepared.preparationEvidence,
      termsHash: held.contract.terms.sha256,
      contractHash: held.contract.sourceHash,
      useAi: held.expectation.useAi,
      ordinal: stage === 'attempt' ? 1 : null,
      transport:
        stage === 'attempt'
          ? {
              schema: 'native-short-submission-publish-transport/v1',
              provenance: 'static-unobserved',
              method: 'POST',
              url: held.plan.request.url,
              encoding: 'application/x-www-form-urlencoded;charset=UTF-8',
            }
          : null,
      eventAt,
    };
    const receipt = faults.transform ? faults.transform(stage, fields, confirm) : confirm(fields);
    receipts.push(receipt);
    return receipt;
  }
  function readData(url: string) {
    if (url === nativeShortMetadataFixedReadUrl(SUBMISSION_FIXTURE_WORK, 'own'))
      return { id: faults.ownerChanged ? '9999' : SUBMISSION_FIXTURE_OWNER };
    if (url === nativeShortMetadataFixedReadUrl(SUBMISSION_FIXTURE_WORK, 'list', 0))
      return faults.duplicateList
        ? {
            total_count: 2,
            item_list: [{ item_id: SUBMISSION_FIXTURE_WORK }, { item_id: SUBMISSION_FIXTURE_WORK }],
          }
        : { total_count: 1, item_list: [{ item_id: SUBMISSION_FIXTURE_WORK }] };
    if (url === nativeShortMetadataFixedReadUrl(SUBMISSION_FIXTURE_WORK, 'catalog'))
      return structuredClone(setup.snapshot.categoryData);
    if (url === nativeShortMetadataFixedReadUrl(SUBMISSION_FIXTURE_WORK, 'edit')) {
      editReads++;
      if (editReads === (faults.mode === 'read' ? 1 : 3)) {
        if (faults.afterFault) throw Error('private-synthetic-after-failure');
        const after: Record<string, unknown> = submissionFixtureEdit({
          ...setup.snapshot.editData,
          content: faults.mismatch
            ? setup.plan.form.content!.replace('合成', '变化')
            : setup.plan.form.content,
          use_ai: setup.business.useAi,
          ...(faults.afterStatus === 'draft'
            ? { publish_status: 0, display_status: 0 }
            : faults.afterStatus === 'unknown'
              ? { publish_status: 1, display_status: 999 }
              : faults.afterStatus === 'published'
                ? { publish_status: 1, display_status: 1 }
                : { publish_status: 1, display_status: 4 }),
        });
        if (faults.afterMissingAi) delete after.use_ai;
        return after;
      }
      return faults.drift && editReads === 2
        ? submissionFixtureEdit({ ...setup.snapshot.editData, extra: { changed: true } })
        : structuredClone(setup.snapshot.editData);
    }
    throw Error('Unexpected fixed fixture GET');
  }
  function response(url: string, body: Buffer, source = false, post = false): APIResponse {
    return {
      url: () => (post && faults.responseFault === 'url' ? url + '&unexpected=1' : url),
      status: () =>
        (post && faults.responseFault === 'redirect') || (!post && faults.redirectGet) ? 302 : 200,
      headers: () => ({
        'content-type':
          post && faults.responseFault === 'mime'
            ? 'text/html'
            : source
              ? url === NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url
                ? 'text/html;charset=utf-8'
                : 'application/javascript;charset=utf-8'
              : 'application/json;charset=utf-8',
      }),
      async body() {
        return post && faults.responseFault === 'utf8' ? Buffer.from([0xc3, 0x28]) : body;
      },
      async dispose() {
        events.push('response-disposed');
        if (post && faults.failDispose === 'response')
          throw Error('private-synthetic-response-disposal');
      },
    } as unknown as APIResponse;
  }
  const api = {
    async get(url: string, options: Record<string, unknown>) {
      calls.push({ method: 'GET', url, options });
      const source = Object.values(NATIVE_SHORT_SUBMISSION_SOURCE_PINS).some(
        (pin) => pin.url === url,
      );
      return response(
        url,
        Buffer.from(
          source
            ? url === NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url
              ? '<!doctype html>synthetic-no-live'
              : '// synthetic fixed URL source, never live proof'
            : JSON.stringify({ code: 0, data: readData(url) }),
        ),
        source,
      );
    },
    async post(url: string, options: Record<string, unknown>) {
      calls.push({ method: 'POST', url, options });
      events.push('POST');
      assert.equal(url, setup.plan.request.url);
      assert.equal(options.data, setup.plan.request.body);
      await pause('post');
      if (faults.acknowledgementLost) throw Error('private-synthetic-ack-loss');
      return response(
        url,
        Buffer.from(
          JSON.stringify({
            code: faults.responseFault === 'code' ? '0' : (faults.acknowledgementCode ?? 0),
            message: faults.acknowledgementMessage ?? 'synthetic acknowledgement',
            data: { item_id: SUBMISSION_FIXTURE_WORK },
          }),
        ),
        false,
        true,
      );
    },
    async dispose() {
      clientDisposes++;
      events.push('dispose-start');
      await pause('dispose');
      if (faults.failDispose === 'api') throw Error('private-synthetic-api-disposal');
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
          value: 'synthetic',
          domain: '.fanqienovel.com',
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
    expectedOwner: { kind: 'account' as const, id: SUBMISSION_FIXTURE_OWNER },
    deadline: performance.now() + 10_000,
    signal: controller.signal,
    assertLease() {
      faults.lease?.();
    },
    assertBorrowedActive() {},
    onBeforePlatformRead() {
      events.push('read-boundary');
    },
    onVerifiedAccount(id: string) {
      assert.equal(id, SUBMISSION_FIXTURE_OWNER);
      ownerCallbacks++;
      events.push('owner-callback');
      if (faults.onVerifiedFails) throw Error('private-synthetic-owner-callback');
    },
    onQuarantine() {
      quarantines++;
    },
  };
  const submitOptions: NativeShortSubmissionApiSubmitOptions = {
    ...common,
    mode: 'submit',
    businessRequest: setup.businessRequest,
    servicePrepared: setup.servicePrepared,
    onBaseline(value) {
      events.push('baseline');
      assert.equal(value.beforeSnapshot.snapshotVersionHash, setup.snapshot.snapshotVersionHash);
      baseline.capturedAt = new Date().toISOString();
      if (faults.baselineFails) throw Error('private-synthetic-baseline');
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
  const options: NativeShortSubmissionApiOptions =
    faults.mode === 'prepare'
      ? { ...common, mode: 'prepare', businessRequest: setup.businessRequest }
      : faults.mode === 'read'
        ? { ...common, mode: 'read' }
        : submitOptions;
  const run = createOwnedNativeShortSubmissionFixtureRun(
    borrowed,
    SUBMISSION_FIXTURE_WORK,
    options,
    factory,
    setup.contract,
  );
  return {
    ...setup,
    run,
    options,
    submitOptions,
    factory,
    borrowed,
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
