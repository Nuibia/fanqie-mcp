import assert from 'node:assert/strict';

import { writeFile, readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';

import path from 'node:path';

import os from 'node:os';

import { DatabaseSync } from 'node:sqlite';

import { canonical, digest } from '../../lib/backup-core.mjs';

export const imageId = `sha256:${'a'.repeat(64)}`;

export const mainVolume = 'fanqie-mcp_fanqie-data';

export function mockDocker({
  failArchive = false,
  inUse = false,
  running = true,
  failValidate = false,
  healthStates = ['healthy'],
  missingHealthcheck = false,
} = {}) {
  const calls = [];
  const volumes = new Map();
  let restored = false;
  let healthIndex = 0;
  const runner = async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === 'compose') {
      if (args.includes('ps')) return 'a'.repeat(64);
      if (args.includes('stop')) {
        running = false;
        return '';
      }
      if (args.includes('start')) {
        assert.ok(options.signal instanceof AbortSignal);
        running = true;
        restored = true;
        return '';
      }
    }
    if (args[0] === 'inspect') {
      if (restored) assert.ok(options.signal instanceof AbortSignal);
      const health = restored
        ? healthStates[Math.min(healthIndex++, healthStates.length - 1)]
        : 'healthy';
      return JSON.stringify([
        {
          Image: imageId,
          Config: {
            Labels: {
              'com.docker.compose.project': 'fanqie-mcp',
              'com.docker.compose.service': 'fanqie-mcp',
            },
            ...(missingHealthcheck ? {} : { Healthcheck: { Test: ['CMD', 'fixture-health'] } }),
          },
          State: {
            Running: running,
            Paused: false,
            Restarting: health === 'restarting',
            Health: { Status: health === 'restarting' ? 'unhealthy' : health },
          },
          Mounts: [{ Type: 'volume', Destination: '/data', Name: mainVolume }],
        },
      ]);
    }
    if (args[0] === 'ps') return inUse ? 'b'.repeat(64) : '';
    if (args[0] === 'volume' && args[1] === 'inspect') {
      const name = args.at(-1);
      return JSON.stringify([
        {
          Name: name,
          Labels:
            name === mainVolume
              ? {
                  'com.docker.compose.project': 'fanqie-mcp',
                  'com.docker.compose.volume': 'fanqie-data',
                }
              : volumes.get(name),
        },
      ]);
    }
    if (args[0] === 'volume' && args[1] === 'create') {
      const labels = {};
      for (let i = 0; i < args.length; i++)
        if (args[i] === '--label') {
          const [key, value] = args[++i].split('=');
          labels[key] = value;
        }
      volumes.set(args.at(-1), labels);
      return args.at(-1);
    }
    if (args[0] === 'volume' && args[1] === 'rm') {
      assert.notEqual(args.at(-1), mainVolume);
      volumes.delete(args.at(-1));
      return '';
    }
    if (args[0] === 'run' && options.outputFile) {
      assert.equal(running, false);
      if (failArchive) throw new Error('Unprinted private Docker diagnostic');
      await writeFile(options.outputFile, 'PRIVATE_PROFILE_FIXTURE_NOT_FOR_STDOUT', {
        mode: 0o600,
      });
      return '';
    }
    if (args[0] === 'run' && options.inputFile) {
      assert.ok(args.includes('--interactive'));
      await readFile(options.inputFile);
      return '';
    }
    if (args[0] === 'run' && options.inputText) {
      assert.ok(args.includes('--read-only'));
      assert.ok(
        args.some(
          (arg) =>
            arg.startsWith('type=volume,src=fanqie-mcp-restore-check-') &&
            arg.endsWith('dst=/data'),
        ),
      );
      if (failValidate) throw new Error('Unprinted invalid restored evidence');
      return JSON.stringify({
        pass: true,
        counts: {
          jobs: 2,
          evidence: 2,
          manifests: 1,
          currentPointers: 1,
          profileFiles: 3,
          profileLinks: 0,
        },
        privatePayload: 'DO_NOT_OUTPUT',
      });
    }
    throw new Error('Unexpected fixture Docker command');
  };
  return { runner, calls, volumes };
}

