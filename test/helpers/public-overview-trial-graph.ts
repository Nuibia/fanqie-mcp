import * as trialProof from '../../src/platform/short-native-trial-proof.js';

import { createHash, randomUUID } from 'node:crypto';

import {
  mkdtempSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  rmSync,
} from 'node:fs';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  createNativeShortTrialSnapshot,
  NATIVE_SHORT_TRIAL_SCOPE,
  planNativeShortTrialUpdate,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  compareNativeShortTrialReadback,
  type NativeShortTrialSnapshot,
} from '../../src/platform/short-native-trial.js';

import {
  type Job,
  type EvidenceDocument,
  canonicalJson,
  type EvidenceRef,
  type Manifest,
} from '../../src/runtime/store.js';

import {
  type NativeShortMetadataWriteReadPhase,
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import {
  type NativeShortTrialReceipt,
  unavailableNativeShortTrialApi,
  type NativeShortTrialHeldIntent,
  type NativeShortTrialAcknowledgement,
} from '../../src/platform/short-native-trial-api.js';

export function trialGraph(acknowledged = true) {
  const proof = trialProof;
  const SERVICE = 'owner',
    OWNER = '001001',
    WORK = '7412345678901234567';
  const HTML = [100, 100, 100, 100]
    .map((count, i) => `<p>${String.fromCharCode(65 + i).repeat(count)}</p>`)
    .join('');
  const live = { executor: 'application-default-browser/v1' as const, mode: 'live' as const },
    fixture = { executor: 'dependency-injected-browser/v1' as const, mode: 'fixture' as const };
  const sha = (value: string) => createHash('sha256').update(value).digest('hex'),
    clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const roots: string[] = [];
  function makeFixture(acknowledged = true, mode: 'live' | 'fixture' = 'live') {
    const root = mkdtempSync(join(tmpdir(), 'trial-proof-'));
    roots.push(root);
    let seq = 0,
      ids = 0;
    const tick = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 10).toISOString(),
      uuid = () => randomUUID();
    const native = createNativeShortMetadataSnapshot({
      binding: { account: { kind: 'account_id', id: OWNER }, work: { kind: 'short', id: WORK } },
      editData: {
        item_id: WORK,
        publish_status: 0,
        multi_title: ['Synthetic title', 'Preserved tail'],
        content: HTML,
        thumb_uri: 'private-head-uri',
        thumb_url_list: ['private-head-url'],
        book_thumb_uri: 'private-cover-uri',
        book_thumb_url_list: ['private-cover-url'],
        category: [{ category_id: 'c1', label: '主类', name: '都市' }],
        sign_type: 1,
        origin_activity_flag: 0,
        authorize_type: 0,
        category_max_count: 8,
        latest_version: 7,
        modify_time: '1789450000',
        unknown: { keep: [null, false, 'private-source-unknown'] },
      },
      categoryData: {
        category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
        opaque: { keep: true },
      },
    });
    const before = createNativeShortTrialSnapshot(native),
      business: trialProof.NativeShortTrialBusinessInput = {
        target: { kind: 'short', workId: WORK },
        snapshotScope: NATIVE_SHORT_TRIAL_SCOPE,
        hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
        expectedSnapshotVersionHash: before.snapshotVersionHash,
        expectedState: 'draft',
        metadata: { trial: { action: 'set', beforeParagraph: 3 } },
      };
    const plan = planNativeShortTrialUpdate(
      before,
      trialProof.nativeShortTrialWriteRequest(business),
    );
    const afterSnapshot = createNativeShortTrialSnapshot(
      createNativeShortMetadataSnapshot({
        binding: native.binding,
        editData: {
          ...native.editData,
          content: plan.expectation.desiredHtml,
          latest_version: 8,
          modify_time: '1789450001',
        },
        categoryData: native.categoryData,
      }),
    );
    const requestedAt = tick(),
      startedAt = tick(),
      job: Job = {
        id: uuid(),
        accountId: SERVICE,
        ownerId: uuid(),
        kind: 'write',
        operation: trialProof.NATIVE_SHORT_TRIAL_OPERATION,
        scope: trialProof.nativeShortTrialScope(WORK),
        datasets: [],
        idempotencyKey: 'offline-proof-only',
        inputHash: trialProof.nativeShortTrialBusinessInputHash(business),
        status: 'running',
        requestedAt,
        startedAt,
        platformReadStartedAt: tick(),
        platformWriteStartedAt: null,
        endedAt: null,
        updatedAt: startedAt,
        result: null,
        error: null,
        target: { kind: 'short-story', id: WORK },
        metadata: {},
        timeoutMs: 10_000,
        deadlineAt: null,
        cancellationRequestedAt: null,
        cancellationReason: null,
      };
    const context: trialProof.NativeShortTrialContext = {
        accountId: SERVICE,
        job,
        manifest: null,
        refs: [],
        documents: [],
        attempts: [],
      },
      p = mode === 'live' ? live : fixture;
    function phase(): NativeShortMetadataWriteReadPhase {
      return {
        proof: {
          platformStarted: true,
          ownerBefore: true,
          ownerAfter: true,
          fixedSourceVerified: true,
          targetUnique: true,
          paginationComplete: true,
          atomicRevision: false,
          readStartedAt: tick(),
          readFinishedAt: tick(),
          proofCapturedAt: tick(),
        },
        requests: {
          own: { attempts: 2, disposed: 2 },
          list: { attempts: 1, disposed: 1 },
          edit: { attempts: 1, disposed: 1 },
          catalog: { attempts: 1, disposed: 1 },
        },
        list: { pagesRead: 1, rowsRead: 1, totalCount: 1 },
      };
    }
    function writeDocument(jobId: string, dataset: string, payload: unknown) {
      const id = uuid(),
        capturedAt = tick(),
        document: EvidenceDocument = {
          schemaVersion: 1,
          evidenceId: id,
          accountId: SERVICE,
          jobId,
          dataset,
          capturedAt,
          collectionMode: mode,
          evidenceKind: dataset === 'write-intent' ? 'local-intent' : 'observation',
          payload,
        },
        path = join(root, `${id}.json`),
        bytes = `${canonicalJson(document)}\n`,
        fd = openSync(path, 'wx', 0o600);
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const directory = openSync(root, 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      const actual = readFileSync(path, 'utf8');
      assert.equal(actual, bytes);
      const ref: EvidenceRef = {
        id,
        accountId: SERVICE,
        jobId,
        dataset,
        capturedAt,
        path: `trial/${id}.json`,
        sha256: sha(actual),
      };
      return { ref, document: JSON.parse(actual) as EvidenceDocument };
    }
    function persist(kind: trialProof.NativeShortTrialStage, input: unknown) {
      const payload = trialProof.createNativeShortTrialStageEvidence(kind, input, context),
        durable = writeDocument(job.id, trialProof.NATIVE_SHORT_TRIAL_DATASETS[kind], payload);
      context.refs.push(durable.ref);
      context.documents.push(durable.document);
      return durable.ref;
    }
    function receipt(stage: 'intent' | 'attempt' | 'acknowledgement'): NativeShortTrialReceipt {
      return {
        schema: `native-short-trial-${stage}-receipt/v1`,
        ...trialProof.nativeShortTrialReceiptFields(context, stage),
      };
    }
    const raw = unavailableNativeShortTrialApi('response_unavailable');
    raw.plan = plan;
    raw.expectation = plan.expectation;
    raw.desiredContentHash = plan.desiredContentHash;
    raw.snapshots.before = before;
    raw.phases.before = phase();
    const baseline: NativeShortTrialHeldIntent = {
      schema: 'native-short-trial-held-intent/v1',
      snapshot: before,
      beforeSnapshot: before,
      businessRequest: trialProof.nativeShortTrialWriteRequest(business),
      plan,
      expectation: plan.expectation,
      desiredContentHash: plan.desiredContentHash,
      read: raw.phases.before,
      checkedAt: tick(),
    };
    persist('baseline', { held: baseline, business, provenance: p });
    raw.phases.preSave = phase();
    raw.snapshots.preSave = before;
    const preSave: NativeShortTrialHeldIntent = {
      ...baseline,
      read: raw.phases.preSave,
      checkedAt: tick(),
    };
    raw.save.held = preSave;
    persist('preSave', { held: preSave });
    persist('intent', { held: preSave });
    raw.save.intentReceipt = receipt('intent');
    const eventAt = tick();
    job.platformWriteStartedAt = eventAt;
    const attemptRef = persist('attempt', { eventAt });
    context.attempts.push({
      jobId: job.id,
      accountId: SERVICE,
      ordinal: 1,
      evidence: { id: attemptRef.id, sha256: attemptRef.sha256, capturedAt: attemptRef.capturedAt },
      eventAt,
    });
    raw.save.attemptReceipt = receipt('attempt');
    raw.save.post = {
      attempts: 1,
      disposed: 1,
      markedAt: eventAt,
      startedAt: tick(),
      acknowledgedAt: null,
      acknowledged: false,
    };
    raw.save.outcome = 'unknown';
    if (acknowledged) {
      const observation: NativeShortTrialAcknowledgement = {
        schema: 'native-short-trial-acknowledgement-observation/v1',
        binding: before.binding,
        scope: NATIVE_SHORT_TRIAL_SCOPE,
        hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
        sourceVersionHash: before.snapshotVersionHash,
        desiredContentHash: plan.desiredContentHash,
        acknowledgedAt: tick(),
      };
      raw.save.observation = observation;
      Object.assign(raw.save.post, {
        acknowledgedAt: observation.acknowledgedAt,
        acknowledged: true,
      });
      raw.save.outcome = 'acknowledged';
      persist('acknowledgement', { observation });
      raw.save.acknowledgementReceipt = receipt('acknowledgement');
    }
    raw.phases.after = phase();
    raw.snapshot = afterSnapshot;
    raw.snapshots.after = afterSnapshot;
    raw.comparison = compareNativeShortTrialReadback(plan.expectation, afterSnapshot);
    raw.observedContentHash = plan.desiredContentHash;
    raw.proof.platformStarted = true;
    raw.cleanup = {
      sessionCreated: true,
      sessionDisposed: true,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: tick(),
    };
    if (acknowledged) {
      raw.status = 'success';
      raw.reason = null;
      raw.proof.ownerCallback = true;
      raw.proof.proofCapturedAt = tick();
      raw.save.outcome = 'verified';
    }
    function finish(result = raw) {
      persist('after', { result });
      if (acknowledged) {
        persist('result', {});
        const returned = context.documents.at(-1)!.payload;
        trialProof.validateNativeShortTrialCompletion(context, returned);
        job.status = 'succeeded';
        job.result = returned;
      } else {
        job.status = 'uncertain';
        job.error = { code: 'outcome_unknown', message: 'Offline synthetic unknown outcome.' };
        job.result = { evidence: context.refs };
      }
      job.endedAt = tick();
      job.updatedAt = job.endedAt;
    }
    function later(
      s: NativeShortTrialSnapshot | null = afterSnapshot,
    ): NativeShortMetadataApiResult {
      const ph = phase();
      if (s === null) {
        const partial = unavailableNativeShortMetadataApi('response_unavailable');
        partial.proof = {
          ...ph.proof,
          ownerCallback: false,
          ownerAfter: false,
          fixedSourceVerified: false,
          proofCapturedAt: null,
        };
        partial.requests = ph.requests;
        partial.list = ph.list;
        partial.cleanup = {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt: tick(),
        };
        return partial;
      }
      return {
        schema: 'native-short-metadata-api-read/v1',
        status: 'success',
        reason: null,
        snapshot: s.native,
        proof: { ...ph.proof, ownerCallback: true, proofCapturedAt: null },
        requests: ph.requests,
        list: ph.list,
        cleanup: {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt: tick(),
        },
      };
    }
    function reconciliationContext(
      s: NativeShortTrialSnapshot | null = afterSnapshot,
      audit?: trialProof.NativeShortTrialOriginalAudit,
    ): trialProof.NativeShortTrialReconciliationContext {
      const requestedAt = tick(),
        startedAt = tick(),
        boundary = tick(),
        read = later(s);
      if (s !== null) read.proof.proofCapturedAt = tick();
      const evidence = trialProof.createNativeShortTrialReconciliationEvidence(
          read,
          context,
          p,
          audit,
        ),
        readId = uuid(),
        durable = writeDocument(readId, 'reconciliation', evidence),
        committedAt = tick(),
        manifest: Manifest = {
          schemaVersion: 1,
          id: uuid(),
          accountId: SERVICE,
          jobId: readId,
          operation: 'reconcile_write',
          scope: 'reconciliation',
          datasets: ['reconciliation'],
          requestedAt,
          platformReadStartedAt: boundary,
          committedAt,
          evidence: [durable.ref],
        };
      const readJob: Job = {
        ...job,
        id: readId,
        kind: 'read',
        operation: 'reconcile_write',
        scope: 'reconciliation',
        datasets: ['reconciliation'],
        idempotencyKey: null,
        inputHash: sha(canonicalJson({ jobId: job.id })),
        status: 'succeeded',
        requestedAt,
        startedAt,
        platformReadStartedAt: boundary,
        platformWriteStartedAt: null,
        endedAt: committedAt,
        updatedAt: committedAt,
        result: { manifest },
        error: null,
      };
      return { original: context, readJob, manifest, ref: durable.ref, document: durable.document };
    }
    return {
      context,
      business,
      before,
      after: afterSnapshot,
      raw,
      plan,
      persist,
      finish,
      tick,
      reconciliationContext,
      writeDocument,
      later,
    };
  }

  const graph = makeFixture(acknowledged, 'live');
  graph.finish();
  return {
    ...graph,
    close() {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    },
  };
}
