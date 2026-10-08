import { type BrowserCallOptions } from '../contracts.js';

import { type ReadPageDiagnostic } from '../chapter-diagnostics.js';

export type DiagnoseChapterVolumeContextOperation = (
  targetRef: string,
  options?: BrowserCallOptions,
) => Promise<ReadPageDiagnostic>;
