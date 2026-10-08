import {
  createNativeShortMetadataSnapshot,
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  validateNativeShortSubmissionContract,
  validateNativeShortPreparedSubmission,
  validateNativeShortSubmissionExpectation,
} from '../short-native-submission.js';

import { type NativeShortSubmissionApiReason } from '../short-native-submission-api.js';

import { type Ports } from './validate-result.js';
interface ResultShapePorts {
  ports: Ports;
  input: unknown;
  expectedBinding: { accountId: string; workId: string } | undefined;
}
export function createResultShape(ports: ResultShapePorts) {
  return () => {
    const value = ports.ports.copy(ports.input),
      r = ports.ports.fields(value, [
        'schema',
        'mode',
        'status',
        'reason',
        'provenance',
        'prepared',
        'contract',
        'plan',
        'expectation',
        'snapshot',
        'comparison',
        'phases',
        'snapshots',
        'sourceReads',
        'sourceReadStartedAt',
        'sourceReadFinishedAt',
        'publish',
        'proof',
        'cleanup',
      ]);

    if (
      r.schema !== 'native-short-submission-api/v1' ||
      !['prepare', 'submit', 'read'].includes(String(r.mode)) ||
      !['success', 'capability_unavailable'].includes(String(r.status)) ||
      (r.status === 'success'
        ? r.reason !== null
        : !ports.ports.NATIVE_SHORT_SUBMISSION_API_REASONS.includes(
            r.reason as NativeShortSubmissionApiReason,
          ))
    )
      throw ports.ports.STOPPED;

    const observedBinding = (r.snapshot ??
      (r.snapshots as Record<string, unknown>)?.before ??
      (r.snapshots as Record<string, unknown>)?.after) as NativeShortMetadataSnapshot | null;

    const binding =
      ports.expectedBinding ??
      (observedBinding
        ? { accountId: observedBinding.binding.account.id, workId: observedBinding.binding.work.id }
        : null);

    if (
      !binding ||
      !ports.ports.OWNER.test(binding.accountId) ||
      !ports.ports.WORK.test(binding.workId)
    )
      throw ports.ports.STOPPED;

    const provenance = ports.ports.fields(r.provenance, ['mode', 'executor']);

    if (
      !ports.ports.same(
        provenance,
        provenance.mode === 'live'
          ? { mode: 'live', executor: 'application-default-submission-owned-run/v1' }
          : { mode: 'fixture', executor: 'dependency-injected-submission-owned-run/v1' },
      )
    )
      throw ports.ports.STOPPED;

    const snapshot = (s: unknown) => {
      if (s === null) return null;
      const source = ports.ports.fields(s, Object.keys(s as object));
      const rebuilt = createNativeShortMetadataSnapshot({
        binding: source.binding as NativeShortBinding,
        editData: source.editData,
        categoryData: source.categoryData,
      });
      if (
        !ports.ports.same(s, rebuilt) ||
        rebuilt.binding.account.id !== binding.accountId ||
        rebuilt.binding.work.id !== binding.workId
      )
        throw ports.ports.STOPPED;
      return rebuilt;
    };

    const snapshots = ports.ports.fields(r.snapshots, ['before', 'preSubmit', 'after']);

    for (const s of Object.values(snapshots)) snapshot(s);

    snapshot(r.snapshot);

    if (r.prepared !== null) validateNativeShortPreparedSubmission(r.prepared);

    if (r.contract !== null) validateNativeShortSubmissionContract(r.contract);

    if (r.expectation !== null) validateNativeShortSubmissionExpectation(r.expectation);

    const phases = ports.ports.fields(r.phases, ['before', 'preSubmit', 'after']);

    for (const [name, p] of Object.entries(phases)) {
      const f = ports.ports.fields(p, ['proof', 'requests', 'list']),
        q = ports.ports.fields(f.proof, [
          'platformStarted',
          'ownerBefore',
          'ownerAfter',
          'fixedSourceVerified',
          'targetUnique',
          'paginationComplete',
          'atomicRevision',
          'readStartedAt',
          'readFinishedAt',
          'proofCapturedAt',
        ]),
        requests = ports.ports.fields(f.requests, ['own', 'list', 'edit', 'catalog']),
        list = ports.ports.fields(f.list, ['pagesRead', 'rowsRead', 'totalCount']);
      for (const key of [
        'platformStarted',
        'ownerBefore',
        'ownerAfter',
        'fixedSourceVerified',
        'targetUnique',
        'paginationComplete',
      ])
        if (typeof q[key] !== 'boolean') throw ports.ports.STOPPED;
      if (q.atomicRevision !== false) throw ports.ports.STOPPED;
      for (const key of ['readStartedAt', 'readFinishedAt', 'proofCapturedAt'])
        if (q[key] !== null && !ports.ports.time(q[key])) throw ports.ports.STOPPED;
      for (const counter of Object.values(requests)) {
        const c = ports.ports.fields(counter, ['attempts', 'disposed']);
        if (
          !Number.isSafeInteger(c.attempts) ||
          Number(c.attempts) < 0 ||
          Number(c.attempts) > 16 ||
          !Number.isSafeInteger(c.disposed) ||
          Number(c.disposed) < 0 ||
          Number(c.disposed) > Number(c.attempts)
        )
          throw ports.ports.STOPPED;
      }
      if (
        !Number.isSafeInteger(list.pagesRead) ||
        Number(list.pagesRead) < 0 ||
        !Number.isSafeInteger(list.rowsRead) ||
        Number(list.rowsRead) < 0 ||
        (list.totalCount !== null &&
          (!Number.isSafeInteger(list.totalCount) || Number(list.totalCount) < 0))
      )
        throw ports.ports.STOPPED;
      if (name === 'after' && Number((requests.list as Record<string, unknown>).attempts) !== 0)
        throw ports.ports.STOPPED;
    }

    const sources = ports.ports.fields(r.sourceReads, ports.ports.SOURCE_KEYS);

    for (const key of ports.ports.SOURCE_KEYS) {
      const s = ports.ports.fields(sources[key], [
          'attempts',
          'disposed',
          'url',
          'sha256',
          'requestedAt',
          'completedAt',
        ]),
        pin = NATIVE_SHORT_SUBMISSION_SOURCE_PINS[key];
      if (
        !Number.isSafeInteger(s.attempts) ||
        Number(s.attempts) < 0 ||
        Number(s.attempts) > 1 ||
        !Number.isSafeInteger(s.disposed) ||
        Number(s.disposed) < 0 ||
        Number(s.disposed) > Number(s.attempts) ||
        (s.url !== null && s.url !== (typeof pin === 'string' ? pin : pin.url)) ||
        (s.sha256 !== null && (typeof s.sha256 !== 'string' || !ports.ports.HASH.test(s.sha256)))
      )
        throw ports.ports.STOPPED;
      for (const k of ['requestedAt', 'completedAt'])
        if (s[k] !== null && !ports.ports.time(s[k])) throw ports.ports.STOPPED;
    }

    const publish = ports.ports.fields(r.publish, [
        'held',
        'intentReceipt',
        'attemptReceipt',
        'acknowledgementReceipt',
        'observation',
        'post',
        'outcome',
      ]),
      post = ports.ports.fields(publish.post, [
        'attempts',
        'disposed',
        'markedAt',
        'startedAt',
        'acknowledgedAt',
        'acknowledged',
      ]);

    if (
      ![0, 1].includes(Number(post.attempts)) ||
      ![0, 1].includes(Number(post.disposed)) ||
      Number(post.disposed) > Number(post.attempts) ||
      typeof post.acknowledged !== 'boolean' ||
      !['not_attempted', 'unknown', 'acknowledged', 'rejected', 'verified'].includes(
        String(publish.outcome),
      )
    )
      throw ports.ports.STOPPED;

    for (const key of ['markedAt', 'startedAt', 'acknowledgedAt'])
      if (post[key] !== null && !ports.ports.time(post[key])) throw ports.ports.STOPPED;

    if (publish.observation !== null) {
      const a = ports.ports.fields(publish.observation, [
        'schema',
        'binding',
        'sourceVersionHash',
        'desiredSubmissionHash',
        'useAi',
        'code',
        'message',
        'itemId',
        'accepted',
        'acknowledgedAt',
      ]);
      if (
        a.schema !== 'native-short-submission-acknowledgement-observation/v1' ||
        !ports.ports.same(a.binding, {
          account: { kind: 'account_id', id: binding.accountId },
          work: { kind: 'short', id: binding.workId },
        }) ||
        typeof a.sourceVersionHash !== 'string' ||
        !ports.ports.HASH.test(a.sourceVersionHash) ||
        typeof a.desiredSubmissionHash !== 'string' ||
        !ports.ports.HASH.test(a.desiredSubmissionHash) ||
        ![1, 2].includes(Number(a.useAi)) ||
        !Number.isSafeInteger(a.code) ||
        typeof a.accepted !== 'boolean' ||
        a.accepted !== (a.code === 0) ||
        (a.message !== null && typeof a.message !== 'string') ||
        (a.itemId !== null && a.itemId !== binding.workId) ||
        !ports.ports.time(a.acknowledgedAt) ||
        a.acknowledgedAt !== post.acknowledgedAt ||
        post.acknowledged !== true
      )
        throw ports.ports.STOPPED;
    } else if (post.acknowledged !== false || post.acknowledgedAt !== null)
      throw ports.ports.STOPPED;

    const proof = ports.ports.fields(r.proof, [
        'platformStarted',
        'ownerCallback',
        'atomicRevision',
        'fixedSourcesVerified',
        'proofCapturedAt',
      ]),
      cleanup = ports.ports.fields(r.cleanup, [
        'sessionCreated',
        'sessionDisposed',
        'quarantined',
        'pendingAtEnd',
        'disposalFailures',
        'checkedAt',
      ]);

    for (const key of ['platformStarted', 'ownerCallback', 'fixedSourcesVerified'])
      if (typeof proof[key] !== 'boolean') throw ports.ports.STOPPED;

    if (
      proof.atomicRevision !== false ||
      (proof.proofCapturedAt !== null && !ports.ports.time(proof.proofCapturedAt))
    )
      throw ports.ports.STOPPED;

    for (const key of ['sessionCreated', 'sessionDisposed', 'quarantined'])
      if (typeof cleanup[key] !== 'boolean') throw ports.ports.STOPPED;

    if (
      !Number.isSafeInteger(cleanup.pendingAtEnd) ||
      Number(cleanup.pendingAtEnd) < 0 ||
      !Number.isSafeInteger(cleanup.disposalFailures) ||
      Number(cleanup.disposalFailures) < 0 ||
      (cleanup.checkedAt !== null && !ports.ports.time(cleanup.checkedAt))
    )
      throw ports.ports.STOPPED;

    if (
      (r.mode === 'read' &&
        (ports.ports.SOURCE_KEYS.some(
          (key) => (sources[key] as Record<string, unknown>).attempts !== 0,
        ) ||
          post.attempts !== 0 ||
          r.contract !== null ||
          r.prepared !== null ||
          r.plan !== null ||
          r.expectation !== null ||
          r.comparison !== null)) ||
      (provenance.mode === 'fixture' && proof.fixedSourcesVerified !== false)
    )
      throw ports.ports.STOPPED;

    if (
      r.status === 'success' &&
      (!proof.platformStarted ||
        !proof.ownerCallback ||
        !ports.ports.time(proof.proofCapturedAt) ||
        !cleanup.sessionCreated ||
        !cleanup.sessionDisposed ||
        cleanup.quarantined ||
        cleanup.pendingAtEnd !== 0 ||
        cleanup.disposalFailures !== 0 ||
        r.snapshot === null ||
        (r.mode !== 'read' && provenance.mode === 'live' && proof.fixedSourcesVerified !== true) ||
        (r.mode === 'submit' &&
          (post.attempts !== 1 || post.disposed !== 1 || publish.acknowledgementReceipt === null)))
    )
      throw ports.ports.STOPPED;

    // Rebuild the business graph rather than trusting recorded hashes or flags.
    const before = snapshot(snapshots.before),
      preSubmit = snapshot(snapshots.preSubmit),
      after = snapshot(snapshots.after),
      current = snapshot(r.snapshot);

    const contract = r.contract === null ? null : validateNativeShortSubmissionContract(r.contract),
      prepared = r.prepared === null ? null : validateNativeShortPreparedSubmission(r.prepared);

    if (
      (contract &&
        contract.mode !==
          (provenance.mode === 'live' ? 'production-fixed-contract' : 'fixture-no-live')) ||
      (prepared &&
        (prepared.completeCurrentSnapshot.binding.account.id !== binding.accountId ||
          prepared.completeCurrentSnapshot.binding.work.id !== binding.workId ||
          !before ||
          !ports.ports.same(before, prepared.completeCurrentSnapshot)))
    )
      throw ports.ports.STOPPED;
    return {
      current,
      value,
      r,
      binding,
      provenance,
      snapshot,
      phases,
      sources,
      publish,
      post,
      proof,
      cleanup,
      before,
      preSubmit,
      after,
      prepared,
      contract,
    };
  };
}
