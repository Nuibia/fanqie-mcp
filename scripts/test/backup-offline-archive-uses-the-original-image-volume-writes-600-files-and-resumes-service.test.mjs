import test from 'node:test';

import {
  temporary,
  mockDocker,
  imageId,
  mainVolume,
  databaseFixture,
} from './helpers/backup-mock-docker.mjs';

import {
  runBackup,
  readBackup,
  waitForServiceHealthy,
  runVerifyBackup,
  digest,
} from '../lib/backup-core.mjs';

import assert from 'node:assert/strict';

import path from 'node:path';

import { stat, readdir, writeFile, readFile } from 'node:fs/promises';

import { verifyDataDirectory } from '../lib/verify-data.mjs';

test('offline archive uses the original image/volume, writes 600 files and resumes service', async () =>
  temporary(async (root) => {
    const mocked = mockDocker();
    const result = await runBackup({ projectRoot: root, runDocker: mocked.runner });
    assert.equal(result.pass, true);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_PROFILE'));
    const backups = path.join(root, '.runtime', 'backups');
    assert.equal((await stat(backups)).mode & 0o777, 0o700);
    for (const name of await readdir(backups))
      assert.equal((await stat(path.join(backups, name))).mode & 0o777, 0o600);
    const backup = await readBackup(root);
    assert.equal(backup.metadata.imageId, imageId);
    const helper = mocked.calls.find((call) => call.options.outputFile);
    assert.ok(helper.args.includes(imageId));
    assert.ok(helper.args.includes(`type=volume,src=${mainVolume},dst=/source,readonly`));
    assert.ok(
      mocked.calls.findIndex((call) => call.args.includes('stop')) < mocked.calls.indexOf(helper),
    );
    assert.ok(
      mocked.calls.findIndex((call) => call.args.includes('start')) > mocked.calls.indexOf(helper),
    );
  }));

test('archive failure and occupied volume resume service and remove only own partial backup', async () => {
  for (const failure of [{ failArchive: true }, { inUse: true }])
    await temporary(async (root) => {
      const mocked = mockDocker(failure);
      await assert.rejects(runBackup({ projectRoot: root, runDocker: mocked.runner }));
      assert.equal(mocked.calls.filter((call) => call.args.includes('start')).length, 1);
      assert.deepEqual(await readdir(path.join(root, '.runtime', 'backups')), []);
      assert.ok(!mocked.calls.some((call) => call.args[0] === 'volume' && call.args[1] === 'rm'));
    });
});

test('an originally stopped service stays stopped after backup', async () =>
  temporary(async (root) => {
    const mocked = mockDocker({ running: false });
    await runBackup({ projectRoot: root, runDocker: mocked.runner });
    assert.equal(mocked.calls.filter((call) => call.args.includes('start')).length, 0);
  }));

test('restore waits through starting, unhealthy and restarting until healthy, starting only once', async () =>
  temporary(async (root) => {
    const mocked = mockDocker({ healthStates: ['starting', 'unhealthy', 'restarting', 'healthy'] });
    let elapsed = 0;
    const waits = [];
    const result = await runBackup({
      projectRoot: root,
      runDocker: mocked.runner,
      restoreTimeoutMs: 5_000,
      monotonicClock: () => elapsed,
      pause: async (milliseconds) => {
        waits.push(milliseconds);
        elapsed += milliseconds;
      },
    });
    assert.equal(result.serviceRestored, true);
    assert.deepEqual(waits, [1_000, 1_000, 1_000]);
    assert.equal(mocked.calls.filter((call) => call.args.includes('start')).length, 1);
    assert.equal((await readBackup(root)).metadata.offline, true);
  }));

