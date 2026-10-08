import { type BrowserContext, type Page, type Request, type Route } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserCallOptions } from '../contracts.js';
import {
  validateDiagnosticSource,
  chapterDirectoryWorkId,
  projectChapterGetQuerySchema,
} from '../chapter-routes.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type PrepareChapterDiagnosticOperation } from '../contracts/prepare-chapter-diagnostic.js';
interface Dependencies {
  activePageSlot: BrowserPageSlot | null;
  diagnosticTargets: Map<string, string>;
  chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
  discoveredStableTargets: Set<string>;
  context: BrowserContext | null;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  identityEpoch: number;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
}
export function createPrepareChapterDiagnostic(
  deps: Dependencies,
): PrepareChapterDiagnosticOperation {
  async function prepareChapterDiagnostic(
    page: Page,
    targetRef: string,
    before: LoginState,
    timeoutMs: number,
    options: BrowserCallOptions,
  ) {
    const slot = deps.activePageSlot;
    const raw = deps.diagnosticTargets.get(targetRef),
      binding = deps.chapterTargetOwners.get(targetRef);
    if (!raw || !binding)
      throw new BrowserSessionError(
        'capability_unavailable',
        'The chapter diagnostic requires its registered current-work target',
      );
    const target = validateDiagnosticSource(raw, deps.discoveredStableTargets),
      workId = chapterDirectoryWorkId(raw),
      context = deps.context;
    const ownerMatches = (state: LoginState) =>
      state.status === 'authenticated' &&
      (binding.kind === 'account' ? state.identity?.accountId : state.identity?.authorId) ===
        binding.id;
    if (!workId || !context || page.context() !== context || !ownerMatches(before))
      throw new BrowserSessionError(
        'capability_unavailable',
        'The chapter diagnostic requires the current typed owner and context',
      );
    const deadline = performance.now() + timeoutMs;
    let violated = false,
      guarded = false,
      fullGoto = false,
      closed = false,
      frozenEpoch: number | null = null,
      generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null,
      wake: (() => void) | null = null;
    const requests = new WeakMap<Request, { generation: number; epoch: number }>(),
      sources = new Set<string>(),
      pending = new Set<Promise<void>>();
    const assertCurrent = () => {
      if (
        options.signal?.aborted ||
        violated ||
        closed ||
        !deps.isCurrentPageSlot(slot, page) ||
        deps.context !== context ||
        page.context() !== context ||
        page.url() !== target.toString() ||
        (frozenEpoch !== null && frozenEpoch !== deps.identityEpoch)
      )
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The chapter structure read boundary changed',
        );
    };
    const matches = (request: Request): boolean => {
      try {
        const url = new URL(request.url());
        return (
          request.method() === 'GET' &&
          ['xhr', 'fetch'].includes(request.resourceType()) &&
          request.frame() === page.mainFrame() &&
          url.origin === 'https://fanqienovel.com' &&
          url.pathname === '/api/author/chapter/chapter_list/v1' &&
          projectChapterGetQuerySchema(request.url(), workId).replayBoundToCurrentWork
        );
      } catch {
        return false;
      }
    };
    const onRequest = (request: Request) => {
      try {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          (!fullGoto || request.url() !== target.toString())
        )
          violated = true;
        if (matches(request)) requests.set(request, { generation, epoch: deps.identityEpoch });
      } catch {
        violated = true;
      }
      wake?.();
    };
    const onNavigation = (frame: unknown) => {
      try {
        if (frame === page.mainFrame()) {
          generation += 1;
          sources.clear();
          if (frozenEpoch !== null || page.url() !== target.toString()) violated = true;
        }
      } catch {
        violated = true;
      }
      wake?.();
    };
    const onResponse = (response: { request(): Request; url(): string; status(): number }) => {
      try {
        const request = response.request(),
          observed = requests.get(request);
        if (
          observed?.generation === generation &&
          observed.epoch === deps.identityEpoch &&
          matches(request) &&
          response.url() === request.url() &&
          response.status() >= 200 &&
          response.status() < 300 &&
          sources.size < 2
        )
          sources.add(response.url());
      } catch {
        /* Unverifiable responses cannot establish readiness. */
      }
      wake?.();
    };
    const onClosed = () => {
      violated = true;
      wake?.();
    };
    const handleRoute = async (route: Route) => {
      let navigation: boolean | null = null,
        blocked = false;
      try {
        const request = route.request(),
          url = new URL(request.url());
        navigation = request.isNavigationRequest();
        const wrongParent = ['book_id', 'bookId', 'work_id', 'workId'].some(
          (key) =>
            url.searchParams.getAll(key).length > 1 ||
            (url.searchParams.has(key) && url.searchParams.get(key) !== workId),
        );
        const writePath =
          url.origin === 'https://fanqienovel.com' &&
          /(?:^|[\/_-])(?:create|new|edit|editor|publish|submit|delete|save|update|upload|sign|pay|withdraw)(?:[\/_-]|$)/i.test(
            url.pathname,
          );
        blocked =
          !['GET', 'HEAD'].includes(request.method()) ||
          !['https:', 'http:'].includes(url.protocol) ||
          Boolean(url.username || url.password || url.hash) ||
          wrongParent ||
          writePath;
        if (wrongParent || writePath) violated = true;
        if (
          navigation &&
          (request.frame() !== page.mainFrame() ||
            !fullGoto ||
            url.toString() !== target.toString())
        ) {
          blocked = true;
          violated = true;
        }
        if (blocked && navigation !== false) violated = true;
      } catch {
        blocked = true;
        violated = true;
      }
      try {
        if (blocked) await route.abort('blockedbyclient');
        else await route.continue();
      } catch {
        violated = true;
      }
      wake?.();
    };
    const readOnlyRoute = (route: Route) => {
      const task = handleRoute(route);
      pending.add(task);
      return task.finally(() => pending.delete(task));
    };
    const stopWait = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      wake = null;
    };
    const close = async () => {
      stopWait();
      try {
        let cleanupFailed = false;
        if (guarded)
          try {
            await page.unroute('**/*', readOnlyRoute);
          } catch {
            cleanupFailed = true;
          }
        // Even a failed unroute cannot release this FIFO while route handlers are alive.
        while (pending.size) await Promise.allSettled([...pending]);
        if (cleanupFailed)
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The chapter structure route cleanup did not complete',
          );
        assertCurrent();
      } catch {
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The chapter structure read boundary changed during cleanup',
        );
      } finally {
        closed = true;
        page.off('request', onRequest);
        page.off('framenavigated', onNavigation);
        page.off('response', onResponse);
        page.off('close', onClosed);
        options.signal?.removeEventListener('abort', onClosed);
      }
    };
    page.on('request', onRequest);
    page.on('framenavigated', onNavigation);
    page.on('response', onResponse);
    page.on('close', onClosed);
    options.signal?.addEventListener('abort', onClosed, { once: true });
    let login = before,
      ready = false;
    try {
      await page.route('**/*', readOnlyRoute);
      guarded = true;
      fullGoto = true;
      try {
        await page.goto(target.toString(), {
          waitUntil: 'domcontentloaded',
          timeout: Math.max(1, deadline - performance.now()),
        });
      } finally {
        fullGoto = false;
      }
      assertCurrent();
      await page.waitForFunction(
        () => {
          const visible = (element: Element) => {
            const box = element.getBoundingClientRect(),
              style = getComputedStyle(element);
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0'
            );
          };
          const table = document.querySelector('.chapter-table');
          return (
            table !== null &&
            visible(table) &&
            [...document.querySelectorAll('.chapter-manage-tabs [role="tab"]')].some(
              (tab) =>
                visible(tab) &&
                new Set(['章节管理', '已发布', '已发布章节']).has(tab.textContent?.trim() ?? '') &&
                (tab.getAttribute('aria-selected') === 'true' ||
                  (tab.getAttribute('class') ?? '')
                    .split(/\s+/)
                    .includes('arco-tabs-header-title-active')),
            )
          );
        },
        undefined,
        { timeout: Math.max(1, deadline - performance.now()) },
      );
      assertCurrent();
      if (sources.size === 0 && performance.now() < deadline)
        await new Promise<void>((resolve) => {
          wake = () => {
            if (
              sources.size > 0 ||
              violated ||
              options.signal?.aborted ||
              page.isClosed() ||
              performance.now() >= deadline
            ) {
              stopWait();
              resolve();
            }
          };
          timer = setTimeout(
            () => {
              stopWait();
              resolve();
            },
            Math.max(1, deadline - performance.now()),
          );
          wake();
        });
      assertCurrent();
      if (performance.now() < deadline && sources.size === 1) {
        const epoch = deps.identityEpoch;
        login = await deps.verifyCurrentAccount(page);
        assertCurrent();
        ready =
          performance.now() < deadline &&
          epoch === deps.identityEpoch &&
          sources.size === 1 &&
          ownerMatches(login);
        if (!ownerMatches(login)) violated = true;
      }
      frozenEpoch = deps.identityEpoch;
    } catch (error) {
      if (error instanceof BrowserSessionError || violated || options.signal?.aborted) {
        await close();
        throw error instanceof BrowserSessionError
          ? error
          : new BrowserSessionError(
              'read_diagnostic_stale',
              'The chapter structure read boundary changed',
            );
      }
      // Timeout never proves an empty directory. Static metadata can still describe the unready page.
      frozenEpoch = deps.identityEpoch;
    }
    const openVolumeOptions = async (): Promise<LoginState> => {
      assertCurrent();
      if (!ready)
        throw new BrowserSessionError(
          'capability_unavailable',
          'The chapter management structure is not ready for a list-control observation',
        );
      const actionDeadline = performance.now() + Math.min(timeoutMs, 8_000);
      const checkAction = () => {
        assertCurrent();
        if (performance.now() >= actionDeadline)
          throw new BrowserSessionError(
            'capability_unavailable',
            'The chapter volume-control observation timed out',
          );
      };
      login = await deps.verifyCurrentAccount(page);
      checkAction();
      if (!ownerMatches(login))
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The chapter volume-control owner changed',
        );
      const handles: Array<{ dispose(): Promise<void> }> = [];
      try {
        const selected = await page.evaluateHandle(() => {
          const visible = (element: Element) => {
            const box = element.getBoundingClientRect(),
              style = getComputedStyle(element);
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0'
            );
          };
          const disabled = (element: Element) =>
            element.hasAttribute('disabled') ||
            element.getAttribute('aria-disabled') === 'true' ||
            (element.tagName === 'BUTTON' && element.getAttribute('type') === 'submit');
          const controls = [
            ...document.querySelectorAll('.chapter-select-left .serial-select'),
          ].filter(
            (element) =>
              visible(element) &&
              !(element.getAttribute('class') ?? '').split(/\s+/).includes('chapter-status-select'),
          );
          if (controls.length !== 1 || disabled(controls[0]!)) return { control: null, view: null };
          const views = [...controls[0]!.querySelectorAll('.byte-select-view')].filter(visible);
          return views.length === 1 && !disabled(views[0]!)
            ? { control: controls[0]!, view: views[0]! }
            : { control: null, view: null };
        });
        handles.push(selected);
        checkAction();
        const controlRef = await selected.getProperty('control');
        handles.push(controlRef);
        checkAction();
        const viewRef = await selected.getProperty('view');
        handles.push(viewRef);
        checkAction();
        const control = controlRef.asElement(),
          view = viewRef.asElement();
        if (!control || !view)
          throw new BrowserSessionError(
            'capability_unavailable',
            'The existing volume list control is not unique and available',
          );
        const bound = await view.evaluate((node, originalControl) => {
          const visible = (element: Element) => {
            const box = element.getBoundingClientRect(),
              style = getComputedStyle(element);
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0'
            );
          };
          const disabled = (element: Element) =>
            element.hasAttribute('disabled') ||
            element.getAttribute('aria-disabled') === 'true' ||
            (element.tagName === 'BUTTON' && element.getAttribute('type') === 'submit');
          const controls = [
            ...document.querySelectorAll('.chapter-select-left .serial-select'),
          ].filter(
            (element) =>
              visible(element) &&
              !(element.getAttribute('class') ?? '').split(/\s+/).includes('chapter-status-select'),
          );
          if (
            !node.isConnected ||
            !originalControl.isConnected ||
            controls.length !== 1 ||
            controls[0] !== originalControl ||
            disabled(originalControl)
          )
            return false;
          const views = [...originalControl.querySelectorAll('.byte-select-view')].filter(visible);
          return views.length === 1 && views[0] === node && !disabled(node);
        }, control);
        checkAction();
        if (!bound)
          throw new BrowserSessionError(
            'capability_unavailable',
            'The verified volume list control changed',
          );
        await view.click({
          timeout: Math.max(1, actionDeadline - performance.now()),
          noWaitAfter: true,
        });
        checkAction();
        login = await deps.verifyCurrentAccount(page);
        checkAction();
        if (!ownerMatches(login))
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The chapter volume-control owner changed',
          );
      } catch (error) {
        if (error instanceof BrowserSessionError) throw error;
        throw new BrowserSessionError(
          'capability_unavailable',
          'The verified volume list-control observation could not complete',
        );
      } finally {
        const disposed = await Promise.allSettled(handles.map((handle) => handle.dispose()));
        if (disposed.some((result) => result.status === 'rejected'))
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The volume list-control handles could not be released',
          );
        checkAction();
      }
      return login;
    };
    return { ready, login, assertCurrent, close, openVolumeOptions };
  }
  return prepareChapterDiagnostic;
}
