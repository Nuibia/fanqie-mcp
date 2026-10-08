import { type Page, type Request, type Route } from 'playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import { type DatasetResult, type ChapterRecord, makeDataset } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import {
  type BrowserSessionConfig,
  type CurrentChapterDirectoryOptions,
  type CurrentChapterBodyRead,
} from '../contracts.js';
import { chapterDirectoryWorkId } from '../chapter-routes.js';
import { currentChapterFailureMetadata } from '../chapter-dom.js';
import { type OwnsPageSlotOperation } from '../contracts/owns-page-slot.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type OpenExistingChapterDirectoryOperation } from '../contracts/open-existing-chapter-directory.js';
import { type ReadCurrentChapterContextOperation } from '../contracts/read-current-chapter-context.js';
import { type CollectChapterDirectoryReadOperation } from '../contracts/collect-chapter-directory-read.js';
interface Dependencies {
  ownsPageSlot: OwnsPageSlotOperation;
  pageSlots: AsyncLocalStorage<BrowserPageSlot>;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  config: BrowserSessionConfig;
  identityEpoch: number;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  waitForWriterReady: WaitForWriterReadyOperation;
  openExistingChapterDirectory: OpenExistingChapterDirectoryOperation;
  readCurrentChapterContext: ReadCurrentChapterContextOperation;
}
export function createCollectChapterDirectoryRead(
  deps: Dependencies,
): CollectChapterDirectoryReadOperation {
  async function collectChapterDirectoryRead(
    page: Page,
    workId: string,
    options: CurrentChapterDirectoryOptions,
    bodyRead?: CurrentChapterBodyRead,
  ): Promise<DatasetResult<ChapterRecord>> {
    if (!deps.ownsPageSlot(page))
      throw new BrowserSessionError(
        'chapter_directory_slot_required',
        'The current chapter read requires its service-owned browser slot',
      );
    const slot = deps.pageSlots.getStore()!;
    const directory = makeDataset<ChapterRecord>(
      'chapters',
      'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}',
    );
    directory.limitations.push(
      'Management volume/page coverage is reported separately from the generic chapter scope. Draft coverage remains unverified and this attempt cannot advance a complete generic snapshot.',
      'Directory status codes and time strings remain raw. No chapter body, editor or write route is read.',
      'At most two volume inventory GETs, two book detail GETs, 64 distinct chapter page GETs and two sequential own-account GET checks are performed inside the connected owned CDP bracket. At most 64 read-only list actions and 60 seconds of management traversal are allowed. These are distinct checks, never transport retries.',
      'capturedAt is the last connected canonical proof cutoff on a valid partial read; cleanup must still succeed. This multi-GET observation is not an atomic platform revision or a statistics cutoff.',
    );
    let entryViolated = false,
      managerGuarded = false;
    const assertSlot = () => {
      if (options.signal?.aborted)
        throw new BrowserSessionError('cancelled', 'The current chapter read was cancelled');
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
        timeout,
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
        scope: 'chapters',
      });
      directory.readDiagnostics = { currentChapterCollection: failureMetadata };
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
      directory.errors.push({ code: 'read_document_changed', scope: 'chapters' });
      failureMetadata.failedStage = 'cleanup';
      directory.readDiagnostics = { currentChapterCollection: failureMetadata };
      return directory;
    }
    await deps.readCurrentChapterContext(page, targetRef!, options, {
      result: directory,
      options,
      failureMetadata,
      ...(bodyRead ? { bodyRead } : {}),
    });
    return directory;
  }
  return collectChapterDirectoryRead;
}
