import {
  type NativeShortCompensationSourceContext,
  ownData,
  type NativeShortCompensationHistoryFrame,
  COMPENSATED_ERROR,
} from './project-native-short-closure.js';

import {
  object,
  reject,
  exact,
  copyBoundedNativeJson,
  UUID,
  ordered,
  equal,
  time,
} from './reject.js';

import {
  createNativeShortOriginalAudit,
  validateNativeShortClosureShape,
} from './create-native-short-original-audit.js';

import { canonicalJson, type Job } from '../../runtime/store.js';

import { validateNativeShortReconciliationContext } from './validate-native-short-reconciliation-context.js';

import { validateNativeShortOriginalAudit } from './safe-native-short-write-job.js';

import { digest } from './validate-native-short-evidence-context.js';

export function compensationHistory(source: NativeShortCompensationSourceContext) {
  ownData(source.history, ['first', 'current', 'previous']);
  const { first, current, previous } = source.history;
  const original = source.original.job;
  const terminal =
    object(original.result ?? {}).schema === 'native-short-metadata-compensated-closure/v1';
  if (!first || !current) {
    if (first !== null || current !== null || previous !== null || terminal) reject();
    const audit = createNativeShortOriginalAudit(original, source.original.refs);
    return { initial: audit, prior: audit, priorJob: original, terminal: false };
  }
  function row(frame: NativeShortCompensationHistoryFrame, allowCompensated: boolean) {
    ownData(frame, ['row', 'read']);
    const value = exact(copyBoundedNativeJson(frame.row, 128 * 1024, 8192, 24), [
      'id',
      'sequence',
      'originalJobId',
      'readJobId',
      'evidenceId',
      'status',
      'createdAt',
      'resultJson',
    ]);
    if (
      !UUID.test(String(value.id)) ||
      !Number.isSafeInteger(value.sequence) ||
      (value.sequence as number) < 1 ||
      value.originalJobId !== original.id ||
      value.readJobId !== frame.read.job.id ||
      value.evidenceId !== frame.read.ref.id ||
      typeof value.resultJson !== 'string' ||
      Buffer.byteLength(value.resultJson) > 64 * 1024
    )
      reject();
    const result = object(copyBoundedNativeJson(JSON.parse(value.resultJson), 64 * 1024, 8192, 24));
    if (
      canonicalJson(result) !== value.resultJson ||
      !['uncertain', 'failed'].includes(String(value.status))
    )
      reject();
    ordered([frame.read.manifest.committedAt, value.createdAt]);
    if (result.schema === 'native-short-metadata-compensated-closure/v1') {
      if (!allowCompensated || value.status !== 'failed') reject();
    } else {
      const closure = validateNativeShortClosureShape(result);
      if (
        value.status !== 'uncertain' ||
        closure.observedStatus !== 'unknown' ||
        !equal(closure.evidence, frame.read.ref)
      )
        reject();
      const historic: Job = {
        ...original,
        status: 'uncertain',
        result: closure,
        error: closure.originalAudit.priorError,
        endedAt: value.createdAt as string,
        updatedAt: value.createdAt as string,
      };
      const verified = validateNativeShortReconciliationContext({
        accountId: source.accountId,
        originalJob: historic,
        originalRefs: source.original.refs,
        originalDocuments: source.original.documents,
        readJob: frame.read.job,
        manifest: frame.read.manifest,
        ref: frame.read.ref,
        document: frame.read.document,
      });
      if (verified.status !== 'uncertain' || !equal(verified.result, closure.result)) reject();
    }
    return { row: value, result };
  }
  if (terminal && first.row.sequence === current.row.sequence) {
    const checked = row(current, true),
      closure = exact(checked.result, [
        'schema',
        'target',
        'reconciliationJobId',
        'evidence',
        'observedStatus',
        'result',
        'originalAudit',
        'originalAttemptEvidence',
      ]);
    const audit = object(closure.originalAudit);
    if (
      !equal(first, current) ||
      previous !== null ||
      closure.originalAttemptEvidence !== null ||
      audit.originalAttemptEvidence !== null ||
      audit.previousClosure !== null ||
      audit.originalEndedAt !== audit.priorEndedAt ||
      !equal(original.result, closure) ||
      original.status !== 'failed' ||
      original.endedAt !== current.row.createdAt ||
      original.updatedAt !== current.row.createdAt ||
      !equal(original.error, COMPENSATED_ERROR)
    )
      reject();
    const priorJob: Job = {
      ...original,
      status: 'uncertain',
      result: { evidence: source.original.refs },
      error: audit.priorError as Job['error'],
      endedAt: time(audit.originalEndedAt),
      updatedAt: time(audit.originalEndedAt),
    };
    const initial = createNativeShortOriginalAudit(priorJob, source.original.refs);
    return { initial, prior: initial, priorJob, terminal: true };
  }
  const firstChecked = row(first, false),
    currentChecked = row(current, terminal);
  const initial = validateNativeShortOriginalAudit(firstChecked.result.originalAudit);
  if (initial.phase !== 'initial') reject();
  const pointer = {
    readJobId: first.read.job.id,
    evidenceId: first.read.ref.id,
    evidenceHash: first.read.ref.sha256,
  };
  if (!equal(firstChecked.result.originalAttemptEvidence, pointer)) reject();
  if (
    first.row.sequence > current.row.sequence ||
    !equal(original.result, currentChecked.result) ||
    original.endedAt !== current.row.createdAt ||
    original.updatedAt !== current.row.createdAt ||
    original.status !== current.row.status
  )
    reject();
  if (current.row.sequence === first.row.sequence) {
    if (!equal(first, current) || previous !== null || terminal) reject();
  } else {
    if (
      !previous ||
      previous.row.sequence >= current.row.sequence ||
      previous.row.sequence < first.row.sequence
    )
      reject();
    const checked = row(previous, false);
    if (!terminal) {
      const audit = validateNativeShortOriginalAudit(currentChecked.result.originalAudit);
      if (
        audit.phase !== 'continuation' ||
        !equal(audit.originalAttemptEvidence, pointer) ||
        !equal(audit.previousClosure, {
          reconciliationJobId: previous.read.job.id,
          evidenceId: previous.read.ref.id,
          evidenceHash: previous.read.ref.sha256,
          resultHash: digest(checked.result),
          settledAt: previous.row.createdAt,
        })
      )
        reject();
    }
  }
  if (!terminal) {
    const closure = validateNativeShortClosureShape(currentChecked.result);
    if (
      !equal(closure.originalAttemptEvidence, pointer) ||
      original.error?.code !== 'outcome_unknown'
    )
      reject();
    const prior = createNativeShortOriginalAudit(original, source.original.refs, {
      firstAudit: initial,
      previousClosure: closure,
    });
    return { initial, prior, priorJob: original, terminal: false };
  }
  exact(currentChecked.result, [
    'schema',
    'target',
    'reconciliationJobId',
    'evidence',
    'observedStatus',
    'result',
    'originalAudit',
    'originalAttemptEvidence',
  ]);
  if (
    !previous ||
    original.status !== 'failed' ||
    !equal(original.error, COMPENSATED_ERROR) ||
    currentChecked.result.observedStatus !== 'compensated' ||
    currentChecked.result.reconciliationJobId !== current.read.job.id ||
    !equal(currentChecked.result.evidence, current.read.ref) ||
    !equal(currentChecked.result.originalAttemptEvidence, pointer)
  )
    reject();
  const previousClosure = validateNativeShortClosureShape(JSON.parse(previous.row.resultJson));
  const priorJob: Job = {
    ...original,
    status: 'uncertain',
    result: previousClosure,
    error: {
      code: 'outcome_unknown',
      message: 'The later platform read still cannot determine the write outcome.',
    },
    endedAt: previous.row.createdAt,
    updatedAt: previous.row.createdAt,
  };
  const prior = createNativeShortOriginalAudit(priorJob, source.original.refs, {
    firstAudit: initial,
    previousClosure,
  });
  return { initial, prior, priorJob, terminal: true };
}