test('persistent restarting times out, keeps completed backup and releases lock without retrying start', async () =>
  temporary(async (root) => {
    const mocked = mockDocker({ healthStates: ['restarting'] });
    let elapsed = 0;
    await assert.rejects(
      runBackup({
        projectRoot: root,
        runDocker: mocked.runner,
        restoreTimeoutMs: 2_500,
        monotonicClock: () => elapsed,
        pause: async (milliseconds) => {
          elapsed += milliseconds;
        },
      }),
      { code: 'service_restore_timeout' },
    );
    assert.equal(elapsed, 2_500);
    assert.equal(mocked.calls.filter((call) => call.args.includes('start')).length, 1);
    const { archive, metadata } = await readBackup(root);
    assert.equal(metadata.offline, true);
    assert.deepEqual(
      (await readdir(path.dirname(archive))).sort(),
      [path.basename(archive), path.basename(archive).replace(/\.tar$/, '.json')].sort(),
    );
  }));

test('a missing healthcheck fails explicitly and preserves the completed archive', async () =>
  temporary(async (root) => {
    const mocked = mockDocker({ missingHealthcheck: true });
    await assert.rejects(runBackup({ projectRoot: root, runDocker: mocked.runner }), {
      code: 'service_healthcheck_missing',
    });
    assert.equal(mocked.calls.filter((call) => call.args.includes('start')).length, 1);
    assert.equal((await readBackup(root)).metadata.offline, true);
    assert.ok(!(await readdir(path.join(root, '.runtime', 'backups'))).includes('.backup-lock'));
  }));

test('compose start and health inspections share one recovery deadline', async () =>
  temporary(async (root) => {
    const mocked = mockDocker({ healthStates: ['unhealthy'] });
    let elapsed = 0;
    const runDocker = async (args, options) => {
      const result = await mocked.runner(args, options);
      if (args.includes('start')) elapsed += 1_600;
      return result;
    };
    const waits = [];
    await assert.rejects(
      runBackup({
        projectRoot: root,
        runDocker,
        restoreTimeoutMs: 2_500,
        monotonicClock: () => elapsed,
        pause: async (milliseconds) => {
          waits.push(milliseconds);
          elapsed += milliseconds;
        },
      }),
      { code: 'service_restore_timeout' },
    );
    assert.deepEqual(waits, [900]);
    assert.equal(elapsed, 2_500);
    assert.equal((await readBackup(root)).metadata.offline, true);
  }));

test('a stalled compose start receives a deadline signal, fails safely and retains completed backup', async () =>
  temporary(async (root) => {
    const mocked = mockDocker();
    const keepAlive = setInterval(() => {}, 10);
    let starts = 0;
    const runDocker = async (args, options = {}) => {
      if (!args.includes('start')) return mocked.runner(args, options);
      starts++;
      assert.ok(options.signal instanceof AbortSignal);
      return new Promise((resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('Private Docker details must not escape')),
          { once: true },
        ),
      );
    };
    try {
      await assert.rejects(runBackup({ projectRoot: root, runDocker, restoreTimeoutMs: 20 }), {
        code: 'service_restore_timeout',
        message: 'service_restore_timeout',
      });
    } finally {
      clearInterval(keepAlive);
    }
    assert.equal(starts, 1);
    assert.equal((await readBackup(root)).metadata.offline, true);
  }));

