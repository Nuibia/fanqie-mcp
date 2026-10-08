import { type Page, type Request, type Route } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import {
  diagnosticRouteTemplate,
  validateDiagnosticSource,
  chapterDirectoryWorkId,
  projectChapterGetQuerySchema,
  encodedChapterRoute,
} from '../chapter-routes.js';
import {
  type ChapterBlockedRequests,
  projectChapterBlockedRequest,
} from '../chapter-diagnostics.js';
import { createHash } from 'node:crypto';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type OpenChapterDraftTabOperation } from '../contracts/open-chapter-draft-tab.js';
interface Dependencies {
  activePageSlot: BrowserPageSlot | null;
  discoveredStableTargets: Set<string>;
  identityEpoch: number;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  diagnosticTargets: Map<string, string>;
}
export function createOpenChapterDraftTab(deps: Dependencies): OpenChapterDraftTabOperation {
  async function openChapterDraftTab(
    page: Page,
    sources: ReadonlyMap<string, { raw: string; epoch: number }>,
    before: LoginState,
    timeoutMs: number,
  ) {
    const slot = deps.activePageSlot;
    const blockedRequests: ChapterBlockedRequests = { entries: [], count: 0, truncated: false };
    const blockedRequestSeen = new WeakSet<Request>();
    const recordBlocked = (request: Request) => {
      if (blockedRequestSeen.has(request)) return;
      blockedRequestSeen.add(request);
      if (blockedRequests.count >= 100) {
        blockedRequests.truncated = true;
        return;
      }
      blockedRequests.count += 1;
      const projected = projectChapterBlockedRequest(request);
      if (projected.pathTemplate.endsWith('/{truncated}')) blockedRequests.truncated = true;
      const existing = blockedRequests.entries.find(
        (entry) =>
          entry.method === projected.method &&
          entry.resourceType === projected.resourceType &&
          entry.navigation === projected.navigation &&
          entry.origin === projected.origin &&
          entry.pathClass === projected.pathClass &&
          entry.pathTemplate === projected.pathTemplate &&
          entry.authorFamily === projected.authorFamily,
      );
      if (existing) existing.count += 1;
      else if (blockedRequests.entries.length < 16)
        blockedRequests.entries.push({ ...projected, count: 1 });
      else blockedRequests.truncated = true;
    };
    const unavailable = (reason: string) => ({
      tab: {
        tab: 'drafts' as const,
        status: 'unavailable' as const,
        reason,
        routeTemplate: null,
        targetRef: null,
        ...(blockedRequests.count
          ? {
              blockedRequests: {
                entries: blockedRequests.entries.map((entry) => ({ ...entry })),
                count: blockedRequests.count,
                truncated: blockedRequests.truncated,
              },
            }
          : {}),
      },
      login: before,
    });
    const owner = before.identity?.accountId ?? before.identity?.authorId;
    if (before.status !== 'authenticated' || !owner)
      return unavailable('chapter_drafts_identity_unverified');
    const initial = validateDiagnosticSource(page.url(), deps.discoveredStableTargets);
    const workId = chapterDirectoryWorkId(initial.toString());
    if (!workId) return unavailable('chapter_drafts_parent_unverified');
    const originalEpoch = deps.identityEpoch;
    const assertEpoch = (epoch: number) => {
      if (!deps.isCurrentPageSlot(slot, page) || epoch !== deps.identityEpoch)
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The chapter tab document changed during verification',
        );
    };
    const boundParentQuery = (target: URL): boolean => {
      const parents = [...target.searchParams].filter(([key]) =>
        ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
      );
      return parents.length === 0 || (parents.length === 1 && parents[0]![1] === workId);
    };
    const allowedDestination = (raw: string): boolean => {
      try {
        const target = validateDiagnosticSource(raw, deps.discoveredStableTargets);
        return (
          target.origin === initial.origin &&
          target.pathname === initial.pathname &&
          chapterDirectoryWorkId(target.toString()) === workId &&
          boundParentQuery(target)
        );
      } catch {
        return false;
      }
    };
    const source = sources.get('/api/author/book/book_detail/v0/');
    if (
      !source ||
      source.epoch !== originalEpoch ||
      !projectChapterGetQuerySchema(source.raw, workId).replayBoundToCurrentWork
    )
      return unavailable('chapter_drafts_parent_source_missing');
    let blocked: string | null = null;
    let guarded = false;
    const readOnlyRoute = async (route: Route) => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method())) {
        blocked = 'chapter_drafts_non_get_blocked';
        recordBlocked(request);
        await route.abort('blockedbyclient');
        return;
      }
      let target: URL;
      try {
        target = new URL(request.url());
      } catch {
        blocked = 'chapter_drafts_request_unverified';
        recordBlocked(request);
        await route.abort('blockedbyclient');
        return;
      }
      if (
        target.origin === 'https://fanqienovel.com' &&
        /(?:^|[\/_-])(?:create|new|edit|editor|publish|submit|delete|save|update|upload|sign|pay|withdraw)(?:[\/_-]|$)/i.test(
          target.pathname,
        )
      ) {
        blocked = 'chapter_drafts_write_route_blocked';
        recordBlocked(request);
        await route.abort('blockedbyclient');
        return;
      }
      if (
        ['xhr', 'fetch'].includes(request.resourceType()) &&
        (target.origin !== initial.origin || !boundParentQuery(target))
      ) {
        blocked = 'chapter_drafts_get_parent_mismatch';
        recordBlocked(request);
        await route.abort('blockedbyclient');
        return;
      }
      if (request.isNavigationRequest()) {
        try {
          if (request.frame() !== page.mainFrame() || !allowedDestination(request.url())) {
            blocked = 'chapter_drafts_parent_route_changed';
            recordBlocked(request);
            await route.abort('blockedbyclient');
            return;
          }
        } catch {
          blocked = 'chapter_drafts_request_unverified';
          recordBlocked(request);
          await route.abort('blockedbyclient');
          return;
        }
      }
      await route.continue();
    };
    const requestEpochs = new WeakMap<Request, number>();
    const onRequest = (request: Request) => {
      if (request.method() === 'GET') requestEpochs.set(request, deps.identityEpoch);
    };
    const onResponse = (response: { url(): string; request(): Request }) => {
      try {
        const request = response.request();
        if (
          request.method() !== 'GET' ||
          !['xhr', 'fetch'].includes(request.resourceType()) ||
          requestEpochs.get(request) !== deps.identityEpoch
        )
          return;
        const target = new URL(response.url());
        if (target.origin !== initial.origin || !boundParentQuery(target))
          blocked = 'chapter_drafts_get_parent_mismatch';
      } catch {
        blocked = 'chapter_drafts_request_unverified';
      }
    };
    // An SPA can leave and return before click() settles. Keep the violation even
    // when the eventual URL is again valid; query transitions within this parent are allowed.
    const onNavigation = (frame: unknown) => {
      if (frame === page.mainFrame() && !allowedDestination(page.url()))
        blocked = 'chapter_drafts_parent_route_changed';
    };
    const verifyParent = async (epoch: number, expectedTitle?: string): Promise<string | null> => {
      assertEpoch(epoch);
      const response = await page.evaluate(async (sourceUrl) => {
        const response = await fetch(sourceUrl, {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'error',
        });
        return {
          status: response.status,
          ok: response.ok,
          json: await response.json().catch(() => null),
        };
      }, source.raw);
      assertEpoch(epoch);
      const object = (value: unknown): Record<string, unknown> | null =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      const payload = object(response.json),
        data = object(payload?.data);
      if (
        !response.ok ||
        payload?.code !== 0 ||
        data?.book_id !== workId ||
        typeof data.book_name !== 'string' ||
        !data.book_name.trim() ||
        (expectedTitle !== undefined && data.book_name !== expectedTitle)
      )
        return null;
      const route = encodedChapterRoute(initial.pathname);
      if (route && route.title !== data.book_name) return null;
      return data.book_name;
    };
    const inspectControl = async (epoch: number) => {
      assertEpoch(epoch);
      const control = await page.evaluate(() => {
        const visible = (element: Element): boolean => {
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
        const tabs = [...document.querySelectorAll('.chapter-manage-tabs [role="tab"]')];
        const matches = tabs
          .map((element, index) => ({ element, index }))
          .filter(({ element }) => element.textContent?.trim() === '草稿箱');
        if (matches.length !== 1)
          return { index: null, active: false, reason: 'chapter_drafts_tab_ambiguous' };
        const { element, index } = matches[0]!;
        if (
          !visible(element) ||
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true' ||
          (element.tagName === 'BUTTON' && element.getAttribute('type') === 'submit')
        )
          return { index: null, active: false, reason: 'chapter_drafts_tab_unverified' };
        return {
          index,
          active:
            element.getAttribute('aria-selected') === 'true' ||
            (element.getAttribute('class') ?? '')
              .split(/\s+/)
              .includes('arco-tabs-header-title-active'),
          reason: null,
        };
      });
      assertEpoch(epoch);
      return control;
    };
    try {
      page.on('framenavigated', onNavigation);
      page.on('request', onRequest);
      page.on('response', onResponse);
      await page.route('**/*', readOnlyRoute);
      guarded = true;
      const title = await verifyParent(originalEpoch);
      if (!title) return unavailable('chapter_drafts_parent_mismatch');
      const control = await inspectControl(originalEpoch);
      if (control.index === null)
        return unavailable(control.reason ?? 'chapter_drafts_tab_unverified');
      if (!control.active) {
        const tabs = page.locator('.chapter-manage-tabs [role="tab"]');
        const exact = tabs.filter({ hasText: /^\s*草稿箱\s*$/ });
        if ((await exact.count()) !== 1) return unavailable('chapter_drafts_tab_ambiguous');
        assertEpoch(originalEpoch);
        await tabs
          .nth(control.index)
          .click({ timeout: Math.min(timeoutMs, 8_000), noWaitAfter: true });
      }
      if (blocked) return unavailable(blocked);
      if (!allowedDestination(page.url()))
        return unavailable('chapter_drafts_parent_route_changed');
      const assertInitializing = () => {
        if (!deps.isCurrentPageSlot(slot, page))
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The service-owned chapter tab page became unavailable during initialization',
          );
      };
      // The observed list tab may update its same-parent read query after click()
      // resolves. Only this bounded initialization window permits such transitions.
      await page.waitForFunction(
        ({ origin, pathname, workId }) => {
          if (location.origin !== origin || location.pathname !== pathname || location.hash)
            return false;
          const parents = [...new URLSearchParams(location.search)].filter(([key]) =>
            ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
          );
          if (parents.length > 1 || (parents.length === 1 && parents[0]![1] !== workId))
            return false;
          const tabs = [...document.querySelectorAll('.chapter-manage-tabs [role="tab"]')].filter(
            (element) => element.textContent?.trim() === '草稿箱',
          );
          return (
            tabs.length === 1 &&
            (tabs[0]!.getAttribute('aria-selected') === 'true' ||
              (tabs[0]!.getAttribute('class') ?? '')
                .split(/\s+/)
                .includes('arco-tabs-header-title-active'))
          );
        },
        { origin: initial.origin, pathname: initial.pathname, workId },
        { timeout: timeoutMs },
      );
      assertInitializing();
      if (blocked) return unavailable(blocked);
      if (!allowedDestination(page.url()))
        return unavailable('chapter_drafts_parent_route_changed');
      await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      assertInitializing();
      if (blocked) return unavailable(blocked);
      if (!allowedDestination(page.url()))
        return unavailable('chapter_drafts_parent_route_changed');
      const epoch = deps.identityEpoch,
        stableUrl = page.url();
      const assertFrozen = () => {
        assertEpoch(epoch);
        if (page.url() !== stableUrl)
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The verified chapter tab read route changed after initialization',
          );
      };
      assertFrozen();
      const login = await deps.verifyCurrentAccount(page);
      assertFrozen();
      const sameOwner = before.identity?.accountId
        ? login.identity?.accountId === owner
        : login.identity?.authorId === owner;
      if (login.status !== 'authenticated' || !sameOwner)
        return unavailable('chapter_drafts_identity_changed');
      if (!(await verifyParent(epoch, title))) return unavailable('chapter_drafts_parent_mismatch');
      assertFrozen();
      const confirmed = await inspectControl(epoch);
      assertFrozen();
      if (confirmed.index === null || !confirmed.active)
        return unavailable('chapter_drafts_tab_not_active');
      if (blocked || !allowedDestination(page.url()))
        return unavailable(blocked ?? 'chapter_drafts_parent_route_changed');
      const actual = validateDiagnosticSource(page.url(), deps.discoveredStableTargets);
      const targetRef = createHash('sha256').update(actual.toString()).digest('hex').slice(0, 24);
      deps.diagnosticTargets.set(targetRef, actual.toString());
      return {
        tab: {
          tab: 'drafts' as const,
          status: 'opened' as const,
          routeTemplate: diagnosticRouteTemplate(actual.toString()),
          targetRef,
        },
        login,
      };
    } catch (error) {
      if (error instanceof BrowserSessionError) throw error;
      return unavailable(blocked ?? 'chapter_drafts_observation_failed');
    } finally {
      page.off('framenavigated', onNavigation);
      page.off('request', onRequest);
      page.off('response', onResponse);
      if (guarded) await page.unroute('**/*', readOnlyRoute).catch(() => undefined);
    }
  }
  return openChapterDraftTab;
}
