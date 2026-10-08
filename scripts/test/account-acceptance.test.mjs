import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runAccountRefreshAcceptance,
  verifyCompleteRefresh,
  safeSnapshot,
  writePrivateRefreshReceipt,
  legacyReadsPassed,
  callAccountTool,
  safeExecutionFailure,
} from '../account-acceptance.mjs';

const datasets = ['short_works', 'short_metrics', 'long_works', 'long_metrics'];
const privateSentinel = 'PRIVATE_SENTINEL_DO_NOT_SERIALIZE';
function fixture() {
  const stamp = new Date().toISOString();
  const jobId = randomUUID();
  const refs = datasets.map((dataset, index) => ({
    id: randomUUID(),
    jobId,
    accountId: privateSentinel,
    dataset,
    capturedAt: stamp,
    sha256: String(index + 1).repeat(64),
    path: privateSentinel,
  }));
  const manifest = {
    id: randomUUID(),
    jobId,
    accountId: privateSentinel,
    operation: 'refresh',
    scope: 'account',
    datasets,
    requestedAt: stamp,
    platformReadStartedAt: stamp,
    committedAt: stamp,
    evidence: refs,
  };
  const data = refs.map((ref) => ({
    dataset: ref.dataset,
    status: 'success',
    capturedAt: stamp,
    records: [
      {
        workId: privateSentinel,
        title: privateSentinel,
        body: privateSentinel,
        metadata: privateSentinel,
      },
    ],
    coverage: {
      complete: true,
      paginationComplete: true,
      pagesFetched: 1,
      pagesDiscovered: 1,
      recordsFetched: 1,
      totalRecords: 1,
      fields: [privateSentinel],
    },
    source: { mode: 'live', origin: 'https://fanqienovel.com' },
    sourceUrl: `https://fanqienovel.com/?secret=${privateSentinel}`,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: stamp,
    statisticsThrough: null,
    errors: [{ code: 'fixture_limited', scope: privateSentinel, workId: privateSentinel }],
    limitations: [privateSentinel],
  }));
  const refresh = {
    isError: false,
    result: {
      job: {
        id: jobId,
        accountId: privateSentinel,
        kind: 'read',
        operation: 'refresh',
        scope: 'account',
        datasets,
        status: 'succeeded',
        requestedAt: stamp,
        platformReadStartedAt: stamp,
        endedAt: stamp,
        error: null,
        result: { manifest },
      },
      sourceMode: 'live',
      retrievalMode: 'live',
      evidence: refs,
      data,
    },
  };
  const saved = { isError: false, result: { sourceMode: 'saved', manifest, data } };
  return { refresh, saved };
}
const emptySaved = () => ({
  isError: false,
  result: { sourceMode: 'saved', manifest: null, data: [] },
});
function scripted(before, getRefresh, getAfter) {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      if (calls.length === 1) return before;
      if (calls.length === 2) return getRefresh();
      if (calls.length === 3) return getAfter();
      assert.fail('The acceptance must use only before/one refresh/after');
    },
  };
}

test('single account refresh proves four current sources and uses only one refresh job', async () => {
  let f;
  const sequence = scripted(
    emptySaved(),
    () => {
      f = fixture();
      return f.refresh;
    },
    () => f.saved,
  );
  const sdkV2Fixture = {
    async callTool(params, options) {
      assert.equal(
        arguments.length,
        2,
        'MCP SDK v2 must receive request options in its second argument',
      );
      assert.equal(options.timeout, 135_000);
      const result = await sequence.call(params.name, params.arguments);
      return { isError: result.isError, structuredContent: { result: result.result }, content: [] };
    },
  };
  const receipt = await runAccountRefreshAcceptance((name, args) =>
    callAccountTool(sdkV2Fixture, name, args),
  );
  assert.equal(receipt.pass, true);
  assert.equal(receipt.sourceRefsMatched, true);
  assert.equal(receipt.after.sourceMode, 'saved');
  assert.deepEqual(sequence.calls, [
    { name: 'fanqie_get_saved_snapshot', args: { scope: 'account' } },
    { name: 'fanqie_refresh_account', args: {} },
    { name: 'fanqie_get_saved_snapshot', args: { scope: 'account' } },
  ]);
  assert.equal(receipt.refresh.evidence.length, 4);
  assert.equal(receipt.after.manifest.jobId, receipt.refresh.jobId);
  assert.equal(JSON.stringify(receipt).includes(privateSentinel), false);
});

