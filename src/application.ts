import { assertNoPublicReadEntry } from './runtime/public-read.js';
import { type NativeShortProvenance } from './platform/short-native-metadata-proof.js';
import path from 'node:path';
import * as z from 'zod/v4';
import type { APIRequest } from 'playwright';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { Store, RuntimeError, type GenericShortTrustedContext } from './runtime/store.js';
import { JobQueue } from './runtime/jobs.js';
import { BrowserSession, type LoginState } from './platform/browser.js';
import { type CollectionEvidenceProfile } from './platform/reads.js';
import * as writes from './platform/writes.js';
import type { ToolDefinition } from './transport/mcp.js';
import type { Api } from './transport/http.js';
import {
  datasets,
  accountDatasets,
  AccountBinding,
  hashSchema,
  writeBase,
  versionBase,
  loadJson,
  runNativeShortMetadataSaveJob,
} from './application/shared.js';
import type { CoreDependencies } from './application/core.js';
import { composeApplicationServices } from './application/compose.js';
import { registerApplicationTools } from './application/tools/register.js';

export function createApplication(
  config: Config,
  dependencies: {
    browser?: BrowserSession;
    nativeShortBodyFixtureFactory?: Pick<APIRequest, 'newContext'>;
  } = {},
): Api {
  assertNoPublicReadEntry();

  const injectedBrowser = dependencies.browser,
    nativeShortBodyFixtureFactory = dependencies.nativeShortBodyFixtureFactory;

  // Fixture policy is captured once by the Store. Injecting a read Browser alone
  // remains valid for every non-body feature, but never borrows default body IO.
  if (nativeShortBodyFixtureFactory !== undefined && injectedBrowser === undefined)
    throw new RuntimeError(
      'invalid_configuration',
      'A synthetic body factory requires an injected browser.',
    );

  const bodyExecutorEligible =
    injectedBrowser === undefined || nativeShortBodyFixtureFactory !== undefined;

  // Synchronous proof replay needs the operation budget plus cleanup grace; a genuinely expired lease still fails closed.
  const genericShortContexts = new Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >();

  const store = new Store({
    nativeShortSubmissionEvidenceMode: injectedBrowser === undefined ? 'live' : 'fixture',
    genericShortStatusContext: (jobId) => genericShortContexts.get(jobId)?.context ?? null,
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    leaseDurationMs: Math.max(30_000, config.timeoutMs + 30_000),
    evidenceMode: nativeShortBodyFixtureFactory === undefined ? 'live' : 'fixture',
    explicitBodyReadEvidenceMode: injectedBrowser === undefined ? 'live' : 'fixture',
    nativeShortBodyWriteEnabled: config.writesEnabled && bodyExecutorEligible,
    ...(nativeShortBodyFixtureFactory === undefined
      ? {}
      : { nativeShortBodyFixtureFactory: nativeShortBodyFixtureFactory }),
  });

  const queue = new JobQueue(store, { timeoutMs: config.timeoutMs, shutdownTimeoutMs: 25_000 });

  // Store construction above acquires the exclusive service lease before any
  // container-only stale process-lock recovery may touch the browser profile.
  const browser =
    injectedBrowser ??
    new BrowserSession({
      profileDir: config.profileDir,
      headless: config.headless,
      timeoutMs: 20_000,
      operationTimeoutMs: config.timeoutMs,
      recoverStaleProfileLocks: config.recoverStaleProfileLocks,
      assertProfileRecoveryLease: () => store.assertLeaseOwnership(),
    });

  // Dependency origin is application-owned: injected collectors never prove live provenance.
  const directoryApplicationOrigin =
    injectedBrowser === undefined ? ('default' as const) : ('injected' as const);

  const nativeProvenance: NativeShortProvenance =
    injectedBrowser === undefined
      ? { executor: 'application-default-browser/v1', mode: 'live' }
      : { executor: 'dependency-injected-browser/v1', mode: 'fixture' };

  const writeProfiles = loadJson<
    Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
      'long-book'?: writes.UiLongBookMetadataProfile;
    }
  >(config.writeProfilePath);

  const readProfiles = loadJson<
    Partial<Record<'long_works' | 'long_metrics' | 'chapters', CollectionEvidenceProfile>>
  >(config.readProfilePath);

  const bindingFile = path.join(config.dataDir, 'account-binding.json');

  let login: LoginState | null = null;

  let bound = loadJson<AccountBinding>(bindingFile);

  const explicitBodyReadKey = 'explicit_body_read.';

  const tools: ToolDefinition[] = [];

  const bodyTrialSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('preserve') }).strict(),
    z.object({ action: z.literal('clear') }).strict(),
    z.object({ action: z.literal('set'), beforeParagraph: z.number().int().min(0) }).strict(),
  ]);

  const submissionSchema = z
    .object({
      ...writeBase,
      ...versionBase,
      expectedContentHash: hashSchema.optional(),
      snapshotScope: z.string().optional(),
      hashBasis: z.string().optional(),
      expectedSnapshotVersionHash: hashSchema.optional(),
      useAi: z.union([z.literal(1), z.literal(2)]).optional(),
      preparationJobId: z.string().uuid(),
      acceptPublicationTerms: z.literal(true),
    })
    .strict();

  let leaseLossShutdown = false;

  let closing: Promise<void> | undefined;
  const core: CoreDependencies = {
    get store(): CoreDependencies['store'] {
      return store;
    },
    get login(): CoreDependencies['login'] {
      return login;
    },
    set login(value) {
      login = value;
    },
    get bindingFile(): CoreDependencies['bindingFile'] {
      return bindingFile;
    },
    get bound(): CoreDependencies['bound'] {
      return bound;
    },
    set bound(value) {
      bound = value;
    },
    get config(): CoreDependencies['config'] {
      return config;
    },
    get browser(): CoreDependencies['browser'] {
      return browser;
    },
    get explicitBodyReadKey(): CoreDependencies['explicitBodyReadKey'] {
      return explicitBodyReadKey;
    },
    get directoryApplicationOrigin(): CoreDependencies['directoryApplicationOrigin'] {
      return directoryApplicationOrigin;
    },
    get readProfiles(): CoreDependencies['readProfiles'] {
      return readProfiles;
    },
    get queue(): CoreDependencies['queue'] {
      return queue;
    },
    get bodyExecutorEligible(): CoreDependencies['bodyExecutorEligible'] {
      return bodyExecutorEligible;
    },
    get writeProfiles(): CoreDependencies['writeProfiles'] {
      return writeProfiles;
    },
    get nativeProvenance(): CoreDependencies['nativeProvenance'] {
      return nativeProvenance;
    },
    get genericShortContexts(): CoreDependencies['genericShortContexts'] {
      return genericShortContexts;
    },
    get tools(): CoreDependencies['tools'] {
      return tools;
    },
    get leaseLossShutdown(): CoreDependencies['leaseLossShutdown'] {
      return leaseLossShutdown;
    },
    set leaseLossShutdown(value) {
      leaseLossShutdown = value;
    },
    get closing(): CoreDependencies['closing'] {
      return closing;
    },
    set closing(value) {
      closing = value;
    },
    get bodyTrialSchema(): CoreDependencies['bodyTrialSchema'] {
      return bodyTrialSchema;
    },
    get submissionSchema(): CoreDependencies['submissionSchema'] {
      return submissionSchema;
    },
  };
  const services = composeApplicationServices(core);
  const {
    listedJob,
    snapshot,
    refresh,
    capabilities,
    status,
    receiveCover,
    call,
    abortForLeaseLoss,
    closeOwned,
  } = services;
  registerApplicationTools(core, services);

  return {
    tools,
    onServiceLeaseLost(listener) {
      return store.onServiceLeaseLost(listener);
    },
    abortForLeaseLoss,
    assertReadiness() {
      store.assertLeaseOwnership();
    },
    async dispatch(method, pathname, query, body) {
      store.assertPublicReadEntryAllowed();
      if (method === 'GET' && pathname === '/api/v1/status') return status();
      if (method === 'GET' && pathname === '/api/v1/capabilities') return capabilities();
      if (method === 'GET' && pathname === '/api/v1/snapshot')
        return snapshot(query.get('scope') ?? 'account');
      if (method === 'GET' && pathname === '/api/v1/job-summaries') {
        if (query.size !== 0)
          throw new AppError('invalid_input', 'Task summary queries are not supported.');
        return store.listKnownWriteTaskSummaries(config.accountId);
      }
      if (method === 'GET' && pathname === '/api/v1/jobs') {
        try {
          const read = () => ({
            jobs: store.listJobsForPublicProjection(config.accountId).map(listedJob),
          });
          // Permanent loss preserves the existing saved-only fresh read; it never borrows an overview or renews authority.
          return store.hasLostServiceLease()
            ? read()
            : store.withPublicProjectionRead(config.accountId, 'jobs', read);
        } catch {
          throw new RuntimeError('capability_unavailable', 'Saved data is unavailable.');
        }
      }
      if (method === 'GET' && pathname === '/api/v1/history')
        return call('fanqie_list_saved_history', {
          ...(query.has('scope') ? { scope: query.get('scope') } : {}),
          ...(query.has('manifestId') ? { manifestId: query.get('manifestId') } : {}),
          ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {}),
        });
      if (method === 'GET' && pathname.startsWith('/api/v1/jobs/'))
        return call('fanqie_get_job', { jobId: pathname.split('/').at(-1) });
      if (method === 'POST' && pathname === '/api/v1/refresh') {
        const parsed = z
          .object({
            datasets: z
              .array(z.enum(datasets))
              .min(1)
              .default([...accountDatasets]),
          })
          .strict()
          .safeParse(body);
        if (!parsed.success) throw new AppError('invalid_input', 'Invalid refresh datasets');
        const handle = refresh(parsed.data.datasets);
        return { jobId: handle.jobId, job: store.getJob(handle.jobId, config.accountId) };
      }
      if (method === 'POST' && pathname === '/api/v1/login/start')
        return call('fanqie_start_login', {});
      if (method === 'POST' && pathname === '/api/v1/login/qrcode')
        return call('fanqie_get_login_qrcode', body ?? {});
      if (method === 'GET' && pathname === '/api/v1/login/screenshot')
        return { mimeType: 'image/png', data: (await browser.screenshot()).toString('base64') };
      if (method === 'POST' && pathname.startsWith('/api/v1/tools/'))
        return call(pathname.split('/').at(-1)!, body);
      if (method === 'POST' && pathname === '/api/v1/uploads') return receiveCover(body);
      throw new AppError('not_found', 'Endpoint not found', 404);
    },
    close(reason) {
      if (reason === 'lease_lost' || store.hasLostServiceLease())
        return store.runLeaseLossCleanup(() => closeOwned(reason));
      store.assertPublicReadEntryAllowed();
      return closeOwned(reason);
    },
  };
}
export { runNativeShortMetadataSaveJob } from './application/shared.js';
