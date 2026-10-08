import { initializeChapterRead } from '../chapter-context/initialize.js';
import { executeChapterRead } from '../chapter-context/execute-read.js';
import { type BrowserContext, type Page } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';

import {
  type DatasetResult,
  type ChapterRecord,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import {
  type BrowserSessionConfig,
  type BrowserCallOptions,
  type CurrentChapterDirectoryOptions,
  type CurrentChapterBodyRead,
} from '../contracts.js';

import { type ReadPageDiagnostic } from '../chapter-diagnostics.js';

import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type ReadCurrentChapterContextOperation } from '../contracts/read-current-chapter-context.js';

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
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  waitForWriterReady: WaitForWriterReadyOperation;
}
export function createReadCurrentChapterContext(
  deps: Dependencies,
): ReadCurrentChapterContextOperation {
  async function readCurrentChapterContext(
    page: Page,
    targetRef: string,
    options: BrowserCallOptions,
    collection?: {
      result: DatasetResult<ChapterRecord>;
      options: CurrentChapterDirectoryOptions;
      failureMetadata: CurrentChapterCollectionFailureDiagnostic;
      bodyRead?: CurrentChapterBodyRead;
    },
  ): Promise<ReadPageDiagnostic> {
    const chapterReadScope = initializeChapterRead(deps, page, targetRef, options, collection);

    chapterReadScope.page.on('request', chapterReadScope.onRequest);

    chapterReadScope.page.on('framenavigated', chapterReadScope.onNavigation);
    try {
      await executeChapterRead(chapterReadScope);
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
        if (chapterReadScope.collection?.bodyRead) await chapterReadScope.settleAborts();
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
        chapterReadScope.diagnostic.cdpSource = { ...chapterReadScope.cdpSource };
        chapterReadScope.diagnostic.schema =
          chapterReadScope.diagnostic.status === 'success' ? chapterReadScope.schema : null;
        chapterReadScope.diagnostic.checkedAt = new Date().toISOString();
        chapterReadScope.result.status = chapterReadScope.diagnostic.status;
        chapterReadScope.result.capturedAt =
          chapterReadScope.diagnostic.status === 'success'
            ? chapterReadScope.cdpSource.proofCapturedAt!
            : chapterReadScope.diagnostic.checkedAt;
        if (chapterReadScope.collection?.bodyRead) {
          const body = chapterReadScope.collection.bodyRead.result;
          body.capturedAt = chapterReadScope.result.capturedAt;
          if (
            chapterReadScope.diagnostic.status === 'success' &&
            chapterReadScope.bodyBuffer &&
            chapterReadScope.diagnostic.checks.responseDisposed &&
            chapterReadScope.cdpSource.detached &&
            chapterReadScope.observedFences()
          ) {
            body.status = 'success';
            body.records = [chapterReadScope.bodyBuffer];
            body.coverage = {
              complete: true,
              paginationComplete: true,
              pagesFetched: 1,
              pagesDiscovered: 1,
              recordsFetched: 1,
              totalRecords: 1,
              fields: [
                'sourceBoundary',
                'representation',
                'publishedVersionVerified',
                'requestedTarget',
                'title',
                'rawContent',
                'rawContentSha256',
                'rawContentBytes',
                'rawPublishStatus',
                'rawCreationStatus',
                'rawLatestVersion',
              ],
            };
          } else {
            body.status = 'capability_unavailable';
            body.records = [];
            body.coverage.complete = body.coverage.paginationComplete = false;
            body.coverage.pagesFetched = body.coverage.recordsFetched = 0;
            body.coverage.totalRecords = body.coverage.pagesDiscovered = null;
            body.coverage.fields = [];
          }
          chapterReadScope.bodyBuffer = null;
        }
        if (chapterReadScope.collection) {
          const directory = chapterReadScope.collection.result;
          directory.capturedAt = chapterReadScope.result.capturedAt;
          directory.coverage.complete = directory.coverage.paginationComplete = false;
          if (chapterReadScope.diagnostic.status === 'success' && chapterReadScope.collected) {
            directory.status = 'partial';
            directory.records = chapterReadScope.collected.records;
            directory.coverage.pagesFetched = chapterReadScope.chapterPagesFetched;
            directory.coverage.recordsFetched = chapterReadScope.collected.records.length;
            directory.coverage.fields = [
              'workId',
              'chapterId',
              'volumeId',
              'title',
              'index',
              'wordCount',
              'articleStatusCode',
              'displayStatusCode',
              'createdAtRaw',
              'scheduledAtRaw',
            ];
            if (chapterReadScope.managementCoverage) {
              // Completion must remain inside the same nonrenewable scope
              // deadline even when final owner or cleanup awaits finish later.
              if (
                chapterReadScope.managementCoverage.status === 'complete' &&
                performance.now() >= chapterReadScope.managementDeadline
              ) {
                chapterReadScope.managementCoverage.status = 'partial';
                if (!chapterReadScope.managementCoverage.reasons.includes('read_budget_exceeded'))
                  chapterReadScope.managementCoverage.reasons.push('read_budget_exceeded');
              }
              directory.managementCoverage = chapterReadScope.managementCoverage;
            }
            if (chapterReadScope.managementControlObservation)
              directory.managementControlObservation =
                chapterReadScope.managementControlObservation;
            directory.errors.push({ code: 'chapter_scope_coverage_unverified', scope: 'chapters' });
          } else {
            chapterReadScope.recordCollectionFailureStage();
            chapterReadScope.collection.failureMetadata.ownAccountContext.attempts =
              chapterReadScope.diagnostic.ownAccountContext.attempts;
            chapterReadScope.collection.failureMetadata.ownAccountContext.disposed =
              chapterReadScope.diagnostic.ownAccountContext.disposed;
            directory.readDiagnostics = {
              currentChapterCollection: chapterReadScope.collection.failureMetadata,
            };
            directory.status =
              chapterReadScope.diagnostic.status === 'login_required'
                ? 'login_required'
                : 'capability_unavailable';
            directory.records = [];
            directory.coverage.pagesFetched = directory.coverage.recordsFetched = 0;
            directory.coverage.fields = [];
            directory.errors.push({
              code:
                !chapterReadScope.active() || chapterReadScope.violated
                  ? chapterReadScope.options.signal?.aborted
                    ? 'cancelled'
                    : 'read_document_changed'
                  : (chapterReadScope.collectionFailure ??
                    chapterReadScope.diagnostic.reason ??
                    'chapter_read_failed'),
              scope: 'chapters',
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

    return chapterReadScope.result;
  }
  return readCurrentChapterContext;
}
