import { readFileSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import {
  callAccountTool,
  runAccountRefreshAcceptance,
  writePrivateRefreshReceipt,
  legacyReadsPassed,
} from './run-account-refresh-acceptance.mjs';

import assert from 'node:assert/strict';

import { opaqueId, iso, safeRef } from './ensure.mjs';

export async function main() {
  const base = process.env.FANQIE_TEST_URL ?? 'http://127.0.0.1:18062';
  const token = readFileSync(
    process.env.FANQIE_TEST_TOKEN_FILE ?? '.secrets/api-token',
    'utf8',
  ).trim();
  mkdirSync('.runtime/acceptance', { recursive: true, mode: 0o700 });
  chmodSync('.runtime/acceptance', 0o700);
  const client = new Client(
    { name: 'fanqie-account-acceptance-local', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const call = (name, args = {}) => callAccountTool(client, name, args);
  function summary({ result, isError }) {
    return {
      isError,
      jobId: result.job?.id,
      status: result.job?.status,
      errorCode: result.job?.error?.code ?? null,
      requestedAt: result.job?.requestedAt,
      platformReadStartedAt: result.job?.platformReadStartedAt,
      endedAt: result.job?.endedAt,
      retrievalMode: result.retrievalMode,
      sourceMode: result.sourceMode,
      evidence: (result.evidence ?? []).map(({ id, dataset, sha256 }) => ({ id, dataset, sha256 })),
      datasets: (result.data ?? []).map((item) => ({
        dataset: item.dataset,
        status: item.status,
        count: item.records?.length ?? null,
        coverage: item.coverage ?? null,
        statisticsThrough: item.statisticsThrough ?? null,
        statisticsThroughBasis: item.statisticsThroughBasis ?? null,
        errors: (item.errors ?? []).map(({ code, scope, page }) => ({ code, scope, page })),
        limitations: item.limitations ?? [],
      })),
    };
  }
  try {
    const login = await call('fanqie_check_login_status');
    const state = login.result.data?.[0];
    const identityVerified = Boolean(state?.identity?.authorId || state?.identity?.accountId);
    console.log(
      JSON.stringify({
        stage: 'account-login',
        ...summary(login),
        loginStatus: state?.status ?? 'unknown',
        stableIdentityObserved: identityVerified,
      }),
    );
    if (process.argv[2] === 'refresh') {
      assert.equal(state?.status, 'authenticated', 'The platform has not verified login');
      assert(identityVerified, 'A stable own-account identity has not been verified');
      assert(
        !login.isError && login.result.job?.status === 'succeeded',
        'The actual login check did not succeed',
      );
      const receipt = await runAccountRefreshAcceptance(call);
      receipt.login = {
        status: 'authenticated',
        stableIdentityObserved: true,
        jobId: opaqueId(login.result.job?.id),
        checkedAt: iso(state?.checkedAt),
        evidence: (login.result.evidence ?? []).map((ref) => ({
          ...safeRef(ref),
          dataset: ref.dataset === 'login' ? 'login' : 'unknown',
        })),
      };
      const artifact = writePrivateRefreshReceipt(receipt);
      console.log(
        JSON.stringify({
          stage: 'account-refresh-result',
          pass: receipt.pass,
          errorCode: receipt.errorCode,
          currentPreserved: receipt.currentPreserved,
          sourceRefsMatched: receipt.sourceRefsMatched,
          requiredDatasets: 4,
          completeDatasets: receipt.refresh.datasets.filter(
            (item) =>
              item.status === 'success' &&
              item.coverage.complete &&
              item.coverage.paginationComplete,
          ).length,
          sourceMode: receipt.refresh.sourceMode,
          savedSourceMode: receipt.after.sourceMode,
          requestedAt: receipt.refresh.requestedAt,
          platformReadStartedAt: receipt.refresh.platformReadStartedAt,
          endedAt: receipt.refresh.endedAt,
          receipt: artifact,
        }),
      );
      if (!receipt.pass) process.exitCode = 1;
    } else if (process.argv[2] === 'diagnose') {
      const diagnostic = await call('fanqie_diagnose_current_login');
      const safe = { ...summary(diagnostic), diagnostics: diagnostic.result.data };
      writeFileSync(
        '.runtime/acceptance/current-login-diagnostic.json',
        JSON.stringify(safe, null, 2),
        { mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          stage: 'current-login-diagnostic',
          ...summary(diagnostic),
          diagnostics: diagnostic.result.data.map((item) => ({
            status: item.status,
            sourceUrl: item.sourceUrl,
            identityObserved: item.identityObserved,
            getResponses: item.getResponses,
            routerStructure: item.routerStructure,
            ownResponseStructure: item.ownResponseStructure,
            controlCount: item.controls?.length ?? 0,
            controlLabels: [
              ...new Set(
                (item.controls ?? []).flatMap((control) => (control.label ? [control.label] : [])),
              ),
            ],
            truncated: item.truncated,
          })),
        }),
      );
    } else {
      assert.equal(state?.status, 'authenticated', 'The platform has not verified login');
      assert(identityVerified, 'A stable own-account identity has not been verified');
      const runs = [];
      for (const [name, args] of [
        ['fanqie_list_works', { kind: 'short' }],
        ['fanqie_get_metrics', { kind: 'short' }],
        ['fanqie_list_works', { kind: 'long' }],
        ['fanqie_get_metrics', { kind: 'long' }],
      ]) {
        const receipt = { name, ...summary(await call(name, args)) };
        runs.push(receipt);
        console.log(JSON.stringify({ stage: 'account-live-read', ...receipt }));
      }
      writeFileSync(
        '.runtime/acceptance/account-live-reads.json',
        JSON.stringify(
          { checkedAt: new Date().toISOString(), stableIdentityObserved: identityVerified, runs },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      const passed = legacyReadsPassed(runs);
      console.log(
        JSON.stringify({
          stage: 'account-live-reads-result',
          passed,
          requiredDatasets: 4,
          completeDatasets: runs.filter((run) => !run.isError && run.status === 'succeeded').length,
        }),
      );
      if (!passed) process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}
