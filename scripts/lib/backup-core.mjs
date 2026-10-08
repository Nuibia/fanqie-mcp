import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new BackupError(code);
};
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Never includes child stdout/stderr in errors: Docker diagnostics can contain private paths. */
export async function docker(args, options = {}) {
  const child = spawn('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  let size = 0;
  const chunks = [];
  child.stderr.on('data', () => {});
  const exited = new Promise((resolve, reject) => {
    child.once('error', () => reject(new BackupError('docker_command_failed')));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new BackupError('docker_command_failed')),
    );
  });
  const transfers = [];
  if (options.outputFile)
    transfers.push(
      pipeline(child.stdout, createWriteStream(options.outputFile, { flags: 'wx', mode: 0o600 })),
    );
  else
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
  if (options.inputFile) transfers.push(pipeline(createReadStream(options.inputFile), child.stdin));
  else child.stdin.end(options.inputText ?? '');
  const results = await Promise.allSettled([exited, ...transfers]);
  if (results.some((result) => result.status === 'rejected')) fail('docker_command_failed');
  return Buffer.concat(chunks).toString('utf8');
}
export async function fileDigest(filename) {
  const sha = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length;
    sha.update(chunk);
  }
  return { sha256: sha.digest('hex'), bytes };
}
async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink())
    fail('unsafe_backup_directory');
  await chmod(directory, 0o700);
}
async function syncFile(filename) {
  const fd = await open(filename, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function atomicJson(filename, value) {
  const temporary = `${filename}.partial`;
  const fd = await open(temporary, 'wx', 0o600);
  try {
    await fd.writeFile(`${canonical(value)}\n`);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temporary, filename);
}
function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    fail('invalid_docker_inspection');
  }
}
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const backupPattern = /^backup-\d{8}T\d{6}Z-[a-f0-9-]{36}\.tar$/;
const pauseFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const validRestoreTimeout = (value) => Number.isInteger(value) && value > 0 && value <= 180_000;

/** Inspect only the caller's already-identified service; never starts or stops it. */
export async function waitForServiceHealthy(
  containerId,
  {
    runDocker = docker,
    timeoutMs = 180_000,
    monotonicClock = () => performance.now(),
    pause = pauseFor,
  } = {},
) {
  if (!/^[a-f0-9]{12,64}$/.test(containerId) || !validRestoreTimeout(timeoutMs))
    fail('invalid_restore_configuration');
  const deadline = monotonicClock() + timeoutMs;
  const remaining = () => {
    const milliseconds = Math.floor(deadline - monotonicClock());
    if (milliseconds <= 0) fail('service_restore_timeout');
    return milliseconds;
  };
  while (true) {
    let container;
    const inspectionSignal = AbortSignal.timeout(Math.min(5_000, remaining()));
    try {
      const inspected = parseJson(
        await runDocker(['inspect', containerId], { signal: inspectionSignal }),
      );
      if (!Array.isArray(inspected) || inspected.length !== 1 || !inspected[0]?.State)
        fail('invalid_docker_inspection');
      container = inspected[0];
    } catch {
      await pause(Math.min(1_000, remaining()));
      continue;
    }
    remaining();
    const healthcheck = container.Config?.Healthcheck?.Test;
    if (!Array.isArray(healthcheck) || !['CMD', 'CMD-SHELL'].includes(healthcheck[0]))
      fail('service_healthcheck_missing');
    if (
      container.State.Running &&
      !container.State.Restarting &&
      container.State.Health?.Status === 'healthy'
    )
      return { healthy: true };
    // Docker may restart an unhealthy/exited entrypoint during this bounded window.
    await pause(Math.min(1_000, remaining()));
  }
}

