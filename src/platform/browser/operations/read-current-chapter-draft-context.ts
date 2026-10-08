import { initializeDraftRead } from '../chapter-draft-context/initialize.js';
import { executeDraftRead } from '../chapter-draft-context/execute-read.js';
import { type BrowserContext, type Page } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';

import {
  type DatasetResult,
  type ChapterDraftRecord,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import {
  type BrowserSessionConfig,
  type BrowserCallOptions,
  type CurrentChapterDirectoryOptions,
} from '../contracts.js';

import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type ReadCurrentChapterDraftContextOperation } from '../contracts/read-current-chapter-draft-context.js';

export interface Dependencies {
  activePageSlot: BrowserPageSlot | null;
  diagnosticTargets: Map<string, string>;
  discoveredStableTargets: Set<string>;
  config: BrowserSessionConfig;
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  identityEpoch: number;
  page: Page | null;
  activeReaderPage: Page | null;
  closed: boolean;
  context: BrowserContext | null;
  chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
  waitForWriterReady: WaitForWriterReadyOperation;
}
export function createReadCurrentChapterDraftContext(
  deps: Dependencies,
): ReadCurrentChapterDraftContextOperation {
  async function readCurrentChapterDraftContext(
    page: Page,
    targetRef: string,
    options: BrowserCallOptions,
    collection: {
      result: DatasetResult<ChapterDraftRecord>;
      options: CurrentChapterDirectoryOptions;
      failureMetadata: CurrentChapterCollectionFailureDiagnostic;
    },
    deadline: number,
  ): Promise<void> {
    const chapterReadScope = initializeDraftRead(
      deps,
      page,
      targetRef,
      options,
      collection,
      deadline,
    );

    chapterReadScope.page.on('request', chapterReadScope.onRequest);

    chapterReadScope.page.on('framenavigated', chapterReadScope.onNavigation);
    try {
      await executeDraftRead(chapterReadScope);
    } catch {
      chapterReadScope.diagnostic.reason = chapterReadScope.fatalBlocked
        ? 'bootstrap_request_blocked'
        : !chapterReadScope.active() ||
            chapterReadScope.violated ||
            (chapterReadScope.frozen && !chapterReadScope.stable())
          ? 'document_changed'
          : 'transport_failed';
    } finally {
      chapterReadScope.closeCollectionSourceWindow();
      chapterReadScope.closeViewWindow();
      if (chapterReadScope.diagnostic.status !== 'success')
        chapterReadScope.recordCollectionFailureStage();
      chapterReadScope.collectionStage = 'cleanup';
      chapterReadScope.cleanup = true;
      try {
        if (chapterReadScope.guarded)
          try {
            await chapterReadScope.page.unroute('**/*', chapterReadScope.readOnlyRoute);
          } catch {
            if (chapterReadScope.collection) {
              chapterReadScope.collectionFailure = 'chapter_context_cleanup_failed';
              chapterReadScope.diagnostic.status = 'capability_unavailable';
              chapterReadScope.diagnostic.reason = 'document_changed';
              chapterReadScope.recordCollectionFailureStage();
            }
          }
        if (chapterReadScope.response)
          try {
            await chapterReadScope.response.dispose();
            chapterReadScope.diagnostic.checks.responseDisposed = true;
          } catch {
            chapterReadScope.diagnostic.status = 'capability_unavailable';
            chapterReadScope.diagnostic.reason = 'response_disposal_failed';
            chapterReadScope.recordCollectionFailureStage();
          }
        await chapterReadScope.settleAborts();
        if (chapterReadScope.diagnostic.status === 'success' && chapterReadScope.cdp) {
          try {
            const finalFrame = (await chapterReadScope.cdp.send('Page.getFrameTree')).frameTree
              .frame;
            if (
              finalFrame.id !== chapterReadScope.rootFrame ||
              finalFrame.parentId ||
              finalFrame.loaderId !== chapterReadScope.loader ||
              finalFrame.urlFragment ||
              finalFrame.url !== chapterReadScope.frozenUrl ||
              !chapterReadScope.stable()
            )
              throw new Error('The final canonical document check failed');
          } catch {
            chapterReadScope.cdpFault('source_unverified', {
              site: 'final_barrier',
              predicate: 'callback_exception',
            });
            chapterReadScope.diagnostic.status = 'capability_unavailable';
            chapterReadScope.diagnostic.reason = chapterReadScope.fatalBlocked
              ? 'bootstrap_request_blocked'
              : 'document_changed';
            chapterReadScope.recordCollectionFailureStage();
          }
        }
        if (chapterReadScope.requestContext)
          chapterReadScope.diagnostic.checks.sameContext =
            chapterReadScope.deps.context === chapterReadScope.requestContext &&
            chapterReadScope.page.context() === chapterReadScope.requestContext;
        chapterReadScope.diagnostic.checks.currentPage =
          chapterReadScope.page === chapterReadScope.deps.page &&
          !chapterReadScope.page.isClosed() &&
          !chapterReadScope.deps.closed;
        chapterReadScope.diagnostic.checks.activeSlot =
          chapterReadScope.page === chapterReadScope.deps.activeReaderPage;
        chapterReadScope.diagnostic.checks.epochStable =
          chapterReadScope.frozen &&
          chapterReadScope.nonempty(chapterReadScope.frozenLoader) &&
          chapterReadScope.loader === chapterReadScope.frozenLoader &&
          chapterReadScope.frozenGeneration === chapterReadScope.generation &&
          !chapterReadScope.pendingNavigation &&
          !chapterReadScope.pendingSameDocument &&
          !chapterReadScope.violated;
        chapterReadScope.diagnostic.checks.routeStable =
          chapterReadScope.frozen &&
          chapterReadScope.page.url() === chapterReadScope.frozenUrl &&
          chapterReadScope.permittedRoute(chapterReadScope.page.url());
        if (chapterReadScope.diagnostic.status === 'success' && !chapterReadScope.stable()) {
          chapterReadScope.diagnostic.status = 'capability_unavailable';
          chapterReadScope.diagnostic.reason = chapterReadScope.fatalBlocked
            ? 'bootstrap_request_blocked'
            : 'document_changed';
          chapterReadScope.recordCollectionFailureStage();
        }
        if (chapterReadScope.diagnostic.status === 'success' && chapterReadScope.collection) {
          chapterReadScope.collectionStage = 'owner_callback';
          try {
            chapterReadScope.assertStable();
            if (!chapterReadScope.verifiedOwner || !chapterReadScope.collected)
              throw new BrowserSessionError(
                'capability_unavailable',
                'The current directory identity could not be verified',
              );
            chapterReadScope.collection.failureMetadata.callback.entered = true;
            chapterReadScope.collection.options.onVerifiedOwner(chapterReadScope.verifiedOwner);
            chapterReadScope.collection.failureMetadata.callback.succeeded = true;
            chapterReadScope.assertStable();
          } catch {
            chapterReadScope.recordCollectionFailureStage('identity_unverified');
            chapterReadScope.diagnostic.status = 'capability_unavailable';
            chapterReadScope.diagnostic.reason = 'identity_unverified';
          }
        }
        chapterReadScope.collectionStage = 'cleanup';
        if (chapterReadScope.diagnostic.status === 'success')
          chapterReadScope.cdpSource.proofCapturedAt = new Date().toISOString();
        if (chapterReadScope.cdp) {
          // Resource cleanup follows the recorded canonical cutoff. Public/CDP
          // observations can still veto delivery, but never extend that proof.
          chapterReadScope.expectedDetach = true;
          try {
            await chapterReadScope.cdp.detach();
            chapterReadScope.cdpSource.detached = true;
            chapterReadScope.cdpSource.connected = false;
          } catch {
            chapterReadScope.cdpFault('cleanup_failed', {
              site: 'detach_cleanup',
              predicate: 'detach_failed',
            });
            chapterReadScope.diagnostic.status = 'capability_unavailable';
            chapterReadScope.diagnostic.reason = 'document_changed';
            chapterReadScope.recordCollectionFailureStage();
          }
        }
        if (
          chapterReadScope.diagnostic.status === 'success' &&
          (!chapterReadScope.cdpSource.detached || !chapterReadScope.observedFences())
        ) {
          chapterReadScope.diagnostic.status = 'capability_unavailable';
          chapterReadScope.diagnostic.reason = chapterReadScope.fatalBlocked
            ? 'bootstrap_request_blocked'
            : 'document_changed';
          chapterReadScope.recordCollectionFailureStage();
        }
        if (chapterReadScope.diagnostic.status !== 'success')
          chapterReadScope.cdpSource.proofCapturedAt = null;
        if (chapterReadScope.blockedRequests.count)
          chapterReadScope.diagnostic.blockedRequests = {
            entries: chapterReadScope.blockedRequests.entries.map((entry) => ({ ...entry })),
            count: chapterReadScope.blockedRequests.count,
            truncated: chapterReadScope.blockedRequests.truncated,
            summary:
              chapterReadScope.blockedNonNavigation && !chapterReadScope.fatalBlocked
                ? 'blocked_non_navigation'
                : null,
          };
        chapterReadScope.navigationTelemetry.final = chapterReadScope.navigationState();
        chapterReadScope.diagnostic.navigationTelemetry = chapterReadScope.navigationTelemetry;
        chapterReadScope.diagnostic.checkedAt = new Date().toISOString();
        if (
          chapterReadScope.diagnostic.status === 'success' &&
          !chapterReadScope.observedFences()
        ) {
          chapterReadScope.diagnostic.status = 'capability_unavailable';
          chapterReadScope.diagnostic.reason = 'document_changed';
          chapterReadScope.recordCollectionFailureStage();
          chapterReadScope.cdpSource.proofCapturedAt = null;
        }
        chapterReadScope.diagnostic.cdpSource = { ...chapterReadScope.cdpSource };
        chapterReadScope.diagnostic.schema =
          chapterReadScope.diagnostic.status === 'success' ? chapterReadScope.schema : null;
        chapterReadScope.result.status = chapterReadScope.diagnostic.status;
        chapterReadScope.result.capturedAt =
          chapterReadScope.diagnostic.status === 'success'
            ? chapterReadScope.cdpSource.proofCapturedAt!
            : chapterReadScope.diagnostic.checkedAt;
        if (chapterReadScope.collection) {
          const directory = chapterReadScope.collection.result;
          directory.capturedAt = chapterReadScope.result.capturedAt;
          directory.coverage.complete = directory.coverage.paginationComplete = false;
          const finalDrafts = chapterReadScope.collected as {
            records: ChapterDraftRecord[];
            total: number;
          } | null;
          if (chapterReadScope.diagnostic.status === 'success' && finalDrafts) {
            directory.status = chapterReadScope.draftComplete ? 'success' : 'partial';
            directory.records = finalDrafts.records;
            directory.coverage.complete = directory.coverage.paginationComplete =
              chapterReadScope.draftComplete;
            directory.coverage.pagesFetched = chapterReadScope.chapterPagesFetched;
            directory.coverage.recordsFetched = finalDrafts.records.length;
            directory.coverage.totalRecords = finalDrafts.total;
            directory.coverage.pagesDiscovered = chapterReadScope.draftComplete
              ? chapterReadScope.chapterPagesFetched
              : null;
            directory.coverage.fields = [
              'workId',
              'draftId',
              'title',
              'wordCount',
              'modifiedAtRaw',
              'sourceScope',
            ];
            if (!chapterReadScope.draftComplete)
              directory.errors.push({
                code: chapterReadScope.draftPartialReason ?? 'chapter_draft_scope_unverified',
                scope: 'chapter_drafts',
              });
          } else {
            directory.status =
              chapterReadScope.diagnostic.status === 'login_required'
                ? 'login_required'
                : 'capability_unavailable';
            directory.records = [];
            directory.coverage.pagesFetched = directory.coverage.recordsFetched = 0;
            directory.coverage.fields = [];
            directory.coverage.totalRecords = directory.coverage.pagesDiscovered = null;
            directory.errors.push({
              code:
                !chapterReadScope.active() || chapterReadScope.violated
                  ? chapterReadScope.options.signal?.aborted
                    ? 'cancelled'
                    : 'read_document_changed'
                  : (chapterReadScope.collectionFailure ??
                    chapterReadScope.diagnostic.reason ??
                    'chapter_draft_read_failed'),
              scope: 'chapter_drafts',
            });
          }
        }
      } finally {
        // Keep the navigation-request latch alive through every cleanup await
        // and the final schema/clock verdict; a pending commit is already stale.
        if (chapterReadScope.cdp) {
          chapterReadScope.cdp.off('Page.frameStartedNavigating', chapterReadScope.cdpStart);
          chapterReadScope.cdp.off('Page.frameNavigated', chapterReadScope.cdpCommitted);
          chapterReadScope.cdp.off(
            'Page.navigatedWithinDocument',
            chapterReadScope.cdpWithinDocument,
          );
          chapterReadScope.cdp.off('Network.requestWillBeSent', chapterReadScope.cdpRequest);
          chapterReadScope.cdp.off('Page.frameDetached', chapterReadScope.cdpFrameDetached);
          chapterReadScope.cdp.off('close', chapterReadScope.cdpClosed);
        }
        chapterReadScope.recordSourceClear('cleanup');
        chapterReadScope.page.off('request', chapterReadScope.onRequest);
        chapterReadScope.page.off('framenavigated', chapterReadScope.onNavigation);
        chapterReadScope.clearTemplates();
        chapterReadScope.sealedCollectionSources = null;
        chapterReadScope.managementRequestIds.clear();
      }
    }

    return;
  }
  return readCurrentChapterDraftContext;
}