test('a stalled inspection receives the remaining deadline signal and cannot wait indefinitely', async () => {
  const keepAlive = setInterval(() => {}, 10);
  let calls = 0;
  const runDocker = async (args, options = {}) => {
    calls++;
    assert.deepEqual(args, ['inspect', 'a'.repeat(64)]);
    assert.ok(options.signal instanceof AbortSignal);
    return new Promise((resolve, reject) =>
      options.signal.addEventListener(
        'abort',
        () => reject(new Error('Private inspection details must not escape')),
        { once: true },
      ),
    );
  };
  try {
    await assert.rejects(waitForServiceHealthy('a'.repeat(64), { runDocker, timeoutMs: 20 }), {
      code: 'service_restore_timeout',
      message: 'service_restore_timeout',
    });
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(calls, 1);
});

test('the read-only readiness helper tolerates a transient inspection error and never starts service', async () => {
  let calls = 0;
  let elapsed = 0;
  const runDocker = async (args, options) => {
    assert.deepEqual(args, ['inspect', 'a'.repeat(64)]);
    assert.ok(options.signal instanceof AbortSignal);
    if (++calls === 1) throw new Error('Private transient diagnostic');
    return JSON.stringify([
      {
        Config: { Healthcheck: { Test: ['CMD', 'fixture-health'] } },
        State: { Running: true, Restarting: false, Health: { Status: 'healthy' } },
      },
    ]);
  };
  assert.deepEqual(
    await waitForServiceHealthy('a'.repeat(64), {
      runDocker,
      timeoutMs: 5_000,
      monotonicClock: () => elapsed,
      pause: async (milliseconds) => {
        elapsed += milliseconds;
      },
    }),
    { healthy: true },
  );
  assert.equal(calls, 2);
  assert.equal(elapsed, 1_000);
});

test('verification restores into a UUID temporary volume and cleans it without touching source volume', async () =>
  temporary(async (root) => {
    const mocked = mockDocker();
    await runBackup({ projectRoot: root, runDocker: mocked.runner });
    const result = await runVerifyBackup({
      projectRoot: root,
      runDocker: mocked.runner,
      validatorSource: 'function verifyDataDirectory() {}',
    });
    assert.deepEqual(result, {
      pass: true,
      counts: {
        jobs: 2,
        evidence: 2,
        manifests: 1,
        currentPointers: 1,
        profileFiles: 3,
        profileLinks: 0,
      },
    });
    const created = mocked.calls
      .find((call) => call.args[0] === 'volume' && call.args[1] === 'create')
      .args.at(-1);
    assert.match(created, /^fanqie-mcp-restore-check-[a-f0-9-]{36}$/);
    assert.deepEqual(
      mocked.calls
        .filter((call) => call.args[0] === 'volume' && call.args[1] === 'rm')
        .map((call) => call.args.at(-1)),
      [created],
    );
    assert.equal(mocked.volumes.size, 0);
    assert.ok(!JSON.stringify(result).includes('DO_NOT_OUTPUT'));
  }));

test('failed validation still removes its own isolated volume', async () =>
  temporary(async (root) => {
    const mocked = mockDocker({ failValidate: true });
    await runBackup({ projectRoot: root, runDocker: mocked.runner });
    await assert.rejects(
      runVerifyBackup({
        projectRoot: root,
        runDocker: mocked.runner,
        validatorSource: 'function verifyDataDirectory() {}',
      }),
    );
    assert.equal(mocked.volumes.size, 0);
  }));

test('corrupted archive or metadata is rejected before creating any Docker volume', async () => {
  for (const kind of ['archive', 'metadata'])
    await temporary(async (root) => {
      const mocked = mockDocker();
      await runBackup({ projectRoot: root, runDocker: mocked.runner });
      const { archive } = await readBackup(root);
      if (kind === 'archive') await writeFile(archive, 'Corrupted archive');
      else {
        const metadataFile = archive.replace(/\.tar$/, '.json');
        const data = JSON.parse(await readFile(metadataFile, 'utf8'));
        data.imageId = `sha256:${'b'.repeat(64)}`;
        await writeFile(metadataFile, JSON.stringify(data));
      }
      await assert.rejects(runVerifyBackup({ projectRoot: root, runDocker: mocked.runner }));
      assert.ok(
        !mocked.calls.some((call) => call.args[0] === 'volume' && call.args[1] === 'create'),
      );
    });
});

test('read-only SQLite validator checks all schema/hash references and outputs only counts', async () =>
  temporary(async (root) => {
    await databaseFixture(root);
    const before = digest(await readFile(path.join(root, 'operations.sqlite')));
    const result = verifyDataDirectory(root);
    assert.deepEqual(result, {
      jobs: 1,
      evidence: 1,
      manifests: 1,
      currentPointers: 1,
      profileFiles: 1,
      profileLinks: 0,
    });
    assert.equal(digest(await readFile(path.join(root, 'operations.sqlite'))), before);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  }));
