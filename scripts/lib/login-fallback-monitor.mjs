import net from 'node:net';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, open, rename, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const instancePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const allowedCodes = {
  starting: ['checking'],
  available: ['verified'],
  unavailable: [
    'password_unavailable',
    'rfb_unavailable',
    'frontend_unavailable',
    'probe_failed',
    'worker_failed',
  ],
};
const pauseFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseIdentity(token) {
  const [pid, parentPid, startTime, extra] = String(token).split(':');
  if (
    extra !== undefined ||
    !/^[1-9]\d*$/.test(pid ?? '') ||
    !/^[1-9]\d*$/.test(parentPid ?? '') ||
    !/^\d+$/.test(startTime ?? '') ||
    Number(pid) <= 1 ||
    Number(parentPid) <= 1 ||
    !Number.isSafeInteger(Number(pid)) ||
    !Number.isSafeInteger(Number(parentPid))
  )
    throw new Error('invalid_fallback_process');
  return { pid: Number(pid), parentPid: Number(parentPid), startTime };
}
async function processRecord(
  pid,
  readStat = (processId) => readFile(`/proc/${processId}/stat`, 'utf8'),
) {
  try {
    const value = await readStat(pid);
    if (!value.startsWith(`${pid} (`)) return null;
    const fields = value
      .slice(value.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    if (
      !/^[A-Z]$/.test(fields[0] ?? '') ||
      !/^\d+$/.test(fields[1] ?? '') ||
      !/^\d+$/.test(fields[19] ?? '')
    )
      return null;
    return { pid, state: fields[0], parentPid: Number(fields[1]), startTime: fields[19] };
  } catch {
    return null;
  }
}
export async function captureProcessIdentity(pid, parentPid, readStat) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(parentPid) || parentPid <= 1)
    throw new Error('invalid_fallback_process');
  const current = await processRecord(pid, readStat);
  if (!current || current.parentPid !== parentPid || ['Z', 'X'].includes(current.state))
    throw new Error('fallback_process_unavailable');
  return `${pid}:${parentPid}:${current.startTime}`;
}
export async function processIsOwned(token, readStat) {
  const identity = parseIdentity(token);
  const current = await processRecord(identity.pid, readStat);
  return Boolean(
    current &&
    current.parentPid === identity.parentPid &&
    current.startTime === identity.startTime &&
    !['Z', 'X'].includes(current.state),
  );
}
export async function cleanupOwnedProcess(
  token,
  { readStat, kill = (pid, signal) => process.kill(pid, signal) } = {},
) {
  const identity = parseIdentity(token);
  const current = await processRecord(identity.pid, readStat);
  // A crashed worker can reparent its original children; start time still fences
  // cleanup. Never kill a reused PID or an unreapable zombie.
  if (!current || current.startTime !== identity.startTime || ['Z', 'X'].includes(current.state))
    return false;
  try {
    kill(identity.pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}
export async function probeOwnedFallback(identities, { readStat, check = probeFallback } = {}) {
  if (
    !(await Promise.all(identities.map((token) => processIsOwned(token, readStat)))).every(Boolean)
  )
    return false;
  if (!(await check())) return false;
  return (await Promise.all(identities.map((token) => processIsOwned(token, readStat)))).every(
    Boolean,
  );
}

export async function writeFallbackState(
  stateFile,
  instanceId,
  status,
  code,
  now = () => new Date(),
) {
  if (!instancePattern.test(instanceId) || !allowedCodes[status]?.includes(code))
    throw new Error('invalid_fallback_state');
  const parent = await lstat(path.dirname(stateFile));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077)
    throw new Error('unsafe_fallback_directory');
  const temporary = `${stateFile}.${randomUUID()}.partial`;
  let descriptor;
  try {
    descriptor = await open(temporary, 'wx', 0o600);
    await descriptor.writeFile(
      `${JSON.stringify({ schemaVersion: 1, instanceId, status, code, checkedAt: now().toISOString() })}\n`,
    );
    await descriptor.sync();
    await descriptor.close();
    descriptor = undefined;
    await rename(temporary, stateFile);
  } finally {
    await descriptor?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}
/** Preserve only this boot's fresh, private terminal reason during cleanup. */
export async function finalizeFallbackState(stateFile, instanceId, code, now = () => new Date()) {
  if (!instancePattern.test(instanceId) || !allowedCodes.unavailable.includes(code))
    throw new Error('invalid_fallback_state');
  const finalAt = now();
  let descriptor;
  try {
    const parent = await lstat(path.dirname(stateFile));
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077)
      throw new Error('unsafe_fallback_directory');
    descriptor = await open(
      stateFile,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await descriptor.stat();
    if (!info.isFile() || info.mode & 0o077 || info.size > 2_048)
      throw new Error('invalid_fallback_state');
    const bytes = Buffer.alloc(2_049);
    const { bytesRead } = await descriptor.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 2_048) throw new Error('invalid_fallback_state');
    const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    const fields = ['schemaVersion', 'instanceId', 'status', 'code', 'checkedAt'];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      Object.keys(value).some((key) => !fields.includes(key)) ||
      value.schemaVersion !== 1 ||
      value.instanceId !== instanceId ||
      value.status !== 'unavailable' ||
      !allowedCodes.unavailable.includes(value.code) ||
      typeof value.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.checkedAt)) ||
      new Date(value.checkedAt).toISOString() !== value.checkedAt
    )
      throw new Error('invalid_fallback_state');
    const age = finalAt.getTime() - Date.parse(value.checkedAt);
    if (age >= -1_000 && age <= 15_000) return { preserved: true };
  } catch {
    /* Invalid/previous/stale states cannot suppress cleanup evidence. */
  } finally {
    await descriptor?.close().catch(() => {});
  }
  await writeFallbackState(stateFile, instanceId, 'unavailable', code, () => finalAt);
  return { preserved: false };
}
export function probeRfb({ port = 5900, host = '127.0.0.1', timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    let bytes = Buffer.alloc(0),
      settled = false;
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk.subarray(0, 12 - bytes.length)]);
      if (bytes.length >= 12)
        finish(/^RFB \d{3}\.\d{3}\n$/.test(bytes.subarray(0, 12).toString('ascii')));
    });
  });
}
export async function probeNoVnc({ url = 'http://127.0.0.1:6080/vnc.html', timeoutMs = 500 } = {}) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}
export async function probeFallback() {
  const results = await Promise.all([probeRfb(), probeNoVnc()]);
  return results.every(Boolean);
}

