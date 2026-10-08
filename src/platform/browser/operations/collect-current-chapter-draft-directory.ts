import { type Page, type Request, type Route } from 'playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import { type DatasetResult, makeDataset, type ChapterDraftRecord } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type CurrentChapterDirectoryOptions } from '../contracts.js';
import { chapterDirectoryWorkId } from '../chapter-routes.js';
import { currentChapterFailureMetadata } from '../chapter-dom.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
import { type OwnsPageSlotOperation } from '../contracts/owns-page-slot.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type OpenExistingChapterDirectoryOperation } from '../contracts/open-existing-chapter-directory.js';
import { type OpenOwnedChapterDraftTabOperation } from '../contracts/open-owned-chapter-draft-tab.js';
import { type ReadCurrentChapterDraftContextOperation } from '../contracts/read-current-chapter-draft-context.js';
import { type CollectCurrentChapterDraftDirectoryOperation } from '../contracts/collect-current-chapter-draft-directory.js';
interface Dependencies {
  assertAccountUsable: AssertAccountUsableOperation;
  ownsPageSlot: OwnsPageSlotOperation;
  pageSlots: AsyncLocalStorage<BrowserPageSlot>;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  config: BrowserSessionConfig;
  identityEpoch: number;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  waitForWriterReady: WaitForWriterReadyOperation;
  openExistingChapterDirectory: OpenExistingChapterDirectoryOperation;
  openOwnedChapterDraftTab: OpenOwnedChapterDraftTabOperation;
  readCurrentChapterDraftContext: ReadCurrentChapterDraftContextOperation;
}
export function createCollectCurrentChapterDraftDirectory(
  deps: Dependencies,
): CollectCurrentChapterDraftDirectoryOperation {
  async function collectCurrentChapterDraftDirectory(
    page: Page,
    workId: string,
    options: CurrentChapterDirectoryOptions,
  ): Promise<DatasetResult<ChapterDraftRecord>> {
    deps.assertAccountUsable();
    if (!deps.ownsPageSlot(page))
      throw new BrowserSessionError(
        'chapter_directory_slot_required',
        'The current chapter read requires its service-owned browser slot',
      );
    const slot = deps.pageSlots.getStore()!;
    const directory = makeDataset<ChapterDraftRecord>(
      'chapter_drafts',
      'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}',
    );
    directory.limitations.push(
      'Only this work’s draft-list namespace can be completed. Published chapter and management scopes are unchanged. No body, editor, create, delete or save action is read.',
      'Draft fields are a fixed official-client candidate, verified at runtime. Raw modification times retain their platform type.',
      'At most 64 pages and 64 retained next-list control actions, 100000 records and one nonrenewable 60-second traversal are allowed. Actual natural GET URLs are replayed unchanged without transport retries.',
      'capturedAt is the final connected canonical cutoff; delivery requires completed cleanup and no observed late violation. Multiple GETs are not an atomic platform revision.',
    );
    const deadline = performance.now() + Math.min(60_000, Math.max(1, options.timeoutMs ?? 60_000));
    let entryViolated = false,
      managerGuarded = false;
    const assertSlot = () => {
      if (options.signal?.aborted)
        throw new BrowserSessionError('cancelled', 'The current chapter read was cancelled');
      if (performance.now() >= deadline)
        throw new BrowserSessionError(
          'chapter_draft_budget_exceeded',
          'The draft-directory budget expired',
        );
      if (entryViolated)
        throw new BrowserSessionError(
          'read_document_changed',
          'The current management entry left its read boundary',
        );
      if (!deps.isCurrentPageSlot(slot, page))
        throw new BrowserSessionError(
          'chapter_directory_slot_required',
          'The current chapter read requires its service-owned browser slot',
        );
    };
    assertSlot();
    if (
      !/^[1-9]\d{9,29}$/.test(workId) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options.jobId) ||
      !['account', 'author'].includes(options.expectedOwner.kind) ||
      !/^\d{1,30}$/.test(options.expectedOwner.id)
    )
      throw new BrowserSessionError(
        'capability_unavailable',
        'The current chapter read requires a fixed job, work and typed own identity',
      );
    const failureMetadata = currentChapterFailureMetadata(options.expectedOwner.kind);
    const timeout = Math.max(
      1,
      Math.min(12_000, options.timeoutMs ?? deps.config.timeoutMs ?? 12_000),
    );
    const sources = new Set<string>(),
      epochs = new WeakMap<Request, number>();
    const matches = (raw: string) => {
      try {
        const url = new URL(raw);
        return (
          url.origin === 'https://fanqienovel.com' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          url.pathname === '/api/author/book/book_list/v0/' &&
          new Set(url.searchParams.keys()).size === url.searchParams.size &&
          ![...url.searchParams.keys()].some((key) =>
            /^(?:book|work|author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id)$/i.test(
              key,
            ),
          )
        );
      } catch {
        return false;
      }
    };
    const onRequest = (request: Request) => {
      try {
        assertSlot();
        if (request.method() === 'GET' && request.frame() === page.mainFrame())
          epochs.set(request, deps.identityEpoch);
      } catch {
        /* No unverifiable management request is adopted. */
      }
    };
    const onNavigation = (frame: unknown) => {
      if (deps.isCurrentPageSlot(slot, page) && frame === page.mainFrame()) sources.clear();
    };
    const onResponse = (response: { url(): string; status(): number; request(): Request }) => {
      try {
        assertSlot();
        const request = response.request();
        if (
          request.method() === 'GET' &&
          request.frame() === page.mainFrame() &&
          epochs.get(request) === deps.identityEpoch &&
          response.status() >= 200 &&
          response.status() < 300 &&
          matches(response.url()) &&
          sources.size < 2
        )
          sources.add(response.url());
      } catch {
        /* A response cannot escape its current management document. */
      }
    };
    const managerPending = new Set<Promise<void>>();
    const handleManagerRoute = async (route: Route) => {
      const request = route.request();
      let navigation: boolean | null = null,
        permitted = false;
      try {
        const url = new URL(request.url());
        navigation = request.isNavigationRequest();
        permitted =
          typeof navigation === 'boolean' &&
          ['GET', 'HEAD'].includes(request.method()) &&
          ['https:', 'http:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.hash;
        if (
          url.origin === 'https://fanqienovel.com' &&
          /(?:^|[\/_-])(?:create|new|edit|editor|publish|submit|delete|save|update|upload|sign|pay|withdraw)(?:[\/_-]|$)/i.test(
            url.pathname,
          )
        )
          permitted = false;
        if (
          navigation &&
          (request.frame() !== page.mainFrame() ||
            url.origin !== 'https://fanqienovel.com' ||
            !(
              url.pathname === '/main/writer/book-manage' ||
              chapterDirectoryWorkId(url.toString()) === workId
            ))
        )
          permitted = false;
      } catch {
        permitted = false;
      }
      if (!permitted) {
        if (navigation !== false) entryViolated = true;
        try {
          await route.abort('blockedbyclient');
        } catch {
          entryViolated = true;
        }
        return;
      }
      try {
        await route.continue();
      } catch {
        entryViolated = true;
      }
    };
    const managerReadOnlyRoute = (route: Route) => {
      const task = handleManagerRoute(route);
      managerPending.add(task);
      return task.finally(() => {
        managerPending.delete(task);
      });
    };
    page.on('request', onRequest);
    page.on('framenavigated', onNavigation);
    page.on('response', onResponse);
    let targetRef: string | null = null;
    try {
      await page.route('**/*', managerReadOnlyRoute);
      managerGuarded = true;
      assertSlot();
      const initial = await deps.verifyCurrentAccount(page);
      assertSlot();
      const sameOwner = (state: LoginState) =>
        state.status === 'authenticated' &&
        (options.expectedOwner.kind === 'account'
          ? state.identity?.accountId
          : state.identity?.authorId) === options.expectedOwner.id;
      if (!sameOwner(initial))
        throw new BrowserSessionError(
          'account_mismatch',
          'The current own identity does not match the fixed chapter read account',
        );
      await page.goto('https://fanqienovel.com/main/writer/book-manage', {
        waitUntil: 'domcontentloaded',
      });
      await page
        .waitForLoadState('networkidle', { timeout: Math.min(4_000, timeout) })
        .catch(() => undefined);
      assertSlot();
      if (!(await deps.waitForWriterReady(page, timeout)))
        throw new BrowserSessionError(
          'capability_unavailable',
          'The current management shell is unavailable',
        );
      const manager = await deps.verifyCurrentAccount(page);
      assertSlot();
      if (!sameOwner(manager))
        throw new BrowserSessionError(
          'account_mismatch',
          'The current own identity changed before chapter entry',
        );
      if (!sources.size)
        try {
          await page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              epochs.get(response.request()) === deps.identityEpoch &&
              matches(response.url()),
            { timeout },
          );
        } catch {
          /* Never invent a management URL. */
        }
      assertSlot();
      if (sources.size !== 1)
        throw new BrowserSessionError(
          'capability_unavailable',
          'The current management list source is missing or ambiguous',
        );
      const entry = await deps.openExistingChapterDirectory(
        page,
        sources,
        workId,
        manager,
        Math.max(1, Math.min(timeout, deadline - performance.now())),
      );
      assertSlot();
      if (entry.entry.status !== 'opened' || !entry.entry.targetRef || !sameOwner(entry.login))
        throw new BrowserSessionError(
          'capability_unavailable',
          'The verified current chapter entry is unavailable',
        );
      targetRef = entry.entry.targetRef;
    } catch (error) {
      directory.errors.push({
        code: error instanceof BrowserSessionError ? error.code : 'chapter_directory_unavailable',
        scope: 'chapter_drafts',
      });

      return directory;
    } finally {
      try {
        if (managerGuarded) await page.unroute('**/*', managerReadOnlyRoute);
      } catch {
        entryViolated = true;
      }
      while (managerPending.size) await Promise.allSettled([...managerPending]);
      page.off('request', onRequest);
      page.off('framenavigated', onNavigation);
      page.off('response', onResponse);
      sources.clear();
    }
    if (entryViolated) {
      directory.errors.push({ code: 'read_document_changed', scope: 'chapter_drafts' });
      failureMetadata.failedStage = 'cleanup';
      return directory;
    }
    try {
      targetRef = await deps.openOwnedChapterDraftTab(page, targetRef!, options, deadline);
      await deps.readCurrentChapterDraftContext(
        page,
        targetRef,
        options,
        { result: directory, options, failureMetadata },
        deadline,
      );
    } catch (error) {
      directory.status = 'capability_unavailable';
      directory.records = [];
      directory.coverage.complete = directory.coverage.paginationComplete = false;
      directory.coverage.pagesFetched = directory.coverage.recordsFetched = 0;
      directory.coverage.fields = [];
      directory.coverage.totalRecords = directory.coverage.pagesDiscovered = null;
      directory.errors.push({
        code: error instanceof BrowserSessionError ? error.code : 'chapter_draft_entry_unavailable',
        scope: 'chapter_drafts',
      });
    }
    return directory;
  }
  return collectCurrentChapterDraftDirectory;
}
