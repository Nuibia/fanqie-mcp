import { type DiagnosticOptions, type ReadPageDiagnostic } from '../chapter-diagnostics.js';

export type DiagnoseReadPageOperation = (
  sourceUrl: string,
  options?: DiagnosticOptions,
) => Promise<ReadPageDiagnostic>;
