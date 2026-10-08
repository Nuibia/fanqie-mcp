import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function rewriteContainerPaths(value, root) {
  // Translate original paths once; a /tmp prefix in a Linux replacement
  // must not become input to another replacement.
  return value.replace(
    /\/(?:run|data|tmp|proc|app)(?=\/|[\s'"]|$)/g,
    (prefix) => `${root}${prefix}`,
  );
}
test('container path rewrite maps original paths once on Linux and macOS temporary roots', async () => {
  const original =
    'cp /run/secrets/api_token /run/fanqie/api-token\nmkdir /data /data/profile\nrm /tmp/.X99-lock\ncat /proc/7/comm\nexec /app/dist/index.js';
  const entrypoint = await readFile(path.join(scripts, 'container-entrypoint.sh'), 'utf8');
  for (const root of [
    '/tmp/fanqie-vnc-isolation-test-linux',
    '/var/folders/test/T/fanqie-vnc-isolation-test-mac',
  ]) {
    assert.equal(
      rewriteContainerPaths(original, root),
      `cp ${root}/run/secrets/api_token ${root}/run/fanqie/api-token\nmkdir ${root}/data ${root}/data/profile\nrm ${root}/tmp/.X99-lock\ncat ${root}/proc/7/comm\nexec ${root}/app/dist/index.js`,
    );
    const rewritten = rewriteContainerPaths(entrypoint, root);
    assert.ok(rewritten.includes(`cp ${root}/run/secrets/api_token ${root}/run/fanqie/api-token`));
    assert.ok(!rewritten.includes(`${root}${root}/run`));
  }
});
function ownFixtureValue(value, key) {
  try {
    return value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, key)?.value
      : undefined;
  } catch {
    return undefined;
  }
}
function fixtureExecutionFacts(result) {
  const rawCode = ownFixtureValue(result, 'code'),
    rawSignal = ownFixtureValue(result, 'signal');
  const bytes = (value) =>
    typeof value === 'string'
      ? Buffer.byteLength(value)
      : Buffer.isBuffer(value)
        ? value.length
        : 0;
  return {
    code:
      Number.isInteger(rawCode) && rawCode !== 0
        ? 'nonzero_exit'
        : ['ENOENT', 'EACCES', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(rawCode)
          ? rawCode
          : 'unknown',
    signal:
      rawSignal == null ? null : ['SIGTERM', 'SIGKILL'].includes(rawSignal) ? rawSignal : 'other',
    killed: ownFixtureValue(result, 'killed') === true,
    stdoutBytes: bytes(ownFixtureValue(result, 'stdout')),
    stderrBytes: bytes(ownFixtureValue(result, 'stderr')),
  };
}
async function settleFixtureExecution(run) {
  try {
    return { completed: true, result: await run() };
  } catch (error) {
    return { completed: false, result: error };
  }
}
function assertCoreFixtureExecution(execution) {
  const facts = fixtureExecutionFacts(execution.result);
  const reject = (code) => {
    const diagnostic = { ...facts, code };
    throw Object.assign(new Error(`fixture_core_execution_failed ${JSON.stringify(diagnostic)}`), {
      code: 'fixture_core_execution_failed',
      diagnostic,
    });
  };
  if (!execution.completed) reject(facts.code);
  const stdout = ownFixtureValue(execution.result, 'stdout');
  if (typeof stdout !== 'string' || stdout.length === 0) reject('core_output_empty');
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    reject('core_output_invalid_json');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    value.coreStarted !== true
  )
    reject('core_output_unexpected');
}
async function fixture(failure = '') {
  const root = await mkdtemp(
    path.join(process.env.FANQIE_TEST_TEMP_BASE ?? os.tmpdir(), 'fanqie-vnc-isolation-test-'),
  );
  const bin = path.join(root, 'bin');
  for (const dir of [
    bin,
    'run/secrets',
    'run/fanqie',
    'tmp/.X11-unix',
    'proc',
    'app/scripts',
    'data',
  ].map((value) => (path.isAbsolute(value) ? value : path.join(root, value))))
    await mkdir(dir, { recursive: true });
  const translate = (value) => rewriteContainerPaths(value, root);
  await writeFile(
    path.join(root, 'entrypoint.sh'),
    translate(await readFile(path.join(scripts, 'container-entrypoint.sh'), 'utf8')),
  );
  const worker = translate(
    await readFile(path.join(scripts, 'container-login-fallback.sh'), 'utf8'),
  ).replace('set -eu', 'set -eu\necho $$ >>"$FIXTURE_ROOT/pids"');
  await writeFile(path.join(root, 'app/scripts/container-login-fallback.sh'), worker);
  await writeFile(path.join(root, 'run/secrets/api_token'), 'SYNTHETIC_API_VALUE');
  await writeFile(
    path.join(root, 'run/secrets/vnc_password'),
    failure === 'empty' ? '' : 'SYNTHETIC_VNC_VALUE',
    { mode: 0o600 },
  );
  if (failure === 'log') await mkdir(path.join(root, 'run/fanqie/login-fallback.log'));
  const stubs = {
    cp: '#!/bin/sh\ncase \"$1\" in */vnc_password) [ \"$FIXTURE_FAIL\" != secretcopy ] || exit 1 ;; esac\nexec /bin/cp \"$@\"\n',
    chown: '#!/bin/sh\nexit 0\n',
    gosu: '#!/bin/sh\nshift\nexec "$@"\n',
    Xvfb: '#!/bin/sh\n[ "$FIXTURE_FAIL" != display ] || exit 1\necho $$ >>"$FIXTURE_ROOT/pids"\nprintf "99\\n" >&3\nexec sleep 60\n',
    fluxbox: '#!/bin/sh\nexit 0\n',
    x11vnc:
      '#!/bin/sh\nif [ "$1" = -storepasswd ]; then\n  [ "$FIXTURE_FAIL" != password ] || exit 1\n  printf fixture >"$3"\n  exit 0\nfi\necho $$ >>"$FIXTURE_ROOT/vnc-pid"\necho $$ >>"$FIXTURE_ROOT/pids"\nprintf "vnc\\n" >>"$FIXTURE_ROOT/events"\nexec sleep 60\n',
    websockify:
      '#!/bin/sh\nprintf "web\\n" >>"$FIXTURE_ROOT/events"\n[ "$FIXTURE_FAIL" != frontend ] || exit 1\necho $$ >>"$FIXTURE_ROOT/pids"\necho $$ >"$FIXTURE_ROOT/web-pid"\nexec sleep 60\n',
    node: `#!/bin/sh
if [ "$1" = -e ]; then printf 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; exit 0; fi
case "$1" in
  */login-fallback-monitor.mjs)
    mode=$2; state=$3; instance=$4
    if [ "$mode" = identity ]; then printf '%s:%s:100' "$state" "$instance"; exit 0; fi
    if [ "$mode" = cleanup ]; then pid=\${state%%:*}; kill -KILL "$pid" 2>/dev/null || true; exit 0; fi
    if [ "$mode" = finalize ]; then set -- "$1" state "$state" "$instance" unavailable "$5"; mode=state; fi
    if [ "$mode" = state ]; then
      "$FIXTURE_REAL_NODE" -e 'const fs=require("node:fs"),p=process.argv[1];fs.writeFileSync(p+".partial",JSON.stringify({schemaVersion:1,instanceId:process.argv[2],status:process.argv[3],code:process.argv[4],checkedAt:new Date().toISOString()}),{mode:384});fs.renameSync(p+".partial",p)' "$state" "$instance" "$5" "$6"
      exit $?
    fi
    if [ "$mode" = rfb ]; then
      printf 'probe\\n' >>"$FIXTURE_ROOT/events"
      sleep 0.4
      [ "$FIXTURE_FAIL" != probe ] || exit 1
      exit 0
    fi
    if [ "$mode" = monitor ]; then
      count=0
      while ! grep -q web "$FIXTURE_ROOT/events" 2>/dev/null; do count=$((count+1)); [ "$count" -lt 100 ] || exit 1; sleep 0.01; done
      [ "$FIXTURE_FAIL" != frontend ] || exit 1
      echo $$ >>"$FIXTURE_ROOT/pids"
      "$0" "$1" state "$state" "$instance" available verified
      if [ "$FIXTURE_FAIL" = lost ]; then sleep 0.2; exit 1; fi
      exec sleep 60
    fi
    exit 1
  ;;
esac
printf '{"coreStarted":true}\\n'
`,
  };
  for (const [name, source] of Object.entries(stubs)) {
    await writeFile(path.join(bin, name), source);
    await chmod(path.join(bin, name), 0o700);
  }
  const execution = await settleFixtureExecution(() =>
    execute('/bin/sh', [path.join(root, 'entrypoint.sh')], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_ROOT: root,
        FIXTURE_FAIL: failure,
        FIXTURE_REAL_NODE: process.execPath,
      },
      timeout: 10_000,
    }),
  );
  const result = execution.result;
  const readState = async () => {
    try {
      return JSON.parse(await readFile(path.join(root, 'run/fanqie/login-fallback.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  const firstState = await readState();
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  return {
    root,
    result,
    firstState,
    alive,
    readState,
    assertCoreResult: () => assertCoreFixtureExecution(execution),
    waitFor: async (expected) => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const state = await readState();
        if (state?.status === expected) return state;
        await pause(20);
      }
      assert.fail('Fixture did not reach expected state');
    },
    events: async () => readFile(path.join(root, 'events'), 'utf8').catch(() => ''),
    cleanup: async () => {
      const pids = (await readFile(path.join(root, 'pids'), 'utf8').catch(() => ''))
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}
test('password failure keeps core available, reports unavailable and never opens management frontend', async () => {
  const f = await fixture('password');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    assert.equal((await f.waitFor('unavailable')).code, 'password_unavailable');
    assert.equal(await f.events(), '');
    assert.ok(!f.result.stderr.includes('SYNTHETIC_'));
    assert.equal(
      (await stat(path.join(f.root, 'run/fanqie/login-fallback.log'))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await stat(path.join(f.root, 'run/fanqie/login-fallback-secret'))).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(path.join(f.root, 'run/secrets/vnc_password'))).mode & 0o777, 0o600);
  } finally {
    await f.cleanup();
  }
});
test('core does not wait for delayed RFB failure; own VNC is cleaned and frontend stays closed', async () => {
  const f = await fixture('probe');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    assert.notEqual(f.firstState?.status, 'unavailable');
    await f.waitFor('unavailable');
    assert.deepEqual((await f.events()).trim().split('\n').sort(), ['probe', 'vnc']);
    const vncPid = Number(await readFile(path.join(f.root, 'vnc-pid'), 'utf8'));
    const deadline = Date.now() + 500;
    while (f.alive(vncPid) && Date.now() < deadline) await pause(10);
    assert.equal(f.alive(vncPid), false);
  } finally {
    await f.cleanup();
  }
});
test('frontend failure is unavailable while core continues and own VNC is cleaned', async () => {
  const f = await fixture('frontend');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    await f.waitFor('unavailable');
    assert.deepEqual((await f.events()).trim().split('\n').sort(), ['probe', 'vnc', 'web']);
    const vncPid = Number(await readFile(path.join(f.root, 'vnc-pid'), 'utf8'));
    const deadline = Date.now() + 500;
    while (f.alive(vncPid) && Date.now() < deadline) await pause(10);
    assert.equal(f.alive(vncPid), false);
  } finally {
    await f.cleanup();
  }
});
test('successful protected fallback becomes available asynchronously after core starts', async () => {
  const f = await fixture();
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    assert.notEqual(f.firstState?.status, 'available');
    assert.equal((await f.waitFor('available')).code, 'verified');
    assert.deepEqual((await f.events()).trim().split('\n').sort(), ['probe', 'vnc', 'web']);
  } finally {
    await f.cleanup();
  }
});
test('required display failure still prevents core and optional worker startup', async () => {
  const f = await fixture('display');
  try {
    assert.equal(f.result.code, 1);
    assert.equal(f.result.stdout, '');
    assert.equal(await f.events(), '');
    assert.match(f.result.stderr, /Virtual display did not start/);
  } finally {
    await f.cleanup();
  }
});

