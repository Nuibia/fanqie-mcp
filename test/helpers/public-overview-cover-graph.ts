import * as coverProof from '../../src/platform/short-native-cover-proof.js';

import { createHash, randomUUID } from 'node:crypto';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
} from '../../src/platform/short-native-metadata.js';

import {
  nativeShortCoverImagePolicy,
  NATIVE_SHORT_COVER_SCOPE,
  createNativeShortCoverUploadIntent,
  planNativeShortCoverSave,
  NATIVE_SHORT_COVER_HASH_BASES,
  compareNativeShortCoverReadback,
  nativeShortCoverDesiredContentHash,
} from '../../src/platform/short-native-cover.js';

import {
  type Job,
  type EvidenceDocument,
  type EvidenceRef,
  canonicalJson,
  type Manifest,
} from '../../src/runtime/store.js';

import {
  type NativeShortMetadataWriteReadPhase,
  type NativeShortMetadataApiResult,
} from '../../src/platform/short-native-metadata-api.js';

import {
  unavailableNativeShortCoverApi,
  type NativeShortCoverHeldIntent,
  type NativeShortCoverReceipt,
  type NativeShortCoverAcknowledgement,
} from '../../src/platform/short-native-cover-api.js';

export function coverGraph() {
  const proof = coverProof;
  const WORK = '7000000001',
    OWNER = '001001',
    SERVICE = 'owner';
  const HTML = '<p>SYNTHETIC PRIVATE BODY &amp; + %</p>',
    URI = 'synthetic/private-recommended&+%',
    URL = 'synthetic-private-opaque-url';
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const live = { executor: 'application-default-browser/v1', mode: 'live' } as const;
  const fixtureProvenance = {
    executor: 'dependency-injected-browser/v1',
    mode: 'fixture',
  } as const;
  function makeFixture(
    stop: 'none' | 'upload_unknown' | 'uploaded' | 'save_unknown' = 'none',
    mode: 'live' | 'fixture' = 'live',
  ) {
    let seq = 0,
      ids = 0;
    const tick = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 10).toISOString();
    const uuid = () => randomUUID();
    const before = createNativeShortMetadataSnapshot({
      binding: { account: { kind: 'account_id', id: OWNER }, work: { kind: 'short', id: WORK } },
      editData: {
        item_id: WORK,
        publish_status: 0,
        multi_title: ['Synthetic title', 'Preserved tail'],
        content: HTML,
        thumb_uri: 'synthetic-private-head-uri',
        thumb_url_list: ['synthetic-private-head-url'],
        book_thumb_uri: 'synthetic-private-old-cover',
        book_thumb_url_list: ['synthetic-private-old-url'],
        category: [{ category_id: 'c1', label: '主类', name: '都市' }],
        sign_type: 1,
        origin_activity_flag: 0,
        authorize_type: 0,
        category_max_count: 8,
        latest_version: 7,
        modify_time: '1789450000',
        unknown: { keep: [null, false, 'private-unknown'] },
      },
      categoryData: {
        category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
        opaque: { keep: true },
      },
    });
    const asset = {
      sourceSha256: sha('synthetic-source'),
      sourceSize: 123,
      sourceMimeType: 'image/png' as const,
      sourceWidth: 900,
      sourceHeight: 1200,
      preparedSha256: sha('synthetic-prepared'),
      preparedSize: 456,
      policy: nativeShortCoverImagePolicy(),
    };
    const business: coverProof.NativeShortCoverBusinessInput = {
      target: { kind: 'short', workId: WORK },
      snapshotScope: NATIVE_SHORT_COVER_SCOPE,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedSnapshotVersionHash: before.snapshotVersionHash,
      expectedState: 'draft',
      cover: { uploadPath: `${uuid()}.png`, sha256: asset.sourceSha256 },
    };
    const requestedAt = tick(),
      startedAt = tick();
    const job: Job = {
      id: uuid(),
      accountId: SERVICE,
      ownerId: uuid(),
      kind: 'write',
      operation: coverProof.NATIVE_SHORT_COVER_OPERATION,
      scope: coverProof.nativeShortCoverScope(WORK),
      datasets: [],
      idempotencyKey: 'synthetic-only',
      inputHash: coverProof.nativeShortCoverBusinessInputHash(business),
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
    const context: coverProof.NativeShortCoverEvidenceContext = {
      accountId: SERVICE,
      job,
      manifest: null,
      refs: [],
      documents: [],
      attempts: [],
    };
    const p = mode === 'live' ? live : fixtureProvenance;
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
    const intent = createNativeShortCoverUploadIntent(before, {
      expectedSnapshotVersionHash: business.expectedSnapshotVersionHash,
      hashBasis: business.hashBasis,
      expectedState: 'draft',
      asset,
    });
    const raw = unavailableNativeShortCoverApi('response_unavailable');
    raw.asset = asset;
    raw.uploadIntent = intent;
    raw.phases.before = phase();
    raw.snapshots.before = before;
    const uploadHeld: NativeShortCoverHeldIntent = {
      schema: 'native-short-cover-held-intent/v1',
      phase: 'upload',
      snapshot: before,
      businessRequest: coverProof.nativeShortCoverWriteRequest(business),
      uploadIntent: intent,
      expectation: null,
      uploadAcknowledgement: null,
      desiredContentHash: null,
      read: raw.phases.before,
      checkedAt: tick(),
    };
    raw.upload.held = uploadHeld;
    function persist(kind: coverProof.NativeShortCoverStage, input: unknown) {
      const payload = coverProof.createNativeShortCoverStageEvidence(kind, input, context),
        id = uuid(),
        capturedAt = tick(),
        dataset = coverProof.NATIVE_SHORT_COVER_DATASETS[kind];
      const document: EvidenceDocument = {
        schemaVersion: 1,
        evidenceId: id,
        accountId: SERVICE,
        jobId: job.id,
        dataset,
        capturedAt,
        collectionMode: mode,
        evidenceKind: dataset === 'write-intent' ? 'local-intent' : 'observation',
        payload,
      };
      const ref: EvidenceRef = {
        id,
        accountId: SERVICE,
        jobId: job.id,
        dataset,
        capturedAt,
        path: `synthetic-private-path/${id}.json`,
        sha256: sha(`${canonicalJson(document)}\n`),
      };
      context.refs.push(ref);
      context.documents.push(document);
      return ref;
    }
    function receipt(
      phaseName: 'upload' | 'save',
      stage: 'intent' | 'attempt' | 'acknowledgement',
    ): NativeShortCoverReceipt {
      return {
        schema: `native-short-cover-${phaseName}-${stage}-receipt/v1`,
        ...coverProof.nativeShortCoverReceiptFields(context, phaseName, stage),
      };
    }
    function attempt(phaseName: 'upload' | 'save') {
      const eventAt = tick();
      if (phaseName === 'upload') job.platformWriteStartedAt = eventAt;
      const ref = persist(phaseName === 'upload' ? 'uploadAttempt' : 'saveAttempt', { eventAt });
      context.attempts.push({
        jobId: job.id,
        accountId: SERVICE,
        phase: phaseName,
        ordinal: 1,
        evidence: { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt },
        eventAt,
      });
      raw[phaseName].attemptReceipt = receipt(phaseName, 'attempt');
      raw[phaseName].post = {
        attempts: 1,
        disposed: 0,
        markedAt: eventAt,
        startedAt: tick(),
        acknowledgedAt: null,
        acknowledged: false,
      };
      raw[phaseName].outcome = 'unknown';
    }
    const plan = planNativeShortCoverSave(before, intent, { picUri: URI, picUrl: URL });
    function ack(phaseName: 'upload' | 'save') {
      const observed: NativeShortCoverAcknowledgement = {
        schema: 'native-short-cover-acknowledgement-observation/v1',
        phase: phaseName,
        binding: before.binding,
        scope: NATIVE_SHORT_COVER_SCOPE,
        hashBases: NATIVE_SHORT_COVER_HASH_BASES,
        sourceVersionHash: intent.sourceVersionHash,
        assetHash: intent.assetHash,
        intentHash: intent.intentHash,
        uploadAckHash: plan.uploadAckHash,
        preSaveVersionHash: phaseName === 'save' ? before.snapshotVersionHash : null,
        desiredContentHash: plan.desiredContentHash,
        acknowledgedAt: tick(),
        picUri: phaseName === 'upload' ? URI : null,
        picUrl: phaseName === 'upload' ? URL : null,
      };
      raw[phaseName].observation = observed;
      Object.assign(raw[phaseName].post, {
        disposed: 1,
        acknowledgedAt: observed.acknowledgedAt,
        acknowledged: true,
      });
      raw[phaseName].outcome = 'acknowledged';
      persist(phaseName === 'upload' ? 'uploadAck' : 'saveAck', { observation: observed });
      raw[phaseName].acknowledgementReceipt = receipt(phaseName, 'acknowledgement');
    }
    persist('baseline', { held: uploadHeld, business, provenance: p });
    persist('uploadIntent', { held: uploadHeld });
    raw.upload.intentReceipt = receipt('upload', 'intent');
    attempt('upload');
    if (stop !== 'upload_unknown') ack('upload');
    if (stop === 'none' || stop === 'save_unknown') {
      raw.phases.preSave = phase();
      raw.snapshots.preSave = before;
      raw.expectation = plan.expectation;
      raw.desiredContentHash = plan.desiredContentHash;
      const saveHeld: NativeShortCoverHeldIntent = {
        ...uploadHeld,
        phase: 'save',
        read: raw.phases.preSave,
        checkedAt: tick(),
        expectation: plan.expectation,
        uploadAcknowledgement: raw.upload.observation,
        desiredContentHash: plan.desiredContentHash,
      };
      raw.save.held = saveHeld;
      persist('preSave', { held: saveHeld });
      persist('saveIntent', { held: saveHeld });
      raw.save.intentReceipt = receipt('save', 'intent');
      attempt('save');
      if (stop === 'none') ack('save');
    }
    const after = createNativeShortMetadataSnapshot({
      binding: before.binding,
      editData: {
        ...before.editData,
        book_thumb_uri: URI,
        book_thumb_url_list: [{ opaque: 'synthetic-derived-url' }],
        latest_version: 8,
        modify_time: '1789450001',
      },
      categoryData: before.categoryData,
    });
    if (stop === 'none') {
      raw.snapshot = after;
      raw.snapshots.after = after;
      raw.phases.after = phase();
      raw.comparison = compareNativeShortCoverReadback(plan.expectation, after);
      raw.observedContentHash = nativeShortCoverDesiredContentHash(plan.expectation);
    }
    raw.proof.platformStarted = true;
    raw.cleanup = {
      sessionCreated: true,
      sessionDisposed: true,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: tick(),
    };
    if (stop === 'none') {
      raw.status = 'success';
      raw.reason = null;
      raw.proof.ownerCallback = true;
      raw.proof.proofCapturedAt = tick();
      raw.save.outcome = 'verified';
    }
    function finish(saveRaw = raw) {
      persist('after', { result: saveRaw });
      if (stop === 'none') {
        persist('result', {});
        const result = context.documents.at(-1)!.payload;
        coverProof.validateNativeShortCoverCompletion(context, result);
        job.status = 'succeeded';
        job.result = result;
      } else {
        job.status = 'uncertain';
        job.error = { code: 'outcome_unknown', message: 'Synthetic unknown outcome.' };
        job.result = { evidence: context.refs };
      }
      job.endedAt = tick();
      job.updatedAt = job.endedAt;
    }
    function later(s: NativeShortMetadataSnapshot = after): NativeShortMetadataApiResult {
      const ph = phase();
      return {
        schema: 'native-short-metadata-api-read/v1',
        status: 'success',
        reason: null,
        snapshot: s,
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
      s: NativeShortMetadataSnapshot = after,
      audit?: coverProof.NativeShortCoverOriginalAudit,
    ): coverProof.NativeShortCoverReconciliationContext {
      const requestedAt = tick(),
        startedAt = tick(),
        boundary = tick(),
        read = later(s);
      read.proof.proofCapturedAt = tick();
      const evidence = coverProof.createNativeShortCoverReconciliationEvidence(
          read,
          context,
          p,
          audit,
        ),
        id = uuid(),
        readId = uuid(),
        capturedAt = tick();
      const document: EvidenceDocument = {
        schemaVersion: 1,
        evidenceId: id,
        accountId: SERVICE,
        jobId: readId,
        dataset: 'reconciliation',
        capturedAt,
        collectionMode: mode,
        evidenceKind: 'observation',
        payload: evidence,
      };
      const ref: EvidenceRef = {
        id,
        accountId: SERVICE,
        jobId: readId,
        dataset: 'reconciliation',
        capturedAt,
        path: 'synthetic-private-reconcile-path',
        sha256: sha(`${canonicalJson(document)}\n`),
      };
      const committedAt = tick(),
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
          evidence: [ref],
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
      return { original: context, readJob, manifest, ref, document };
    }
    return {
      context,
      business,
      before,
      after,
      raw,
      plan,
      persist,
      finish,
      tick,
      reconciliationContext,
    };
  }

  const graph = makeFixture('none', 'live');
  graph.finish();
  return graph;
}
