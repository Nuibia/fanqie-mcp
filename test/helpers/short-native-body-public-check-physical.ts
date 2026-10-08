import {
  ACCOUNT,
  WORK,
  TOKEN,
  OWNER,
  CRASH_OPERATION_TIMEOUT_MS,
} from './short-native-body-public-account.js';

import assert from 'node:assert/strict';

import { fixture } from './short-native-body-public-fixture.js';

import { createMcpServer } from '../../src/transport/mcp.js';

import { Client } from '@modelcontextprotocol/client';

import { InMemoryTransport } from '@modelcontextprotocol/server';

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import { createHash } from 'node:crypto';

import os from 'node:os';

import { spawn } from 'node:child_process';

import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../../src/config.js';

import { Store } from '../../src/runtime/store.js';

export const noPrivate = (value: unknown) => {
  const serialized = JSON.stringify(value);
  for (const marker of [
    'PRIVATE',
    ACCOUNT,
    WORK,
    TOKEN,
    'operations.sqlite',
    'default-body-owned-api',
    'sqlite-owned-body-fixture',
  ])
    assert.equal(serialized.includes(marker), false, marker);
};

export const sdk = async (f: ReturnType<typeof fixture>) => {
  const server = createMcpServer(f.app.tools),
    client = new Client({ name: 'body-public-official-fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name: 'fanqie_' + name, arguments: args });
      assert(result.structuredContent);
      return (result.structuredContent as any).result;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
};

export function checkPhysical(f: ReturnType<typeof fixture>, jobId: string) {
  for (const ref of f.refs(jobId)) {
    const bytes = readFileSync(path.join(f.evidenceDirectory, String(ref.path)));
    assert.equal(bytes.at(-1), 10);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256);
    const document = JSON.parse(bytes.toString());
    assert.equal(document.jobId, jobId);
    assert.equal(document.accountId, OWNER);
    assert.equal(document.dataset, ref.dataset);
  }
}

export async function publicDeath(mode: 'death-attempt' | 'death-ack') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-public-death-'));
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('../short-native-body-public.test.ts', import.meta.url).href),
    ],
    {
      env: { ...process.env, FQ_BODY_PUBLIC_CHILD: mode, FQ_BODY_PUBLIC_CHILD_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '';
  child.stdout!.on('data', (data) => {
    output += String(data);
  });
  child.stderr!.on('data', (data) => {
    output += String(data);
  });
  let exited = false;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true;
      resolve({ code, signal });
    };
    child.once('exit', finish);
    child.once('close', finish);
  });
  const waitForExit = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('Synthetic child cleanup timeout')), 2000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    const receipt = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Error('Synthetic child checkpoint timeout'));
      }, 8000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('message', (message) => {
        clearTimeout(timer);
        resolve(message as Record<string, unknown>);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Synthetic child exited before checkpoint'));
      });
    });
    assert.equal(
      receipt.phase,
      mode === 'death-attempt' ? 'committed-attempt-before-post' : 'post-ack-before-completion',
    );
    child.kill('SIGKILL');
    assert.equal((await waitForExit()).signal, 'SIGKILL');
    assert.equal(output.includes('PRIVATE'), false);
    // Reopening obeys the real durable service lease; process death does not
    // authorize deleting or shortening a lease held by a different owner.
    const db = new DatabaseSync(path.join(dir, 'operations.sqlite'), { readOnly: true });
    const expiresAt = Number(
      db.prepare('SELECT expires_at FROM service_lease WHERE id=1').get()!.expires_at,
    );
    db.close();
    assert(expiresAt > Date.now());
    assert.throws(
      () =>
        new Store({
          databasePath: path.join(dir, 'operations.sqlite'),
          evidenceDirectory: path.join(dir, 'evidence'),
        }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'service_already_running',
    );
    // Match the child's explicit operation budget and the unchanged App lease grace.
    const config = loadConfig({
      FANQIE_TOKEN: TOKEN,
      FANQIE_PORT: '0',
      FANQIE_TIMEOUT_MS: String(CRASH_OPERATION_TIMEOUT_MS),
      FANQIE_ENABLE_WRITES: 'true',
      FANQIE_ACCOUNT_ID: OWNER,
      FANQIE_DATA_DIR: dir,
      FANQIE_PROFILE_DIR: path.join(dir, 'unused-profile'),
      FANQIE_RUNTIME_DIR: path.join(dir, 'runtime'),
    });
    const maxWaitMs = Math.max(30_000, config.timeoutMs + 30_000) + 2;
    const waitMs = Math.max(1, expiresAt - Date.now() + 2);
    assert(waitMs <= maxWaitMs);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    return { dir, receipt };
  } catch (error) {
    if (!exited) {
      child.kill('SIGKILL');
      await waitForExit();
    }
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
