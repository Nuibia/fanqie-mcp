import { createVolumeRequestMatcher } from '../chapter-directory/matches-volume-request.js';
import { createDirectoryMatcher } from '../chapter-directory/matches-directory.js';
import { type Page, type Request } from 'playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot } from '../body-options.js';
import { type LoginState } from '../own-identity.js';
import {
  type ChapterVolumeRefreshEvent,
  type ChapterVolumeRefreshDiagnostic,
} from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type ChapterDirectoryCallOptions } from '../contracts.js';
import {
  diagnosticRouteTemplate,
  validateDiagnosticSource,
  projectChapterVolumeRefreshEvent,
} from '../chapter-routes.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
import { type OwnsPageSlotOperation } from '../contracts/owns-page-slot.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type OpenExistingChapterDirectoryOperation } from '../contracts/open-existing-chapter-directory.js';
import { type EnterCurrentChapterDirectoryOperation } from '../contracts/enter-current-chapter-directory.js';
export interface Dependencies {
  assertAccountUsable: AssertAccountUsableOperation;
  ownsPageSlot: OwnsPageSlotOperation;
  pageSlots: AsyncLocalStorage<BrowserPageSlot>;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  config: BrowserSessionConfig;
  discoveredStableTargets: Set<string>;
  identityEpoch: number;
  page: Page | null;
  closed: boolean;
  activeReaderPage: Page | null;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  waitForWriterReady: WaitForWriterReadyOperation;
  openExistingChapterDirectory: OpenExistingChapterDirectoryOperation;
  diagnosticTargets: Map<string, string>;
}
export function createEnterCurrentChapterDirectory(
  deps: Dependencies,
): EnterCurrentChapterDirectoryOperation {
  async function enterCurrentChapterDirectory(
    page: Page,
    workId: string,
    options: ChapterDirectoryCallOptions = {},
  ): Promise<{ sourceUrl: string }> {
    deps.assertAccountUsable();
    if (!deps.ownsPageSlot(page))
      throw new BrowserSessionError(
        'chapter_directory_slot_required',
        'Chapter directory entry requires the active service-owned browser slot',
      );
    const slot = deps.pageSlots.getStore()!;
    const assertSlot = () => {
      if (options.signal?.aborted)
        throw new BrowserSessionError('cancelled', 'Chapter directory entry was cancelled');
      if (!deps.isCurrentPageSlot(slot, page))
        throw new BrowserSessionError(
          'chapter_directory_slot_required',
          'Chapter directory entry requires the active service-owned browser slot',
        );
    };
    assertSlot();
    if (!/^[1-9]\d{9,29}$/.test(workId))
      throw new BrowserSessionError(
        'invalid_work_id',
        'Chapter directory entry requires a stable work ID',
      );
    const timeoutMs = Math.max(
      1,
      Math.min(12_000, options.timeoutMs ?? deps.config.timeoutMs ?? 20_000),
    );
    const sources = new Set<string>();
    const epochs = new WeakMap<Request, number>();
    // This is a call-local request template, not response evidence. A cold-navigation
    // request may start before the new document epoch; its old response stays rejected
    // by every existing observer. Only a separate new GET can establish a current source.
    const volumeTemplates = new Set<string>();
    let captureVolumeTemplate = false;
    let bootstrapDestination: URL | null = null,
      bootstrapInterrupted = false;
    const matchesDirectory = createDirectoryMatcher({
      get bootstrapDestination() {
        return bootstrapDestination;
      },
      deps,
      workId,
    });
    let refreshUrl: string | null = null,
      refreshEpoch: number | null = null;
    let refreshRequest: Request | null = null,
      refreshResponseStatus: number | null = null,
      refreshAmbiguous = false,
      refreshTemplateChanged = false;
    const refreshEvents: ChapterVolumeRefreshEvent[] = [];
    let refreshStarted = false,
      refreshVerified = false,
      refreshEventsTruncated = false;
    let refreshFetchResult: ChapterVolumeRefreshDiagnostic['fetchResult'] = 'not_completed',
      refreshHttpStatus: number | null = null;
    const refreshObservedEvents = { requests: 0, responses: 0 },
      refreshCandidateEvents = { requests: 0, responses: 0 };
    const volumeRequestMatches = createVolumeRequestMatcher({ page, workId });
    const observeRefreshEvent = (
      event: ChapterVolumeRefreshEvent['event'],
      request: Request,
      status?: number,
    ) => {
      if (!deps.isCurrentPageSlot(slot, page) || refreshUrl === null || refreshEpoch === null)
        return;
      const category = event === 'request' ? 'requests' : 'responses';
      refreshObservedEvents[category] += 1;
      const projected = projectChapterVolumeRefreshEvent(request, {
        event,
        workId,
        template: refreshUrl,
        mainFrame: page.mainFrame(),
        requestEpoch: epochs.get(request),
        refreshEpoch,
        currentEpoch: deps.identityEpoch,
        samePage: page === deps.page,
        activeSlot: deps.isCurrentPageSlot(slot, page),
        pageOpen: !page.isClosed(),
        sessionOpen: !deps.closed,
        signalAborted: Boolean(options.signal?.aborted),
        strictSourceMatch: volumeRequestMatches(request),
        ...(status !== undefined ? { status } : {}),
      });
      if (!projected) return;
      refreshCandidateEvents[category] += 1;
      if (refreshEvents.length < 32) refreshEvents.push(projected);
      else refreshEventsTruncated = true;
    };
    const matches = (raw: string): boolean => {
      try {
        const url = new URL(raw);
        return (
          url.origin === 'https://fanqienovel.com' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          url.pathname === '/api/author/book/book_list/v0/' &&
          url.searchParams.has('page_index') &&
          url.searchParams.has('page_count') &&
          ![...url.searchParams.keys()].some((key) =>
            /^(?:author|writer|user|target|account|owner)_?id$|^(?:uid|id)$/i.test(key),
          )
        );
      } catch {
        return false;
      }
    };
    const onRequest = (request: Request) => {
      if (!deps.isCurrentPageSlot(slot, page)) return;
      if (request.method() === 'GET') epochs.set(request, deps.identityEpoch);
      observeRefreshEvent('request', request);
      if (
        options.signal?.aborted ||
        page !== deps.page ||
        page !== deps.activeReaderPage ||
        page.isClosed() ||
        deps.closed ||
        !volumeRequestMatches(request)
      )
        return;
      if (captureVolumeTemplate) {
        if (!bootstrapInterrupted && matchesDirectory(page.url()) && volumeTemplates.size < 2)
          volumeTemplates.add(request.url());
      } else if (refreshUrl !== null && refreshEpoch === deps.identityEpoch) {
        if (request.url() !== refreshUrl) {
          refreshTemplateChanged = true;
          return;
        }
        if (refreshRequest && refreshRequest !== request) refreshAmbiguous = true;
        else refreshRequest = request;
      }
    };
    const onNavigation = (frame: unknown) => {
      if (deps.isCurrentPageSlot(slot, page) && frame === page.mainFrame()) {
        sources.clear();
        if (captureVolumeTemplate && !matchesDirectory(page.url())) bootstrapInterrupted = true;
      }
    };
    const onResponse = (response: { url(): string; status(): number; request(): Request }) => {
      if (!deps.isCurrentPageSlot(slot, page)) return;
      observeRefreshEvent('response', response.request(), response.status());
      if (
        page === deps.page &&
        !page.isClosed() &&
        !deps.closed &&
        response.request().method() === 'GET' &&
        epochs.get(response.request()) === deps.identityEpoch &&
        response.status() >= 200 &&
        response.status() < 300 &&
        matches(response.url()) &&
        sources.size < 5
      )
        sources.add(response.url());
      if (
        refreshRequest === response.request() &&
        refreshUrl === response.url() &&
        refreshEpoch === deps.identityEpoch &&
        epochs.get(response.request()) === deps.identityEpoch &&
        page === deps.page &&
        page === deps.activeReaderPage &&
        !page.isClosed() &&
        !deps.closed &&
        !options.signal?.aborted
      )
        refreshResponseStatus = response.status();
    };
    page.on('request', onRequest);
    page.on('framenavigated', onNavigation);
    page.on('response', onResponse);
    const sameOwner = (before: LoginState, after: LoginState): boolean =>
      after.status === 'authenticated' &&
      Boolean(
        before.identity?.accountId
          ? after.identity?.accountId === before.identity.accountId
          : before.identity?.authorId && after.identity?.authorId === before.identity.authorId,
      );
    try {
      const original = await deps.verifyCurrentAccount(page);
      assertSlot();
      if (
        original.status !== 'authenticated' ||
        (!original.identity?.accountId && !original.identity?.authorId)
      )
        throw new BrowserSessionError(
          'capability_unavailable',
          'A fresh stable own identity is required for chapter directory entry',
        );
      await page.goto('https://fanqienovel.com/main/writer/book-manage', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      assertSlot();
      if (!(await deps.waitForWriterReady(page, timeoutMs)))
        throw new BrowserSessionError(
          'capability_unavailable',
          'The established management shell did not become ready',
        );
      const manager = await deps.verifyCurrentAccount(page);
      assertSlot();
      if (!sameOwner(original, manager))
        throw new BrowserSessionError(
          'account_mismatch',
          'The stable own identity changed before chapter entry',
        );
      if (!sources.size)
        try {
          await page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              epochs.get(response.request()) === deps.identityEpoch &&
              matches(response.url()),
            { timeout: timeoutMs },
          );
        } catch {
          /* An unobserved management URL is never synthesized. */
        }
      assertSlot();
      const entered = await deps.openExistingChapterDirectory(
        page,
        sources,
        workId,
        manager,
        timeoutMs,
      );
      assertSlot();
      if (entered.entry.status !== 'opened' || !entered.entry.targetRef)
        throw new BrowserSessionError(
          'capability_unavailable',
          'The verified existing-work chapter directory could not be opened',
        );
      const raw = deps.diagnosticTargets.get(entered.entry.targetRef);
      if (!raw)
        throw new BrowserSessionError(
          'capability_unavailable',
          'The verified chapter directory target is unavailable',
        );
      const target = validateDiagnosticSource(raw, deps.discoveredStableTargets);
      // A full read navigation is necessary: the real SPA button left directory
      // GETs lazy, whereas a full goto of this already verified target loaded them.
      bootstrapDestination = target;
      captureVolumeTemplate = true;
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      assertSlot();
      captureVolumeTemplate = false;
      if (bootstrapInterrupted || !matchesDirectory(page.url()))
        throw new BrowserSessionError(
          'read_document_changed',
          'The cold chapter navigation left its verified existing-work read route',
        );
      // Freeze after the bounded initialization window. No initialization response
      // is adopted as evidence, and every later await retains the strict epoch fence.
      const stableUrl = page.url(),
        epoch = deps.identityEpoch;
      const assertDirectory = () => {
        assertSlot();
        if (epoch !== deps.identityEpoch || page.url() !== stableUrl)
          throw new BrowserSessionError(
            'read_document_changed',
            'The verified chapter directory document changed during entry',
          );
      };
      assertDirectory();
      const current = await deps.verifyCurrentAccount(page);
      assertDirectory();
      if (!sameOwner(original, current))
        throw new BrowserSessionError(
          'account_mismatch',
          'The stable own identity changed during chapter entry',
        );
      if (volumeTemplates.size !== 1)
        throw new BrowserSessionError(
          'chapter_volume_template_unavailable',
          'No unique existing-work volume request template was observed during this directory navigation',
        );
      const template = [...volumeTemplates][0]!;
      // No URL construction or old response adoption: replay the exact request-start
      // template once after the destination, current epoch and same owner are verified.
      assertDirectory();
      refreshUrl = template;
      refreshEpoch = epoch;
      refreshStarted = true;
      const refreshed = await page
        .evaluate(async (sourceUrl) => {
          const request = new Request(sourceUrl, {
            method: 'GET',
            credentials: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
          });
          const response = await fetch(request);
          await response.arrayBuffer();
          return { status: response.status, ok: response.ok };
        }, template)
        .catch(() => {
          assertDirectory();
          throw new BrowserSessionError(
            'chapter_volume_refresh_transport_failed',
            'The current existing-work volume GET transport did not complete',
          );
        });
      assertDirectory();
      refreshHttpStatus = refreshed.status;
      refreshFetchResult =
        refreshed.ok && refreshed.status >= 200 && refreshed.status < 300
          ? 'http_success'
          : 'http_failure';
      if (!refreshed.ok || refreshed.status < 200 || refreshed.status >= 300)
        throw new BrowserSessionError(
          'chapter_volume_refresh_http_failed',
          'The current existing-work volume GET did not report HTTP success',
        );
      if (refreshTemplateChanged)
        throw new BrowserSessionError(
          'chapter_volume_refresh_request_template_changed',
          'A current volume GET request differed from the observed refresh template',
        );
      if (!refreshRequest)
        throw new BrowserSessionError(
          'chapter_volume_refresh_request_unobserved',
          'The current volume GET request was not observed in this document',
        );
      if (refreshAmbiguous)
        throw new BrowserSessionError(
          'chapter_volume_refresh_request_ambiguous',
          'More than one current volume GET request matched this refresh',
        );
      if (refreshResponseStatus === null) {
        // evaluate() and Node response events can resolve in either order. Wait only
        // for this already observed new request; this does not issue or retry a GET.
        const request = refreshRequest;
        const matchesRefresh = (response: {
          url(): string;
          status(): number;
          request(): Request;
        }): boolean => {
          assertDirectory();
          return (
            !refreshAmbiguous &&
            !refreshTemplateChanged &&
            response.request() === request &&
            refreshRequest === request &&
            response.url() === template &&
            refreshUrl === template &&
            refreshEpoch === epoch &&
            epochs.get(request) === epoch &&
            volumeRequestMatches(request) &&
            response.status() === refreshed.status
          );
        };
        try {
          const response = await page.waitForResponse(matchesRefresh, {
            timeout: Math.min(4_000, Math.max(1_000, timeoutMs)),
          });
          assertDirectory();
          if (matchesRefresh(response)) refreshResponseStatus = response.status();
        } catch {
          assertDirectory();
          if (refreshTemplateChanged)
            throw new BrowserSessionError(
              'chapter_volume_refresh_request_template_changed',
              'A current volume GET request differed from the observed refresh template',
            );
          if (refreshAmbiguous)
            throw new BrowserSessionError(
              'chapter_volume_refresh_request_ambiguous',
              'More than one current volume GET request matched this refresh',
            );
          throw new BrowserSessionError(
            'chapter_volume_refresh_response_unobserved',
            'The matching current volume GET response was not observed within the bounded wait',
          );
        }
      }
      assertDirectory();
      if (refreshTemplateChanged)
        throw new BrowserSessionError(
          'chapter_volume_refresh_request_template_changed',
          'A current volume GET request differed from the observed refresh template',
        );
      if (refreshAmbiguous)
        throw new BrowserSessionError(
          'chapter_volume_refresh_request_ambiguous',
          'More than one current volume GET request matched this refresh',
        );
      if (refreshResponseStatus !== refreshed.status)
        throw new BrowserSessionError(
          'chapter_volume_refresh_response_unobserved',
          'The matching successful current volume GET response was not observed',
        );
      refreshUrl = null;
      refreshEpoch = null;
      const afterRefresh = await deps.verifyCurrentAccount(page);
      assertDirectory();
      if (!sameOwner(original, afterRefresh))
        throw new BrowserSessionError(
          'account_mismatch',
          'The stable own identity changed during volume refresh',
        );
      refreshVerified = true;
      return { sourceUrl: diagnosticRouteTemplate(stableUrl) };
    } catch (error) {
      if (error instanceof BrowserSessionError) throw error;
      throw new BrowserSessionError(
        'chapter_directory_unavailable',
        'The verified chapter directory could not be opened safely',
      );
    } finally {
      captureVolumeTemplate = false;
      bootstrapDestination = null;
      refreshUrl = null;
      refreshEpoch = null;
      volumeTemplates.clear();
      page.off('request', onRequest);
      page.off('framenavigated', onNavigation);
      page.off('response', onResponse);
      if (refreshStarted && options.onVolumeRefreshDiagnostic) {
        const diagnostic: ChapterVolumeRefreshDiagnostic = {
          kind: 'chapter_volume_refresh',
          outcome: refreshVerified ? 'verified' : 'unverified',
          observedEvents: { ...refreshObservedEvents },
          candidateEvents: { ...refreshCandidateEvents },
          events: refreshEvents.map((event) => ({
            ...event,
            query: { ...event.query, knownKeys: [...event.query.knownKeys] },
          })),
          truncated: refreshEventsTruncated,
          fetchResult: refreshFetchResult,
          proof: {
            requestObserved: refreshRequest !== null,
            requestAmbiguous: refreshAmbiguous,
            templateChanged: refreshTemplateChanged,
            responseStatusMatched:
              refreshHttpStatus !== null && refreshResponseStatus === refreshHttpStatus,
          },
        };
        // Debug delivery cannot change the read result or substitute for source proof.
        try {
          options.onVolumeRefreshDiagnostic(diagnostic);
        } catch {
          /* The caller receives no outside error details. */
        }
      }
    }
  }
  return enterCurrentChapterDirectory;
}
