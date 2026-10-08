import { createReadPageInspector } from '../read-page/inspect-page.js';

import { type Page } from 'playwright';
import { type ReadResponseStructure } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig } from '../contracts.js';
import { validateDiagnosticSource, chapterDirectoryWorkId } from '../chapter-routes.js';

import { type DiagnosticOptions, type ReadPageDiagnostic } from '../chapter-diagnostics.js';

import { type DiagnoseChapterVolumeContextOperation } from '../contracts/diagnose-chapter-volume-context.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type WaitForObservedOwnSourceOperation } from '../contracts/wait-for-observed-own-source.js';
import { type OpenExistingChapterDirectoryOperation } from '../contracts/open-existing-chapter-directory.js';
import { type PrepareChapterDiagnosticOperation } from '../contracts/prepare-chapter-diagnostic.js';
import { type OpenChapterDraftTabOperation } from '../contracts/open-chapter-draft-tab.js';
import { type DiagnoseReadPageOperation } from '../contracts/diagnose-read-page.js';
export interface Dependencies {
  diagnoseChapterVolumeContext: DiagnoseChapterVolumeContextOperation;
  diagnosticTargets: Map<string, string>;
  discoveredStableTargets: Set<string>;
  withPage: WithPageOperation;
  page: Page | null;
  closed: boolean;
  identityEpoch: number;
  config: BrowserSessionConfig;
  waitForWriterReady: WaitForWriterReadyOperation;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  ownInfoUrls: WeakMap<Page, Set<string>>;
  waitForObservedOwnSource: WaitForObservedOwnSourceOperation;
  openExistingChapterDirectory: OpenExistingChapterDirectoryOperation;
  prepareChapterDiagnostic: PrepareChapterDiagnosticOperation;
  openChapterDraftTab: OpenChapterDraftTabOperation;
  pageReadStructures: WeakMap<Page, Map<string, ReadResponseStructure>>;
}
export function createDiagnoseReadPage(deps: Dependencies): DiagnoseReadPageOperation {
  async function diagnoseReadPage(
    sourceUrl: string,
    options: DiagnosticOptions = {},
  ): Promise<ReadPageDiagnostic> {
    if (
      options.chapterVolumeOptions !== undefined &&
      (options.chapterVolumeOptions !== true ||
        !options.openChaptersForWorkId ||
        options.chapterTab !== undefined ||
        options.chapterVolumeContext !== undefined)
    )
      throw new BrowserSessionError(
        'invalid_chapter_volume_options',
        'Volume options require only the verified current-work management entry',
      );
    if (options.chapterVolumeContext !== undefined) {
      if (
        options.chapterVolumeContext !== true ||
        options.openChaptersForWorkId !== undefined ||
        options.chapterTab !== undefined ||
        !/^diagnostic:[a-f0-9]{24}$/.test(sourceUrl)
      )
        throw new BrowserSessionError(
          'invalid_chapter_context_target',
          'The volume context experiment requires only a registered directory reference',
        );
      return deps.diagnoseChapterVolumeContext(sourceUrl.slice('diagnostic:'.length), options);
    }
    const resolved = sourceUrl.startsWith('diagnostic:')
      ? deps.diagnosticTargets.get(sourceUrl.slice('diagnostic:'.length))
      : sourceUrl;
    if (!resolved)
      throw new BrowserSessionError(
        'invalid_diagnostic_route',
        'Unknown or expired diagnostic target reference',
      );
    const url = validateDiagnosticSource(resolved, deps.discoveredStableTargets);
    if (
      options.openChaptersForWorkId !== undefined &&
      (!/^[1-9]\d{9,29}$/.test(options.openChaptersForWorkId) ||
        !/^\/main\/writer\/book-manage\/?$/.test(url.pathname))
    )
      throw new BrowserSessionError(
        'invalid_chapter_diagnostic_target',
        'Chapter navigation requires a stable work ID and the established book management base page',
      );
    if (
      options.chapterTab !== undefined &&
      (options.chapterTab !== 'drafts' ||
        (!options.openChaptersForWorkId &&
          (!sourceUrl.startsWith('diagnostic:') ||
            chapterDirectoryWorkId(url.toString()) === null)))
    )
      throw new BrowserSessionError(
        'invalid_chapter_tab_target',
        'Chapter tab observation requires a verified existing-work directory target',
      );
    const maxElements = Math.max(1, Math.min(500, options.maxElements ?? 150));
    const maxResponses = Math.max(1, Math.min(100, options.maxResponses ?? 40));
    return deps.withPage(
      createReadPageInspector({
        get options() {
          return options;
        },
        get deps() {
          return deps;
        },
        get maxResponses() {
          return maxResponses;
        },
        get url() {
          return url;
        },
        get maxElements() {
          return maxElements;
        },
      }),
      options,
    );
  }
  return diagnoseReadPage;
}
