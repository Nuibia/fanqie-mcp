import {
  RuntimeError,
  Store,
  resolveNativeShortBodyStoreAuthority,
} from '../../src/runtime/store.js';

import {
  PUBLIC_READ_MEMO_BUDGET_BYTES,
  PublicReadCoordinator,
} from '../../src/runtime/public-read.js';

import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { DatabaseSync } from 'node:sqlite';

import { createHash } from 'node:crypto';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  validateNativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
  nativeShortBodyBusinessInputHash,
} from '../../src/platform/short-native-body.js';

import {
  NATIVE_SHORT_BODY_OPERATION,
  nativeShortBodyScope,
} from '../../src/platform/short-native-body-proof.js';

import assert from 'node:assert/strict';

export const unavailable = (error: unknown) =>
  error instanceof Error && (error as Error & { code?: string }).code === 'capability_unavailable';

export const lost = (error: unknown) =>
  error instanceof RuntimeError && error.code === 'service_lease_lost';

export function coordinator(budget = PUBLIC_READ_MEMO_BUDGET_BYTES) {
  let ownershipLost = false;
  const ledger: string[] = [];
  const scope = new PublicReadCoordinator(
    {
      begin() {
        ledger.push('begin');
      },
      commit() {
        ledger.push('commit');
      },
      rollback() {
        ledger.push('rollback');
      },
      assertLease() {
        ledger.push('lease');
        if (ownershipLost) throw new RuntimeError('service_lease_lost', 'Synthetic permanent loss');
      },
      isLeaseLost: () => ownershipLost,
      leaseLostError: () => new RuntimeError('service_lease_lost', 'Synthetic permanent loss'),
    },
    budget,
  );
  return {
    scope,
    ledger,
    lose() {
      ownershipLost = true;
      scope.invalidateForLeaseLoss();
    },
  };
}

export function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'public-read-store-synthetic-'));
  const options = {
    databasePath: path.join(root, 'operations.sqlite'),
    evidenceDirectory: path.join(root, 'evidence'),
    evidenceMode: 'fixture' as const,
    nativeShortBodyWriteEnabled: true,
    nativeShortBodyFixtureFactory: {
      async newContext() {
        throw Error('Synthetic Store test forbids network');
      },
    },
  };
  const store = new Store(options),
    job = store.createJob({
      accountId: 'owner',
      kind: 'read',
      operation: 'refresh',
      scope: 'synthetic',
      datasets: ['works'],
    }).job;
  store.startJob(job.id);
  store.markPlatformReadStarted(job.id);
  const ref = store.saveEvidence(job.id, 'works', { records: [], status: 'success' });
  store.completeReadJob(job.id, [ref]);
  const db = new DatabaseSync(options.databasePath);
  const ledger = () => ({
    rows: [
      'jobs',
      'evidence',
      'manifests',
      'current_manifests',
      'write_reconciliations',
      'native_short_body_attempts',
      'native_short_trial_attempts',
      'native_short_cover_attempts',
      'service_lease',
    ].map((table) => [table, db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()]),
    files: files(root),
  });
  return {
    root,
    options,
    store,
    job,
    ref,
    db,
    ledger,
    close() {
      db.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function files(root: string): any[] {
  const result: any[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, name.name);
    if (name.isDirectory()) result.push([name.name, files(file)]);
    else if (!/sqlite(?:-wal|-shm)?$/.test(name.name))
      result.push([name.name, createHash('sha256').update(readFileSync(file)).digest('hex')]);
  }
  return result;
}

export function preissuedBody(f: ReturnType<typeof fixture>) {
  const work = '7000000001',
    account = 'owner',
    platform = '001001',
    native = {
      binding: {
        account: { kind: 'account_id' as const, id: platform },
        work: { kind: 'short' as const, id: work },
      },
      editData: {
        item_id: work,
        publish_status: 0,
        content: '<p>甲</p><p>乙</p>',
        multi_title: ['Synthetic body'],
        thumb_uri: 'synthetic-head',
        book_thumb_uri: 'synthetic-cover',
        category: [],
        sign_type: 1,
        origin_activity_flag: 0,
        latest_version: 7,
        modify_time: '1789450000',
      },
      categoryData: {
        category_list: [{ category_id: 'fixture-1', label: 'Synthetic', name: 'Fixture' }],
      },
    };
  const snapshot = createNativeShortMetadataSnapshot(native),
    business = validateNativeShortBodyBusinessInput({
      target: { kind: 'short', workId: work },
      snapshotScope: NATIVE_SHORT_BODY_SCOPE,
      expectedSnapshotVersionHash: snapshot.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft',
      representation: NATIVE_SHORT_BODY_REPRESENTATION,
      paragraphs: [
        { sourceIndex: null, lines: ['新正文'] },
        { sourceIndex: 1, lines: ['乙'] },
      ],
      trial: { action: 'clear' },
    }),
    inputHash = nativeShortBodyBusinessInputHash(account, business);
  const job = f.store.createJob({
    accountId: account,
    kind: 'write',
    operation: NATIVE_SHORT_BODY_OPERATION,
    scope: nativeShortBodyScope(work),
    idempotencyKey: 'public-read-preissued',
    inputHash,
  }).job;
  f.store.startJob(job.id);
  const authority = f.store.issueNativeShortBodyWriteAuthority(job.id, account, business, platform),
    binding = resolveNativeShortBodyStoreAuthority(authority, {
      accountId: account,
      workId: work,
      inputHash,
    });
  assert(binding);
  return { authority, binding, business, job, native, inputHash };
}
