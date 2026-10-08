import { type CurrentLoginDiagnostic } from '../read-diagnostics.js';

import { type DiagnosticOptions } from '../chapter-diagnostics.js';

export type DiagnoseCurrentLoginPageOperation = (
  options?: DiagnosticOptions,
) => Promise<CurrentLoginDiagnostic>;
