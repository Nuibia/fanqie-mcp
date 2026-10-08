import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store, type Manifest, type EvidenceRef } from '../src/runtime/store.js';
import { JobQueue } from '../src/runtime/jobs.js';

const modules = Object.fromEntries(
  [
    'application',
    'config',
    'service-lifecycle',
    'platform/browser',
    'runtime/store',
    'runtime/jobs',
    'transport/http',
  ].map((name) => [name, new URL(`../src/${name}.ts`, import.meta.url).href]),
);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function childSource(directory: string, mode: string) {
  return `
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from ${JSON.stringify(modules.application)};
import { loadConfig } from ${JSON.stringify(modules.config)};
import { createServiceLifecycle } from ${JSON.stringify(modules['service-lifecycle'])};
import { BrowserSession } from ${JSON.stringify(modules['platform/browser'])};
import { Store } from ${JSON.stringify(modules['runtime/store'])};
import { JobQueue } from ${JSON.stringify(modules['runtime/jobs'])};
import { createHttpServer } from ${JSON.stringify(modules['transport/http'])};
const directory=${JSON.stringify(directory)},mode=${JSON.stringify(mode)};
const config=loadConfig({ FANQIE_TOKEN:'synthetic-child-token-public-fixture-only',FANQIE_ACCOUNT_ID:'synthetic-reader',FANQIE_DATA_DIR:path.join(directory,'data'),FANQIE_PROFILE_DIR:path.join(directory,'profile'),FANQIE_RUNTIME_DIR:path.join(directory,'runtime') });
let readReady;const reading=new Promise(resolve=>{readReady=resolve});
class FakeBrowser extends BrowserSession {
  closeCalls=0;
  async checkLogin(options={}) { readReady(); await new Promise(resolve=>options.signal.addEventListener('abort',()=>setTimeout(resolve,10),{once:true})); return {status:'unknown',identity:null,sourceUrl:'https://fixture.invalid/no-network',checkedAt:new Date().toISOString()}; }
  async close() { this.closeCalls++;writeFileSync(path.join(directory,'browser-close-calls.txt'),String(this.closeCalls));if(mode==='reject')throw Error('token=PRIVATE_SYNTHETIC_CHILD_ERROR');if(mode==='never')await new Promise(()=>{}); }
  async withPage() { throw Error('Synthetic child forbids any platform work'); }
}
const browser=new FakeBrowser({profileDir:config.profileDir,headless:true});const application=createApplication(config,{browser});
let store,queue;const originalAssert=Store.prototype.assertLeaseOwnership;Store.prototype.assertLeaseOwnership=function(){store=this;return originalAssert.call(this)};application.assertReadiness();Store.prototype.assertLeaseOwnership=originalAssert;
const baseline=store.createJob({accountId:config.accountId,kind:'read',operation:'synthetic_baseline',datasets:['works']}).job;store.startJob(baseline.id);store.markPlatformReadStarted(baseline.id);store.completeReadJob(baseline.id,[store.saveEvidence(baseline.id,'works',{complete:true,works:[]})]);
const previousCurrent=store.getCurrent(config.accountId),frozenEvidence=store.listEvidence(baseline.id);
const originalEnqueue=JobQueue.prototype.enqueueRead;JobQueue.prototype.enqueueRead=function(...args){queue=this;return originalEnqueue.apply(this,args)};
const login=application.tools.find(tool=>tool.name==='fanqie_check_login_status').run({});void login.catch(()=>{});JobQueue.prototype.enqueueRead=originalEnqueue;await reading;
const readJob=store.listJobs(config.accountId).find(job=>job.operation==='check_login');
let writeReady;const writing=new Promise(resolve=>{writeReady=resolve});
const write=queue.enqueueWrite({accountId:'synthetic-writer',operation:'synthetic_effect',idempotencyKey:'synthetic-sticky-effect',inputHash:'1'.repeat(64),run:async ctx=>{ctx.beforePlatformWrite();writeFileSync(path.join(directory,'effects.txt'),'1');writeReady();await new Promise(resolve=>ctx.signal.addEventListener('abort',()=>setTimeout(resolve,10),{once:true}));return {saved:true};}});void write.completion.catch(()=>{});await writing;
const queued=queue.enqueueWrite({accountId:'synthetic-writer',operation:'synthetic_queued',idempotencyKey:'synthetic-never-start',inputHash:'2'.repeat(64),run:async()=>{writeFileSync(path.join(directory,'effects.txt'),'2');return {saved:true};}});void queued.completion.catch(()=>{});
writeFileSync(path.join(directory,'prepared.json'),JSON.stringify({readJobId:readJob.id,writeJobId:write.jobId,queuedJobId:queued.jobId,previousCurrent,frozenEvidence,accountId:config.accountId}));
const transport=createHttpServer(config,application);const lifecycle=createServiceLifecycle({fatalTimeoutMs:180,close:()=>transport.close(),abortForLeaseLoss:()=>transport.abortForLeaseLoss(),exit:code=>process.exit(code),log:message=>console.error(message)});
transport.onServiceLeaseLost(()=>lifecycle.stop('lease_lost'));let normalStarted;const normalStopStarted=new Promise(resolve=>{normalStarted=resolve});process.on('SIGTERM',()=>{lifecycle.stop();normalStarted()});
if(mode==='normal-then-lost'){process.kill(process.pid,'SIGTERM');await normalStopStarted;await Promise.resolve();if(!store.getJob(write.jobId).cancellationRequestedAt)throw Error('Synthetic normal cancellation boundary was not observed');}
const database=new DatabaseSync(path.join(config.dataDir,'operations.sqlite'));database.prepare('UPDATE service_lease SET expires_at=? WHERE id=1').run(Date.now()-1);
try{application.assertReadiness()}catch{}database.close();
`;
}

