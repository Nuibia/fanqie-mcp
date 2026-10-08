import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSubmissionFixture,
  SUBMISSION_FIXTURE_WORK,
  SUBMISSION_FIXTURE_OWNER,
  SUBMISSION_FIXTURE_MARKER,
} from './short-native-submission-fixture.js';
import {
  captureNativeShortSubmissionWriteRequest,
  captureNativeShortSubmissionOptions,
  validateNativeShortSubmissionApiResult,
  type NativeShortSubmissionApiResult,
} from '../src/platform/short-native-submission-api.js';
import {
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  NATIVE_SHORT_SUBMISSION_TTL_MS,
} from '../src/platform/short-native-submission.js';

const binding = { accountId: SUBMISSION_FIXTURE_OWNER, workId: SUBMISSION_FIXTURE_WORK };
function validate(result: NativeShortSubmissionApiResult) {
  return validateNativeShortSubmissionApiResult(result, binding);
}
test('GET-only preparation observes all fixed source bytes in one owned client and preserves explicit fixture provenance', async () => {
  const f = createSubmissionFixture({ mode: 'prepare' }),
    r = await f.run.run();
  assert.equal(r.status, 'success');
  assert.equal(r.mode, 'prepare');
  assert(r.prepared);
  assert.equal(r.prepared.business.useAi, 1);
  assert.equal(f.calls.length, 10);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(f.clientCreates, 1);
  assert.equal(f.clientDisposes, 1);
  assert.equal(r.phases.before.requests.own.attempts, 3);
  assert.equal(r.proof.fixedSourcesVerified, false);
  assert.deepEqual(
    Object.values(r.sourceReads).map((s) => [s.attempts, s.disposed]),
    [
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ],
  );
  assert.equal(r.prepared.contract.mode, 'fixture-no-live');
  assert(r.prepared.form.content!.includes(SUBMISSION_FIXTURE_MARKER));
  assert.deepEqual(validate(r), r);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(r))), r);
  for (const call of f.calls) {
    assert.equal(call.options.maxRetries, 0);
    assert.equal(call.options.maxRedirects, 0);
  }
  assert.equal(
    Object.values(NATIVE_SHORT_SUBMISSION_SOURCE_PINS).filter((pin) =>
      f.calls.some((c) => c.url === pin.url),
    ).length,
    4,
  );
});
test('complete submission has durable baseline, intent, ordinal 1 attempt, one POST, durable ACK and targeted after reads', async () => {
  const f = createSubmissionFixture(),
    r = await f.run.run();
  assert.equal(r.status, 'success');
  assert.equal(r.publish.outcome, 'verified');
  assert.equal(r.snapshot?.state, 'reviewing');
  assert.equal(r.comparison?.ai.evidence, 'matched');
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 19);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(r.publish.post.attempts, 1);
  assert.equal(r.publish.post.disposed, 1);
  assert.deepEqual(
    f.events.filter((e) =>
      ['baseline', 'intent', 'attempt', 'POST', 'acknowledgement'].includes(e),
    ),
    ['baseline', 'intent', 'attempt', 'POST', 'acknowledgement'],
  );
  assert.equal(r.phases.after.requests.list.attempts, 0);
  assert.equal(r.phases.preSubmit.requests.list.attempts, 1);
  assert.equal(r.phases.after.requests.own.attempts, 2);
  assert.equal(r.publish.attemptReceipt?.ordinal, 1);
  assert.equal(
    r.publish.held?.servicePrepared.preparationJobId,
    f.servicePrepared.preparationJobId,
  );
  assert.equal(f.clientCreates, 1);
  assert.equal(f.clientDisposes, 1);
  assert.equal(r.cleanup.quarantined, false);
  assert.equal(r.cleanup.pendingAtEnd, 0);
  assert(Object.isFrozen(r));
  assert.deepEqual(validate(r), r);
  await assert.rejects(() => f.run.run(), /single-use/);
});
test('reconcile mode reads original owner and edit/catalog with zero draft-list, source or POST requests', async () => {
  const f = createSubmissionFixture({ mode: 'read', afterStatus: 'published' }),
    r = await f.run.run();
  assert.equal(r.status, 'success');
  assert.equal(r.snapshot?.state, 'published');
  assert.equal(f.calls.length, 4);
  assert.equal(r.phases.after.requests.list.attempts, 0);
  assert.equal(r.publish.post.attempts, 0);
  assert.equal(
    Object.values(r.sourceReads).reduce((n, s) => n + s.attempts, 0),
    0,
  );
  assert.deepEqual(validate(r), r);
});
test('ACK accepted does not imply published or completed when AI is missing or state remains draft/unknown', async (t) => {
  for (const faults of [
    { afterMissingAi: true },
    { afterStatus: 'draft' as const },
    { afterStatus: 'unknown' as const },
  ])
    await t.test(JSON.stringify(faults), async () => {
      const f = createSubmissionFixture(faults),
        r = await f.run.run();
      assert.equal(r.status, 'success');
      assert.equal(r.publish.observation?.accepted, true);
      assert.equal(r.publish.outcome, 'acknowledged');
      assert.equal(r.publish.post.attempts, 1);
      assert.deepEqual(validate(r), r);
      if (faults.afterMissingAi) {
        assert.equal(r.comparison?.matches, false);
        assert.equal(r.comparison?.ai.evidence, 'missing');
      }
    });
});
test('server rejection is a complete collection retaining exact code/message in private ACK without fabricated acceptance', async () => {
  const f = createSubmissionFixture({
      acknowledgementCode: 1012,
      acknowledgementMessage: 'synthetic rejected by server',
    }),
    r = await f.run.run();
  assert.equal(r.status, 'success');
  assert.equal(r.publish.outcome, 'rejected');
  assert.equal(r.publish.observation?.code, 1012);
  assert.equal(r.publish.observation?.message, 'synthetic rejected by server');
  assert.equal(r.publish.observation?.accepted, false);
  assert(r.publish.acknowledgementReceipt);
  assert.deepEqual(validate(r), r);
});
test('lost or invalid ACK never retries and still observes fixed after reads while outcome remains unknown', async (t) => {
  for (const faults of [
    { acknowledgementLost: true },
    ...(['redirect', 'url', 'utf8', 'mime', 'code'] as const).map((responseFault) => ({
      responseFault,
    })),
  ])
    await t.test(JSON.stringify(faults), async () => {
      const f = createSubmissionFixture(faults),
        r = await f.run.run();
      assert.equal(r.status, 'capability_unavailable');
      assert.equal(r.publish.outcome, 'unknown');
      assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
      assert.equal(r.publish.acknowledgementReceipt, null);
      assert.equal(r.publish.observation, null);
      assert(r.snapshot);
      assert.equal(r.phases.after.requests.list.attempts, 0);
      assert.deepEqual(validate(r), r);
    });
});
test('snapshot drift, owner/list/redirect and durability callback failures block the only POST', async (t) => {
  for (const faults of [
    { drift: true },
    { ownerChanged: true },
    { duplicateList: true },
    { redirectGet: true },
    { baselineFails: true },
    { transform: (_stage: unknown, fields: unknown) => fields as never },
  ])
    await t.test(Object.keys(faults)[0]!, async () => {
      const f = createSubmissionFixture(faults),
        r = await f.run.run();
      assert.equal(r.status, 'capability_unavailable');
      assert.equal(r.publish.post.attempts, 0);
      assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
      assert.equal(f.clientDisposes, 1);
    });
});
test('TTL is checked after durability awaits before attempt marking and again immediately before the only POST', async (t) => {
  for (const stage of ['intent', 'attempt'] as const)
    await t.test(stage, async () => {
      const OriginalDate = Date;
      let shift = 0;
      class ShiftedDate extends OriginalDate {
        constructor(value?: string | number) {
          super(value ?? OriginalDate.now() + shift);
        }
        static now() {
          return OriginalDate.now() + shift;
        }
      }
      globalThis.Date = ShiftedDate as DateConstructor;
      try {
        const f = createSubmissionFixture({
            transform(s, fields, confirm) {
              const receipt = confirm(fields);
              if (s === stage) shift = NATIVE_SHORT_SUBMISSION_TTL_MS;
              return receipt;
            },
          }),
          r = await f.run.run();
        assert.equal(r.reason, 'version_conflict');
        assert.equal(r.publish.post.attempts, 0);
        assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
        if (stage === 'attempt') {
          assert.equal(r.publish.outcome, 'unknown');
          assert.equal(r.publish.attemptReceipt?.ordinal, 1);
          assert.equal(r.publish.post.markedAt, r.publish.attemptReceipt?.eventAt);
          assert.deepEqual(validate(r), r);
        } else {
          assert.equal(r.publish.attemptReceipt, null);
          assert.equal(r.publish.outcome, 'not_attempted');
        }
      } finally {
        globalThis.Date = OriginalDate;
      }
    });
});
test('late creation cancellation remains owned through actual disposal and no platform reads', async () => {
  const f = createSubmissionFixture({ hold: 'creation' }),
    p = f.run.run();
  await f.entered;
  f.controller.abort();
  const r = await p;
  assert.equal(r.reason, 'cancelled');
  assert.equal(r.cleanup.quarantined, true);
  assert(r.cleanup.pendingAtEnd > 0);
  assert.equal(f.calls.length, 0);
  f.release();
  await f.run.cleanupDone;
  assert.equal(f.clientDisposes, 1);
  assert.equal(r.cleanup.sessionDisposed, false);
  assert.equal(r.cleanup.pendingAtEnd > 0, true);
});
test('cancellation inside POST holds single attempt unknown and drains late response; cleanup failure cannot turn green', async () => {
  const f = createSubmissionFixture({ hold: 'post' }),
    p = f.run.run();
  await f.entered;
  f.controller.abort();
  const r = await p;
  assert.equal(r.publish.post.attempts, 1);
  assert.equal(r.publish.outcome, 'unknown');
  assert.equal(r.cleanup.quarantined, true);
  f.release();
  await f.run.cleanupDone;
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  for (const failDispose of ['response', 'api'] as const) {
    const failed = await createSubmissionFixture({ failDispose }).run.run();
    assert.equal(failed.status, 'capability_unavailable');
    assert.equal(failed.cleanup.quarantined, true);
    assert(failed.cleanup.disposalFailures > 0);
  }
});
test('descriptor capture rejects getters, policy overrides and implicit AI without invoking accessors', () => {
  const f = createSubmissionFixture();
  let getters = 0;
  assert.equal(
    captureNativeShortSubmissionWriteRequest({ ...f.businessRequest, useAi: undefined }),
    null,
  );
  assert.equal(
    captureNativeShortSubmissionWriteRequest({
      ...f.businessRequest,
      url: 'https://invalid.example',
    }),
    null,
  );
  assert.equal(
    captureNativeShortSubmissionOptions({
      ...f.options,
      get businessRequest() {
        getters++;
        return f.businessRequest;
      },
    }),
    null,
  );
  assert.equal(getters, 0);
});
test('private replay rebuilds model/held/receipts, tolerates canonical key order and rejects causal/counter/AI/status forgery', async () => {
  const r = await createSubmissionFixture().run.run();
  const sorted = (value: unknown): unknown =>
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map(sorted)
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
          )
      : value;
  assert.deepEqual(validate(sorted(r) as NativeShortSubmissionApiResult), r);
  const mutations: Array<(v: any) => void> = [
    (v) => {
      v.phases.after.requests.list.attempts = 1;
    },
    (v) => {
      v.publish.post.attempts = 2;
    },
    (v) => {
      v.publish.held.servicePrepared.preparationJobId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    },
    (v) => {
      v.publish.attemptReceipt.useAi = 2;
    },
    (v) => {
      v.publish.acknowledgementReceipt.ordinal = 1;
    },
    (v) => {
      v.publish.observation.useAi = 2;
    },
    (v) => {
      v.comparison.matches = false;
    },
    (v) => {
      v.sourceReads.main.completedAt = '2000-01-01T00:00:00.000Z';
    },
    (v) => {
      v.plan.request.liveAllowed = true;
    },
    (v) => {
      v.cleanup.pendingAtEnd = 1;
    },
  ];
  for (const mutate of mutations) {
    const raw = structuredClone(r);
    mutate(raw);
    assert.throws(() => validate(raw));
  }
});
test('private repeated result graph preserves the legal native source budget rather than failing after POST at 40 MiB', async () => {
  const opaque = 'synthetic source metadata '.repeat(105_000);
  const f = createSubmissionFixture({ editChanges: { opaque }, catalogChanges: { opaque } }),
    r = await f.run.run();
  assert.equal(r.status, 'success');
  assert.equal(r.publish.post.attempts, 1);
  assert.equal(r.publish.outcome, 'verified');
  assert(Buffer.byteLength(JSON.stringify(r)) > 40 * 1024 * 1024);
  assert.deepEqual(validate(r), r);
});