export async function awaitFallbackReady({
  check,
  timeoutMs = 10_000,
  monotonicClock = () => performance.now(),
  pause = pauseFor,
}) {
  const deadline = monotonicClock() + timeoutMs;
  while (monotonicClock() < deadline) {
    if (await check()) return monotonicClock() < deadline;
    const remaining = deadline - monotonicClock();
    if (remaining <= 0) return false;
    await pause(Math.min(100, remaining));
  }
  return false;
}
export async function monitorFallback({
  stateFile,
  instanceId,
  check = probeFallback,
  now = () => new Date(),
  monotonicClock = () => performance.now(),
  pause = pauseFor,
  intervalMs = 5_000,
}) {
  if (!(await awaitFallbackReady({ check, monotonicClock, pause }))) {
    await writeFallbackState(stateFile, instanceId, 'unavailable', 'frontend_unavailable', now);
    return false;
  }
  await writeFallbackState(stateFile, instanceId, 'available', 'verified', now);
  while (true) {
    await pause(intervalMs);
    if (!(await check())) {
      await writeFallbackState(stateFile, instanceId, 'unavailable', 'probe_failed', now);
      return false;
    }
    await writeFallbackState(stateFile, instanceId, 'available', 'verified', now);
  }
}
async function main(args) {
  const [mode, stateFile, instanceId, status, code] = args;
  if (mode === 'identity' && args.length === 3) {
    process.stdout.write(await captureProcessIdentity(Number(stateFile), Number(instanceId)));
    return;
  }
  if (mode === 'cleanup' && args.length === 2) {
    await cleanupOwnedProcess(stateFile);
    return;
  }
  if (stateFile !== '/run/fanqie/login-fallback.json' || !instancePattern.test(instanceId ?? ''))
    throw new Error('invalid_fallback_configuration');
  if (mode === 'state' && args.length === 5)
    return writeFallbackState(stateFile, instanceId, status, code);
  if (mode === 'finalize' && args.length === 4)
    return finalizeFallbackState(stateFile, instanceId, status);
  if (mode === 'rfb' && args.length === 4) {
    parseIdentity(status);
    if (
      !(await awaitFallbackReady({
        check: () => probeOwnedFallback([status], { check: () => probeRfb() }),
      }))
    )
      process.exitCode = 1;
    return;
  }
  if (mode === 'monitor' && args.length === 5) {
    const identities = [status, code];
    identities.forEach(parseIdentity);
    try {
      if (
        !(await monitorFallback({
          stateFile,
          instanceId,
          check: () => probeOwnedFallback(identities),
        }))
      )
        process.exitCode = 1;
    } finally {
      await Promise.all(identities.map((token) => cleanupOwnedProcess(token)));
    }
    return;
  }
  throw new Error('invalid_fallback_configuration');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Protected login fallback unavailable');
    process.exitCode = 1;
  });
}
