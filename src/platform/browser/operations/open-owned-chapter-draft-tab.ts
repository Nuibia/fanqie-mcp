import { type BrowserContext, type Page, type Request, type Route } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';
import { BrowserSessionError } from '../errors.js';
import { type CurrentChapterDirectoryOptions } from '../contracts.js';
import { validateDiagnosticSource, chapterDirectoryWorkId } from '../chapter-routes.js';
import { createHash } from 'node:crypto';
import { currentDraftDirectoryDom } from '../chapter-dom.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type OpenOwnedChapterDraftTabOperation } from '../contracts/open-owned-chapter-draft-tab.js';
interface Dependencies {
  activePageSlot: BrowserPageSlot | null;
  diagnosticTargets: Map<string, string>;
  chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
  context: BrowserContext | null;
  discoveredStableTargets: Set<string>;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
}
export function createOpenOwnedChapterDraftTab(
  deps: Dependencies,
): OpenOwnedChapterDraftTabOperation {
  async function openOwnedChapterDraftTab(
    page: Page,
    targetRef: string,
    options: CurrentChapterDirectoryOptions,
    deadline: number,
  ): Promise<string> {
    const slot = deps.activePageSlot;
    const raw = deps.diagnosticTargets.get(targetRef),
      binding = deps.chapterTargetOwners.get(targetRef),
      context = deps.context;
    if (
      !raw ||
      !binding ||
      binding.kind !== 'account' ||
      options.expectedOwner.kind !== binding.kind ||
      options.expectedOwner.id !== binding.id
    )
      throw new BrowserSessionError(
        'chapter_draft_owner_unverified',
        'The draft list requires its fixed verified account',
      );
    const initial = validateDiagnosticSource(raw, deps.discoveredStableTargets),
      workId = chapterDirectoryWorkId(raw);
    let violated = false,
      guarded = false;
    const pending = new Set<Promise<void>>(),
      handles: Array<{ dispose(): Promise<void> }> = [];
    const own = <T extends { dispose(): Promise<void> }>(handle: T): T => {
      handles.push(handle);
      return handle;
    };
    const permitted = (value: string) => {
      try {
        const url = validateDiagnosticSource(value, deps.discoveredStableTargets);
        return (
          url.origin === initial.origin &&
          url.pathname === initial.pathname &&
          chapterDirectoryWorkId(value) === workId &&
          new Set(url.searchParams.keys()).size === url.searchParams.size &&
          [...url.searchParams]
            .filter(([key]) => ['book_id', 'bookId', 'work_id', 'workId'].includes(key))
            .every(([, value]) => value === workId) &&
          [...url.searchParams].filter(([key]) =>
            ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
          ).length <= 1
        );
      } catch {
        return false;
      }
    };
    const assertCurrent = () => {
      if (options.signal?.aborted)
        throw new BrowserSessionError('cancelled', 'The draft entry was cancelled');
      if (
        violated ||
        !context ||
        deps.context !== context ||
        page.context() !== context ||
        !deps.isCurrentPageSlot(slot, page) ||
        !permitted(page.url()) ||
        performance.now() >= deadline
      )
        throw new BrowserSessionError(
          'read_document_changed',
          'The draft entry lost its owned read boundary',
        );
    };
    const onNavigation = (frame: unknown) => {
      if (frame === page.mainFrame() && !permitted(page.url())) violated = true;
    };
    const onRequest = (request: Request) => {
      try {
        if (
          request.isNavigationRequest() &&
          (request.frame() !== page.mainFrame() || !permitted(request.url()))
        )
          violated = true;
      } catch {
        violated = true;
      }
    };
    const handleRoute = async (route: Route) => {
      let navigation: boolean | null = null,
        allowed = false;
      try {
        const request = route.request(),
          url = new URL(request.url());
        navigation = request.isNavigationRequest();
        const parents = [...url.searchParams].filter(([key]) =>
          ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
        );
        allowed =
          typeof navigation === 'boolean' &&
          ['GET', 'HEAD'].includes(request.method()) &&
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.hash &&
          !(
            url.origin === initial.origin &&
            /(?:^|[\/_-])(?:create|new|edit|editor|publish|submit|delete|save|update|upload|sign|pay|withdraw)(?:[\/_-]|$)/i.test(
              url.pathname,
            )
          ) &&
          parents.length <= 1 &&
          parents.every(([, value]) => value === workId) &&
          (!navigation || (request.frame() === page.mainFrame() && permitted(request.url())));
      } catch {
        allowed = false;
      }
      if (!allowed) {
        if (navigation !== false) violated = true;
        try {
          await route.abort('blockedbyclient');
        } catch {
          violated = true;
        }
      } else
        try {
          await route.continue();
        } catch {
          violated = true;
        }
    };
    const guard = (route: Route) => {
      const task = handleRoute(route);
      pending.add(task);
      return task.finally(() => pending.delete(task));
    };
    page.on('request', onRequest);
    page.on('framenavigated', onNavigation);
    let actual: string | null = null;
    try {
      assertCurrent();
      await page.route('**/*', guard);
      guarded = true;
      assertCurrent();
      // A valid registered route can precede the render of its existing tab.
      // This wait supplies no action authority: acquire and recheck the original
      // handle only after the unchanged exact DOM predicate becomes ready.
      const tabDeadline = Math.min(deadline, performance.now() + 2_500);
      let tabReady = false;
      while (performance.now() < tabDeadline) {
        assertCurrent();
        const readiness = await page.evaluate(currentDraftDirectoryDom, { mode: 'tab' as const });
        assertCurrent();
        if (performance.now() >= tabDeadline) break;
        if (readiness.bound === true) {
          tabReady = true;
          break;
        }
        assertCurrent();
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const done = () => {
            if (timer !== null) clearTimeout(timer);
            options.signal?.removeEventListener('abort', done);
            page.off('close', done);
            resolve();
          };
          options.signal?.addEventListener('abort', done, { once: true });
          page.on('close', done);
          timer = setTimeout(done, Math.max(1, Math.min(75, tabDeadline - performance.now())));
          if (options.signal?.aborted || page.isClosed()) done();
        });
        assertCurrent();
      }
      assertCurrent();
      if (!tabReady)
        throw new BrowserSessionError(
          'chapter_draft_tab_unavailable',
          'One visible draft-list tab did not become ready within its bounded wait',
        );
      const handle = own(
        await page.evaluateHandle(currentDraftDirectoryDom, { mode: 'tab' as const }),
      );
      assertCurrent();
      const property = own(await handle.getProperty('tab'));
      assertCurrent();
      const tab = property.asElement();
      if (!tab)
        throw new BrowserSessionError(
          'chapter_draft_tab_unavailable',
          'One visible draft-list tab is required',
        );
      const state = await page.evaluate(currentDraftDirectoryDom, { mode: 'tab' as const, tab });
      assertCurrent();
      if (!state.bound)
        throw new BrowserSessionError(
          'chapter_draft_tab_changed',
          'The original draft-list tab changed',
        );
      // Click only the retained original handle, never a substituted selector match.
      await tab.click({
        timeout: Math.max(1, Math.min(12_000, deadline - performance.now())),
        noWaitAfter: true,
      });
      assertCurrent();
      await page.waitForFunction(
        () => {
          const visible = (node: Element) => {
            const box = node.getBoundingClientRect();
            return node.isConnected && box.width > 0 && box.height > 0;
          };
          const tabs = [
            ...document.querySelectorAll(
              '.chapter-manage-tabs.serial-tabs.serial-tabs-text.arco-tabs-size-small .arco-tabs-header-nav .arco-tabs-header-title',
            ),
          ].filter(visible);
          const active = tabs.filter(
            (node) =>
              node.getAttribute('aria-selected') === 'true' ||
              node.classList.contains('arco-tabs-header-title-active'),
          );
          return active.length === 1 && active[0]!.textContent?.trim() === '草稿箱';
        },
        undefined,
        { timeout: Math.max(1, Math.min(12_000, deadline - performance.now())) },
      );
      assertCurrent();
      await page
        .waitForLoadState('networkidle', {
          timeout: Math.max(1, Math.min(4_000, deadline - performance.now())),
        })
        .catch(() => undefined);
      assertCurrent();
      const after = await page.evaluate(currentDraftDirectoryDom, { mode: 'tab' as const, tab });
      assertCurrent();
      if (!after.bound || !after.activeDraft)
        throw new BrowserSessionError(
          'chapter_draft_tab_changed',
          'The original draft-list tab is no longer active',
        );
      actual = validateDiagnosticSource(page.url(), deps.discoveredStableTargets).toString();
    } finally {
      try {
        if (guarded)
          try {
            await page.unroute('**/*', guard);
          } catch {
            violated = true;
          }
        while (pending.size) await Promise.allSettled([...pending]);
        const disposed = await Promise.allSettled(handles.map((handle) => handle.dispose()));
        if (disposed.some((result) => result.status === 'rejected')) violated = true;
        assertCurrent();
      } finally {
        page.off('request', onRequest);
        page.off('framenavigated', onNavigation);
      }
    }
    if (!actual)
      throw new BrowserSessionError(
        'chapter_draft_tab_unavailable',
        'The owned draft-list route is unavailable',
      );
    const ref = createHash('sha256').update(actual).digest('hex').slice(0, 24);
    deps.diagnosticTargets.set(ref, actual);
    deps.chapterTargetOwners.set(ref, { ...binding });
    return ref;
  }
  return openOwnedChapterDraftTab;
}
