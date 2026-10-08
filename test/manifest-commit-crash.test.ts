import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import {
  canonicalJson,
  Store,
  type EvidenceDocument,
  type EvidenceRef,
  type Job,
  type Manifest,
} from '../src/runtime/store.js';

type Phase = 'pre_commit' | 'post_commit';
type StorePaths = { databasePath: string; evidenceDirectory: string; evidenceMode: 'fixture' };
type Exit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderrBytes: number;
};
interface Baseline {
  manifest: Manifest;
  job: Job;
  references: EvidenceRef[];
  documents: EvidenceDocument[];
  fileHashes: string[];
}
interface Gate {
  kind: 'commit_gate';
  nonce: string;
  phase: Phase;
  pid: number;
  ownerId: string;
  defaultLeaseMs: number;
  leaseExpiresAt: number;
  gatedAt: number;
  commitCalls: number;
  commitCompleted: boolean;
  callerReturned: false;
  sameConnection: true;
  manifestInserted: true;
  currentUpdated: true;
  jobSucceeded: true;
  jobsCount: number;
  manifestsCount: number;
  currentCount: number;
  evidenceCount: number;
  references: EvidenceRef[];
  runningJob: Job;
  committedJob: Job;
  manifest: Manifest;
}
interface Recovery {
  kind: 'recovery_checked';
  nonce: string;
  phase: Phase;
  pid: number;
  ownerId: string;
  checks: number;
  stateDigest: string;
  integrityPassed: true;
  foreignKeysPassed: true;
  expectedCurrentPassed: true;
  exactJobsPassed: true;
  allEvidencePassed: true;
  jobsCount: 2;
  evidenceCount: 4;
  manifestCount: number;
  noRetry: true;
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const datasets = ['metrics', 'works'];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Child strings import the same production Store as this test, in source and compiled runs.
// The only injection wraps this instance's original exec after both saveEvidence transactions.
const writerSource = `
const input = JSON.parse(process.argv[1]);
const ensure = (value, code) => { if (!value) throw new Error(code); };
const store = new Store(input.paths);
const job = store.createJob({accountId:input.accountId,kind:'read',operation:'commit-crash-next',scope:'account',datasets:['works','metrics'],inputHash:input.inputHash}).job;
store.startJob(job.id); store.markPlatformReadStarted(job.id);
const references = ['works','metrics'].map(dataset => store.saveEvidence(job.id,dataset,{complete:true,generation:'next',dataset,nonce:input.nonce}));
const runningJob = store.getJob(job.id);
const db = store.db;
const originalExec = db.exec.bind(db);
let armed = false; let commitCalls = 0; let callerReturned = false;
const gate = () => {
  const row = db.prepare('SELECT * FROM manifests WHERE job_id = ?').get(job.id);
  const pointer = db.prepare('SELECT * FROM current_manifests WHERE account_id = ? AND scope = ?').get(input.accountId,'account');
  const committedJob = store.getJob(job.id);
  const manifest = row ? JSON.parse(row.manifest_json) : null;
  const lease = db.prepare('SELECT owner_id, expires_at FROM service_lease WHERE id = 1').get();
  ensure(manifest && manifest.accountId === input.accountId && manifest.jobId === job.id && manifest.scope === 'account','gate_manifest_binding');
  ensure(pointer && pointer.manifest_id === manifest.id,'gate_current_binding');
  ensure(committedJob.status === 'succeeded' && canonicalJson(committedJob.result) === canonicalJson({manifest}),'gate_job_result');
  ensure(canonicalJson(manifest.evidence) === canonicalJson([...references].sort((a,b) => a.dataset.localeCompare(b.dataset))),'gate_refs_binding');
  ensure(runningJob.status === 'running' && store.leaseDurationMs === 30000,'gate_default_lease');
  ensure(lease && lease.owner_id === store.ownerId && lease.expires_at > Date.now(),'gate_lease_owner');
  ensure(commitCalls === 1 && !callerReturned,'gate_single_commit');
  const count = table => Number(db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count);
  const packet = {kind:'commit_gate',nonce:input.nonce,phase:input.phase,pid:process.pid,ownerId:store.ownerId,
    defaultLeaseMs:store.leaseDurationMs,leaseExpiresAt:lease.expires_at,gatedAt:Date.now(),commitCalls,
    commitCompleted:input.phase === 'post_commit',callerReturned,sameConnection:true,
    manifestInserted:true,currentUpdated:true,jobSucceeded:true,
    jobsCount:count('jobs'),manifestsCount:count('manifests'),currentCount:count('current_manifests'),evidenceCount:count('evidence'),
    references,runningJob,committedJob,manifest};
  writeSync(1,JSON.stringify(packet)+'\\n');
  // This is a synchronous, deterministic gate, not a throw or delayed/random crash.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  throw new Error('gate_resumed_without_sigkill');
};
db.exec = sql => {
  if (!armed || sql !== 'COMMIT') return originalExec(sql);
  commitCalls++;
  if (input.phase === 'pre_commit') gate();
  const result = originalExec(sql);
  if (input.phase === 'post_commit') gate();
  return result;
};
armed = true;
store.completeReadJob(job.id,references);
callerReturned = true;
throw new Error('caller_returned_without_gate');
`;

const recoverySource = `
const input = JSON.parse(process.argv[1]);
let checks = 0;
const ensure = (value, code) => { checks++; if (!value) throw new Error(code); };
const same = (a,b,code) => ensure(canonicalJson(a) === canonicalJson(b),code);
const store = new Store(input.paths);
let report;
try {
  const db = store.db;
  const integrity = db.prepare('PRAGMA integrity_check').all();
  ensure(integrity.length === 1 && integrity[0].integrity_check === 'ok','integrity_check');
  ensure(db.prepare('PRAGMA foreign_key_check').all().length === 0,'foreign_key_check');
  ensure(store.ownerId !== input.gate.ownerId && store.leaseDurationMs === 30000,'fresh_recovery_owner');
  ensure(!Object.hasOwn(input.paths,'leaseDurationMs'),'default_lease_options');
  ensure(store.recoverInterrupted() === 0,'no_repeat_recovery');
  const count = table => Number(db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count);
  ensure(count('jobs') === 2 && count('evidence') === 4 && count('current_manifests') === 1,'exact_table_counts');
  ensure(store.listJobs().length === 2 && store.listJobs(input.accountId).length === 2,'no_extra_jobs');
  same(store.getJob(input.baseline.job.id),input.baseline.job,'baseline_job_unchanged');
  same(store.listEvidence(input.baseline.job.id),input.baseline.references,'baseline_refs_unchanged');
  same(store.listEvidence(input.gate.runningJob.id),input.gate.references,'next_refs_exact');
  ensure(store.getCurrent('outside-account') === null && store.getCurrent(input.accountId,'outside-scope') === null,'current_account_scope_isolation');
  ensure(store.history('outside-account').length === 0 && store.history(input.accountId,'outside-scope').length === 0,'history_account_scope_isolation');
  const observedJob = store.getJob(input.gate.runningJob.id);
  const current = store.getCurrent(input.accountId,'account');
  const history = store.history(input.accountId,'account');
  if (input.phase === 'pre_commit') {
    ensure(observedJob.status === 'failed' && observedJob.error.code === 'interrupted','pre_interrupted_read');
    ensure(Number.isFinite(Date.parse(observedJob.endedAt)) && observedJob.endedAt === observedJob.updatedAt,'pre_recovery_timestamp');
    same(observedJob,{...input.gate.runningJob,status:'failed',endedAt:observedJob.endedAt,updatedAt:observedJob.updatedAt,
      result:{evidence:input.gate.references},error:{code:'interrupted',message:'The previous service stopped before this job completed.'}},'pre_full_job_binding');
    same(current,input.baseline.manifest,'pre_full_current_unchanged');
    same(history,[input.baseline.manifest],'pre_full_history_unchanged');
    ensure(count('manifests') === 1 && !db.prepare('SELECT id FROM manifests WHERE job_id = ?').get(observedJob.id),'pre_no_new_manifest');
  } else {
    same(observedJob,input.gate.committedJob,'post_full_job_unchanged');
    ensure(observedJob.status === 'succeeded' && observedJob.error === null,'post_succeeded_not_downgraded');
    same(current,input.gate.manifest,'post_full_current_exact');
    same(history,[input.gate.manifest,input.baseline.manifest],'post_full_history_exact');
    ensure(count('manifests') === 2,'post_exact_manifest_count');
    same(observedJob.result,{manifest:current},'post_job_manifest_result');
  }
  const allReferences = [...input.baseline.references,...input.gate.references];
  const documents = [];
  const fileHashes = [];
  for (const ref of allReferences) {
    const doc = store.readEvidence(ref);
    const bytes = readFileSync(path.join(store.evidenceDirectory,ref.path));
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    ensure(fileHash === ref.sha256,'file_sha256_exact');
    ensure(bytes.equals(Buffer.from(canonicalJson(doc)+'\\n','utf8')),'full_evidence_bytes');
    same({schemaVersion:doc.schemaVersion,evidenceId:doc.evidenceId,accountId:doc.accountId,jobId:doc.jobId,dataset:doc.dataset,capturedAt:doc.capturedAt},
      {schemaVersion:1,evidenceId:ref.id,accountId:input.accountId,jobId:ref.jobId,dataset:ref.dataset,capturedAt:ref.capturedAt},'document_identity_binding');
    ensure(doc.collectionMode === 'fixture' && doc.evidenceKind === 'observation','fixture_observation_only');
    const baselineIndex = input.baseline.references.findIndex(item => item.id === ref.id);
    if (baselineIndex >= 0) { same(doc,input.baseline.documents[baselineIndex],'baseline_document_unchanged'); ensure(fileHash === input.baseline.fileHashes[baselineIndex],'baseline_file_unchanged'); }
    else same(doc.payload,{complete:true,generation:'next',dataset:ref.dataset,nonce:input.nonce},'next_payload_exact');
    documents.push(doc); fileHashes.push(fileHash);
  }
  ensure(current.accountId === input.accountId && current.scope === 'account' && current.datasets.length === 2,'current_full_scope');
  ensure(new Set(current.evidence.map(ref => ref.dataset)).size === 2,'current_dataset_unique');
  for (const ref of current.evidence) ensure(ref.jobId === current.jobId && ref.accountId === current.accountId && ref.capturedAt >= current.platformReadStartedAt && ref.capturedAt <= current.committedAt,'current_ref_job_time_binding');
  const stateDigest = createHash('sha256').update(canonicalJson({current,history,job:observedJob,baselineJob:store.getJob(input.baseline.job.id),references:allReferences,documents,fileHashes})).digest('hex');
  report = {kind:'recovery_checked',nonce:input.nonce,phase:input.phase,pid:process.pid,ownerId:store.ownerId,checks,stateDigest,
    integrityPassed:true,foreignKeysPassed:true,expectedCurrentPassed:true,exactJobsPassed:true,allEvidencePassed:true,
    jobsCount:2,evidenceCount:4,manifestCount:count('manifests'),noRetry:true};
} finally { store.close(); }
writeSync(1,JSON.stringify(report)+'\\n');
`;

function childProgram(body: string): string {
  const storeUrl = new URL(
    `../src/runtime/store.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`,
    import.meta.url,
  ).href;
  return `import {Store,canonicalJson} from ${JSON.stringify(storeUrl)}; import {writeSync,readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; import path from 'node:path';\n${body}`;
}
function startChild(body: string, input: unknown) {
  const child = spawn(
    process.execPath,
    [
      ...(import.meta.url.endsWith('.ts') ? ['--import', 'tsx'] : []),
      '--no-warnings',
      '--input-type=module',
      '-e',
      childProgram(body),
      JSON.stringify(input),
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderrBytes = 0;
  let settled = false;
  let receive!: (value: unknown) => void;
  let rejectPacket!: (error: Error) => void;
  const packet = new Promise<unknown>((resolve, reject) => {
    receive = resolve;
    rejectPacket = reject;
  });
  const packetTimeout = setTimeout(
    () => rejectPacket(new Error('commit_child_packet_timeout')),
    8_000,
  );
  child.stdout!.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    if (Buffer.byteLength(stdout) > 128 * 1024) {
      rejectPacket(new Error('commit_child_output_limit'));
      return;
    }
    const newline = stdout.indexOf('\n');
    if (newline >= 0 && !settled) {
      settled = true;
      clearTimeout(packetTimeout);
      try {
        receive(JSON.parse(stdout.slice(0, newline)));
      } catch {
        rejectPacket(new Error('commit_child_invalid_packet'));
      }
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
  });
  const done = new Promise<Exit>((resolve, reject) => {
    child.once('error', () => {
      clearTimeout(packetTimeout);
      rejectPacket(new Error('commit_child_spawn_failed'));
      reject(new Error('commit_child_spawn_failed'));
    });
    child.once('close', (code, signal) => {
      clearTimeout(packetTimeout);
      if (!settled) rejectPacket(new Error('commit_child_exited_before_packet'));
      resolve({ code, signal, stdout, stderrBytes });
    });
  });
  return { child, packet, done };
}
async function boundedExit(done: Promise<Exit>, milliseconds = 8_000): Promise<Exit> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      done,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('commit_child_exit_timeout')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function stopOwnedChild(child: ChildProcess, done: Promise<Exit>): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await boundedExit(done);
}
function baselineRead(paths: StorePaths, accountId: string, nonce: string): Baseline {
  const store = new Store(paths);
  try {
    const job = store.createJob({
      accountId,
      kind: 'read',
      operation: 'commit-crash-baseline',
      scope: 'account',
      datasets,
      inputHash: digest(`baseline:${nonce}`),
    }).job;
    store.startJob(job.id);
    store.markPlatformReadStarted(job.id);
    const references = datasets.map((dataset) =>
      store.saveEvidence(job.id, dataset, {
        complete: true,
        generation: 'baseline',
        dataset,
        nonce,
      }),
    );
    const manifest = store.completeReadJob(job.id, references);
    return {
      manifest,
      job: store.getJob(job.id)!,
      references,
      documents: references.map((ref) => store.readEvidence(ref)),
      fileHashes: references.map((ref) =>
        digest(readFileSync(path.join(paths.evidenceDirectory, ref.path))),
      ),
    };
  } finally {
    store.close();
  }
}

// Both independent directories wait concurrently for the unmodified default 30s lease.
describe(
  'real SIGKILL at exact manifest transaction commit boundaries',
  { concurrency: true },
  () => {
    for (const phase of ['pre_commit', 'post_commit'] as const)
      test(phase, { timeout: 60_000 }, async (t) => {
        const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-manifest-commit-kill-'));
        const paths: StorePaths = {
          databasePath: path.join(directory, 'runtime.sqlite'),
          evidenceDirectory: path.join(directory, 'evidence'),
          evidenceMode: 'fixture',
        };
        const nonce = randomUUID();
        const accountId = `commit-${phase}`;
        const inputHash = digest(`next:${nonce}`);
        let writer: ReturnType<typeof startChild> | undefined;
        let killed = false;
        try {
          const baseline = baselineRead(paths, accountId, nonce);
          writer = startChild(writerSource, { paths, nonce, accountId, inputHash, phase });
          const gate = (await writer.packet) as Gate;
          assert.equal(
            gate.kind === 'commit_gate' &&
              gate.nonce === nonce &&
              gate.phase === phase &&
              gate.pid === writer.child.pid,
            true,
            'exact spawned child gate',
          );
          assert.equal(gate.commitCalls, 1);
          assert.equal(gate.commitCompleted, phase === 'post_commit');
          assert.equal(gate.callerReturned, false);
          assert.equal(gate.sameConnection, true);
          assert.equal(gate.manifestInserted && gate.currentUpdated && gate.jobSucceeded, true);
          assert.equal(gate.defaultLeaseMs, 30_000);
          assert.equal(Object.hasOwn(paths, 'leaseDurationMs'), false);
          assert.equal(
            gate.leaseExpiresAt > Date.now() && gate.leaseExpiresAt - gate.gatedAt <= 30_000,
            true,
          );
          assert.equal(gate.jobsCount, 2);
          assert.equal(gate.manifestsCount, 2);
          assert.equal(gate.currentCount, 1);
          assert.equal(gate.evidenceCount, 4);
          assert.equal(
            gate.runningJob.accountId === accountId &&
              gate.runningJob.scope === 'account' &&
              gate.runningJob.inputHash === inputHash &&
              gate.runningJob.status === 'running',
            true,
          );
          assert.equal(
            gate.committedJob.id === gate.runningJob.id &&
              gate.manifest.jobId === gate.runningJob.id &&
              gate.manifest.accountId === accountId,
            true,
          );
          assert.equal(canonicalJson(gate.manifest.datasets), canonicalJson(datasets));
          assert.equal(
            canonicalJson(gate.manifest.evidence),
            canonicalJson([...gate.references].sort((a, b) => a.dataset.localeCompare(b.dataset))),
          );
          assert.equal(new Set(gate.references.map((ref) => ref.dataset)).size, 2);
          assert.equal(
            gate.references.every(
              (ref) =>
                ref.accountId === accountId &&
                ref.jobId === gate.runningJob.id &&
                /^[a-f0-9]{64}$/.test(ref.sha256),
            ),
            true,
          );
          assert.equal(writer.child.kill('SIGKILL'), true);
          killed = true;
          const exited = await boundedExit(writer.done);
          assert.equal(exited.code, null);
          assert.equal(exited.signal, 'SIGKILL');
          assert.equal(exited.stdout.trim().split('\n').length, 1);
          assert.equal(exited.stderrBytes, 0);
          // Read-only SQL verifies the crashed owner's exact lease remains, before waiting.
          const db = new DatabaseSync(paths.databasePath, { readOnly: true });
          try {
            const lease = db
              .prepare('SELECT owner_id, expires_at FROM service_lease WHERE id = 1')
              .get()!;
            assert.equal(lease.owner_id, gate.ownerId);
            assert.equal(lease.expires_at, gate.leaseExpiresAt);
          } finally {
            db.close();
          }
          await delay(Math.max(0, gate.leaseExpiresAt - Date.now()) + 100);
          assert.equal(Date.now() >= gate.leaseExpiresAt, true);
          const recoveries: Recovery[] = [];
          for (let attempt = 0; attempt < 2; attempt++) {
            const worker = startChild(recoverySource, {
              paths,
              nonce,
              accountId,
              phase,
              baseline,
              gate,
            });
            try {
              const report = (await worker.packet) as Recovery;
              const outcome = await boundedExit(worker.done);
              assert.equal(outcome.code, 0);
              assert.equal(outcome.signal, null);
              assert.equal(outcome.stderrBytes, 0);
              assert.equal(outcome.stdout.trim().split('\n').length, 1);
              assert.equal(
                report.kind === 'recovery_checked' &&
                  report.nonce === nonce &&
                  report.phase === phase &&
                  report.pid === worker.child.pid &&
                  report.pid !== gate.pid,
                true,
              );
              assert.equal(
                report.ownerId !== gate.ownerId &&
                  (!recoveries.length || report.ownerId !== recoveries[0]!.ownerId),
                true,
              );
              assert.equal(report.checks >= 30, true);
              assert.equal(
                report.integrityPassed &&
                  report.foreignKeysPassed &&
                  report.expectedCurrentPassed &&
                  report.exactJobsPassed &&
                  report.allEvidencePassed &&
                  report.noRetry,
                true,
              );
              assert.equal(report.jobsCount, 2);
              assert.equal(report.evidenceCount, 4);
              assert.equal(report.manifestCount, phase === 'pre_commit' ? 1 : 2);
              assert.match(report.stateDigest, /^[a-f0-9]{64}$/);
              recoveries.push(report);
            } finally {
              await stopOwnedChild(worker.child, worker.done);
            }
          }
          assert.equal(
            recoveries[0]!.stateDigest,
            recoveries[1]!.stateDigest,
            'second fresh recovery preserves complete committed state',
          );
          t.diagnostic(
            JSON.stringify({
              phase,
              signal: exited.signal,
              sameConnectionGate: true,
              defaultLeaseMs: gate.defaultLeaseMs,
              leaseExpiredNormally: true,
              recoveryProcesses: recoveries.length,
              integrityPassed: true,
              noExtraJobs: true,
              evidenceFilesChecked: 4,
              atomicBoundaryPassed: true,
            }),
          );
        } finally {
          if (writer) {
            if (!killed) await stopOwnedChild(writer.child, writer.done);
            else await boundedExit(writer.done);
          }
          rmSync(directory, { recursive: true, force: true });
        }
      });
  },
);
