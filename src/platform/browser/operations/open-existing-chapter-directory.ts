import { type Page, type Route } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import {
  diagnosticRouteTemplate,
  validateDiagnosticSource,
  projectChapterQuerySchema,
  isDiagnosticReadQueryKey,
  inspectEncodedChapterRoute,
} from '../chapter-routes.js';
import {
  type ChapterEntryDiagnostic,
  type ChapterRouteQuerySchema,
} from '../chapter-diagnostics.js';
import { createHash } from 'node:crypto';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type OpenExistingChapterDirectoryOperation } from '../contracts/open-existing-chapter-directory.js';
interface Dependencies {
  activePageSlot: BrowserPageSlot | null;
  identityEpoch: number;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  discoveredStableTargets: Set<string>;
  waitForWriterReady: WaitForWriterReadyOperation;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  diagnosticTargets: Map<string, string>;
  chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
}
export function createOpenExistingChapterDirectory(
  deps: Dependencies,
): OpenExistingChapterDirectoryOperation {
  async function openExistingChapterDirectory(
    page: Page,
    sources: ReadonlySet<string>,
    workId: string,
    before: LoginState,
    timeoutMs: number,
  ) {
    const slot = deps.activePageSlot;
    let login = before;
    let ready = false;
    const redactions: string[] = [workId];
    let routeTemplate: string | null = null;
    let routeObservation: ChapterEntryDiagnostic['routeObservation'] = null;
    let querySchema: ChapterRouteQuerySchema | undefined;
    const failed = (reason: string) => ({
      entry: {
        status: 'unavailable' as const,
        reason,
        routeTemplate,
        routeObservation,
        targetRef: null,
        ...(querySchema ? { querySchema } : {}),
      },
      login,
      ready,
      redactions,
    });
    const epoch = deps.identityEpoch;
    const assertManager = () => {
      if (
        !deps.isCurrentPageSlot(slot, page) ||
        epoch !== deps.identityEpoch ||
        !/^https:\/\/fanqienovel\.com\/main\/writer\/book-manage\/?(?:\?|$)/.test(page.url())
      )
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The verified management document changed before chapter navigation',
        );
    };
    if (
      before.status !== 'authenticated' ||
      (!before.identity?.accountId && !before.identity?.authorId)
    )
      return failed('chapter_manager_identity_unverified');
    let title: string | null = null;
    let routeBookName: string | null = null;
    try {
      const raw = [...sources][0];
      if (!raw) return failed('chapter_manager_list_source_missing');
      assertManager();
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
      }, raw);
      assertManager();
      const object = (value: unknown): Record<string, unknown> | null =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      const payload = object(response.json);
      const data = object(payload?.data);
      if (!response.ok || payload?.code !== 0 || !Array.isArray(data?.book_list))
        return failed('chapter_manager_list_unrecognized');
      const rows = data.book_list.map((value: unknown) => {
        const row = object(value);
        return { id: row?.book_id, title: row?.book_name };
      });
      if (
        rows.some(
          (row: { id: unknown; title: unknown }) =>
            typeof row.id !== 'string' ||
            !/^[1-9]\d{9,29}$/.test(row.id) ||
            typeof row.title !== 'string' ||
            !row.title.trim(),
        )
      )
        return failed('chapter_manager_list_unrecognized');
      const targets = rows.filter((row: { id: unknown }) => row.id === workId);
      if (targets.length !== 1)
        return failed(
          targets.length
            ? 'chapter_manager_target_ambiguous'
            : 'chapter_manager_target_not_visible',
        );
      routeBookName = targets[0]!.title as string;
      title = routeBookName.trim();
      redactions.push(...rows.map((row: { title: unknown }) => (row.title as string).trim()));
      if (
        rows.filter((row: { title: unknown }) => (row.title as string).trim() === title).length !==
        1
      )
        return failed('chapter_manager_title_ambiguous');
      const selected = await page.evaluate((title) => {
        const visible = (element: Element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        const cards = [...document.querySelectorAll('.home-book-item')];
        const matches = cards
          .map((card, index) => ({ card, index }))
          .filter(
            ({ card }) =>
              visible(card) &&
              card.querySelector('.info-content-title')?.textContent?.trim() === title,
          );
        if (matches.length !== 1)
          return {
            index: null,
            reason: matches.length
              ? 'chapter_manager_card_ambiguous'
              : 'chapter_manager_target_not_visible',
          };
        const buttons = [...matches[0]!.card.querySelectorAll('button')].filter(
          (button) => visible(button) && button.textContent?.trim() === '章节管理',
        );
        if (buttons.length !== 1)
          return { index: null, reason: 'chapter_manager_button_ambiguous' };
        const button = buttons[0]!;
        if (
          !button.matches('button.right-btn[type="button"]') ||
          button.hasAttribute('disabled') ||
          button.getAttribute('aria-disabled') === 'true'
        )
          return { index: null, reason: 'chapter_manager_button_unverified' };
        return { index: matches[0]!.index, reason: null };
      }, title);
      assertManager();
      if (selected.index === null)
        return failed(selected.reason ?? 'chapter_manager_card_unverified');
      const card = page.locator('.home-book-item').nth(selected.index);
      const button = card
        .locator('button.right-btn[type="button"]')
        .filter({ hasText: /^\s*章节管理\s*$/ });
      if ((await button.count()) !== 1) return failed('chapter_manager_button_ambiguous');
      assertManager();
      if ((await card.locator('.info-content-title').innerText()).trim() !== title)
        return failed('chapter_manager_card_changed');
      assertManager();
      const initialUrl = page.url();
      let blocked: string | null = null;
      const verifiedDestination = (raw: string): { url: URL | null; reason: string | null } => {
        const rejected = (reason: string) => ({ url: null, reason });
        try {
          const target = new URL(raw);
          if (target.origin !== 'https://fanqienovel.com' || target.username || target.password)
            return rejected('chapter_manager_route_origin_invalid');
          if (target.hash) return rejected('chapter_manager_route_fragment_invalid');
          querySchema = projectChapterQuerySchema(
            target.searchParams,
            [
              ...redactions,
              before.identity?.displayName ?? '',
              before.identity?.accountId ?? '',
              before.identity?.authorId ?? '',
            ],
            target.pathname,
          );
          const queryKeys = new Set<string>();
          for (const [key, value] of target.searchParams) {
            if (queryKeys.has(key)) return rejected('chapter_manager_route_query_ambiguous');
            if (!isDiagnosticReadQueryKey(target.pathname, key) || !/^\d{1,30}$/.test(value))
              return rejected('chapter_manager_route_query_invalid');
            queryKeys.add(key);
          }
          const encoded = inspectEncodedChapterRoute(target.pathname);
          if (encoded.status !== 'unshaped') {
            if (encoded.workId !== workId) return rejected('chapter_manager_route_id_mismatch');
            if (encoded.status === 'malformed')
              return rejected('chapter_manager_route_encoding_malformed');
            if (encoded.title !== routeBookName)
              return rejected('chapter_manager_route_title_mismatch');
            // This classification proves the binding matched before identifying the encoding assumption.
            if (!encoded.canonical) return rejected('chapter_manager_route_encoding_noncanonical');
          } else {
            if (
              !/^\/main\/writer\/(?:chapter-manage|book-manage)(?:\/[1-9]\d{9,29})?\/?$/.test(
                target.pathname,
              )
            )
              return rejected('chapter_manager_route_shape_unrecognized');
            const id = target.pathname.match(/\/([1-9]\d{9,29})\/?$/)?.[1];
            if (id && id !== workId) return rejected('chapter_manager_route_id_mismatch');
          }
          for (const key of ['book_id', 'work_id', 'bookId', 'workId'])
            if (target.searchParams.has(key) && target.searchParams.get(key) !== workId)
              return rejected('chapter_manager_route_id_mismatch');
          return {
            url: validateDiagnosticSource(
              raw,
              new Set([...deps.discoveredStableTargets, `${target.origin}${target.pathname}`]),
            ),
            reason: null,
          };
        } catch {
          return rejected('chapter_manager_route_url_invalid');
        }
      };
      const readOnlyRoute = async (route: Route) => {
        const request = route.request();
        if (!['GET', 'HEAD'].includes(request.method())) {
          blocked = 'chapter_manager_non_get_blocked';
          await route.abort('blockedbyclient');
          return;
        }
        let target: URL;
        try {
          target = new URL(request.url());
        } catch {
          blocked = 'chapter_manager_request_unverified';
          await route.abort('blockedbyclient');
          return;
        }
        if (
          target.origin === 'https://fanqienovel.com' &&
          /(?:^|[\/_-])(?:create|new|edit|editor|publish|submit|delete|save|update|upload|sign|pay|withdraw)(?:[\/_-]|$)/i.test(
            target.pathname,
          )
        ) {
          blocked = 'chapter_manager_write_route_blocked';
          await route.abort('blockedbyclient');
          return;
        }
        if (request.isNavigationRequest()) {
          try {
            if (request.frame() === page.mainFrame()) {
              const destination = verifiedDestination(request.url());
              if (!destination.url) {
                if (
                  target.origin === 'https://fanqienovel.com' &&
                  /^\/main\/writer\//.test(target.pathname) &&
                  !target.username &&
                  !target.password
                )
                  routeTemplate = diagnosticRouteTemplate(request.url());
                routeObservation = 'navigation-request';
                blocked = destination.reason;
                await route.abort('blockedbyclient');
                return;
              }
            }
          } catch {
            blocked = 'chapter_manager_request_unverified';
            await route.abort('blockedbyclient');
            return;
          }
        }
        await route.continue();
      };
      await page.route('**/*', readOnlyRoute);
      try {
        assertManager();
        await button.click({ timeout: Math.min(timeoutMs, 8_000), noWaitAfter: true });
        if (!blocked)
          await page.waitForURL((url) => url.toString() !== initialUrl, { timeout: timeoutMs });
        if (blocked) return failed(blocked);
        routeTemplate = diagnosticRouteTemplate(page.url());
        routeObservation = 'landed';
        const checked = verifiedDestination(page.url());
        if (!checked.url) return failed(checked.reason ?? 'chapter_manager_route_unverified');
        const destination = checked.url;
        ready = await deps.waitForWriterReady(page, timeoutMs);
        login = await deps.verifyCurrentAccount(page);
        if (!ready || login.status !== 'authenticated')
          return failed('chapter_manager_identity_unverified');
        const oldId = before.identity?.accountId ?? before.identity?.authorId;
        const newId = before.identity?.accountId
          ? login.identity?.accountId
          : login.identity?.authorId;
        if (!oldId || oldId !== newId) return failed('chapter_manager_identity_changed');
        deps.discoveredStableTargets.add(`${destination.origin}${destination.pathname}`);
        const targetRef = createHash('sha256')
          .update(destination.toString())
          .digest('hex')
          .slice(0, 24);
        deps.diagnosticTargets.set(targetRef, destination.toString());
        deps.chapterTargetOwners.set(targetRef, {
          kind: before.identity?.accountId ? 'account' : 'author',
          id: oldId,
        });
        return {
          entry: {
            status: 'opened' as const,
            routeTemplate,
            routeObservation,
            targetRef,
            ...(querySchema ? { querySchema } : {}),
          },
          login,
          ready,
          redactions,
        };
      } catch (error) {
        if (error instanceof BrowserSessionError) throw error;
        return failed(blocked ?? 'chapter_manager_navigation_failed');
      } finally {
        await page.unroute('**/*', readOnlyRoute).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof BrowserSessionError) throw error;
      return failed('chapter_manager_navigation_failed');
    }
  }
  return openExistingChapterDirectory;
}