export async function runBackup({
  projectRoot,
  runDocker = docker,
  signal,
  now = () => new Date(),
  restoreTimeoutMs = 180_000,
  monotonicClock = () => performance.now(),
  pause = pauseFor,
}) {
  if (!validRestoreTimeout(restoreTimeoutMs)) fail('invalid_restore_configuration');
  projectRoot = path.resolve(projectRoot);
  const compose = ['compose', '-f', path.join(projectRoot, 'compose.yaml'), '-p', 'fanqie-mcp'];
  const backups = path.join(projectRoot, '.runtime', 'backups');
  await secureDirectory(path.join(projectRoot, '.runtime'));
  await secureDirectory(backups);
  const lock = path.join(backups, '.backup-lock');
  let lockHandle;
  try {
    lockHandle = await open(lock, 'wx', 0o600);
  } catch {
    fail('backup_already_running');
  }
  let initiallyRunning = false;
  let containerId;
  let stopAttempted = false;
  let complete = false;
  const timestamp = now()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const archiveName = `backup-${timestamp}-${randomUUID()}.tar`;
  const archive = path.join(backups, archiveName);
  const partial = `${archive}.partial`;
  const metadataFile = archive.replace(/\.tar$/, '.json');
  try {
    const ids = (await runDocker([...compose, 'ps', '--all', '--quiet', 'fanqie-mcp']))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0]))
      fail('service_container_missing_or_ambiguous');
    containerId = ids[0];
    const inspected = parseJson(await runDocker(['inspect', ids[0]]));
    const container = inspected[0];
    if (
      container?.Config?.Labels?.['com.docker.compose.project'] !== 'fanqie-mcp' ||
      container.Config.Labels['com.docker.compose.service'] !== 'fanqie-mcp'
    )
      fail('service_identity_mismatch');
    if (!imagePattern.test(container.Image) || container.State?.Paused)
      fail('service_state_unsupported');
    const mounts =
      container.Mounts?.filter(
        (mount) => mount.Type === 'volume' && mount.Destination === '/data',
      ) ?? [];
    if (mounts.length !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(mounts[0].Name))
      fail('data_volume_missing_or_ambiguous');
    const volumeName = mounts[0].Name;
    const volume = parseJson(await runDocker(['volume', 'inspect', volumeName]))[0];
    if (
      volume?.Labels?.['com.docker.compose.project'] !== 'fanqie-mcp' ||
      volume.Labels['com.docker.compose.volume'] !== 'fanqie-data'
    )
      fail('data_volume_identity_mismatch');
    initiallyRunning = Boolean(container.State.Running);
    stopAttempted = true;
    await runDocker([...compose, 'stop', '--timeout', '150', 'fanqie-mcp']);
    if ((await runDocker(['ps', '--quiet', '--filter', `volume=${volumeName}`])).trim())
      fail('data_volume_is_in_use');
    if (signal?.aborted) fail('backup_cancelled');
    await runDocker(
      [
        'run',
        '--rm',
        '--pull',
        'never',
        '--network',
        'none',
        '--read-only',
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${volumeName},dst=/source,readonly`,
        '--entrypoint',
        'tar',
        container.Image,
        '--numeric-owner',
        '-C',
        '/source',
        '-cf',
        '-',
        '.',
      ],
      { outputFile: partial, signal },
    );
    if (signal?.aborted) fail('backup_cancelled');
    await syncFile(partial);
    const archiveHash = await fileDigest(partial);
    if (!archiveHash.bytes) fail('empty_backup');
    await chmod(partial, 0o600);
    await rename(partial, archive);
    const data = {
      schemaVersion: 1,
      format: 'tar',
      archive: archiveName,
      archiveSha256: archiveHash.sha256,
      archiveBytes: archiveHash.bytes,
      createdAt: now().toISOString(),
      imageId: container.Image,
      offline: true,
    };
    const metadata = { ...data, metadataSha256: digest(canonical(data)) };
    await atomicJson(metadataFile, metadata);
    const directory = await open(backups, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    complete = true;
    return {
      pass: true,
      archiveSha256: archiveHash.sha256,
      archiveBytes: archiveHash.bytes,
      metadataSha256: metadata.metadataSha256,
      serviceRestored: true,
    };
  } finally {
    let restoreError;
    if (stopAttempted && initiallyRunning) {
      try {
        const deadline = monotonicClock() + restoreTimeoutMs;
        // Restoration has an independent deadline even if the backup was cancelled.
        const startSignal = AbortSignal.timeout(restoreTimeoutMs);
        try {
          await runDocker([...compose, 'start', 'fanqie-mcp'], { signal: startSignal });
        } catch {
          fail(
            startSignal.aborted || monotonicClock() >= deadline
              ? 'service_restore_timeout'
              : 'service_restore_failed',
          );
        }
        const remaining = Math.floor(deadline - monotonicClock());
        if (remaining <= 0) fail('service_restore_timeout');
        await waitForServiceHealthy(containerId, {
          runDocker,
          timeoutMs: remaining,
          monotonicClock,
          pause,
        });
      } catch (error) {
        restoreError =
          error instanceof BackupError ? error : new BackupError('service_restore_failed');
      }
    }
    if (!complete)
      for (const filename of [partial, archive, metadataFile, `${metadataFile}.partial`])
        await rm(filename, { force: true }).catch(() => {});
    await lockHandle.close().catch(() => {});
    await rm(lock, { force: true });
    if (restoreError) throw restoreError;
  }
}

export async function readBackup(projectRoot, archiveArgument) {
  const backups = path.resolve(projectRoot, '.runtime', 'backups');
  let archive;
  if (archiveArgument) {
    archive = path.resolve(archiveArgument);
    if (path.dirname(archive) !== backups || !backupPattern.test(path.basename(archive)))
      fail('archive_outside_private_backups');
  } else {
    const candidates = [];
    for (const name of await readdir(backups)) {
      const tar = name.replace(/\.json$/, '.tar');
      if (!name.endsWith('.json') || !backupPattern.test(tar)) continue;
      const filename = path.join(backups, name);
      if (!(await lstat(filename)).isFile() || (await lstat(filename)).isSymbolicLink()) continue;
      let data;
      try {
        data = JSON.parse(await readFile(filename, 'utf8'));
      } catch {
        continue;
      }
      if (Number.isFinite(Date.parse(data.createdAt)))
        candidates.push({ archive: path.join(backups, tar), createdAt: data.createdAt });
    }
    candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    archive = candidates.at(-1)?.archive;
    if (!archive) fail('backup_missing');
  }
  const metadataFile = archive.replace(/\.tar$/, '.json');
  for (const filename of [archive, metadataFile]) {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
      fail('backup_permissions_or_type_invalid');
  }
  if ((await lstat(metadataFile)).size > 16_384) fail('backup_metadata_invalid');
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
  } catch {
    fail('backup_metadata_invalid');
  }
  const { metadataSha256, ...data } = metadata;
  const keys = [
    'schemaVersion',
    'format',
    'archive',
    'archiveSha256',
    'archiveBytes',
    'createdAt',
    'imageId',
    'offline',
    'metadataSha256',
  ];
  if (
    Object.keys(metadata).length !== keys.length ||
    Object.keys(metadata).some((key) => !keys.includes(key)) ||
    metadata.schemaVersion !== 1 ||
    metadata.format !== 'tar' ||
    metadata.offline !== true ||
    metadata.archive !== path.basename(archive) ||
    !Number.isFinite(Date.parse(metadata.createdAt)) ||
    !imagePattern.test(metadata.imageId) ||
    !/^[a-f0-9]{64}$/.test(metadata.archiveSha256) ||
    !Number.isSafeInteger(metadata.archiveBytes) ||
    metadata.archiveBytes <= 0 ||
    digest(canonical(data)) !== metadataSha256
  )
    fail('backup_metadata_invalid');
  const actual = await fileDigest(archive);
  if (actual.sha256 !== metadata.archiveSha256 || actual.bytes !== metadata.archiveBytes)
    fail('backup_archive_hash_mismatch');
  return { archive, metadata };
}

export async function runVerifyBackup({
  projectRoot,
  archiveArgument,
  runDocker = docker,
  validatorSource,
}) {
  const { archive, metadata } = await readBackup(projectRoot, archiveArgument);
  const nonce = randomUUID();
  const temporaryVolume = `fanqie-mcp-restore-check-${nonce}`;
  const label = `fanqie.backup-verification=${nonce}`;
  let created = false;
  try {
    await runDocker([
      'volume',
      'create',
      '--label',
      label,
      '--label',
      'fanqie.purpose=isolated-backup-check',
      temporaryVolume,
    ]);
    created = true;
    await runDocker(
      [
        'run',
        '--rm',
        '--pull',
        'never',
        '--interactive',
        '--network',
        'none',
        '--read-only',
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${temporaryVolume},dst=/restore`,
        '--entrypoint',
        'tar',
        metadata.imageId,
        '-C',
        '/restore',
        '-xf',
        '-',
        '--no-same-owner',
      ],
      { inputFile: archive },
    );
    const source =
      validatorSource ??
      (await readFile(path.join(projectRoot, 'scripts', 'lib', 'verify-data.mjs'), 'utf8'));
    const program = `${source}\ntry { const counts = verifyDataDirectory('/data'); process.stdout.write(JSON.stringify({pass:true,counts})); } catch { process.stdout.write(JSON.stringify({pass:false})); process.exitCode=1; }\n`;
    // SQLite may create WAL shared-memory files even for a readOnly connection.
    // Only this disposable restored volume is writable; the source volume is never mounted here.
    const output = await runDocker(
      [
        'run',
        '--rm',
        '--pull',
        'never',
        '--interactive',
        '--network',
        'none',
        '--read-only',
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${temporaryVolume},dst=/data`,
        '--entrypoint',
        'node',
        metadata.imageId,
        '--no-warnings',
        '--input-type=module',
      ],
      { inputText: program },
    );
    const result = parseJson(output);
    const allowedCounts = [
      'jobs',
      'evidence',
      'manifests',
      'currentPointers',
      'profileFiles',
      'profileLinks',
    ];
    if (
      result.pass !== true ||
      !result.counts ||
      Object.keys(result.counts).some((key) => !allowedCounts.includes(key)) ||
      allowedCounts.some(
        (key) => !Number.isSafeInteger(result.counts[key]) || result.counts[key] < 0,
      )
    )
      fail('backup_validation_failed');
    return {
      pass: true,
      counts: Object.fromEntries(allowedCounts.map((key) => [key, result.counts[key]])),
    };
  } finally {
    if (created) {
      const volume = parseJson(await runDocker(['volume', 'inspect', temporaryVolume]))[0];
      if (
        volume?.Name !== temporaryVolume ||
        volume?.Labels?.['fanqie.backup-verification'] !== nonce
      )
        fail('temporary_volume_identity_mismatch');
      await runDocker(['volume', 'rm', temporaryVolume]);
    }
  }
}