function runChild(source: string): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (bytes) => {
      stdout += bytes.toString();
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString();
    });
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Synthetic child exceeded 10 seconds: ${stderr}`));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(watchdog);
      resolve({ exitCode, signal, stdout, stderr, elapsedMs: Date.now() - started });
    });
  });
}

for (const mode of ['clean', 'reject', 'never', 'normal-then-lost']) {
  test(`real fatal child ${mode} exits1 and recovery preserves evidence/current without replaying unknown writes`, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-real-fatal-child-'));
    let reopened: Store | undefined, queue: JobQueue | undefined;
    try {
      const result = await runChild(childSource(directory, mode));
      console.log('CHILD_ATTEMPT ' + JSON.stringify({ mode, ...result }));
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.signal, null);
      assert.equal((result.stderr.match(/service_lease_lost/g) ?? []).length, 1, result.stderr);
      assert(!result.stderr.includes('PRIVATE_SYNTHETIC_CHILD_ERROR'));
      assert(result.elapsedMs < 10_000);
      assert.equal(readFileSync(path.join(directory, 'browser-close-calls.txt'), 'utf8'), '1');
      assert.equal(readFileSync(path.join(directory, 'effects.txt'), 'utf8'), '1');
      if (mode === 'reject' || mode === 'never')
        assert.match(result.stderr, /service_fatal_deadline/);
      else assert(!result.stderr.includes('service_fatal_deadline'));
      const before = JSON.parse(readFileSync(path.join(directory, 'prepared.json'), 'utf8')) as {
        readJobId: string;
        writeJobId: string;
        queuedJobId: string;
        accountId: string;
        previousCurrent: Manifest;
        frozenEvidence: EvidenceRef[];
      };
      const evidenceHashes = before.frozenEvidence.map((ref) =>
        sha(readFileSync(path.join(directory, 'data/evidence', ref.path))),
      );
      reopened = new Store({
        databasePath: path.join(directory, 'data/operations.sqlite'),
        evidenceDirectory: path.join(directory, 'data/evidence'),
      });
      assert.equal(reopened.getJob(before.readJobId)?.status, 'failed');
      assert.equal(reopened.getJob(before.readJobId)?.error?.code, 'interrupted');
      assert.equal(reopened.getJob(before.writeJobId)?.status, 'uncertain');
      assert.equal(reopened.getJob(before.writeJobId)?.error?.code, 'outcome_unknown');
      assert.equal(
        reopened.getJob(before.queuedJobId)?.status,
        mode === 'normal-then-lost' ? 'cancelled' : 'failed',
      );
      assert.deepEqual(reopened.getCurrent(before.accountId), before.previousCurrent);
      assert.deepEqual(
        before.frozenEvidence.map((ref) =>
          sha(readFileSync(path.join(directory, 'data/evidence', ref.path))),
        ),
        evidenceHashes,
      );
      for (const ref of before.frozenEvidence)
        assert.equal(reopened.readEvidence(ref).dataset, ref.dataset);
      queue = new JobQueue(reopened);
      let replayCalls = 0;
      const retry = await queue.enqueueWrite({
        accountId: 'synthetic-writer',
        operation: 'synthetic_effect',
        idempotencyKey: 'synthetic-sticky-effect',
        inputHash: '1'.repeat(64),
        run: async () => {
          replayCalls++;
          return { saved: true };
        },
      }).completion;
      assert.equal(retry.id, before.writeJobId);
      assert.equal(retry.status, 'uncertain');
      assert.equal(replayCalls, 0);
      assert.equal(readFileSync(path.join(directory, 'effects.txt'), 'utf8'), '1');
      console.log(
        'CHILD_RECEIPT ' +
          JSON.stringify({
            mode,
            exitCode: result.exitCode,
            signal: result.signal,
            elapsedMs: result.elapsedMs,
            fixedEvents: result.stderr.split('\n').filter((line) => line.startsWith('service_')),
            recoveredRead: 'failed/interrupted',
            recoveredWrite: 'uncertain/outcome_unknown',
            effectCounter: 1,
            replayCalls,
            currentUnchanged: true,
            evidenceHashesUnchanged: true,
          }),
      );
    } finally {
      await queue?.drainAndStop();
      reopened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
