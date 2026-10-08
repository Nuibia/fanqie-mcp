import { BrowserSessionError } from './errors.js';

import { isAbsolute, resolve, parse, join } from 'node:path';

import { lstat, readFile, realpath, stat, readdir, readlink, unlink } from 'node:fs/promises';

export interface ProfileLockRecoveryOptions {
  assertProfileRecoveryLease: () => void;
  /** Fixture-only override. Production uses the current Linux PID namespace's /proc. */
  procRoot?: string;
}

export interface ProfileLockRecoveryResult {
  recovered: boolean;
  removed: string[];
}

type PathSnapshot = { path: string; dev: bigint; ino: bigint; mode: bigint; target?: string };

const SINGLETON_NAMES = ['SingletonCookie', 'SingletonSocket', 'SingletonLock'] as const;

const CHROMIUM_SOCKET =
  /^\/tmp\/(?:\.?org\.chromium\.Chromium|\.?com\.google\.Chrome)\.[A-Za-z0-9]{6,64}\/SingletonSocket$/;

function recoveryUnavailable(message: string): never {
  throw new BrowserSessionError('browser_unavailable', message);
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function assertRecoveryLease(options: ProfileLockRecoveryOptions): void {
  if (typeof options.assertProfileRecoveryLease !== 'function')
    recoveryUnavailable('Profile lock recovery requires an exclusive application lease');
  try {
    const result: unknown = options.assertProfileRecoveryLease();
    if (result && typeof result === 'object' && 'then' in result)
      recoveryUnavailable('Profile recovery lease verification must be synchronous');
  } catch {
    recoveryUnavailable('Exclusive application lease could not be verified for profile recovery');
  }
}

/** Refuses symlinked profile directories or ancestors; it does not read profile contents. */
async function profileDirectories(
  profileDir: string,
): Promise<{ exists: boolean; snapshots: PathSnapshot[] }> {
  if (!isAbsolute(profileDir))
    recoveryUnavailable('Profile lock recovery requires an absolute profile directory');
  const absolute = resolve(profileDir);
  const root = parse(absolute).root;
  let current = root;
  const paths = [root];
  for (const component of absolute.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, component);
    paths.push(current);
  }
  const snapshots: PathSnapshot[] = [];
  for (const path of paths) {
    let stat;
    try {
      stat = await lstat(path, { bigint: true });
    } catch (error) {
      if (isMissing(error)) return { exists: false, snapshots };
      recoveryUnavailable('Profile directory metadata could not be verified');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      recoveryUnavailable('Profile directory and ancestors must be real directories');
    snapshots.push({ path, dev: stat.dev, ino: stat.ino, mode: stat.mode });
  }
  return { exists: true, snapshots };
}

async function assertNoActiveChromium(procRoot: string, lockPid: string | null): Promise<void> {
  // A PID can be reused by a Node worker after a container restart. Existence
  // alone is not Chromium liveness, but only the running Node executable is a
  // permitted reuse; an unknown, zombie or different executable fails closed.
  if (lockPid) {
    try {
      const processDir = join(procRoot, lockPid);
      const before = await lstat(processDir, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink())
        recoveryUnavailable('Profile singleton PID metadata is unexpected');
      try {
        const name = (await readFile(join(processDir, 'comm'), 'utf8')).trim();
        if (!name) recoveryUnavailable('Profile singleton PID process name could not be verified');
        if (/^(?:chrome|chromium)(?:$|[-_ ])/i.test(name))
          recoveryUnavailable('Profile singleton PID belongs to an active Chromium process');
        const runtimeExe = await realpath(process.execPath);
        const selfExe = await realpath(join(procRoot, 'self', 'exe'));
        const ownerExe = await realpath(join(processDir, 'exe'));
        if (runtimeExe !== selfExe || ownerExe !== selfExe)
          recoveryUnavailable(
            'Profile singleton PID is not a verified reuse of the current Node executable',
          );
        const runtimeStat = await stat(runtimeExe, { bigint: true });
        const selfStat = await stat(join(procRoot, 'self', 'exe'), { bigint: true });
        const ownerStat = await stat(join(processDir, 'exe'), { bigint: true });
        if (
          !runtimeStat.isFile() ||
          !selfStat.isFile() ||
          !ownerStat.isFile() ||
          runtimeStat.dev !== selfStat.dev ||
          runtimeStat.ino !== selfStat.ino ||
          ownerStat.dev !== selfStat.dev ||
          ownerStat.ino !== selfStat.ino
        )
          recoveryUnavailable(
            'Profile singleton PID executable does not match the current Node runtime inode',
          );
        const after = await lstat(processDir, { bigint: true });
        const finalOwnerStat = await stat(join(processDir, 'exe'), { bigint: true });
        const finalSelfStat = await stat(join(procRoot, 'self', 'exe'), { bigint: true });
        if (
          !after.isDirectory() ||
          after.isSymbolicLink() ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.mode !== after.mode ||
          finalOwnerStat.dev !== ownerStat.dev ||
          finalOwnerStat.ino !== ownerStat.ino ||
          finalSelfStat.dev !== selfStat.dev ||
          finalSelfStat.ino !== selfStat.ino ||
          (await realpath(join(processDir, 'exe'))) !== ownerExe ||
          (await realpath(join(procRoot, 'self', 'exe'))) !== selfExe
        )
          recoveryUnavailable(
            'Profile singleton PID executable changed during recovery verification',
          );
      } catch (error) {
        if (error instanceof BrowserSessionError) throw error;
        recoveryUnavailable(
          'Profile singleton PID executable could not be verified as the current Node runtime',
        );
      }
    } catch (error) {
      if (!isMissing(error)) {
        if (error instanceof BrowserSessionError) throw error;
        recoveryUnavailable('Profile singleton PID liveness could not be verified');
      }
    }
  }
  let entries;
  try {
    entries = await readdir(procRoot, { withFileTypes: true });
  } catch {
    recoveryUnavailable('Current PID namespace could not be inspected safely');
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry.name)) continue;
    if (!entry.isDirectory()) recoveryUnavailable('Current PID namespace metadata is unexpected');
    let name: string;
    try {
      name = (await readFile(join(procRoot, entry.name, 'comm'), 'utf8')).trim();
    } catch (error) {
      if (isMissing(error)) continue;
      recoveryUnavailable('A process name could not be verified safely');
    }
    if (/^(?:chrome|chromium)(?:$|[-_ ])/i.test(name))
      recoveryUnavailable('A Chromium process is still active in the current namespace');
  }
}