test('worker loss after readiness closes its own frontend and VNC while core stays independent', async () => {
  const f = await fixture('lost');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    await f.waitFor('available');
    await f.waitFor('unavailable');
    const own = [
      Number(await readFile(path.join(f.root, 'vnc-pid'), 'utf8')),
      Number(await readFile(path.join(f.root, 'web-pid'), 'utf8')),
    ];
    const deadline = Date.now() + 500;
    while (own.some(f.alive) && Date.now() < deadline) await pause(10);
    assert.ok(own.every((pid) => !f.alive(pid)));
  } finally {
    await f.cleanup();
  }
});

test('an empty secret degrades only fallback and never starts VNC or frontend', async () => {
  const f = await fixture('empty');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    assert.equal((await f.waitFor('unavailable')).code, 'password_unavailable');
    assert.equal(await f.events(), '');
  } finally {
    await f.cleanup();
  }
});

test('optional log initialization failure cannot stop core or create an available fallback', async () => {
  const f = await fixture('log');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    await pause(100);
    assert.equal(await f.readState(), null);
    assert.equal(await f.events(), '');
    assert.equal(f.result.stderr, '');
  } finally {
    await f.cleanup();
  }
});

test('optional secret copy failure cannot stop core or open the management frontend', async () => {
  const f = await fixture('secretcopy');
  try {
    f.assertCoreResult();
    assert.deepEqual(JSON.parse(f.result.stdout), { coreStarted: true });
    await pause(100);
    assert.equal(await f.readState(), null);
    assert.equal(await f.events(), '');
    assert.equal(f.result.stderr, '');
    assert.equal((await stat(path.join(f.root, 'run/secrets/vnc_password'))).mode & 0o777, 0o600);
  } finally {
    await f.cleanup();
  }
});

