import { resumeAppFixture } from './application-resume-app-fixture.js';

import { type A6Observer } from './application-a6-observe.js';

import assert from 'node:assert/strict';

import { a6RawRows } from './application-long-book-metadata-application-fixture.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import { type Job } from '../../src/runtime/store.js';

import { BrowserSession, type LoginState } from '../../src/platform/browser.js';

import { createApplication } from '../../src/application.js';

export function a6Unclosed(f: Awaited<ReturnType<typeof resumeAppFixture>>, o: A6Observer) {
  assert.equal(o.store.getJob(f.original.id)!.status, 'uncertain');
  const row = a6RawRows(o.store)[4]!.find((value) => value.original_job_id === f.original.id)!;
  assert.equal(row.closed_at, null);
  assert.equal(a6RawRows(o.store)[7]!.length, 0);
}

// Both normal resume and repair use the same actual-shaped native server/editor fixture.
export async function repairAppFixture(body?: string) {
  return resumeAppFixture(body);
}

export async function unknownRepairAppChain(repairCount = 1, unrelated = false) {
  const f = await resumeAppFixture('Synthetic recovery body\n\n\nSecond paragraph\n', {
    recovery: 'unknown',
    repairCount,
    final: 'unknown',
    unrelated,
  });
  assert(f.family);
  f.state.lostAck = true;
  return {
    f,
    recovery: { job: f.family.recoveryBefore },
    first: {
      job: f.family.repairsBefore[0]!,
      original: { job: f.family.originalBefore },
      recovered: { job: f.family.recoveryBefore },
    },
    firstArgs: f.family.repairArgs[0]!,
  };
}

export async function f03SavedFixture(
  payload: Record<string, unknown>,
  refDataset = 'short_metrics',
) {
  const { Store } = await import('../../src/runtime/store.js');
  const { JobQueue } = await import('../../src/runtime/jobs.js');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-f03-saved-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-f03-saved-token-at-least-24',
    FANQIE_ACCOUNT_ID: 'synthetic-f03-owner',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const storage = {
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
  };
  const seed = new Store(storage),
    queue = new JobQueue(seed),
    scope = `selection.${refDataset}`;
  let job!: Job,
    ref!: ReturnType<typeof seed.listEvidence>[number],
    current!: string,
    jobs!: string;
  try {
    job = await queue.enqueueRead({
      accountId: config.accountId,
      operation: 'synthetic_f03_read',
      scope,
      datasets: [refDataset],
      run: async (ctx) => {
        ctx.beforePlatformRead();
        return [ctx.saveEvidence(refDataset, payload)];
      },
    }).completion;
    assert.equal(job.status, 'succeeded');
    ref = seed.listEvidence(job.id)[0]!;
    current = JSON.stringify(seed.getCurrent(config.accountId, scope));
    jobs = JSON.stringify(seed.listJobs(config.accountId));
  } finally {
    await queue.drainAndStop();
    seed.close();
  }
  const evidencePath = path.join(storage.evidenceDirectory, ref.path),
    bytes = readFileSync(evidencePath);
  let browserCalls = 0;
  class SavedBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      browserCalls++;
      throw Error('F03 saved projection must not access platform');
    }
    override async withPage<T>(): Promise<T> {
      browserCalls++;
      throw Error('F03 saved projection must not access Page');
    }
  }
  const application = createApplication(config, {
    browser: new SavedBrowser({ profileDir: config.profileDir, headless: true }),
  });
  return {
    config,
    application,
    job,
    ref,
    scope,
    payload,
    get browserCalls() {
      return browserCalls;
    },
    async closeAndVerify() {
      await application.close();
      const verifier = new Store(storage);
      try {
        assert.equal(JSON.stringify(verifier.getCurrent(config.accountId, scope)), current);
        assert.equal(JSON.stringify(verifier.listJobs(config.accountId)), jobs);
        assert.deepEqual(readFileSync(evidencePath), bytes);
        assert.deepEqual(verifier.readEvidence(ref).payload, payload);
      } finally {
        verifier.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

export const originalDirectoryToolNames = [
  'fanqie_upload_cover',
  'fanqie_get_service_status',
  'fanqie_get_capabilities',
  'fanqie_diagnose_current_login',
  'fanqie_diagnose_short_metadata_schema',
  'fanqie_diagnose_short_metadata_api_schema',
  'fanqie_diagnose_read_page',
  'fanqie_diagnose_editor',
  'fanqie_check_login_status',
  'fanqie_get_login_qrcode',
  'fanqie_start_login',
  'fanqie_refresh_account',
  'fanqie_get_short_metadata_snapshot',
  'fanqie_get_job',
  'fanqie_cancel_job',
  'fanqie_get_saved_snapshot',
  'fanqie_list_saved_history',
  'fanqie_list_works',
  'fanqie_get_work_detail',
  'fanqie_get_metrics',
  'fanqie_list_chapters',
  'fanqie_get_chapter',
  'fanqie_list_chapter_drafts',
  'fanqie_list_activities',
  'fanqie_get_writer_class_catalog',
  'fanqie_get_writer_article',
  'fanqie_get_editable_snapshot',
  'fanqie_reconcile_write',
  'fanqie_create_draft',
  'fanqie_resume_create_draft',
  'fanqie_repair_created_draft',
  'fanqie_update_draft',
  'fanqie_update_work_metadata',
  'fanqie_save_chapter_draft',
  'fanqie_prepare_submission',
  'fanqie_submit_short_story',
  'fanqie_publish_chapter',
] as const;

export const DIRECTORY_PRIVATE_OWNER = '9000000000000000000099';

export const DIRECTORY_PRIVATE_MARKER = 'PRIVATE_F02_RAW_BODY_ERROR_COOKIE_SENTINEL';

export const directoryExpectedRecord = (value: string) => ({
  id: { namespace: 'native_short_item', value },
  title: null,
  publicationStatus: 'unknown',
  signingStatus: 'unknown',
  listingScope: 'own_draft_list',
});

export const directoryRecordIds = (total: number) =>
  Array.from({ length: total }, (_, index) => String(7900000000000000000n + BigInt(index + 1)));
