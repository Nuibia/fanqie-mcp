import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  probeRfb,
  probeNoVnc,
  awaitFallbackReady,
  monitorFallback,
  writeFallbackState,
  captureProcessIdentity,
  processIsOwned,
  probeOwnedFallback,
  cleanupOwnedProcess,
} from '../lib/login-fallback-monitor.mjs';

async function temporary(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanqie-fallback-monitor-test-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test('RFB requires a complete real banner and silent or malformed listeners fail within a bounded timeout', async () => {
  for (const banner of ['RFB 003.008\n', 'NOT VNC HERE', null]) {
    const sockets = [];
    const server = net.createServer((socket) => {
      sockets.push(socket);
      if (banner !== null) socket.write(banner);
    });
    const port = await listen(server);
    // Banner I/O needs scheduling headroom; the silent listener still tests the short deadline.
    try {
      assert.equal(
        await probeRfb({ port, timeoutMs: banner === null ? 30 : 1000 }),
        banner === 'RFB 003.008\n',
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await close(server);
    }
  }
});
test('noVNC requires its fixed page success and rejects redirects, missing pages and stalled response', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/vnc.html') {
      res.writeHead(200);
      res.end('Synthetic noVNC asset');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/vnc.html' });
      res.end();
    } else if (req.url === '/missing') {
      res.writeHead(404);
      res.end();
    }
  });
  const port = await listen(server);
  try {
    for (const route of ['/vnc.html', '/redirect', '/missing', '/stall'])
      assert.equal(
        await probeNoVnc({
          url: `http://127.0.0.1:${port}${route}`,
          timeoutMs: route === '/stall' ? 30 : 500,
        }),
        route === '/vnc.html',
      );
  } finally {
    await close(server);
  }
});
test('startup readiness uses bounded pauses and cannot claim available at or after its deadline', async () => {
  let elapsed = 0;
  let checks = 0;
  assert.equal(
    await awaitFallbackReady({
      check: async () => {
        checks++;
        return false;
      },
      timeoutMs: 250,
      monotonicClock: () => elapsed,
      pause: async (milliseconds) => {
        elapsed += milliseconds;
      },
    }),
    false,
  );
  assert.equal(elapsed, 250);
  assert.equal(checks, 3);
  elapsed = 0;
  assert.equal(
    await awaitFallbackReady({
      check: async () => {
        elapsed = 250;
        return true;
      },
      timeoutMs: 250,
      monotonicClock: () => elapsed,
      pause: async (milliseconds) => {
        elapsed += milliseconds;
      },
    }),
    false,
  );
});
test('monitor updates real check timestamps then marks loss unavailable; only fixed metadata persists', async () =>
  temporary(async (root) => {
    const stateFile = path.join(root, 'state.json');
    const instanceId = randomUUID();
    let elapsed = 0;
    let checks = 0;
    const observations = [];
    const result = await monitorFallback({
      stateFile,
      instanceId,
      check: async () => ++checks < 3,
      now: () => new Date(Date.UTC(2026, 9, 3) + elapsed),
      monotonicClock: () => elapsed,
      pause: async (milliseconds) => {
        observations.push(JSON.parse(await readFile(stateFile, 'utf8')));
        elapsed += milliseconds;
      },
    });
    assert.equal(result, false);
    assert.equal(checks, 3);
    assert.deepEqual(
      observations.map((item) => item.status),
      ['available', 'available'],
    );
    assert.notEqual(observations[0].checkedAt, observations[1].checkedAt);
    const final = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(final.status, 'unavailable');
    assert.equal(final.code, 'probe_failed');
    assert.deepEqual(Object.keys(final).sort(), [
      'checkedAt',
      'code',
      'instanceId',
      'schemaVersion',
      'status',
    ]);
    assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(root), ['state.json']);
  }));
test('a frontend that never becomes ready produces unavailable without any available state', async () =>
  temporary(async (root) => {
    const stateFile = path.join(root, 'state.json');
    let elapsed = 0;
    assert.equal(
      await monitorFallback({
        stateFile,
        instanceId: randomUUID(),
        check: async () => false,
        monotonicClock: () => elapsed,
        pause: async (milliseconds) => {
          elapsed += milliseconds;
        },
      }),
      false,
    );
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(state.status, 'unavailable');
    assert.equal(state.code, 'frontend_unavailable');
    assert.equal(elapsed, 10_000);
  }));
test('state writer refuses invalid schema code and public directory without writing', async () =>
  temporary(async (root) => {
    const stateFile = path.join(root, 'state.json');
    await assert.rejects(
      writeFallbackState(stateFile, randomUUID(), 'available', 'PRIVATE_RAW_FAILURE'),
    );
    assert.deepEqual(await readdir(root), []);
    const publicDir = path.join(root, 'public');
    await mkdir(publicDir, { mode: 0o755 });
    await chmod(publicDir, 0o755);
    await assert.rejects(
      writeFallbackState(path.join(publicDir, 'state.json'), randomUUID(), 'available', 'verified'),
    );
    assert.deepEqual(await readdir(publicDir), []);
  }));

test('owned PID, parent, start time and non-zombie state are required alongside probes and fence cleanup', async () => {
  const record = (pid, parent = 50, start = '100', state = 'S') => {
    const fields = Array(20).fill('0');
    fields[0] = state;
    fields[1] = String(parent);
    fields[19] = start;
    return `${pid} (fixture (process)) ${fields.join(' ')}`;
  };
  const records = new Map([
    [60, record(60)],
    [61, record(61)],
  ]);
  const readStat = async (pid) => {
    if (!records.has(pid)) throw new Error('private_proc_failure');
    return records.get(pid);
  };
  const identities = [
    await captureProcessIdentity(60, 50, readStat),
    await captureProcessIdentity(61, 50, readStat),
  ];
  assert.equal(await processIsOwned(identities[0], readStat), true);
  assert.equal(await probeOwnedFallback(identities, { readStat, check: async () => true }), true);
  assert.equal(await probeOwnedFallback(identities, { readStat, check: async () => false }), false);
  for (const changed of [
    record(60, 51),
    record(60, 50, '101'),
    record(60, 50, '100', 'Z'),
    record(60, 50, '100', 'X'),
  ]) {
    records.set(60, changed);
    let checked = false;
    assert.equal(
      await probeOwnedFallback(identities, {
        readStat,
        check: async () => {
          checked = true;
          return true;
        },
      }),
      false,
    );
    assert.equal(checked, false);
  }
  records.set(60, record(60));
  assert.equal(
    await probeOwnedFallback(identities, {
      readStat,
      check: async () => {
        records.set(60, record(60, 50, '101'));
        return true;
      },
    }),
    false,
  );
  const kills = [];
  assert.equal(
    await cleanupOwnedProcess(identities[0], {
      readStat,
      kill: (pid, signal) => kills.push([pid, signal]),
    }),
    false,
  );
  records.set(60, record(60, 1)); // original child reparented after worker loss
  assert.equal(
    await cleanupOwnedProcess(identities[0], {
      readStat,
      kill: (pid, signal) => kills.push([pid, signal]),
    }),
    true,
  );
  assert.deepEqual(kills, [[60, 'SIGKILL']]);
  records.delete(61);
  assert.equal(await processIsOwned(identities[1], readStat), false);
});
