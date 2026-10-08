import {
  type Data,
  sha,
  BASES,
  WORK,
  SCOPE,
  at,
  bytesHash,
  modernTuple4,
  BINDING,
  raw,
  data,
} from './short-native-body-proof-utf16.js';

import {
  reference,
  DACCOUNT,
  DJOB,
  DOWNER,
  DT,
  DDATASETS,
  physical,
  dread,
  DSOURCE,
  dlink,
  DTRANSPORT,
  cleaned,
} from './short-native-body-proof-reference.js';

export function durableReference(
  options: { noChange?: boolean; ackLoss?: boolean; extra?: Data } = {},
) {
  const base = reference(options.extra ?? {}, 8, options.noChange ?? false),
    business = base.business,
    inputHash = sha({
      basis: BASES.business,
      accountId: DACCOUNT,
      target: business.target,
      input: business,
    });
  const job: Data = {
    id: DJOB,
    accountId: DACCOUNT,
    ownerId: DOWNER,
    kind: 'write',
    operation: 'update_short_body',
    scope: `short_native_body.${WORK}`,
    datasets: [],
    idempotencyKey: 'synthetic-key',
    inputHash,
    status: options.ackLoss ? 'uncertain' : 'succeeded',
    requestedAt: DT(0),
    startedAt: DT(1),
    platformReadStartedAt: DT(2),
    platformWriteStartedAt: options.noChange ? null : DT(14),
    endedAt: DT(22),
    updatedAt: DT(22),
    result: null,
    error: null,
    target: { kind: 'short-story', id: WORK },
    metadata: {},
    timeoutMs: 120000,
    deadlineAt: DT(120001),
    cancellationRequestedAt: null,
    cancellationReason: null,
  };
  const refs: Data[] = [],
    documents: Data[] = [],
    stages: Data[] = [];
  function append(kind: keyof typeof DDATASETS, event: number, payload: Data): void {
    const sequence = stages.length + 1,
      stage = {
        schema: 'native-short-body-stage/v1',
        scope: SCOPE,
        kind,
        sequence,
        eventAt: DT(event),
        priorStageHash: stages.length ? sha(at(stages, stages.length - 1)) : null,
        accountId: DACCOUNT,
        jobId: DJOB,
        inputHash,
        payload,
      };
    const id = `22222222-2222-4222-8222-${String(sequence).padStart(12, '0')}`,
      doc = {
        schemaVersion: 1,
        evidenceId: id,
        accountId: DACCOUNT,
        jobId: DJOB,
        dataset: DDATASETS[kind],
        capturedAt: DT(event),
        collectionMode: 'fixture',
        evidenceKind: kind === 'intent' ? 'local-intent' : 'observation',
        payload: stage,
      };
    const ref = {
      id,
      accountId: DACCOUNT,
      jobId: DJOB,
      dataset: DDATASETS[kind],
      capturedAt: DT(event),
      path: `/synthetic/${id}.json`,
      sha256: bytesHash(physical(doc) + '\n'),
    };
    stages.push(stage);
    documents.push(doc);
    refs.push(ref);
  }
  append('baseline', 7, {
    businessInput: business,
    native: modernTuple4(base.before),
    read: dread(3),
    source: DSOURCE,
  });
  if (!options.noChange) {
    append('preSave', 12, {
      native: modernTuple4(base.before),
      read: dread(8),
      sourceVersionHash: base.expectation.sourceVersionHash,
      desiredContentHash: base.desiredHash,
    });
    append('intent', 13, {
      hashBasesHash: 'fcb2726382d9f0fbdb7c065588e3b2ef253b1ea64cd0cb7cd42fec5ed7f4084a',
      target: { kind: 'short-story', id: WORK },
      binding: BINDING,
      inputHash,
      sourceVersionHash: base.expectation.sourceVersionHash,
      desiredContentHash: base.desiredHash,
      baselineEvidence: dlink(at(refs, 0)),
      preSaveEvidence: dlink(at(refs, 1)),
      expectationHash: sha(base.expectation),
      transport: DTRANSPORT,
    });
    append('attempt', 14, {
      ordinal: 1,
      eventAt: DT(14),
      intentEvidence: dlink(at(refs, 2)),
      transport: DTRANSPORT,
    });
    if (!options.ackLoss)
      append('acknowledgement', 16, {
        observation: {
          schema: 'native-short-body-acknowledgement/v1',
          binding: BINDING,
          scope: SCOPE,
          sourceVersionHash: base.expectation.sourceVersionHash,
          desiredContentHash: base.desiredHash,
          acknowledgedAt: DT(16),
        },
        attemptEvidence: dlink(at(refs, 3)),
      });
    append('after', 20, {
      native: modernTuple4(raw('<p>乙</p><p></p>', 8, options.extra ?? {})),
      read: dread(17),
      comparison: base.comparison,
    });
  }
  const evidence = Object.fromEntries(
    ['baseline', 'preSave', 'intent', 'attempt', 'acknowledgement', 'after'].map((kind) => {
      const index = stages.findIndex((v) => v.kind === kind);
      return [kind, index < 0 ? null : dlink(at(refs, index))];
    }),
  );
  const result = {
    schema: 'native-short-body-write-result/v1',
    outcome: options.noChange ? 'not_attempted' : options.ackLoss ? 'unknown' : 'matched',
    reason: options.noChange
      ? 'no_change'
      : options.ackLoss
        ? 'acknowledgement_unverified'
        : 'fixture_not_live',
    source: DSOURCE,
    desiredContentHash: options.noChange ? null : base.desiredHash,
    preservationHash: options.noChange ? null : base.expectation.preservationHash,
    hashBasesHash: 'fcb2726382d9f0fbdb7c065588e3b2ef253b1ea64cd0cb7cd42fec5ed7f4084a',
    evidence,
    post: {
      attempts: options.noChange ? 0 : 1,
      disposed: options.noChange ? 0 : 1,
      startedAt: options.noChange ? null : DT(15),
      acknowledgedAt: options.noChange || options.ackLoss ? null : DT(16),
      acknowledged: !options.noChange && !options.ackLoss,
    },
    ownerCheckedAt: DT(options.noChange ? 5 : 18),
    cleanup: cleaned(DT(21)),
    atomicRevision: false,
  };
  append('result', 21, result);
  const attempts = options.noChange
    ? []
    : [
        {
          jobId: DJOB,
          accountId: DACCOUNT,
          ordinal: 1,
          evidence: dlink(at(refs, 3)),
          eventAt: DT(14),
        },
      ];
  job.result = options.ackLoss ? { evidence: refs } : result;
  if (options.ackLoss)
    job.error = {
      code: 'outcome_unknown',
      message: 'The platform write may have happened; reconcile before retrying.',
      details: {
        cause: { code: 'capability_unavailable', message: 'Native short body is unavailable.' },
      },
    };
  return {
    context: { accountId: DACCOUNT, job, manifest: null, refs, documents, attempts },
    result,
    stages,
    base,
  };
}

