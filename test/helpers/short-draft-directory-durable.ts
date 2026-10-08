import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import { tmpdir } from 'node:os';

import { Store, type EvidenceRef, RuntimeError, type Job } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import { fixture, INPUT, ACCOUNT } from './short-draft-directory-deferred.js';

import { randomUUID } from 'node:crypto';

import assert from 'node:assert/strict';

import {
  createShortDraftDirectoryEvidence,
  validateShortDraftDirectoryContext,
} from '../../src/platform/short-draft-directory.js';

export async function durable(total = 1) {
  const root = mkdtempSync(path.join(tmpdir(), 'short-draft-directory-'));
  const databasePath = path.join(root, 'operations.sqlite'),
    evidenceDirectory = path.join(root, 'evidence');
  const store = new Store({ databasePath, evidenceDirectory, evidenceMode: 'fixture' }),
    queue = new JobQueue(store, { timeoutMs: 5_000 });
  const f = fixture({ total });
  const execute = (tamper?: (reference: EvidenceRef, payload: unknown) => void) =>
    queue.enqueueRead({
      accountId: 'directory-test',
      operation: 'list_short_drafts',
      scope: 'native_short_draft_directory.v1',
      datasets: ['short_drafts'],
      inputHash: INPUT,
      idempotencyKey: randomUUID(),
      run: async (ctx) => {
        const current = () => {
          store.assertLeaseOwnership();
          const job = store.getJob(ctx.jobId)!;
          if (
            job.status !== 'running' ||
            ctx.signal.aborted ||
            job.cancellationRequestedAt ||
            !job.deadlineAt ||
            Date.now() > Date.parse(job.deadlineAt)
          )
            throw new RuntimeError(
              'capability_unavailable',
              'Short draft directory is unavailable.',
            );
        };
        const raw = await f.browser.runShortDraftDirectory(
          {
            mode: 'read',
            expectedOwner: { kind: 'account', id: ACCOUNT },
            signal: ctx.signal,
            assertLease: current,
            onBeforePlatformRead() {
              current();
              ctx.beforePlatformRead();
            },
            onVerifiedAccount(id) {
              current();
              assert.equal(id, ACCOUNT);
            },
          },
          f.factory,
        );
        const payload = createShortDraftDirectoryEvidence(raw, 'injected');
        ctx.addMetadata({
          shortDraftDirectorySchema: 'short-draft-directory-job/v1',
          shortDraftDirectoryOwnerKind: 'account',
          shortDraftDirectoryOwnerId: ACCOUNT,
          shortDraftDirectorySource: 'fixture',
        });
        const reference = ctx.saveEvidence('short_drafts', payload);
        validateShortDraftDirectoryContext(
          {
            accountId: 'directory-test',
            job: store.getJob(ctx.jobId)!,
            manifest: null,
            refs: store.listEvidence(ctx.jobId),
            documents: [store.readEvidence(reference)],
            evaluationAt: new Date().toISOString(),
          },
          'prefix',
        );
        tamper?.(reference, payload);
        if (raw.status !== 'success')
          throw new RuntimeError('capability_unavailable', 'Short draft directory is unavailable.');
        return [reference];
      },
    });
  const publicContext = (job: Job) => {
    const refs = store.listEvidence(job.id);
    return {
      accountId: 'directory-test',
      job,
      manifest: store.getManifestForJob('directory-test', job.id),
      refs,
      documents: refs.map((ref) => store.readEvidence(ref)),
      evaluationAt: new Date().toISOString(),
    };
  };
  return {
    root,
    databasePath,
    evidenceDirectory,
    store,
    queue,
    f,
    execute,
    publicContext,
    async close() {
      await queue.drainAndStop();
      await f.browser.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
