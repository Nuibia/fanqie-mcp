import { readCurrentLoginDom } from '../dom/current-login.js';
import { type Page } from 'playwright';
import {
  type PlatformIdentity,
  ownInfoSource,
  projectOwnResponseFields,
  parseOwnResponseIdentity,
} from '../own-identity.js';
import { type CurrentLoginDiagnostic, type OwnResponseStructure } from '../read-diagnostics.js';
import { BrowserSessionError } from '../errors.js';
import { diagnosticRouteTemplate } from '../chapter-routes.js';
import { type DiagnosticOptions } from '../chapter-diagnostics.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';
import { type RememberIdentityOperation } from '../contracts/remember-identity.js';
import { type DiagnoseCurrentLoginPageOperation } from '../contracts/diagnose-current-login-page.js';
interface Dependencies {
  withPage: WithPageOperation;
  identityEpoch: number;
  page: Page | null;
  closed: boolean;
  inspectLogin: InspectLoginOperation;
  pageGetMetadata: WeakMap<
    Page,
    { entries: CurrentLoginDiagnostic['getResponses']; truncated: boolean }
  >;
  pageOwnStructures: WeakMap<Page, Map<string, OwnResponseStructure>>;
  ownInfoUrls: WeakMap<Page, Set<string>>;
  identity: PlatformIdentity | null;
  rememberIdentity: RememberIdentityOperation;
}
export function createDiagnoseCurrentLoginPage(
  deps: Dependencies,
): DiagnoseCurrentLoginPageOperation {
  function diagnoseCurrentLoginPage(
    options: DiagnosticOptions = {},
  ): Promise<CurrentLoginDiagnostic> {
    const maxElements = Math.max(1, Math.min(200, options.maxElements ?? 80));
    const maxResponses = Math.max(1, Math.min(100, options.maxResponses ?? 40));
    return deps.withPage(async (page) => {
      try {
        const epoch = deps.identityEpoch;
        const sameDocument = (): boolean =>
          page === deps.page && !page.isClosed() && !deps.closed && epoch === deps.identityEpoch;
        let login = await deps.inspectLogin(page, false);
        if (!sameDocument())
          throw new BrowserSessionError(
            'login_diagnostic_stale',
            'The login document changed during schema inspection',
          );
        const cache = deps.pageGetMetadata.get(page);
        const structures =
          deps.pageOwnStructures.get(page) ?? new Map<string, OwnResponseStructure>();
        const base = {
          status: login.status,
          sourceUrl: diagnosticRouteTemplate(login.sourceUrl),
          checkedAt: new Date().toISOString(),
          identityObserved: {
            accountId: Boolean(login.identity?.accountId),
            authorId: Boolean(login.identity?.authorId),
            displayName: Boolean(login.identity?.displayName),
          },
          getResponses: (cache?.entries ?? []).slice(0, maxResponses),
          ownResponseStructure: [] as OwnResponseStructure[],
          limitations: [
            'Current-page diagnostic does not navigate. Authentication requires a current-document stable own ID from the same verification rules as checkLogin.',
            'Only observed official GET response paths/status/types are included; queries, headers, bodies and resource URLs are excluded.',
            'DOM values, account names, body/title text and router values are excluded. Unknown/dynamic router field names are omitted.',
            'Own response schemas include fixed field paths/types only; no values or array items. Schema observation does not assign uid or other fields to an account.',
          ],
        };
        let officialWriter = false;
        try {
          const source = new URL(page.url());
          officialWriter =
            source.origin === 'https://fanqienovel.com' &&
            /^\/main\/writer(?:\/|$)/.test(source.pathname);
        } catch {
          /* Keep metadata empty on unknown pages. */
        }
        if (!officialWriter)
          return {
            ...base,
            controls: [],
            routerStructure: [],
            truncated: {
              controls: false,
              responses: Boolean(cache?.truncated || (cache?.entries.length ?? 0) > maxResponses),
              router: false,
            },
          };
        // Replay only safe own sources actually observed in this exact document.
        const seenPaths = new Set<string>();
        for (const raw of login.status === 'login_required'
          ? []
          : [...(deps.ownInfoUrls.get(page) ?? [])].slice(-10).reverse()) {
          const source = new URL(raw);
          if (!ownInfoSource(source) || seenPaths.has(source.pathname)) continue;
          seenPaths.add(source.pathname);
          try {
            const response = await page.evaluate(async (url) => {
              const response = await fetch(url, {
                method: 'GET',
                credentials: 'same-origin',
                redirect: 'error',
              });
              return { status: response.status, json: await response.json().catch(() => null) };
            }, raw);
            if (!sameDocument())
              throw new BrowserSessionError(
                'login_diagnostic_stale',
                'The login document changed during schema inspection',
              );
            structures.set(source.pathname, {
              pathTemplate: source.pathname,
              status: response.status,
              ...projectOwnResponseFields(response.json),
            });
            if (response.status === 401) {
              deps.identity = null;
              login = {
                ...login,
                status: 'login_required',
                identity: null,
                reason: 'Current own-account API requires login',
              };
              break;
            }
            const identity =
              response.status >= 200 && response.status < 300
                ? parseOwnResponseIdentity(response.json, raw)
                : null;
            if (identity?.accountId || identity?.authorId) {
              deps.rememberIdentity(identity);
              login = { ...login, status: 'authenticated', identity, reason: undefined };
            }
          } catch (error) {
            if (error instanceof BrowserSessionError) throw error;
            if (!sameDocument())
              throw new BrowserSessionError(
                'login_diagnostic_stale',
                'The login document changed during schema inspection',
              );
            base.limitations.push(
              'A previously observed own response could not be refreshed; any retained schema is from this same document.',
            );
          }
        }
        base.status = login.status;
        base.identityObserved = {
          accountId: Boolean(login.identity?.accountId),
          authorId: Boolean(login.identity?.authorId),
          displayName: Boolean(login.identity?.displayName),
        };
        base.getResponses = (cache?.entries ?? []).slice(0, maxResponses);
        base.ownResponseStructure = [...structures.values()]
          .slice(-10)
          .map((entry) => ({ ...entry, fields: entry.fields.map((field) => ({ ...field })) }));
        const observed = await page.evaluate(readCurrentLoginDom, {
          maxElements,
          redactions: [
            login.identity?.accountId,
            login.identity?.authorId,
            login.identity?.displayName,
          ].filter((value): value is string => Boolean(value)),
        });
        if (!sameDocument())
          throw new BrowserSessionError(
            'login_diagnostic_stale',
            'The login document changed during schema inspection',
          );
        return {
          ...base,
          controls: observed.controls,
          routerStructure: observed.routerStructure,
          ...(observed.chapterTabStructure
            ? { chapterTabStructure: observed.chapterTabStructure }
            : {}),
          truncated: {
            ...observed.truncated,
            responses: Boolean(cache?.truncated || (cache?.entries.length ?? 0) > maxResponses),
          },
        };
      } catch (error) {
        if (error instanceof BrowserSessionError) throw error;
        throw new BrowserSessionError(
          'login_diagnostic_unavailable',
          'Current login page structure could not be inspected safely',
        );
      }
    }, options);
  }
  return diagnoseCurrentLoginPage;
}
