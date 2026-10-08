import {
  type NativeShortCompensationAuthority,
  type NativeShortCompensationSourceContext,
  OPERATOR_BASIS,
  OPERATOR_POLICY_SHA,
  OPERATOR_ACTOR_SHA,
  OPERATOR_CONTROLLER_SHA,
} from './project-native-short-closure.js';

import { type NativeShortOriginalAudit } from './safe-native-short-write-job.js';

import {
  type StoredSnapshot,
  exact,
  copyBoundedNativeJson,
  equal,
  reject,
  HASH,
  object,
  type Data,
  time,
  ordered,
} from './reject.js';

import { digestBytes } from './validate-native-short-reconciliation-context.js';

import { summaryRef } from './compensation-read.js';

import { rejectAdditionalNativeSignals } from './validate-api-result-core.js';

export function validateCompensationAuthority(
  authorityValue: NativeShortCompensationAuthority,
  source: NativeShortCompensationSourceContext,
  original: NativeShortOriginalAudit,
  operatorSnapshot: StoredSnapshot,
) {
  const authority = exact(copyBoundedNativeJson(authorityValue, 64 * 1024, 12000, 24), [
    'policy',
    'source',
    'actor',
    'controller',
    'receipts',
  ]);
  if (
    !equal(exact(authority.policy, ['basis', 'sha256']), {
      basis: OPERATOR_BASIS,
      sha256: OPERATOR_POLICY_SHA,
    }) ||
    !equal(exact(authority.actor, ['sha256']), { sha256: OPERATOR_ACTOR_SHA }) ||
    !equal(exact(authority.controller, ['sha256']), { sha256: OPERATOR_CONTROLLER_SHA })
  )
    reject();
  const inventory = exact(authority.source, [
    'executionManifestSha256',
    'executionInventory',
    'registrationManifestSha256',
    'registrationInventory',
  ]);
  for (const name of ['executionManifestSha256', 'registrationManifestSha256'])
    if (!HASH.test(String(inventory[name]))) reject();
  for (const name of ['executionInventory', 'registrationInventory']) {
    const entries = Object.entries(object(inventory[name]));
    if (
      entries.length !== 35 ||
      entries.some(
        ([key, hash]) =>
          !/^(src|test)\/[a-z0-9/.-]+\.ts$/.test(key) ||
          key.includes('..') ||
          !HASH.test(String(hash)),
      ) ||
      !equal(
        entries.map(([key]) => key).sort(),
        Object.keys(object(inventory.executionInventory)).sort(),
      )
    )
      reject();
  }
  const receipts = exact(authority.receipts, ['actor', 'controller']);
  function receipt(name: string): Data {
    const descriptor = exact(receipts[name], ['sha256', 'bytes']);
    if (
      typeof descriptor.bytes !== 'string' ||
      !HASH.test(String(descriptor.sha256)) ||
      digestBytes(descriptor.bytes) !== descriptor.sha256
    )
      reject();
    try {
      return object(copyBoundedNativeJson(JSON.parse(descriptor.bytes), 32 * 1024, 8192, 24));
    } catch {
      return reject();
    }
  }
  const actor = receipt('actor'),
    controller = receipt('controller');
  if (
    actor.schema !== 'fanqie-c3-operator-title-restoration-safe/v1' ||
    controller.schema !== 'fanqie-c3-operator-title-restoration-controller-safe/v1' ||
    actor.operatorJobId !== source.operator.job.id ||
    actor.runId !== source.operator.job.metadata.runId ||
    controller.runId !== actor.runId ||
    !equal(controller.operatorSafe, actor) ||
    object(controller.operatorOutputSafe).sha256 !== object(receipts.actor).sha256 ||
    object(object(controller.approvedInputs).sourceManifest).sha256 !==
      inventory.executionManifestSha256
  )
    reject();
  for (const name of [
    'pass',
    'operatorExecuted',
    'originalUnknownUnchanged',
    'originalTitleRestored',
    'loginWarmAuthenticatedOwnerMatched',
    'nonServerRawPreserved',
    'revisionDeltaExactlyOne',
    'opaqueServerTokenNondecreasing',
    'queueDrained',
    'browserClosed',
    'storeClosed',
  ])
    if (actor[name] !== true) reject();
  if (
    actor.postAttempts !== 1 ||
    actor.acknowledged !== true ||
    actor.nativeV1VerificationPassed !== false ||
    actor.serverTokenUnitTimezoneClaimed !== false ||
    actor.privateValueOutput !== false ||
    actor.fullF05Verified !== false ||
    actor.overallGoalComplete !== false
  )
    reject();
  for (const name of [
    'pass',
    'operatorExecuted',
    'originalUnknownUnchanged',
    'protectedSevenUnchanged',
    'writesDisabledAfter',
    'oldNativeV1RunStillFailed',
    'sameImagePriorSourceDistESMProofReusedAfterCurrentObservation',
    'operatorRestorationObserved',
    'operatorStoppedVerified',
  ])
    if (controller[name] !== true) reject();
  if (
    controller.remainingMaximumPostAttempts !== 1 ||
    controller.productionSourceChanged !== false ||
    controller.controllerPlatformToolCalls !== 0 ||
    controller.tokenInRAMOnly !== true ||
    controller.privateValueOutput !== false ||
    controller.fullF05Verified !== false ||
    controller.overallGoalComplete !== false ||
    controller.errorCode !== null ||
    controller.phase !== 'finally-restore-false'
  )
    reject();
  if (
    !equal(controller.checkpointEvents, actor.events) ||
    !equal(actor.afterEvidence, summaryRef(source.operator.refs[3]!))
  )
    reject();
  const phases = [
    'saved-context-validated',
    'login-warm-start',
    'login-warm-complete',
    'fresh-before-start',
    'fresh-before-complete',
    'restore-job-start',
    'durable-before-mark',
    'restore-marked',
    'native-v1-mismatch-clean',
    'operator-restoration-observed',
    'operator-job-settled',
  ];
  if (!Array.isArray(actor.events) || actor.events.length !== phases.length) reject();
  const events = actor.events.map((event, index) => {
    const value = object(event);
    if (value.phase !== phases[index]) reject();
    time(value.checkedAt);
    return value;
  });
  ordered(events.map((event) => event.checkedAt));
  const refs = source.operator.refs;
  if (
    events[0]!.originalJobId !== original.originalJobId ||
    !equal(events[0]!.baselineEvidence, summaryRef(source.original.refs[0]!)) ||
    (source.history.current &&
      events[0]!.laterReadJobId !==
        (source.history.current.row.status === 'failed'
          ? source.history.previous?.read.job.id
          : source.history.current.read.job.id)) ||
    events[3]!.jobId !== source.operatorBefore.job.id ||
    events[4]!.jobId !== source.operatorBefore.job.id ||
    !equal(events[4]!.ref, summaryRef(source.operatorBefore.ref)) ||
    events[5]!.jobId !== source.operator.job.id ||
    !equal(events[6]!.baseline, summaryRef(refs[0]!)) ||
    !equal(events[6]!.intent, summaryRef(refs[1]!)) ||
    events[7]!.markedAt !== source.operator.job.platformWriteStartedAt ||
    !equal(events[8]!.ref, summaryRef(refs[2]!)) ||
    !equal(events[9]!.afterEvidence, summaryRef(refs[3]!)) ||
    events[10]!.status !== 'succeeded'
  )
    reject();
  for (const index of [5, 6, 7, 8, 9, 10])
    if (events[index]!.jobId !== source.operator.job.id) reject();
  if (
    !equal(events[4]!.snapshotHashes, {
      snapshotVersionHash: operatorSnapshot.snapshotVersionHash,
      catalogHash: operatorSnapshot.catalogHash,
      documentHash: operatorSnapshot.documentHash,
      savedFieldsHash: operatorSnapshot.savedFieldsHash,
      categorySelectionHash: operatorSnapshot.categorySelectionHash,
    }) ||
    actor.loginWarmCheckedAt !== events[2]!.checkedAt
  )
    reject();
  ordered([
    original.priorEndedAt,
    controller.admittedAt,
    events[0]!.checkedAt,
    events[2]!.checkedAt,
    source.operatorBefore.job.requestedAt,
    events[4]!.checkedAt,
    source.operator.job.requestedAt,
    refs[0]!.capturedAt,
    refs[1]!.capturedAt,
    events[6]!.checkedAt,
    source.operator.job.platformWriteStartedAt,
    events[7]!.checkedAt,
    refs[2]!.capturedAt,
    events[8]!.checkedAt,
    refs[3]!.capturedAt,
    events[9]!.checkedAt,
    source.operator.job.endedAt,
    events[10]!.checkedAt,
    actor.completedAt,
    controller.completedAt,
  ]);
  rejectAdditionalNativeSignals(actor, new Map());
  rejectAdditionalNativeSignals(controller, new Map());
  return { authority: authority as unknown as NativeShortCompensationAuthority, actor, controller };
}
