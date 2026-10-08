import {
  type GenericGraphNode,
  type RuntimeFailure,
  writeTaskTime,
  GENERIC_SHORT_STATUS_PROTOCOL,
  type PlatformTarget,
  type CapturedGenericShortGraph,
} from '../runtime-error.js';
import {
  type GenericCreationPriorOperation,
  type GenericCreationPriorViewOperation,
  type GenericCreationEnvelopeInGraphOperation,
  type GenericCreationUnknownOperation,
  type GenericCreationResumeClaimOperation,
  type GenericCreationAncestorOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';

import {
  genericUnavailable,
  genericObject,
  genericSame,
} from '../has-generic-short-status-signal.js';

import { genericBindings } from '../native-closure-signal.js';
import { type GenericQualifyWriteOperation } from '../contracts/generic-status-generic-refs.js';

interface GenericCreationPriorDependencies {}

export function createGenericCreationPrior(
  deps: GenericCreationPriorDependencies,
): GenericCreationPriorOperation {
  function genericCreationPrior(
    node: GenericGraphNode,
    kind: 'original' | 'recovery' | 'repair',
  ): Record<string, unknown> {
    const { job } = node;
    return {
      ...(kind === 'repair' ? { id: job.id } : {}),
      status: job.status,
      error: job.error,
      result: job.result,
      target: job.target,
      endedAt: job.endedAt,
      ...(kind === 'original'
        ? { intentRefs: node.refs }
        : { evidence: node.refs, metadata: job.metadata }),
    };
  }
  return genericCreationPrior;
}

interface GenericCreationPriorViewDependencies {}

export function createGenericCreationPriorView(
  deps: GenericCreationPriorViewDependencies,
): GenericCreationPriorViewOperation {
  function genericCreationPriorView(
    node: GenericGraphNode,
    input: unknown,
    kind: 'original' | 'recovery' | 'repair',
  ): GenericGraphNode {
    const prior = genericObject(
      input,
      kind === 'original'
        ? ['status', 'error', 'result', 'target', 'endedAt', 'intentRefs']
        : kind === 'recovery'
          ? ['status', 'error', 'result', 'target', 'endedAt', 'evidence', 'metadata']
          : ['id', 'status', 'error', 'result', 'target', 'endedAt', 'evidence', 'metadata'],
    );
    if (
      prior.status !== 'uncertain' ||
      !writeTaskTime(prior.endedAt) ||
      !genericSame(prior.target, node.job.target) ||
      !genericSame(kind === 'original' ? prior.intentRefs : prior.evidence, node.refs) ||
      (kind !== 'original' && !genericSame(prior.metadata, node.job.metadata)) ||
      (kind === 'repair' && prior.id !== node.job.id)
    )
      return genericUnavailable();
    return {
      ...node,
      job: {
        ...node.job,
        status: 'uncertain',
        error: prior.error as RuntimeFailure,
        result: prior.result,
        endedAt: prior.endedAt,
        updatedAt: prior.endedAt,
      },
    };
  }
  return genericCreationPriorView;
}

interface GenericCreationEnvelopeInGraphDependencies {}

export function createGenericCreationEnvelopeInGraph(
  deps: GenericCreationEnvelopeInGraphDependencies,
): GenericCreationEnvelopeInGraphOperation {
  function genericCreationEnvelopeInGraph(
    node: GenericGraphNode,
    input: unknown,
    keys: string[],
  ): Record<string, unknown> {
    const modern = Object.hasOwn(genericObject(node.job.metadata), 'genericShortStatus'),
      value = genericObject(input, [...keys, ...(modern ? ['statusProtocol'] : [])]);
    if (modern && value.statusProtocol !== GENERIC_SHORT_STATUS_PROTOCOL)
      return genericUnavailable();
    return value;
  }
  return genericCreationEnvelopeInGraph;
}

interface GenericCreationUnknownDependencies {}

export function createGenericCreationUnknown(
  deps: GenericCreationUnknownDependencies,
): GenericCreationUnknownOperation {
  function genericCreationUnknown(
    node: GenericGraphNode,
    target: PlatformTarget,
    previousEndedAt?: string,
  ): void {
    const job = node.job;
    if (
      job.kind !== 'write' ||
      job.status !== 'uncertain' ||
      job.error?.code !== 'outcome_unknown' ||
      job.scope !== 'account' ||
      job.datasets.length ||
      !job.startedAt ||
      !job.platformReadStartedAt ||
      !job.platformWriteStartedAt ||
      !job.endedAt ||
      !genericSame(job.target, target) ||
      (previousEndedAt !== undefined && previousEndedAt > job.requestedAt)
    )
      return genericUnavailable();
    if (!(
      job.requestedAt <= job.startedAt &&
      job.startedAt <= job.platformReadStartedAt &&
      job.platformReadStartedAt <= job.platformWriteStartedAt &&
      job.platformWriteStartedAt <= job.endedAt
    ))
      return genericUnavailable();
  }
  return genericCreationUnknown;
}

interface GenericCreationResumeClaimDependencies {
  genericCreationUnknown: GenericCreationUnknownOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericCreationPrior: GenericCreationPriorOperation;
  genericCreationEnvelopeInGraph: GenericCreationEnvelopeInGraphOperation;
}

export function createGenericCreationResumeClaim(
  deps: GenericCreationResumeClaimDependencies,
): GenericCreationResumeClaimOperation {
  function genericCreationResumeClaim(
    root: GenericGraphNode,
    recovery: GenericGraphNode,
    graph: CapturedGenericShortGraph,
  ): Record<string, unknown> {
    const target = root.job.target;
    if (!target || target.kind !== 'short-story' || !/^\d{10,22}$/.test(target.id))
      return genericUnavailable();
    genericObject(target, ['kind', 'id']);
    deps.genericCreationUnknown(root, target);
    deps.genericQualifyWrite(root, graph);
    const relation = genericObject(root.relations.recovery),
      bindings = genericObject(
        JSON.parse(String(relation.bindings_json)),
        genericBindings.resume_create_draft,
      );
    if (
      relation.original_job_id !== root.job.id ||
      relation.resume_job_id !== recovery.job.id ||
      root.job.operation !== 'create_draft' ||
      recovery.job.operation !== 'resume_create_draft' ||
      root.job.id === recovery.job.id ||
      recovery.job.kind !== 'write' ||
      recovery.job.accountId !== root.job.accountId ||
      bindings.accountId !== root.job.accountId ||
      bindings.originalInputHash !== root.job.inputHash ||
      bindings.resumeInputHash !== recovery.job.inputHash ||
      Object.entries(bindings).some(
        ([key, value]) =>
          typeof value !== 'string' || (key !== 'accountId' && !/^[a-f0-9]{64}$/.test(value)),
      ) ||
      !genericSame(
        JSON.parse(String(relation.prior_json)),
        deps.genericCreationPrior(root, 'original'),
      ) ||
      root.refs.length !== 1 ||
      root.refs[0]!.dataset !== 'write-intent' ||
      !genericSame(root.job.result, { evidence: root.refs }) ||
      root.job.endedAt! > recovery.job.requestedAt ||
      !writeTaskTime(relation.created_at) ||
      relation.created_at < recovery.job.requestedAt ||
      (recovery.job.endedAt !== null && relation.created_at > recovery.job.endedAt)
    )
      return genericUnavailable();
    const document = root.documents[0]!,
      entry = deps.genericCreationEnvelopeInGraph(root, document.payload, [
        'capability',
        'clientReferenceHash',
        'phase',
        'requestedContentHash',
      ]);
    if (
      document.collectionMode !== 'live' ||
      document.evidenceKind !== 'local-intent' ||
      entry.capability !== 'create_draft' ||
      entry.phase !== 'creation-entry' ||
      entry.clientReferenceHash !== bindings.clientReferenceHash ||
      entry.requestedContentHash !== bindings.requestedContentHash ||
      root.job.metadata.clientReferenceHash !== bindings.clientReferenceHash ||
      root.refs[0]!.capturedAt < root.job.platformReadStartedAt! ||
      root.refs[0]!.capturedAt > root.job.platformWriteStartedAt! ||
      recovery.job.metadata.creationOriginalJobId !== root.job.id ||
      recovery.job.metadata.clientReferenceHash !== bindings.clientReferenceHash ||
      recovery.job.metadata.requestedContentHash !== bindings.requestedContentHash
    )
      return genericUnavailable();
    return bindings;
  }
  return genericCreationResumeClaim;
}

interface GenericCreationAncestorDependencies {
  genericCreationUnknown: GenericCreationUnknownOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericCreationEnvelopeInGraph: GenericCreationEnvelopeInGraphOperation;
}

export function createGenericCreationAncestor(
  deps: GenericCreationAncestorDependencies,
): GenericCreationAncestorOperation {
  function genericCreationAncestor(
    node: GenericGraphNode,
    root: GenericGraphNode,
    recovery: GenericGraphNode,
    bindings: Record<string, unknown>,
    graph: CapturedGenericShortGraph,
  ): void {
    const target = root.job.target!;
    deps.genericCreationUnknown(node, target);
    deps.genericQualifyWrite(node, graph);
    const isRecovery = node.job.operation === 'resume_create_draft',
      baselineDataset = isRecovery ? 'creation-resume-baseline' : 'creation-repair-baseline',
      bases = node.refs.filter((ref) => ref.dataset === baselineDataset),
      intents = node.refs.filter((ref) => ref.dataset === 'write-intent'),
      modern = Object.hasOwn(node.job.metadata, 'genericShortStatus');
    if (
      node.job.accountId !== root.job.accountId ||
      !['resume_create_draft', 'repair_created_draft'].includes(node.job.operation) ||
      bases.length !== 1 ||
      intents.length !== 1 ||
      node.refs.some(
        (ref) =>
          ![
            baselineDataset,
            'write-intent',
            'write-result',
            ...(!isRecovery ? ['creation-repair-verification'] : []),
            ...(modern ? ['editable_snapshot'] : []),
          ].includes(ref.dataset),
      ) ||
      node.refs.filter((ref) => ref.dataset === 'write-result').length > 1 ||
      node.refs.filter((ref) => ref.dataset === 'creation-repair-verification').length > 1
    )
      return genericUnavailable();
    const baseDocument = node.documents[node.refs.indexOf(bases[0]!)]!,
      intentDocument = node.documents[node.refs.indexOf(intents[0]!)]!,
      base = genericObject(baseDocument.payload),
      snapshot = genericObject(base.snapshot),
      intent = deps.genericCreationEnvelopeInGraph(node, intentDocument.payload, [
        'desiredContentHash',
        'expectedStates',
        'target',
      ]);
    if (
      baseDocument.collectionMode !== 'live' ||
      baseDocument.evidenceKind !== 'observation' ||
      !genericSame(base.source, { mode: 'live', origin: 'https://fanqienovel.com' }) ||
      base.originalJobId !== root.job.id ||
      base.requestedContentHash !== bindings.requestedContentHash ||
      !genericSame(base.target, target) ||
      !genericSame(snapshot.target, { kind: 'short', workId: target.id }) ||
      snapshot.state !== 'draft' ||
      !writeTaskTime(snapshot.platformReadAt) ||
      snapshot.platformReadAt < node.job.platformReadStartedAt! ||
      snapshot.platformReadAt > bases[0]!.capturedAt ||
      bases[0]!.capturedAt > intents[0]!.capturedAt ||
      intentDocument.collectionMode !== 'live' ||
      intentDocument.evidenceKind !== 'local-intent' ||
      typeof intent.desiredContentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(intent.desiredContentHash) ||
      !genericSame(intent.target, target) ||
      !genericSame(intent.expectedStates, ['draft_saved']) ||
      intents[0]!.capturedAt > node.job.platformWriteStartedAt! ||
      (isRecovery && (snapshot.title !== '' || snapshot.body !== '')) ||
      (!isRecovery &&
        (base.recoveryJobId !== recovery.job.id ||
          base.expectedContentHash !== bindings.expectedContentHash ||
          snapshot.contentHash !== bindings.expectedContentHash ||
          intent.desiredContentHash !== bindings.desiredContentHash))
    )
      return genericUnavailable();
    if (!node.ledger.length) {
      if (!genericSame(node.job.result, { evidence: node.refs })) return genericUnavailable();
    } else {
      const head = node.ledger.at(-1)!,
        read = graph.jobs[head.readJobId],
        index = read?.refs.findIndex((ref) => ref.id === head.evidenceId);
      if (
        head.status !== 'uncertain' ||
        !read ||
        index === undefined ||
        index < 0 ||
        read.documents[index]!.collectionMode !== 'live' ||
        read.documents[index]!.evidenceKind !== 'observation' ||
        !genericSame(genericObject(read.documents[index]!.payload).source, {
          mode: 'live',
          origin: 'https://fanqienovel.com',
        })
      )
        return genericUnavailable();
    }
  }
  return genericCreationAncestor;
}
