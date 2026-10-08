import { BrowserSessionError } from '../errors.js';
import { type BrowserCallOptions } from '../contracts.js';
import { validateDiagnosticSource, chapterDirectoryWorkId } from '../chapter-routes.js';
import { type ReadPageDiagnostic } from '../chapter-diagnostics.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type ReadCurrentChapterContextOperation } from '../contracts/read-current-chapter-context.js';
import { type DiagnoseChapterVolumeContextOperation } from '../contracts/diagnose-chapter-volume-context.js';
interface Dependencies {
  diagnosticTargets: Map<string, string>;
  discoveredStableTargets: Set<string>;
  withPage: WithPageOperation;
  readCurrentChapterContext: ReadCurrentChapterContextOperation;
}
export function createDiagnoseChapterVolumeContext(
  deps: Dependencies,
): DiagnoseChapterVolumeContextOperation {
  async function diagnoseChapterVolumeContext(
    targetRef: string,
    options: BrowserCallOptions = {},
  ): Promise<ReadPageDiagnostic> {
    const raw = /^[a-f0-9]{24}$/.test(targetRef)
      ? deps.diagnosticTargets.get(targetRef)
      : undefined;
    if (!raw)
      throw new BrowserSessionError(
        'invalid_chapter_context_target',
        'The volume context probe requires a registered existing-work directory reference',
      );
    const target = validateDiagnosticSource(raw, deps.discoveredStableTargets),
      workId = chapterDirectoryWorkId(raw);
    if (!workId)
      throw new BrowserSessionError(
        'invalid_chapter_context_target',
        'The volume context probe requires a registered existing-work directory reference',
      );
    return deps.withPage(
      async (page) => deps.readCurrentChapterContext(page, targetRef, options),
      options,
    );
  }
  return diagnoseChapterVolumeContext;
}