export async function temporary(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fanqie-backup-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function databaseFixture(root) {
  await mkdir(path.join(root, 'evidence', 'fixture'), { recursive: true });
  await mkdir(path.join(root, 'profile'));
  await writeFile(path.join(root, 'profile', 'Cookies'), 'PRIVATE_PROFILE_BINARY');
  const db = new DatabaseSync(path.join(root, 'operations.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE jobs(id TEXT PRIMARY KEY,account_id TEXT);
    CREATE TABLE evidence(id TEXT PRIMARY KEY,account_id TEXT,job_id TEXT REFERENCES jobs(id),dataset TEXT,captured_at TEXT,path TEXT,sha256 TEXT);
    CREATE TABLE manifests(id TEXT PRIMARY KEY,account_id TEXT,job_id TEXT REFERENCES jobs(id),scope TEXT,committed_at TEXT,manifest_json TEXT);
    CREATE TABLE current_manifests(account_id TEXT,scope TEXT,manifest_id TEXT REFERENCES manifests(id));`);
  db.prepare('INSERT INTO jobs VALUES(?,?)').run('job-fixture', 'account-fixture');
  const capturedAt = '2026-10-03T00:00:00Z';
  const doc = {
    schemaVersion: 1,
    evidenceId: 'evidence-fixture',
    accountId: 'account-fixture',
    jobId: 'job-fixture',
    dataset: 'short_works',
    capturedAt,
    collectionMode: 'live',
    evidenceKind: 'observation',
    payload: { body: 'PRIVATE_BODY_FIXTURE' },
  };
  const bytes = Buffer.from(`${canonical(doc)}\n`);
  const reference = {
    id: doc.evidenceId,
    accountId: doc.accountId,
    jobId: doc.jobId,
    dataset: doc.dataset,
    capturedAt,
    path: 'fixture/evidence.json',
    sha256: digest(bytes),
  };
  await writeFile(path.join(root, 'evidence', reference.path), bytes);
  db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)').run(
    reference.id,
    reference.accountId,
    reference.jobId,
    reference.dataset,
    capturedAt,
    reference.path,
    reference.sha256,
  );
  const manifest = {
    schemaVersion: 1,
    id: 'manifest-fixture',
    accountId: doc.accountId,
    jobId: doc.jobId,
    operation: 'refresh',
    scope: 'account',
    datasets: ['short_works'],
    requestedAt: capturedAt,
    platformReadStartedAt: capturedAt,
    committedAt: capturedAt,
    evidence: [reference],
  };
  db.prepare('INSERT INTO manifests VALUES(?,?,?,?,?,?)').run(
    manifest.id,
    manifest.accountId,
    manifest.jobId,
    manifest.scope,
    manifest.committedAt,
    canonical(manifest),
  );
  db.prepare('INSERT INTO current_manifests VALUES(?,?,?)').run(
    manifest.accountId,
    manifest.scope,
    manifest.id,
  );
  db.close();
  return { reference, doc, manifest };
}

// Archive-only synthetic administration. These literals do not replay native ACK/business proof.
export const registrationIds = {
  original: '41000000-0000-4000-8000-000000000001',
  before: '41000000-0000-4000-8000-000000000002',
  operator: '41000000-0000-4000-8000-000000000003',
  job: '41000000-0000-4000-8000-000000000004',
  manifest: '41000000-0000-4000-8000-000000000005',
  run: '41000000-0000-4000-8000-000000000006',
};

export const registrationAt = (n) => `2020-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;

export const registrationRefId = (n) => `42000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const registrationSafeRef = (ref) =>
  Object.fromEntries(
    ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'sha256'].map((key) => [key, ref[key]]),
  );