async function assertSnapshot(snapshot: PathSnapshot, symbolic: boolean): Promise<void> {
  let stat;
  try {
    stat = await lstat(snapshot.path, { bigint: true });
  } catch {
    recoveryUnavailable('Profile recovery metadata changed before deletion');
  }
  if (
    stat.dev !== snapshot.dev ||
    stat.ino !== snapshot.ino ||
    stat.mode !== snapshot.mode ||
    (symbolic ? !stat.isSymbolicLink() : !stat.isDirectory())
  )
    recoveryUnavailable('Profile recovery metadata changed before deletion');
  if (symbolic) {
    let target: string;
    try {
      target = await readlink(snapshot.path);
    } catch {
      recoveryUnavailable('Profile singleton link changed before deletion');
    }
    if (target !== snapshot.target)
      recoveryUnavailable('Profile singleton link changed before deletion');
  }
}

/**
 * Removes only proven stale Chromium process-lock symlinks under an explicitly leased profile.
 * Never follows their targets, reads authentication storage, or removes socket target directories.
 */
export async function recoverStaleProfileSingletons(
  profileDir: string,
  options: ProfileLockRecoveryOptions,
): Promise<ProfileLockRecoveryResult> {
  assertRecoveryLease(options);
  if (!options.procRoot && process.platform !== 'linux')
    recoveryUnavailable('Profile lock recovery is supported only in the Linux container');
  const procRoot = options.procRoot ?? '/proc';
  if (!isAbsolute(procRoot)) recoveryUnavailable('Current PID namespace path must be absolute');
  const directories = await profileDirectories(profileDir);
  const snapshots: PathSnapshot[] = [];
  let lockPid: string | null = null;
  if (directories.exists)
    for (const name of SINGLETON_NAMES) {
      const path = join(resolve(profileDir), name);
      let stat;
      try {
        stat = await lstat(path, { bigint: true });
      } catch (error) {
        if (isMissing(error)) continue;
        recoveryUnavailable('Profile singleton metadata could not be verified');
      }
      if (!stat.isSymbolicLink())
        recoveryUnavailable('Profile singleton entries must be recognized Chromium symlinks');
      let target: string;
      try {
        target = await readlink(path);
      } catch {
        recoveryUnavailable('Profile singleton link could not be verified');
      }
      if (name === 'SingletonLock') {
        const match = /^([A-Za-z0-9][A-Za-z0-9.-]{0,252})-([1-9]\d{0,9})$/.exec(target);
        if (!match || Number(match[2]) > 2_147_483_647)
          recoveryUnavailable('Profile singleton lock format is unexpected');
        lockPid = match[2]!;
      } else if (name === 'SingletonSocket') {
        if (!CHROMIUM_SOCKET.test(target))
          recoveryUnavailable('Profile singleton socket path is unexpected');
      } else if (!/^\d{1,30}$/.test(target))
        recoveryUnavailable('Profile singleton cookie link format is unexpected');
      snapshots.push({ path, dev: stat.dev, ino: stat.ino, mode: stat.mode, target });
    }
  if (snapshots.length && !lockPid)
    recoveryUnavailable('Profile sidecar locks have no singleton PID to verify');
  await assertNoActiveChromium(procRoot, lockPid);
  if (!snapshots.length) return { recovered: false, removed: [] };
  // Validate the entire set before the first mutation; a partial valid set also
  // requires a dead PID or a strictly proven reuse by this Node executable.
  for (const directory of directories.snapshots) await assertSnapshot(directory, false);
  for (const snapshot of snapshots) await assertSnapshot(snapshot, true);
  await assertNoActiveChromium(procRoot, lockPid);
  assertRecoveryLease(options);
  const removed: string[] = [];
  for (const snapshot of snapshots) {
    // Lease verification is application code: revalidate directories after it,
    // so replacing the profile/ancestor with a symlink cannot redirect unlink.
    assertRecoveryLease(options);
    await assertNoActiveChromium(procRoot, lockPid);
    for (const directory of directories.snapshots) await assertSnapshot(directory, false);
    await assertSnapshot(snapshot, true);
    try {
      await unlink(snapshot.path);
    } catch {
      recoveryUnavailable('A verified singleton symlink could not be removed');
    }
    removed.push(parse(snapshot.path).base);
  }
  return { recovered: true, removed };
}
