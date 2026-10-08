import { RuntimeError, type Job, type RuntimeFailure, type Manifest } from '../runtime-error.js';
import { canonicalJson, hash, timestamp } from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import path from 'node:path';
import {
  type TransactionOperation,
  type PrepareOperation,
  type AssertOwnershipOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type GetJobOperation,
  type ResolveOperatorEntryInvestigationOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

interface ResolveOperatorEntryInvestigationDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  prepare: PrepareOperation;
  assertOwnership: AssertOwnershipOperation;
}

export function createResolveOperatorEntryInvestigation(
  deps: ResolveOperatorEntryInvestigationDependencies,
): ResolveOperatorEntryInvestigationOperation {
  function resolveOperatorEntryInvestigation(originalId: string, readJobId: string): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const reject = (): never => {
        throw new RuntimeError(
          'operator_entry_investigation_unverified',
          'The operator calibration and later inventory do not meet the dedicated investigation contract.',
        );
      };
      const object = (value: unknown): Record<string, unknown> => {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.getPrototypeOf(value) !== Object.prototype
        )
          return reject();
        return value as Record<string, unknown>;
      };
      const exact = (value: Record<string, unknown>, keys: string[]) => {
        if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) reject();
      };
      const time = (value: unknown): number => {
        if (
          typeof value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        )
          return reject();
        const parsed = Date.parse(value);
        if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return reject();
        return parsed;
      };
      const ids = (value: unknown): string[] => {
        if (
          !Array.isArray(value) ||
          value.some((id) => typeof id !== 'string' || !/^\d{10,22}$/.test(id)) ||
          new Set(value).size !== value.length
        )
          return reject();
        return value as string[];
      };
      const equalSet = (a: string[], b: string[]) =>
        canonicalJson([...a].sort()) === canonicalJson([...b].sort());
      const original = deps.getJob(originalId),
        readJob = deps.getJob(readJobId);
      if (
        !original ||
        original.kind !== 'write' ||
        original.operation !== 'operator_short_draft_bootstrap_calibration_v2' ||
        original.scope !== 'operator_short_calibration' ||
        original.status !== 'uncertain' ||
        original.target !== null ||
        original.error?.code !== 'outcome_unknown' ||
        original.datasets.length !== 0 ||
        !original.platformWriteStartedAt ||
        !original.platformReadStartedAt ||
        !original.endedAt
      )
        return reject();
      const originalEnd = time(original.endedAt),
        originalWrite = time(original.platformWriteStartedAt);
      if (!(
        time(original.requestedAt) <= time(original.startedAt) &&
        time(original.startedAt) <= time(original.platformReadStartedAt) &&
        time(original.platformReadStartedAt) <= originalWrite &&
        originalWrite <= originalEnd
      ))
        return reject();
      const originalRefs = deps.listEvidence(originalId);
      if (
        originalRefs.length !== 2 ||
        originalRefs.some(
          (ref) => ref.accountId !== original.accountId || ref.jobId !== originalId,
        ) ||
        canonicalJson(object(original.result).evidence) !== canonicalJson(originalRefs)
      )
        return reject();
      const intentRef = originalRefs.find((ref) => ref.dataset === 'write-intent'),
        baselineRef = originalRefs.find(
          (ref) => ref.dataset === 'operator_short_incomplete_calibration',
        );
      if (!intentRef || !baselineRef) return reject();
      const intentDoc = deps.readEvidence(intentRef),
        baselineDoc = deps.readEvidence(baselineRef);
      if (
        intentDoc.collectionMode !== 'live' ||
        intentDoc.evidenceKind !== 'local-intent' ||
        baselineDoc.collectionMode !== 'live' ||
        baselineDoc.evidenceKind !== 'observation' ||
        time(intentRef.capturedAt) < time(original.platformReadStartedAt) ||
        time(intentRef.capturedAt) > originalWrite ||
        time(baselineRef.capturedAt) < originalWrite ||
        time(baselineRef.capturedAt) > originalEnd
      )
        return reject();
      const intent = object(intentDoc.payload);
      exact(intent, [
        'schema',
        'action',
        'selectedTitleHash',
        'expectedOwnerType',
        'publicationPermitted',
        'fillPermitted',
      ]);
      if (
        intent.schema !== 'operator-short-bootstrap/v1' ||
        intent.action !== 'one_observed_native_new_entry' ||
        typeof intent.selectedTitleHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(intent.selectedTitleHash) ||
        !['account', 'author'].includes(String(intent.expectedOwnerType)) ||
        intent.publicationPermitted !== false ||
        intent.fillPermitted !== false
      )
        return reject();
      const expectedInput = hash(
        canonicalJson({
          schema: 'operator-short-bootstrap/v1',
          titleHash: intent.selectedTitleHash,
          actions: 'draft-box-read_then_existing-or-one-new-entry',
        }),
      );
      if (
        original.inputHash !== expectedInput ||
        original.idempotencyKey !== 'operator-short-bootstrap-v2-' + intent.selectedTitleHash
      )
        return reject();
      const baseline = object(baselineDoc.payload),
        apiPath = '/api/author/short_article/draft_list/v0/';
      if (
        baseline.schema !== 'operator-short-bootstrap-calibration/v2' ||
        baseline.scope !== 'operator_incomplete_calibration' ||
        baseline.target !== null ||
        baseline.state !== 'unknown' ||
        baseline.profileReady !== false ||
        baseline.mcpCreatePassed !== false ||
        baseline.mcpSavePassed !== false ||
        baseline.draftBoxClickAttempts !== 1 ||
        baseline.newEntryClickAttempts !== 1 ||
        baseline.explicitFillCalls !== 0 ||
        baseline.explicitAgreementCalls !== 0 ||
        baseline.explicitSubmitCalls !== 0 ||
        !Array.isArray(baseline.getSamples)
      )
        return reject();
      // Only the old observer's actual ID fields are used; its total/query values were not recorded.
      const samples = baseline.getSamples.map(object).filter((sample) => sample.path === apiPath);
      if (samples.length !== 1 || samples[0]!.status !== 200 || !Array.isArray(samples[0]!.fields))
        return reject();
      const fields = (samples[0]!.fields as unknown[]).map(object);
      const codes = fields.filter((field) => field.path === '$.code');
      if (codes.length !== 1 || codes[0]!.type !== 'number' || codes[0]!.value !== 0)
        return reject();
      const idFields = fields.filter(
        (field) =>
          typeof field.path === 'string' &&
          /^\$\.data\.item_list\[\d+\]\.item_id$/.test(field.path),
      );
      if (
        idFields.length === 0 ||
        idFields.some(
          (field, index) =>
            field.path !== `$.data.item_list[${index}].item_id` || field.type !== 'string',
        )
      )
        return reject();
      const baselineIds = ids(idFields.map((field) => field.value));
      if (
        !readJob ||
        readJob.kind !== 'read' ||
        readJob.operation !== 'operator_short_entry_investigation' ||
        readJob.scope !== 'operator_short_entry_investigation' ||
        canonicalJson(readJob.datasets) !== canonicalJson(['operator_entry_investigation']) ||
        readJob.status !== 'succeeded' ||
        readJob.error !== null ||
        readJob.accountId !== original.accountId ||
        readJob.target !== null ||
        readJob.platformWriteStartedAt !== null ||
        !readJob.platformReadStartedAt ||
        !readJob.endedAt ||
        readJob.cancellationRequestedAt !== null
      )
        return reject();
      const readStart = time(readJob.platformReadStartedAt),
        readEnd = time(readJob.endedAt);
      if (!(
        originalEnd < time(readJob.requestedAt) &&
        time(readJob.requestedAt) <= time(readJob.startedAt) &&
        time(readJob.startedAt) <= readStart &&
        readStart <= readEnd
      ))
        return reject();
      const refs = deps.listEvidence(readJobId);
      if (refs.length !== 1 || refs[0]!.dataset !== 'operator_entry_investigation') return reject();
      const ref = refs[0]!,
        doc = deps.readEvidence(ref),
        payload = object(doc.payload);
      const durable = deps
        .prepare('SELECT manifest_json FROM manifests WHERE job_id = ?')
        .all(readJobId);
      if (durable.length !== 1) return reject();
      const manifest = JSON.parse(String(durable[0]!.manifest_json)) as Manifest;
      if (
        canonicalJson(object(readJob.result).manifest) !== canonicalJson(manifest) ||
        manifest.schemaVersion !== 1 ||
        manifest.accountId !== readJob.accountId ||
        manifest.jobId !== readJob.id ||
        manifest.operation !== readJob.operation ||
        manifest.scope !== readJob.scope ||
        canonicalJson(manifest.datasets) !== canonicalJson(readJob.datasets) ||
        manifest.requestedAt !== readJob.requestedAt ||
        manifest.platformReadStartedAt !== readJob.platformReadStartedAt ||
        manifest.committedAt !== readJob.endedAt ||
        canonicalJson(manifest.evidence) !== canonicalJson(refs)
      )
        return reject();
      if (
        doc.collectionMode !== 'live' ||
        doc.evidenceKind !== 'observation' ||
        ref.accountId !== original.accountId ||
        ref.jobId !== readJobId ||
        payload.schema !== 'operator-short-entry-investigation/v1' ||
        payload.originalJobId !== originalId ||
        payload.originalInputHash !== original.inputHash ||
        canonicalJson(payload.originalBaselineRef) !== canonicalJson(baselineRef) ||
        canonicalJson(payload.source) !==
          canonicalJson({ mode: 'live', origin: 'https://fanqienovel.com' }) ||
        payload.sourceUrl !== 'https://fanqienovel.com/main/writer/short-draft' ||
        payload.apiPath !== apiPath ||
        payload.nativeGetOnly !== true ||
        payload.httpStatus !== 200 ||
        payload.code !== 0 ||
        payload.ownAccountMatched !== true ||
        payload.editorEntryAttempts !== 0 ||
        payload.explicitFillCalls !== 0 ||
        payload.explicitSaveCalls !== 0 ||
        !Array.isArray(payload.records)
      )
        return reject();
      const ownerBefore = time(payload.ownerBefore),
        ownerAfter = time(payload.ownerAfter),
        observed = time(payload.observedAt),
        capture = time(ref.capturedAt);
      if (!(
        readStart <= ownerBefore &&
        ownerBefore <= ownerAfter &&
        ownerAfter <= observed &&
        observed <= capture &&
        capture <= readEnd
      ))
        return reject();
      const records = payload.records.map(object);
      for (const record of records) {
        exact(record, ['itemId', 'titles', 'wordNumber', 'createTime', 'modifyTime']);
        if (
          !Array.isArray(record.titles) ||
          record.titles.some((title) => typeof title !== 'string') ||
          !Number.isSafeInteger(record.wordNumber) ||
          Number(record.wordNumber) < 0 ||
          typeof record.createTime !== 'string' ||
          typeof record.modifyTime !== 'string'
        )
          return reject();
      }
      const currentIds = ids(records.map((record) => record.itemId));
      if (
        payload.pageIndex !== 0 ||
        !Number.isSafeInteger(payload.pageCount) ||
        Number(payload.pageCount) < 1 ||
        !Number.isSafeInteger(payload.currentTotal) ||
        Number(payload.currentTotal) < 0 ||
        Number(payload.pageCount) < Number(payload.currentTotal) ||
        payload.currentTotal !== records.length ||
        payload.complete !== true ||
        !equalSet(ids(payload.beforeObservedIds), baselineIds) ||
        !equalSet(currentIds, baselineIds) ||
        !Array.isArray(payload.newIds) ||
        payload.newIds.length !== 0 ||
        payload.beforeObservedIdsStillPresent !== true
      )
        return reject();
      deps.assertOwnership();
      const now = timestamp();
      const result = {
        calibrationOnly: true,
        mcpCreateVerified: false,
        mcpSaveVerified: false,
        target: null,
        observedStatus: 'investigated_no_additional_draft',
        reconciliationJobId: readJobId,
        evidence: ref,
        writeIntent: intentRef,
        baselineEvidence: baselineRef,
        priorResult: original.result,
        priorError: original.error,
        originalEndedAt: original.endedAt,
        observedAt: payload.observedAt,
        currentTotal: records.length,
        baselineObservedIdCount: baselineIds.length,
        historicalTransientSideEffectsVerifiedAbsent: false,
      };
      deps
        .prepare(
          'INSERT INTO write_reconciliations(id, original_job_id, read_job_id, evidence_id, status, created_at, result_json) VALUES(?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), originalId, readJobId, ref.id, 'failed', now, canonicalJson(result));
      const error: RuntimeFailure = {
        code: 'investigated_no_additional_draft',
        message:
          'The later complete inventory contains exactly the previously observed draft IDs. This operator calibration is closed without verifying an MCP create/save or excluding earlier transient effects.',
      };
      deps
        .prepare(
          'UPDATE jobs SET status = ?, result_json = ?, error_json = ?, ended_at = ?, updated_at = ? WHERE id = ?',
        )
        .run('failed', canonicalJson(result), canonicalJson(error), now, now, originalId);
      return deps.getJob(originalId)!;
    });
  }
  return resolveOperatorEntryInvestigation;
}
