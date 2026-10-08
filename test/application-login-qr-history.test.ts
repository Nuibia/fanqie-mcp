import test from 'node:test';

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import {
  BrowserSession,
  type LoginQrcodeResult,
  type LoginState,
} from '../src/platform/browser.js';

import { createApplication } from '../src/application.js';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { collectedAccountFixture, ownAccountState } from './helpers/application-binding-fixture.js';

test('QR jobs return transient bytes per request while persisted history cannot replay them', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-qr-state-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'qr-evidence-contract-test-only-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const data =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=';
  let calls = 0;
  let captureGate: { entered(): void; wait: Promise<void> } | null = null;
  class FixtureBrowser extends BrowserSession {
    override async diagnoseCurrentLoginPage() {
      return {
        status: 'login_required' as const,
        sourceUrl: 'https://fanqienovel.com/main/writer/login',
        checkedAt: new Date().toISOString(),
        identityObserved: { accountId: false, authorId: false, displayName: false },
        controls: [],
        getResponses: [],
        routerStructure: [],
        ownResponseStructure: [],
        truncated: { controls: false, responses: false, router: false },
        limitations: ['Fixture static metadata only'],
      };
    }
    override async getLoginQrcode(): Promise<LoginQrcodeResult> {
      calls++;
      if (captureGate) {
        captureGate.entered();
        await captureGate.wait;
      }
      return {
        status: 'ready',
        login: {
          status: 'login_required',
          identity: null,
          sourceUrl: 'https://fanqienovel.com/main/writer/login',
          checkedAt: new Date().toISOString(),
        },
        checkedAt: new Date().toISOString(),
        sourceUrl: 'https://fanqienovel.com/main/writer/login',
        platform: 'fanqie',
        appInstructions: '使用平台提示的App扫码',
        expiry: { status: 'unknown' },
        image: Buffer.from(data, 'base64'),
        mimeType: 'image/png',
        qrVerified: true,
      };
    }
  }
  const application = createApplication(config, {
    browser: new FixtureBrowser({ profileDir: config.profileDir, headless: true }),
  });
  try {
    const tool = application.tools.find((item) => item.name === 'fanqie_get_login_qrcode');
    assert(tool);
    const responses = (await Promise.all(Array.from({ length: 3 }, () => tool.run({})))) as Array<
      Record<string, any>
    >;
    assert.equal(calls, 3);
    const diagnosis = (await application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_diagnose_current_login',
      new URLSearchParams(),
      {},
    )) as Record<string, any>;
    assert.equal(diagnosis.job.status, 'succeeded');
    assert.equal(diagnosis.data[0].status, 'login_required');
    assert.equal(new Set(responses.map((item) => item.job.id)).size, 3);
    for (const response of responses) {
      assert.equal(response.job.status, 'succeeded');
      assert.equal(response.sourceMode, 'live');
      assert.deepEqual(response.image, { mimeType: 'image/png', data });
      assert.equal(
        response.qrcode.imageSha256,
        createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex'),
      );
      assert.equal(response.qrcode.imageSize, Buffer.from(data, 'base64').length);
      const history = await application.dispatch(
        'GET',
        `/api/v1/jobs/${response.job.id}`,
        new URLSearchParams(),
        undefined,
      );
      assert.equal(Object.hasOwn(history as object, 'image'), false);
      assert.equal(JSON.stringify(history).includes(data), false);
      assert.equal(JSON.stringify(response.data).includes(data), false);
    }
    const saved = await application.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams('scope=login_qrcode'),
      undefined,
    );
    assert.equal(JSON.stringify(saved).includes(data), false);
    const evidenceDir = path.join(config.dataDir, 'evidence');
    for (const file of readdirSync(evidenceDir, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      assert.equal(
        readFileSync(path.join(file.parentPath, file.name), 'utf8').includes(data),
        false,
      );
    }
    let imageCaptured!: () => void;
    let releaseCapture!: () => void;
    const captured = new Promise<void>((resolve) => {
      imageCaptured = resolve;
    });
    captureGate = {
      entered: imageCaptured,
      wait: new Promise<void>((resolve) => {
        releaseCapture = resolve;
      }),
    };
    const pending = application.dispatch('POST', '/api/v1/login/qrcode', new URLSearchParams(), {});
    await captured;
    const jobs = (await application.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as { jobs: Array<{ id: string; status: string }> };
    const running = jobs.jobs.find((job) => job.status === 'running');
    assert(running);
    const cancel = application.tools.find((item) => item.name === 'fanqie_cancel_job');
    assert(cancel);
    await cancel.run({ jobId: running.id });
    releaseCapture();
    const cancelled = (await pending) as Record<string, any>;
    assert.equal(cancelled.job.status, 'cancelled');
    assert.equal(Object.hasOwn(cancelled, 'image'), false);
    assert.equal(JSON.stringify(cancelled).includes(data), false);
  } finally {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('collected account data is committed only after a fresh matching typed identity, and a later switch preserves the old current', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-collected-account-'));
  const fixture = collectedAccountFixture(directory, [
    ownAccountState('1001', '4001'),
    ownAccountState('3001', '2001'),
  ]);
  try {
    const success = await fixture.call('list_works', { kind: 'short' });
    assert.equal(success.job.status, 'succeeded');
    assert.equal(success.sourceMode, 'live');
    assert.equal(success.evidence.length, 1);
    assert.equal(success.data[0].records.length, 1);
    const before = await fixture.snapshot('short_works');
    assert(before.manifest);
    const switched = await fixture.call('list_works', { kind: 'short' });
    assert.equal(switched.job.status, 'failed');
    assert.equal(switched.job.error.code, 'account_mismatch');
    assert.equal(switched.sourceMode, 'incomplete');
    assert.deepEqual(switched.evidence, []);
    assert.deepEqual(switched.data, []);
    assert.deepEqual(await fixture.snapshot('short_works'), before);
    assert.deepEqual(fixture.calls, { pageCallbacks: 2, navigations: 2, postVerifications: 2 });
    const status = (await fixture.application.dispatch(
      'GET',
      '/api/v1/status',
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    assert.equal(status.platform.status, 'unknown');
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('post-collection unknown, expired or missing bound identity cannot persist successful account evidence', async () => {
  const cases: Array<{ state: LoginState; error: string; jobStatus: string }> = [
    {
      state: { ...ownAccountState('1001'), status: 'unknown', identity: null },
      error: 'capability_unavailable',
      jobStatus: 'failed',
    },
    {
      state: { ...ownAccountState('1001'), status: 'login_required', identity: null },
      error: 'requires_login',
      jobStatus: 'waiting_for_login',
    },
    { state: ownAccountState(null, '1001'), error: 'capability_unavailable', jobStatus: 'failed' },
  ];
  for (const scenario of cases) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-collected-unproved-'));
    const fixture = collectedAccountFixture(directory, [scenario.state]);
    try {
      const result = await fixture.call('list_works', { kind: 'short' });
      assert.equal(result.job.status, scenario.jobStatus);
      assert.equal(result.job.error.code, scenario.error);
      assert.deepEqual(result.evidence, []);
      assert.deepEqual(result.data, []);
      assert.equal((await fixture.snapshot('short_works')).manifest, null);
      assert.equal(fixture.calls.postVerifications, 1);
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('partial account collection is post-verified too: same-account diagnostics persist, other-account records do not', async () => {
  for (const accountId of ['1001', '3001']) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-collected-partial-'));
    const fixture = collectedAccountFixture(directory, [ownAccountState(accountId, '2001')], {
      partial: true,
    });
    try {
      const result = await fixture.call('list_works', { kind: 'short' });
      assert.equal(result.job.status, accountId === '1001' ? 'partial' : 'failed');
      assert.equal(
        result.job.error.code,
        accountId === '1001' ? 'invalid_evidence' : 'account_mismatch',
      );
      assert.equal(fixture.calls.postVerifications, 1);
      if (accountId === '1001') {
        assert.equal(result.evidence.length, 1);
        assert.equal(result.data[0].status, 'partial');
      } else {
        assert.deepEqual(result.evidence, []);
        assert.deepEqual(result.data, []);
      }
      assert.equal((await fixture.snapshot('short_works')).manifest, null);
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('chapter account reads use the same post-collection guard inside one FIFO callback', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-collected-chapters-'));
  const fixture = collectedAccountFixture(
    directory,
    [ownAccountState('1001'), ownAccountState('3001')],
    { chapters: true },
  );
  try {
    const success = await fixture.call('list_chapters', { workId: '12345678901234' });
    assert.equal(success.job.status, 'succeeded');
    assert.equal(success.data[0].records[0].chapterId, '12345678901234');
    const before = await fixture.snapshot('chapters.12345678901234');
    assert(before.manifest);
    const switched = await fixture.call('list_chapters', { workId: '12345678901234' });
    assert.equal(switched.job.status, 'failed');
    assert.equal(switched.job.error.code, 'account_mismatch');
    assert.deepEqual(switched.evidence, []);
    assert.deepEqual(switched.data, []);
    assert.deepEqual(await fixture.snapshot('chapters.12345678901234'), before);
    assert.deepEqual(fixture.calls, { pageCallbacks: 2, navigations: 2, postVerifications: 2 });
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('unverified built-in chapter source remains unavailable without claiming a fresh page or advancing current', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-collected-no-profile-'));
  const fixture = collectedAccountFixture(directory, []);
  try {
    for (const [name, args, scope] of [
      ['list_chapters', { workId: '12345678901234' }, 'chapters.12345678901234'],
    ] as const) {
      const result = await fixture.call(name, args);
      assert.equal(result.job.status, 'partial');
      assert.equal(result.job.error.code, 'capability_unavailable');
      assert.equal(result.sourceMode, 'incomplete');
      assert.equal(result.data[0].status, 'capability_unavailable');
      assert.equal((await fixture.snapshot(scope)).manifest, null);
    }
    assert.deepEqual(fixture.calls, { pageCallbacks: 1, navigations: 0, postVerifications: 0 });
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