export function reseal(context: ReturnType<typeof durableReference>['context']): void {
  const refs = context.refs,
    documents = context.documents;
  for (let i = 0; i < documents.length; i++) {
    const stage = data(at(documents, i).payload);
    stage.sequence = i + 1;
    stage.priorStageHash = i ? sha(data(at(documents, i - 1).payload)) : null;
    const ref = at(refs, i);
    ref.sha256 = bytesHash(physical(at(documents, i)) + '\n');
  }
}

export function independentAudit(
  context: ReturnType<typeof durableReference>['context'],
  first?: Data,
  previous?: Data,
): Data {
  const j = context.job,
    error = first ? first.originalError : j.error;
  function pointer(c: Data): Data {
    const e = data(c.evidence);
    return {
      readJobId: c.reconciliationJobId,
      evidenceId: e.id,
      evidenceHash: e.sha256,
      resultHash: sha(c),
      settledAt: c.settledAt,
    };
  }
  const previousAudit = previous ? data(previous.originalAudit) : null;
  return {
    schema: 'native-short-body-original-audit/v1',
    accountId: DACCOUNT,
    originalJobId: DJOB,
    target: { kind: 'short-story', id: WORK },
    inputHash: j.inputHash,
    originalEndedAt: first ? first.originalEndedAt : j.endedAt,
    priorEndedAt: j.endedAt,
    originalResultHash: sha({ evidence: context.refs }),
    originalErrorHash: sha(error),
    originalError: error,
    evidenceHash: sha({
      basis: 'native-short-body-original-evidence/v1',
      links: context.refs.map(dlink),
    }),
    attemptsHash: sha({
      basis: 'native-short-body-original-attempts/v1',
      attempts: context.attempts,
    }),
    firstClosure: previous ? (previousAudit?.firstClosure ?? pointer(previous)) : null,
    previousClosure: previous ? pointer(previous) : null,
  };
}
