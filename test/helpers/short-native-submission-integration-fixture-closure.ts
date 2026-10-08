import { fixture, noPrivate } from './short-native-submission-integration-edit.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { Store, type Job, type EvidenceRef, type Manifest } from '../../src/runtime/store.js';

import { readFileSync, writeFileSync } from 'node:fs';

import * as proof from '../../src/platform/short-native-submission-proof.js';

import assert from 'node:assert/strict';

import { tmpdir } from 'node:os';

// Read only the synthetic database owned by this test, then build a detached
// proof closure. This never promotes a fixture through Store's live settlement gate.
export function fixtureClosure(f: ReturnType<typeof fixture>, originalId: string, readId: string) {
  const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
  try {
    const job = (id: string) =>
      (Store.prototype as unknown as { decodeJob(row: Record<string, unknown>): Job }).decodeJob(
        db.prepare('SELECT * FROM jobs WHERE id=?').get(id)!,
      );
    const refs = (id: string): EvidenceRef[] =>
      db
        .prepare('SELECT * FROM evidence WHERE job_id=? ORDER BY rowid')
        .all(id)
        .map((row) => ({
          id: String(row.id),
          accountId: String(row.account_id),
          jobId: String(row.job_id),
          dataset: String(row.dataset),
          capturedAt: String(row.captured_at),
          path: String(row.path),
          sha256: String(row.sha256),
        }));
    const doc = (ref: EvidenceRef) =>
      JSON.parse(readFileSync(path.join(f.config.dataDir, 'evidence', ref.path), 'utf8'));
    const manifest = (id: string) =>
      JSON.parse(
        String(
          db.prepare('SELECT manifest_json FROM manifests WHERE job_id=?').get(id)!.manifest_json,
        ),
      ) as Manifest;
    const original = job(originalId),
      orefs = refs(originalId),
      docs = orefs.map(doc),
      pid = (docs[0].payload as any).businessInput.preparationJobId,
      prefs = refs(pid),
      pjob = job(pid),
      attempts = db
        .prepare('SELECT * FROM native_short_submission_attempts WHERE job_id=? ORDER BY rowid')
        .all(originalId)
        .map((row) => ({
          jobId: String(row.job_id),
          accountId: String(row.account_id),
          ordinal: 1 as const,
          evidence: {
            id: String(row.evidence_id),
            sha256: String(row.evidence_sha256),
            capturedAt: String(row.evidence_captured_at),
          },
          eventAt: String(row.event_at),
        }));
    const context: proof.NativeShortSubmissionReconciliationContext = {
      original: {
        accountId: original.accountId,
        job: original,
        manifest: null,
        refs: orefs,
        documents: docs,
        attempts,
        preparation: {
          job: pjob,
          manifest: manifest(pid),
          ref: prefs[0]!,
          document: doc(prefs[0]!),
        },
      },
      readJob: job(readId),
      manifest: manifest(readId),
      ref: refs(readId)[0]!,
      document: doc(refs(readId)[0]!),
    };
    const settledAt = new Date().toISOString(),
      closure = proof.createNativeShortSubmissionClosure(context, settledAt);
    assert.equal(closure.status, 'uncertain');
    context.original.job = {
      ...original,
      status: 'uncertain',
      result: closure,
      endedAt: settledAt,
      updatedAt: settledAt,
    };
    const projection = proof.projectNativeShortSubmissionReconciliationContext(context);
    assert.equal(projection.validated, true);
    const envelope = {
      job: proof.safeNativeShortSubmissionJob(context.original.job, projection),
      retrievalMode: 'saved',
      sourceMode: 'incomplete',
      evidence: projection.evidence,
      data: projection.data,
    };
    noPrivate(envelope);
    writeFileSync(
      path.join(tmpdir(), 'fanqie-native-submission-public-closure-fixture-20261007.json'),
      JSON.stringify(envelope, null, 2),
    );
    const changed = structuredClone(context);
    (changed.document.payload as any).originalAudit.inputHash = 'f'.repeat(64);
    assert.equal(proof.projectNativeShortSubmissionReconciliationContext(changed).validated, false);
  } finally {
    db.close();
  }
}