test('core fixture guard rejects failed execution and invalid stdout before core assertions using only fixed diagnostics', async () => {
  const privateMarker = 'SYNTHETIC_UNTRUSTED_CORE_DETAIL';
  const failure = (code, signal = null, killed = false) =>
    Object.assign(new Error(`${privateMarker}/original-error`), {
      code,
      signal,
      killed,
      stdout: '',
      stderr: `${privateMarker}/stderr`,
      env: { secret: privateMarker },
      path: `/synthetic/${privateMarker}`,
    });
  const cases = [
    {
      run: async () => {
        throw failure(7);
      },
      expectedCode: 'nonzero_exit',
      expectedSignal: null,
      expectedKilled: false,
    },
    {
      run: async () => {
        throw failure(null, 'SIGTERM', true);
      },
      expectedCode: 'unknown',
      expectedSignal: 'SIGTERM',
      expectedKilled: true,
    },
    {
      run: async () => ({ stdout: '', stderr: '' }),
      expectedCode: 'core_output_empty',
      expectedSignal: null,
      expectedKilled: false,
    },
    {
      run: async () => ({ stdout: `{${privateMarker}`, stderr: '' }),
      expectedCode: 'core_output_invalid_json',
      expectedSignal: null,
      expectedKilled: false,
    },
    {
      run: async () => ({
        stdout: JSON.stringify({ coreStarted: true, unknown: privateMarker }),
        stderr: '',
      }),
      expectedCode: 'core_output_unexpected',
      expectedSignal: null,
      expectedKilled: false,
    },
    {
      run: async () => {
        throw failure(privateMarker, privateMarker);
      },
      expectedCode: 'unknown',
      expectedSignal: 'other',
      expectedKilled: false,
    },
  ];
  for (const row of cases) {
    let calls = 0;
    const execution = await settleFixtureExecution(async () => {
      calls++;
      return row.run();
    });
    let observed;
    assert.throws(
      () => assertCoreFixtureExecution(execution),
      (error) => {
        observed = error;
        return error?.code === 'fixture_core_execution_failed';
      },
    );
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(observed.diagnostic), [
      'code',
      'signal',
      'killed',
      'stdoutBytes',
      'stderrBytes',
    ]);
    assert.equal(observed.diagnostic.code, row.expectedCode);
    assert.equal(observed.diagnostic.signal, row.expectedSignal);
    assert.equal(observed.diagnostic.killed, row.expectedKilled);
    assert.equal(
      Number.isSafeInteger(observed.diagnostic.stdoutBytes) && observed.diagnostic.stdoutBytes >= 0,
      true,
    );
    assert.equal(
      Number.isSafeInteger(observed.diagnostic.stderrBytes) && observed.diagnostic.stderrBytes >= 0,
      true,
    );
    assert.equal(
      observed.message.includes(privateMarker) ||
        JSON.stringify(observed.diagnostic).includes(privateMarker),
      false,
    );
    assert.equal(Object.hasOwn(observed, 'cause'), false);
  }
  const success = await settleFixtureExecution(async () => ({
    stdout: '{"coreStarted":true}\n',
    stderr: '',
  }));
  assert.equal(success.completed, true);
  assert.doesNotThrow(() => assertCoreFixtureExecution(success));
});
