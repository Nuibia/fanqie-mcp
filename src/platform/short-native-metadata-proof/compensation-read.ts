import {
  type NativeShortCompensationReadFrame,
  ownData,
  compensationDocument,
} from './project-native-short-closure.js';

import { type Job, type EvidenceRef } from '../../runtime/store.js';

import {
  type Data,
  object,
  copyBoundedNativeJson,
  exact,
  equal,
  UUID,
  reject,
  ordered,
  type StoredSnapshot,
} from './reject.js';

import { rejectAdditionalNativeSignals } from './validate-api-result-core.js';

export function compensationRead(
  frame: NativeShortCompensationReadFrame,
  operation: string,
  scope: string,
  dataset: string,
  inputHash: string,
  target: Job['target'],
): Data {
  ownData(frame, ['job', 'manifest', 'ref', 'document']);
  const job = object(copyBoundedNativeJson(frame.job, 128 * 1024, 8192, 24)) as unknown as Job,
    manifest = exact(copyBoundedNativeJson(frame.manifest, 64 * 1024, 4096, 20), [
      'schemaVersion',
      'id',
      'accountId',
      'jobId',
      'operation',
      'scope',
      'datasets',
      'requestedAt',
      'platformReadStartedAt',
      'committedAt',
      'evidence',
    ]);
  if (
    job.kind !== 'read' ||
    job.status !== 'succeeded' ||
    job.operation !== operation ||
    job.scope !== scope ||
    !equal(job.datasets, [dataset]) ||
    job.inputHash !== inputHash ||
    job.platformWriteStartedAt !== null ||
    job.error !== null ||
    job.cancellationRequestedAt !== null ||
    job.cancellationReason !== null ||
    job.idempotencyKey !== null ||
    !equal(job.target, target) ||
    job.updatedAt !== job.endedAt ||
    !UUID.test(job.id)
  )
    reject();
  ordered([job.requestedAt, job.startedAt, job.platformReadStartedAt, job.endedAt]);
  if (
    manifest.schemaVersion !== 1 ||
    !UUID.test(String(manifest.id)) ||
    manifest.accountId !== job.accountId ||
    manifest.jobId !== job.id ||
    manifest.operation !== operation ||
    manifest.scope !== scope ||
    !equal(manifest.datasets, job.datasets) ||
    manifest.requestedAt !== job.requestedAt ||
    manifest.platformReadStartedAt !== job.platformReadStartedAt ||
    manifest.committedAt !== job.endedAt ||
    !equal(manifest.evidence, [frame.ref]) ||
    !equal(job.result, { manifest })
  )
    reject();
  const allowed = new Map<string, unknown>();
  if (operation === 'operator_short_native_title_restore_before_v1') {
    const metadata = exact(job.metadata, ['schema', 'runId']);
    if (
      metadata.schema !== 'native-short-metadata-operator-read/v1' ||
      !UUID.test(String(metadata.runId))
    )
      reject();
    allowed.set(JSON.stringify(['job', 'metadata', 'schema']), metadata.schema);
  }
  rejectAdditionalNativeSignals({ job, manifest, ref: frame.ref }, allowed);
  return compensationDocument(frame.ref, frame.document, job, dataset);
}

function serverPair(snapshot: StoredSnapshot) {
  const latest = snapshot.editData.latest_version,
    modify = snapshot.editData.modify_time;
  if (
    !Number.isSafeInteger(latest) ||
    Object.is(latest, -0) ||
    (latest as number) < 0 ||
    typeof modify !== 'string' ||
    modify.length !== 10 ||
    !/^[0-9]{10}$/.test(modify)
  )
    reject();
  return { latest: latest as number, modify };
}

export function nonServerSnapshot(snapshot: StoredSnapshot, maskTitle: boolean) {
  const edit = { ...snapshot.editData };
  delete edit.latest_version;
  delete edit.modify_time;
  if (maskTitle) edit.multi_title = [null, ...snapshot.savedFields.multi_title.slice(1)];
  return { binding: snapshot.binding, editData: edit, categoryData: snapshot.categoryData };
}

function operatorRevision(before: StoredSnapshot, after: StoredSnapshot) {
  const a = serverPair(before),
    b = serverPair(after);
  if (
    a.latest >= Number.MAX_SAFE_INTEGER ||
    b.latest !== a.latest + 1 ||
    BigInt(b.modify) < BigInt(a.modify) ||
    before.snapshotVersionHash === after.snapshotVersionHash
  )
    reject();
}

export function summaryRef(ref: EvidenceRef) {
  return { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt };
}

export function assertOperatorSnapshot(
  original: StoredSnapshot,
  before: StoredSnapshot,
  after: StoredSnapshot,
) {
  if (
    original.state !== 'draft' ||
    before.state !== 'draft' ||
    after.state !== 'draft' ||
    !equal(nonServerSnapshot(original, true), nonServerSnapshot(before, true)) ||
    !equal(nonServerSnapshot(original, false), nonServerSnapshot(after, false)) ||
    before.savedFields.multi_title[0] === original.savedFields.multi_title[0] ||
    !before.savedFields.multi_title[0]!.startsWith(original.savedFields.multi_title[0]!)
  )
    reject();
  operatorRevision(original, before);
  operatorRevision(before, after);
}
