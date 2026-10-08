import {
  bodyUnavailable,
  sameNativeValue,
  timestamp,
  bodyLink,
  bodyObject,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';

import { request } from 'playwright';
import { type NativeShortBodyPlan } from '../../../platform/short-native-body.js';
import { type NativeShortBodyAttemptPermit } from '../authority.js';

import { type CreateNativeShortBodyAuthorityDependencies } from '../operations/jobs-api-create-native-short-body-authority.js';
interface Ports {
  deps: CreateNativeShortBodyAuthorityDependencies;
  requireWrite: () => import('../runtime-error.js').Job;
  attemptIssued: boolean;
  plan: NativeShortBodyPlan | null;
  links: () => Record<string, bodyProof.NativeShortBodyRefLink | null>;
  jobId: string;
  accountId: string;
}
export function createBodyAuthorityAttemptIssuer(ports: Ports) {
  return (transport: bodyProof.NativeShortBodyTransport) => {
    ports.deps.publicReads.assertMutationAllowed();
    ports.requireWrite();
    if (ports.attemptIssued || !ports.plan) return bodyUnavailable();
    ports.attemptIssued = true;
    const expectedTransport = {
      method: 'POST',
      url: ports.plan.request.url,
      contentType: ports.plan.request.contentType,
      maxRedirects: 0,
      maxRetries: 0,
      maxAttempts: 1,
    };
    if (!sameNativeValue(bodyObject(transport, Object.keys(expectedTransport)), expectedTransport))
      return bodyUnavailable();
    const before = ports.requireWrite(),
      evidence = ports.links(),
      eventAt = timestamp();
    if (
      before.platformWriteStartedAt !== null ||
      ports.deps.listNativeShortBodyAttempts(ports.jobId, ports.accountId).length !== 0 ||
      evidence.intent === null
    )
      return bodyUnavailable();
    const stage = ports.deps.nativeShortBodyStage(
      before,
      'attempt',
      { ordinal: 1, eventAt, intentEvidence: evidence.intent, transport: expectedTransport },
      eventAt,
    );
    // Physical prepare is durable before BEGIN; an orphan never grants a permit.
    const prepared = ports.deps.preparePhysicalEvidence(
      before,
      bodyProof.NATIVE_SHORT_BODY_DATASETS.attempt,
      stage,
    );
    const ref = ports.deps.transaction(() => {
      const job = ports.requireWrite();
      if (
        job.platformWriteStartedAt !== null ||
        ports.deps.listNativeShortBodyAttempts(ports.jobId, ports.accountId).length !== 0 ||
        !sameNativeValue(evidence, ports.links()) ||
        !sameNativeValue(
          stage,
          ports.deps.nativeShortBodyStage(
            job,
            'attempt',
            {
              ordinal: 1,
              eventAt,
              intentEvidence: evidence.intent,
              transport: expectedTransport,
            },
            eventAt,
          ),
        )
      )
        return bodyUnavailable();
      ports.deps
        .prepare('UPDATE jobs SET write_started_at=?,updated_at=? WHERE id=?')
        .run(eventAt, eventAt, ports.jobId);
      ports.deps.insertPhysicalEvidence(prepared.reference);
      const r = prepared.reference;
      ports.deps
        .prepare(
          'INSERT INTO native_short_body_attempts(job_id,account_id,ordinal,evidence_id,evidence_sha256,evidence_captured_at,event_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(ports.jobId, ports.accountId, 1, r.id, r.sha256, r.capturedAt, eventAt);
      const prospective = ports.deps.rawJob(ports.jobId);
      if (!prospective) return bodyUnavailable();
      bodyProof.validateNativeShortBodyEvidenceContext(
        ports.deps.nativeShortBodyContext(prospective),
        'prefix',
      );
      return r;
    });
    // Only committed row plus physical readback may issue one consumable permit.
    ports.requireWrite();
    ports.deps.readEvidence(ref);
    const rows = ports.deps.listNativeShortBodyAttempts(ports.jobId, ports.accountId),
      current = ports.deps.rawJob(ports.jobId);
    if (
      !current ||
      rows.length !== 1 ||
      !sameNativeValue(rows[0]!.evidence, bodyLink(ref)) ||
      rows[0]!.eventAt !== current.platformWriteStartedAt
    )
      return bodyUnavailable();
    bodyProof.validateNativeShortBodyEvidenceContext(
      ports.deps.nativeShortBodyContext(current),
      'prefix',
    );
    const permit = Object.freeze(Object.create(null)) as NativeShortBodyAttemptPermit;
    ports.deps.nativeShortBodyPermits.set(permit, {
      store: ports.deps.owner,
      jobId: ports.jobId,
      ref: bodyLink(ref),
      consumed: false,
    });
    return permit;
  };
}
