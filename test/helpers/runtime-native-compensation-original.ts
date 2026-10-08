import {
  installedSourceInventory,
  installedSourceRegistrationHash,
} from '../../src/runtime/source-integrity.js';
import { fixture, delay, digest } from './runtime-deferred.js';

import { type Job } from '../../src/runtime/store.js';

import {
  type NativeShortWriteBusinessInput,
  nativeShortReadScope,
  nativeShortWriteInputHash,
  nativeShortWriteRequest,
  nativeShortDesiredContentHash,
} from '../../src/platform/short-native-metadata-proof.js';

import {
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { nativeStoreReadResult, nativeStoreProvenance } from './runtime-recovery-baseline.js';

import {
  nativeCompensationPlan,
  nativeCompensationLink,
  nativeCompensationExecutionInventory,
} from './runtime-native-store-original.js';

import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';

export async function nativeCompensationOriginal(
  f: ReturnType<typeof fixture>,
  before: any,
  title: string,
): Promise<Job> {
  const business: NativeShortWriteBusinessInput = {
    target: { kind: 'short', workId: before.binding.work.id },
    snapshotScope: NATIVE_SHORT_METADATA_SCOPE,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    expectedState: 'draft',
    title,
  };
  const job = f.store.createJob({
    accountId: 'author',
    kind: 'write',
    operation: 'update_work_metadata',
    scope: nativeShortReadScope(before.binding.work.id),
    idempotencyKey: 'native-store-key',
    inputHash: nativeShortWriteInputHash(business),
  }).job;
  f.store.startJob(job.id);
  const at = f.store.markPlatformReadStarted(job.id),
    raw = nativeStoreReadResult(before, at);
  const { ownerCallback: _unused, ...proof } = raw.proof;
  const request = nativeShortWriteRequest(business),
    plan = nativeCompensationPlan(before, request);
  const held = {
    schema: 'native-short-metadata-held-before/v1',
    phase: 'held-for-write',
    snapshot: before,
    businessRequest: request,
    expectation: plan.expectation,
    desiredContentHash: nativeShortDesiredContentHash(plan.expectation),
    read: { proof, requests: raw.requests, list: raw.list },
    cleanup: { ...raw.cleanup, sessionDisposed: false },
  };
  // Rebuild the old exact carrier from its original wire; no modern writer accepts this fixture.
  const baseline = {
    schema: held.schema,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    held,
    businessInput: business,
    source: { origin: 'https://fanqienovel.com', mode: 'live' },
    provenance: nativeStoreProvenance,
  };
  const baselineRef = f.store.saveEvidence(job.id, 'short_native_metadata_baseline', baseline),
    expectation = held.expectation;
  f.store.saveEvidence(job.id, 'write-intent', {
    schema: 'native-short-metadata-intent/v1',
    scope: NATIVE_SHORT_METADATA_SCOPE,
    hashBases: expectation.hashBases,
    binding: expectation.binding,
    target: { kind: 'short-story', id: before.binding.work.id },
    expectedSnapshotVersionHash: expectation.sourceVersionHash,
    expectation,
    baselineEvidence: nativeCompensationLink(baselineRef),
    comparisonBasis: 'native-short-metadata-desired-and-preservation/v1',
    desiredContentHash: held.desiredContentHash,
    expectedStates: ['draft_saved'],
  });
  f.store.recordTarget(job.id, { kind: 'short-story', id: before.binding.work.id });
  f.store.markPlatformWriteStarted(job.id);
  await delay(2);
  return f.store.failJob(job.id, {
    code: 'response_lost',
    message: 'Synthetic ACK lost after one saved effect.',
  });
}

export function nativeCompensationInstalledInventory(): Record<string, string> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const inventory = installedSourceInventory(root);
  return Object.fromEntries(
    Object.keys(nativeCompensationExecutionInventory).map((relative) => [
      relative,
      installedSourceRegistrationHash(relative, inventory),
    ]),
  );
}