test('failed and partial account runs can prove current preservation without passing live acceptance', async () => {
  for (const status of ['failed', 'partial', 'waiting_for_login', 'cancelled']) {
    const old = fixture().saved;
    const partial = fixture().refresh;
    partial.isError = true;
    partial.result.sourceMode = 'incomplete';
    partial.result.job.status = status;
    partial.result.job.error = {
      code: 'capability_unavailable',
      message: privateSentinel,
      details: { dataset: 'long_metrics', raw: privateSentinel },
    };
    partial.result.job.result = { evidence: partial.result.evidence };
    partial.result.data[3] = {
      ...partial.result.data[3],
      status: 'capability_unavailable',
      records: [],
      coverage: {
        complete: false,
        paginationComplete: false,
        pagesFetched: 0,
        pagesDiscovered: null,
        recordsFetched: 0,
        totalRecords: null,
      },
      errors: [{ code: 'loaded_long_statistics_list_missing', scope: 'bootstrap' }],
      limitations: [privateSentinel],
    };
    const sequence = scripted(
      old,
      () => partial,
      () => old,
    );
    const sdkV2Fixture = {
      async callTool(params, options) {
        assert.equal(arguments.length, 2);
        assert.equal(options.timeout, 135_000);
        const value = await sequence.call(params.name, params.arguments);
        return { isError: value.isError, structuredContent: { result: value.result }, content: [] };
      },
    };
    const receipt = await runAccountRefreshAcceptance((name, args) =>
      callAccountTool(sdkV2Fixture, name, args),
    );
    assert.equal(receipt.pass, false);
    assert.equal(receipt.currentPreserved, true);
    assert.equal(receipt.errorCode, 'capability_unavailable');
    assert.equal(receipt.refresh.datasets.length, 4);
    assert.equal(
      receipt.refresh.datasets.filter((dataset) => dataset.status === 'success').length,
      3,
    );
    assert.deepEqual(
      receipt.refresh.datasets.find((dataset) => dataset.dataset === 'long_metrics').errorCodes,
      ['loaded_long_statistics_list_missing'],
    );
    assert.equal(JSON.stringify(receipt).includes(privateSentinel), false);
    if (status === 'partial') {
      const temporary = mkdtempSync(path.join(os.tmpdir(), 'fanqie-partial-receipt-'));
      try {
        const artifact = writePrivateRefreshReceipt(
          receipt,
          path.join(temporary, 'runtime', 'acceptance'),
        );
        const stored = JSON.parse(readFileSync(artifact.path, 'utf8'));
        assert.equal(statSync(artifact.path).mode & 0o777, 0o600);
        assert.equal(stored.pass, false);
        assert.equal(stored.currentPreserved, true);
        assert.equal(
          stored.refresh.datasets.filter((dataset) => dataset.status === 'success').length,
          3,
        );
        assert.equal(JSON.stringify(stored).includes(privateSentinel), false);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
});

test('incomplete refresh replacing account current is rejected', async () => {
  const old = fixture().saved;
  const changed = fixture().saved;
  const sequence = scripted(
    old,
    () => ({
      isError: true,
      result: { sourceMode: 'incomplete', job: { status: 'partial', result: {} } },
    }),
    () => changed,
  );
  const receipt = await runAccountRefreshAcceptance(sequence.call);
  assert.equal(receipt.pass, false);
  assert.equal(receipt.currentPreserved, false);
  assert.equal(receipt.errorCode, 'incomplete_refresh_replaced_current');
});

test('empty records envelope, duplicate data, incomplete coverage and wrong source job cannot pass', () => {
  for (const change of [
    (f) => {
      f.refresh.result.data = [];
    },
    (f) => {
      f.refresh.result.data[3].dataset = 'short_works';
    },
    (f) => {
      f.refresh.result.data[1].coverage.complete = false;
    },
    (f) => {
      f.refresh.result.data[1].coverage.totalRecords = 2;
    },
    (f) => {
      f.refresh.result.evidence[1].jobId = randomUUID();
    },
    (f) => {
      f.refresh.result.evidence[1].sha256 = 'invalid';
    },
    (f) => {
      f.refresh.result.sourceMode = 'saved';
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(
      () => verifyCompleteRefresh(f.refresh, f.saved),
      (error) => /^[a-z_]+$/.test(error.code),
    );
  }
});

test('saved snapshot must say saved and must match the single refresh manifest/source refs', () => {
  for (const change of [
    (f) => {
      f.saved.result.sourceMode = 'live';
    },
    (f) => {
      f.saved.result.manifest = fixture().saved.result.manifest;
    },
    (f) => {
      f.saved.result.data = [];
    },
    (f) => {
      f.saved.result.data[0] = { ...f.saved.result.data[0], evidenceHash: 'f'.repeat(64) };
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(
      () => verifyCompleteRefresh(f.refresh, f.saved),
      (error) => /^[a-z_]+$/.test(error.code),
    );
  }
});

test('cached platform access from before this local request is rejected even if labelled live', () => {
  const f = fixture();
  const next = new Date(Date.parse(f.refresh.result.job.platformReadStartedAt) + 1).toISOString();
  assert.throws(() => verifyCompleteRefresh(f.refresh, f.saved, next), {
    code: 'cached_platform_read_rejected',
  });
});

test('a labelled-live cached current is not accepted as a new refresh manifest', async () => {
  const f = fixture();
  const sequence = scripted(
    f.saved,
    () => f.refresh,
    () => f.saved,
  );
  const receipt = await runAccountRefreshAcceptance(sequence.call);
  assert.equal(receipt.pass, false);
  assert.equal(receipt.errorCode, 'refresh_did_not_commit_new_manifest');
});

test('safe projection drops platform IDs, titles, body, metadata, paths, private labels and URL queries', () => {
  const f = fixture();
  const projected = safeSnapshot(f.saved);
  assert.equal(JSON.stringify(projected).includes(privateSentinel), false);
  assert.equal(projected.datasets.length, 4);
  assert.equal(projected.datasets[0].count, 1);
  assert.equal(Object.hasOwn(projected.datasets[0], 'records'), false);
  assert.equal(Object.hasOwn(projected.manifest, 'accountId'), false);
  const timeout = Object.assign(new Error(privateSentinel), {
    name: 'McpError',
    code: -32001,
    data: { token: privateSentinel },
    details: privateSentinel,
    [privateSentinel]: true,
  });
  const failure = safeExecutionFailure(timeout);
  assert.equal(failure.name, 'McpError');
  assert.equal(failure.code, -32001);
  assert.equal(failure.hasDetails, true);
  assert.equal(JSON.stringify(failure).includes(privateSentinel), false);
  assert.deepEqual(failure.ownKeys, ['name', 'code', 'message', 'stack', 'data', 'details']);
});

test('refresh receipt is unique private 0600 JSON with bytes/hash and 0700 parent directory', async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'fanqie-refresh-receipt-'));
  try {
    let f;
    const sequence = scripted(
      emptySaved(),
      () => {
        f = fixture();
        return f.refresh;
      },
      () => f.saved,
    );
    const receipt = await runAccountRefreshAcceptance(sequence.call);
    const artifact = writePrivateRefreshReceipt(
      receipt,
      path.join(temporary, 'runtime', 'acceptance'),
    );
    assert.equal(statSync(artifact.path).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(artifact.path)).mode & 0o777, 0o700);
    const text = readFileSync(artifact.path, 'utf8');
    assert.equal(Buffer.byteLength(text), artifact.bytes);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(text.includes(privateSentinel), false);
    assert.equal(JSON.parse(text).pass, true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('legacy independent mode no longer accepts every(empty) or mismatched datasets', () => {
  const valid = datasets.map((dataset) => ({
    isError: false,
    status: 'succeeded',
    sourceMode: 'live',
    retrievalMode: 'live',
    evidence: [{ dataset }],
    datasets: [
      { dataset, status: 'success', coverage: { complete: true, paginationComplete: true } },
    ],
  }));
  assert.equal(legacyReadsPassed(valid), true);
  assert.equal(legacyReadsPassed([]), false);
  assert.equal(legacyReadsPassed(valid.map((run) => ({ ...run, datasets: [] }))), false);
  assert.equal(legacyReadsPassed(valid.map((run) => ({ ...run, evidence: [] }))), false);
  assert.equal(legacyReadsPassed(valid.map((run) => ({ ...run, sourceMode: 'saved' }))), false);
});
