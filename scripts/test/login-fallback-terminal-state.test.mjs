import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finalizeFallbackState, writeFallbackState } from '../lib/login-fallback-monitor.mjs';
const execute = promisify(execFile);
const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedAt = new Date('2026-10-03T00:00:20.000Z');
const now = () => fixedAt;
async function temporary(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanqie-fallback-terminal-test-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('cleanup preserves the same boot fresh private terminal reason and its actual timestamp', async () =>
  temporary(async (root) => {
    const state = path.join(root, 'state.json');
    const instance = randomUUID();
    await writeFallbackState(
      state,
      instance,
      'unavailable',
      'frontend_unavailable',
      () => new Date(fixedAt.getTime() - 100),
    );
    const original = await readFile(state);
    assert.deepEqual(await finalizeFallbackState(state, instance, 'probe_failed', now), {
      preserved: true,
    });
    assert.deepEqual(await readFile(state), original);
    assert.equal((await stat(state)).mode & 0o777, 0o600);
  }));
test('stale future malformed previous-generation and nonterminal states cannot suppress cleanup failure evidence', async () =>
  temporary(async (root) => {
    const state = path.join(root, 'state.json');
    const instance = randomUUID();
    const valid = {
      schemaVersion: 1,
      instanceId: instance,
      status: 'unavailable',
      code: 'frontend_unavailable',
      checkedAt: new Date(fixedAt.getTime() - 100).toISOString(),
    };
    const inputs = [
      { ...valid, checkedAt: new Date(fixedAt.getTime() - 15001).toISOString() },
      { ...valid, checkedAt: new Date(fixedAt.getTime() + 1001).toISOString() },
      { ...valid, instanceId: randomUUID() },
      { ...valid, schemaVersion: 2 },
      { ...valid, status: 'available', code: 'verified' },
      { ...valid, status: 'starting', code: 'checking' },
      { ...valid, code: 'raw_private_failure' },
      { ...valid, extra: 'not_allowed' },
      '{broken-json',
    ];
    for (const input of inputs) {
      await writeFile(state, typeof input === 'string' ? input : JSON.stringify(input), {
        mode: 0o600,
      });
      assert.deepEqual(await finalizeFallbackState(state, instance, 'worker_failed', now), {
        preserved: false,
      });
      const result = JSON.parse(await readFile(state, 'utf8'));
      assert.deepEqual(result, {
        schemaVersion: 1,
        instanceId: instance,
        status: 'unavailable',
        code: 'worker_failed',
        checkedAt: fixedAt.toISOString(),
      });
    }
  }));
test('public files and symlinks are never preserved; safe replacement does not read or change a symlink target', async () =>
  temporary(async (root) => {
    const state = path.join(root, 'state.json');
    const instance = randomUUID();
    await writeFallbackState(
      state,
      instance,
      'unavailable',
      'frontend_unavailable',
      () => new Date(fixedAt.getTime() - 100),
    );
    await chmod(state, 0o644);
    assert.deepEqual(await finalizeFallbackState(state, instance, 'worker_failed', now), {
      preserved: false,
    });
    assert.equal(JSON.parse(await readFile(state, 'utf8')).code, 'worker_failed');
    assert.equal((await stat(state)).mode & 0o777, 0o600);
    await rm(state);
    const target = path.join(root, 'synthetic-target');
    await writeFile(target, 'SYNTHETIC_TARGET_UNCHANGED', { mode: 0o600 });
    await symlink(target, state);
    assert.deepEqual(await finalizeFallbackState(state, instance, 'worker_failed', now), {
      preserved: false,
    });
    assert.equal(await readFile(target, 'utf8'), 'SYNTHETIC_TARGET_UNCHANGED');
    assert.equal(JSON.parse(await readFile(state, 'utf8')).code, 'worker_failed');
  }));
async function shellFixture(root, legacy) {
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  await mkdir(path.join(root, 'run'), { mode: 0o700 });
  const instance = randomUUID();
  const source = await readFile(path.join(scripts, 'container-login-fallback.sh'), 'utf8');
  // One-pass rewrite of fixed originals, so Linux /tmp roots are never reprocessed.
  let worker = source
    .replace(/\/run\/fanqie/g, `${root}/run`)
    .replace('/app/scripts/lib/login-fallback-monitor.mjs', 'fixture-monitor');
  if (legacy)
    worker = worker.replace(
      'finalize "$state" "$FANQIE_LOGIN_FALLBACK_INSTANCE" "$fallback_code"',
      'state "$state" "$FANQIE_LOGIN_FALLBACK_INSTANCE" unavailable "$fallback_code"',
    );
  const filename = path.join(root, 'worker.sh');
  await writeFile(filename, worker);
  await writeFile(path.join(root, 'run/login-fallback-secret'), 'SYNTHETIC_ONLY', { mode: 0o600 });
  const moduleUrl = pathToFileURL(path.join(scripts, 'lib/login-fallback-monitor.mjs')).href;
  const nodeSource = `import {writeFallbackState,monitorFallback,finalizeFallbackState} from ${JSON.stringify(moduleUrl)};
let [marker,mode,state,instance,status,code]=process.argv.slice(2);
async function main(){
 if(mode==='identity'){process.stdout.write('60:50:100');return;}
 if(mode==='cleanup'||mode==='rfb')return;
 if(mode==='state'){await writeFallbackState(state,instance,status,code);return;}
 if(mode==='finalize'){await finalizeFallbackState(state,instance,status);return;}
 if(mode==='monitor'){
  let elapsed=0;await monitorFallback({stateFile:state,instanceId:instance,check:async()=>false,monotonicClock:()=>elapsed,pause:async ms=>{elapsed+=ms;}});
  process.exitCode=1;return;
 }
 process.exitCode=1;
}
main().catch(()=>{process.exitCode=1;});`;
  await writeFile(path.join(root, 'fixture-node.mjs'), nodeSource);
  for (const [name, body] of Object.entries({
    node: '#!/bin/sh\nexec "$FIXTURE_REAL_NODE" "$FIXTURE_NODE_SCRIPT" "$@"\n',
    x11vnc: '#!/bin/sh\nexit 0\n',
    websockify: '#!/bin/sh\nexit 0\n',
  })) {
    await writeFile(path.join(bin, name), body, { mode: 0o700 });
  }
  let result;
  try {
    result = await execute('/bin/sh', [filename], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FANQIE_LOGIN_FALLBACK_INSTANCE: instance,
        FIXTURE_REAL_NODE: process.execPath,
        FIXTURE_NODE_SCRIPT: path.join(root, 'fixture-node.mjs'),
      },
      timeout: 5000,
    });
  } catch (error) {
    result = error;
  }
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const state = JSON.parse(await readFile(path.join(root, 'run/login-fallback.json'), 'utf8'));
  assert.equal(state.status, 'unavailable');
  assert.equal(state.instanceId, instance);
  return state;
}
test('real shell EXIT cleanup preserves initial frontend readiness failure instead of overwriting it, without sockets or service access', async () =>
  temporary(async (root) => {
    const control = path.join(root, 'control');
    const corrected = path.join(root, 'corrected');
    await mkdir(control, { mode: 0o700 });
    await mkdir(corrected, { mode: 0o700 });
    assert.equal((await shellFixture(control, true)).code, 'probe_failed');
    assert.equal((await shellFixture(corrected, false)).code, 'frontend_unavailable');
  }));
test('invalid instance or fallback code cannot cause a terminal state to be accepted or overwritten', async () =>
  temporary(async (root) => {
    const state = path.join(root, 'state.json');
    const instance = randomUUID();
    await writeFallbackState(state, instance, 'unavailable', 'frontend_unavailable', now);
    const original = await readFile(state);
    await assert.rejects(finalizeFallbackState(state, 'invalid-instance', 'worker_failed', now));
    await assert.rejects(finalizeFallbackState(state, instance, 'raw_private_error', now));
    assert.deepEqual(await readFile(state), original);
  }));
