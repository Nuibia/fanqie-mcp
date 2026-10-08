import { createObservedLinkRegistrar } from './register-observed-links.js';
import { createReadPageResponseObserver } from './observe-response.js';
import { readPageDiagnosticDom } from '../dom/read-page-diagnostic.js';
import { type BrowserSession } from '../session.js';
import { type Page, type Request } from 'playwright';
import { projectReadResponseFields, isChapterReadSchemaSource } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';

import {
  diagnosticRouteTemplate,
  validateDiagnosticSource,
  chapterDirectoryWorkId,
  projectChapterGetQuerySchema,
  isChapterDirectoryRoute,
} from '../chapter-routes.js';
import { isLongStatsSchemaSource, projectLongStatsResponseFields } from '../long-statistics.js';
import {
  type DiagnosticOptions,
  type ChapterEntryDiagnostic,
  type ReadPageDiagnostic,
  type ChapterGetQuerySchema,
  type ChapterTabDiagnostic,
  type ChapterGetRequestStructure,
} from '../chapter-diagnostics.js';

import { type Dependencies } from '../operations/diagnose-read-page.js';
interface Ports {
  options: DiagnosticOptions;
  deps: Dependencies;
  maxResponses: number;
  url: URL;
  maxElements: number;
}
export function createReadPageInspector(ports: Ports) {
  return async (page: Page): Promise<ReadPageDiagnostic> => {
    const responses: ReadPageDiagnostic['getResponses'] = [];
    // Local to this diagnostic only. SPA navigation may discard observer caches; raw sources never leave this callback.
    const observedLongStats = new Map<string, string>();
    // Three endpoint families, not three pagination URL variants. Never carry raw sources across navigation.
    const observedDirectorySources = new Map<
      string,
      { raw: string; epoch: number; observation: number }
    >();
    const directoryMetadata: Array<{
      pathTemplate: string;
      status: number;
      querySchema: ChapterGetQuerySchema;
      epoch: number | undefined;
      stored: boolean;
      observation: number;
    }> = [];
    let directoryObservation = 0;
    let chapterStructure:
      Awaited<ReturnType<BrowserSession['prepareChapterDiagnostic']>> | undefined;
    const directoryRequestEpochs = new WeakMap<Request, number>();
    const observedManagerSources = new Set<string>();
    const requestEpochs = new WeakMap<object, number>();
    let managerGeneration = 0;
    const onNavigation = (frame: unknown) => {
      if (frame === page.mainFrame()) {
        observedDirectorySources.clear();
        if (ports.options.openChaptersForWorkId) {
          managerGeneration += 1;
          observedManagerSources.clear();
        }
      }
    };
    const onRequest = (request: Request) => {
      if (request.method() !== 'GET') return;
      if (page === ports.deps.page && !page.isClosed() && !ports.deps.closed)
        directoryRequestEpochs.set(request, ports.deps.identityEpoch);
      if (ports.options.openChaptersForWorkId) requestEpochs.set(request, managerGeneration);
    };
    let responseCount = 0;
    const onResponse = createReadPageResponseObserver({
      get options() {
        return ports.options;
      },
      get requestEpochs() {
        return requestEpochs;
      },
      get managerGeneration() {
        return managerGeneration;
      },
      set managerGeneration(value) {
        managerGeneration = value;
      },
      get observedManagerSources() {
        return observedManagerSources;
      },
      get observedLongStats() {
        return observedLongStats;
      },
      get directoryRequestEpochs() {
        return directoryRequestEpochs;
      },
      get directoryObservation() {
        return directoryObservation;
      },
      set directoryObservation(value) {
        directoryObservation = value;
      },
      get deps() {
        return ports.deps;
      },
      get page() {
        return page;
      },
      get observedDirectorySources() {
        return observedDirectorySources;
      },
      get directoryMetadata() {
        return directoryMetadata;
      },
      get maxResponses() {
        return ports.maxResponses;
      },
      get responseCount() {
        return responseCount;
      },
      set responseCount(value) {
        responseCount = value;
      },
      get responses() {
        return responses;
      },
    });
    page.on('framenavigated', onNavigation);
    page.on('request', onRequest);
    page.on('response', onResponse);
    try {
      await page.goto(ports.url.toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      const readinessTimeout = Math.max(
        1,
        Math.min(ports.options.timeoutMs ?? ports.deps.config.timeoutMs ?? 20_000, 12_000),
      );
      let shellReady = await ports.deps.waitForWriterReady(page, readinessTimeout);
      let login = await ports.deps.verifyCurrentAccount(page);
      if (shellReady && login.status === 'unknown' && !ports.deps.ownInfoUrls.get(page)?.size) {
        await ports.deps.waitForObservedOwnSource(page, readinessTimeout);
        login = await ports.deps.verifyCurrentAccount(page);
      }
      let chapterEntry: ChapterEntryDiagnostic | undefined;
      let chapterRedactions: string[] = [];
      if (ports.options.openChaptersForWorkId) {
        const entered = await ports.deps.openExistingChapterDirectory(
          page,
          observedManagerSources,
          ports.options.openChaptersForWorkId,
          login,
          readinessTimeout,
        );
        chapterEntry = entered.entry;
        chapterRedactions = entered.redactions;
        shellReady = entered.ready;
        login = entered.login;
        if (
          chapterEntry.status === 'opened' &&
          chapterEntry.targetRef &&
          !ports.options.chapterTab
        ) {
          chapterStructure = await ports.deps.prepareChapterDiagnostic(
            page,
            chapterEntry.targetRef,
            login,
            readinessTimeout,
            ports.options,
          );
          shellReady = chapterStructure.ready;
          login = chapterStructure.login;
          if (ports.options.chapterVolumeOptions && shellReady)
            login = await chapterStructure.openVolumeOptions();
        }
      }
      let chapterTab: ChapterTabDiagnostic | undefined;
      if (ports.options.chapterTab && (!chapterEntry || chapterEntry.status === 'opened')) {
        const selected = await ports.deps.openChapterDraftTab(
          page,
          observedDirectorySources,
          login,
          readinessTimeout,
        );
        chapterTab = selected.tab;
        login = selected.login;
      }
      const epoch = ports.deps.identityEpoch;
      const sameDocument = (): boolean => {
        chapterStructure?.assertCurrent();
        return (
          page === ports.deps.page &&
          !page.isClosed() &&
          !ports.deps.closed &&
          epoch === ports.deps.identityEpoch
        );
      };
      const chapterGetRequests: ChapterGetRequestStructure[] = directoryMetadata.map((entry) => ({
        pathTemplate: entry.pathTemplate,
        status: entry.status,
        querySchema: entry.querySchema,
        sourceState:
          entry.epoch === undefined
            ? 'unobserved_request'
            : entry.epoch !== epoch
              ? entry.stored
                ? 'cleared_by_navigation'
                : 'prior_request'
              : !entry.stored
                ? 'non_success_response'
                : !entry.querySchema.replayBoundToCurrentWork
                  ? 'work_binding_unverified'
                  : observedDirectorySources.get(entry.pathTemplate)?.observation ===
                      entry.observation
                    ? 'current_source'
                    : 'superseded_same_family',
      }));
      const empty: ReadPageDiagnostic = {
        status: login.status === 'login_required' ? 'login_required' : 'capability_unavailable',
        sourceUrl:
          chapterTab?.routeTemplate ??
          chapterEntry?.routeTemplate ??
          diagnosticRouteTemplate(ports.url.toString()),
        capturedAt: new Date().toISOString(),
        identityObserved: {
          accountId: Boolean(login.identity?.accountId),
          authorId: Boolean(login.identity?.authorId),
          displayName: Boolean(login.identity?.displayName),
        },
        elements: [],
        links: [],
        getResponses: responses,
        readResponseStructure: [],
        chapterGetRequests,
        ...(chapterEntry ? { chapterEntry } : {}),
        ...(chapterTab ? { chapterTab } : {}),
        truncated: { elements: false, responses: responseCount > ports.maxResponses },
        limitations: [
          'Diagnostic metadata contains no element values, body text, account IDs, cookie/header data or response bodies.',
          'A route being diagnosed does not establish supported collection fields or permission to write.',
          'Read response schemas contain fixed field paths/types only, with bounded array-item shapes and no field values.',
          'Chapter GET query diagnostics contain fixed names/types/shapes and source-generation states only; unknown names and all query values are opaque.',
        ],
      };
      if (chapterEntry) {
        empty.limitations.push(
          'Chapter entry is a read-only structure diagnostic, not a verified chapter-directory collector; only current-generation actually observed GET URLs bound to this existing work may be freshly replayed for schema, and no chapter API is guessed.',
        );
        if (chapterEntry.status !== 'opened') return empty;
      }
      if (chapterTab?.status === 'unavailable') return empty;
      if (!shellReady)
        empty.limitations.push(
          'The observed writer navigation shell did not become ready within the bounded wait; a blank shell is not an empty dataset.',
        );
      if (login.status === 'unknown')
        empty.limitations.push(
          'No stable own-account identity was freshly verified on this document.',
        );
      if (login.status === 'login_required') return empty;
      try {
        validateDiagnosticSource(page.url(), ports.deps.discoveredStableTargets);
      } catch {
        empty.limitations.push(
          'The platform redirected to a route outside the diagnostic read allowlist.',
        );
        return empty;
      }
      if (!sameDocument())
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The read document changed before structure inspection',
        );
      const inspectChapterUi =
        login.status === 'authenticated' && chapterDirectoryWorkId(page.url()) !== null;
      const observed = await page.evaluate(readPageDiagnosticDom, {
        maxElements: ports.maxElements,
        inspectChapterUi,
        inspectVolumeOptions: ports.options.chapterVolumeOptions === true && inspectChapterUi,
        redactions: [
          login.identity?.accountId,
          login.identity?.authorId,
          login.identity?.displayName,
          ...chapterRedactions,
        ].filter((value): value is string => Boolean(value)),
      });
      const links: ReadPageDiagnostic['links'] = [];
      if (chapterTab?.status === 'opened' && chapterTab.routeTemplate && chapterTab.targetRef)
        links.push({
          routeTemplate: chapterTab.routeTemplate,
          targetRef: chapterTab.targetRef,
          label: '草稿箱',
        });
      if (chapterEntry?.status === 'opened' && chapterEntry.routeTemplate && chapterEntry.targetRef)
        links.push({
          routeTemplate: chapterEntry.routeTemplate,
          targetRef: chapterEntry.targetRef,
          label: '章节管理',
        });
      if (!sameDocument())
        throw new BrowserSessionError(
          'read_diagnostic_stale',
          'The read document changed during structure inspection',
        );
      const registerObservedLinks = createObservedLinkRegistrar({
        get observed() {
          return observed;
        },
        get deps() {
          return ports.deps;
        },
        get links() {
          return links;
        },
      });
      registerObservedLinks();
      const structures = new Map(ports.deps.pageReadStructures.get(page) ?? []);
      // A cached chapter schema is not fresh proof of this directory/work binding.
      for (const key of structures.keys())
        if (isChapterReadSchemaSource(new URL(key, 'https://fanqienovel.com').href))
          structures.delete(key);
      if (shellReady && login.status === 'authenticated') {
        const redactions = [
          login.identity?.accountId,
          login.identity?.authorId,
          login.identity?.displayName,
          ...(observed.internalBookTitles ?? []),
        ].filter((value): value is string => Boolean(value));
        for (const raw of [...observedLongStats.values()]) {
          if (!isLongStatsSchemaSource(raw)) continue;
          const pathTemplate = diagnosticRouteTemplate(raw).replace('https://fanqienovel.com', '');
          try {
            if (!sameDocument())
              throw new BrowserSessionError(
                'read_diagnostic_stale',
                'The read document changed during schema inspection',
              );
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
            if (!sameDocument())
              throw new BrowserSessionError(
                'read_diagnostic_stale',
                'The read document changed during schema inspection',
              );
            structures.set(pathTemplate, {
              pathTemplate,
              status: response.status,
              ...projectLongStatsResponseFields(response.json, redactions),
            });
            if (!response.ok || response.json === null)
              empty.limitations.push(
                `The actually observed long statistics GET ${pathTemplate} did not return successful JSON when refreshed; its diagnostic schema does not establish metric support.`,
              );
          } catch (error) {
            if (error instanceof BrowserSessionError) throw error;
            if (!sameDocument())
              throw new BrowserSessionError(
                'read_diagnostic_stale',
                'The read document changed during schema inspection',
              );
            structures.delete(pathTemplate);
            empty.limitations.push(
              `The actually observed long statistics GET ${pathTemplate} could not be refreshed safely; no raw failure details or schema values are returned.`,
            );
          }
        }
      }
      if (
        shellReady &&
        login.status === 'authenticated' &&
        isChapterDirectoryRoute(new URL(page.url()).pathname)
      ) {
        const currentWorkId = chapterDirectoryWorkId(page.url());
        if (!observedDirectorySources.has('/api/author/volume/volume_list/v1'))
          empty.limitations.push(
            'No current-generation observed volume GET survived; prior navigation sources are not reused or guessed.',
          );
        for (const [pathTemplate, source] of observedDirectorySources) {
          if (source.epoch !== epoch) continue;
          if (!projectChapterGetQuerySchema(source.raw, currentWorkId).replayBoundToCurrentWork) {
            empty.limitations.push(
              `The observed directory GET ${pathTemplate} has no unambiguous current-work query binding and is not replayed.`,
            );
            continue;
          }
          try {
            if (!sameDocument())
              throw new BrowserSessionError(
                'read_diagnostic_stale',
                'The read document changed during schema inspection',
              );
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
            if (!sameDocument())
              throw new BrowserSessionError(
                'read_diagnostic_stale',
                'The read document changed during schema inspection',
              );
            if (response.ok && response.json !== null)
              structures.set(pathTemplate, {
                pathTemplate,
                status: response.status,
                ...projectReadResponseFields(response.json),
              });
            else {
              structures.delete(pathTemplate);
              empty.limitations.push(
                `The actually observed directory GET ${pathTemplate} did not return successful JSON when refreshed; its schema does not establish chapter collection support.`,
              );
            }
          } catch (error) {
            if (error instanceof BrowserSessionError) throw error;
            if (!sameDocument())
              throw new BrowserSessionError(
                'read_diagnostic_stale',
                'The read document changed during schema inspection',
              );
            structures.delete(pathTemplate);
            empty.limitations.push(
              `The actually observed directory GET ${pathTemplate} could not be refreshed safely; no raw failure details or schema values are returned.`,
            );
          }
        }
      }
      const readResponseStructure = [...structures.values()]
        .slice(-ports.maxResponses)
        .map((entry) => ({ ...entry, fields: entry.fields.map((field) => ({ ...field })) }));
      return {
        ...empty,
        status:
          shellReady && login.status === 'authenticated' ? 'success' : 'capability_unavailable',
        elements: observed.elements,
        links,
        readResponseStructure,
        navigationLabels: observed.navigationLabels ?? [],
        ...(observed.chapterUi ? { chapterUi: observed.chapterUi } : {}),
        truncated: { elements: observed.truncated, responses: responseCount > ports.maxResponses },
      };
    } finally {
      try {
        await chapterStructure?.close();
      } finally {
        page.off('framenavigated', onNavigation);
        page.off('request', onRequest);
        page.off('response', onResponse);
      }
    }
  };
}
