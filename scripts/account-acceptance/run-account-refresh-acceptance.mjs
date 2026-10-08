import {
  safeSnapshot,
  safeRefresh,
  requiredAccountDatasets,
  ensure,
  object,
  fingerprint,
  verifyCompleteRefresh,
  errorCode,
} from './ensure.mjs';

import path from 'node:path';

import {
  mkdirSync,
  lstatSync,
  chmodSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from 'node:fs';

import { randomUUID, createHash } from 'node:crypto';

export async function runAccountRefreshAcceptance(call) {
  const checkedAt = new Date().toISOString();
  const before = await call('fanqie_get_saved_snapshot', { scope: 'account' });
  // One actual account refresh job; no four independent list/metrics calls.
  const clientRequestedAt = new Date().toISOString();
  const refresh = await call('fanqie_refresh_account', {});
  const after = await call('fanqie_get_saved_snapshot', { scope: 'account' });
  const beforeSafe = safeSnapshot(before);
  const afterSafe = safeSnapshot(after);
  const refreshSafe = safeRefresh(refresh);
  const receipt = {
    schemaVersion: 1,
    mode: 'refresh',
    checkedAt,
    clientRequestedAt,
    completedAt: new Date().toISOString(),
    requiredDatasets: requiredAccountDatasets,
    pass: false,
    errorCode: null,
    currentPreserved: false,
    sourceRefsMatched: false,
    before: beforeSafe,
    refresh: refreshSafe,
    after: afterSafe,
  };
  try {
    ensure(
      !beforeSafe.isError && beforeSafe.sourceMode === 'saved',
      'initial_saved_snapshot_required',
    );
    if (refreshSafe.status !== 'succeeded') {
      ensure(
        ['failed', 'partial', 'waiting_for_login', 'cancelled', 'uncertain'].includes(
          refreshSafe.status,
        ),
        'refresh_outcome_not_terminal',
      );
      ensure(
        refreshSafe.isError && refreshSafe.sourceMode === 'incomplete',
        'incomplete_refresh_mode_required',
      );
      ensure(
        !object(object(refresh.result).job?.result).manifest,
        'incomplete_refresh_cannot_commit',
      );
      ensure(
        !afterSafe.isError &&
          afterSafe.sourceMode === 'saved' &&
          fingerprint(beforeSafe) === fingerprint(afterSafe),
        'incomplete_refresh_replaced_current',
      );
      receipt.currentPreserved = true;
      receipt.errorCode = refreshSafe.errorCode ?? 'refresh_incomplete';
    } else {
      ensure(
        !beforeSafe.manifest ||
          (refreshSafe.jobId !== beforeSafe.manifest.jobId &&
            afterSafe.manifest?.id !== beforeSafe.manifest.id),
        'refresh_did_not_commit_new_manifest',
      );
      verifyCompleteRefresh(refresh, after, clientRequestedAt);
      receipt.pass = true;
      receipt.sourceRefsMatched = true;
    }
  } catch (error) {
    receipt.errorCode = errorCode(error?.code) ?? 'acceptance_contract_failed';
  }
  return receipt;
}

export function legacyReadsPassed(runs) {
  const expected = ['short_works', 'short_metrics', 'long_works', 'long_metrics'];
  return (
    Array.isArray(runs) &&
    runs.length === 4 &&
    runs.every(
      (run, index) =>
        !run.isError &&
        run.status === 'succeeded' &&
        run.sourceMode === 'live' &&
        run.retrievalMode === 'live' &&
        Array.isArray(run.evidence) &&
        run.evidence.length === 1 &&
        run.evidence[0].dataset === expected[index] &&
        Array.isArray(run.datasets) &&
        run.datasets.length === 1 &&
        run.datasets[0].dataset === expected[index] &&
        run.datasets[0].status === 'success' &&
        run.datasets[0].coverage?.complete === true &&
        run.datasets[0].coverage?.paginationComplete === true,
    )
  );
}

export function writePrivateRefreshReceipt(receipt, directory = '.runtime/acceptance') {
  for (const candidate of [path.dirname(directory), directory]) {
    mkdirSync(candidate, { recursive: true, mode: 0o700 });
    const metadata = lstatSync(candidate);
    ensure(metadata.isDirectory() && !metadata.isSymbolicLink(), 'unsafe_receipt_directory');
    chmodSync(candidate, 0o700);
  }
  const filename = path.join(directory, `account-refresh-${Date.now()}-${randomUUID()}.json`);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const descriptor = openSync(filename, 'wx', 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return {
    path: filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

export async function callAccountTool(client, name, args = {}) {
  // Installed MCP SDK v2 accepts request options as the second argument.
  const response = await client.callTool({ name, arguments: args }, { timeout: 135_000 });
  return {
    isError: response.isError === true,
    result:
      response.structuredContent?.result ??
      JSON.parse(response.content.find((item) => item.type === 'text')?.text ?? '{}'),
  };
}

export function safeExecutionFailure(error) {
  const value = object(error);
  const names = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AssertionError', 'McpError'];
  const systemCodes = [
    'EACCES',
    'EPERM',
    'ENOENT',
    'EEXIST',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ERR_ASSERTION',
  ];
  const code =
    Number.isSafeInteger(value.code) && value.code >= -32768 && value.code < 0
      ? value.code
      : systemCodes.includes(value.code)
        ? value.code
        : null;
  return {
    name: names.includes(value.name) ? value.name : 'UnknownError',
    code,
    ownKeys: ['name', 'code', 'message', 'stack', 'data', 'cause', 'details'].filter((key) =>
      Object.hasOwn(value, key),
    ),
    hasDetails: ['data', 'cause', 'details'].some((key) => Object.hasOwn(value, key)),
  };
}
