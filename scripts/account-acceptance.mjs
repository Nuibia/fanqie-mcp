import { pathToFileURL } from 'node:url';

import path from 'node:path';

import { main } from './account-acceptance/main.mjs';

import { safeExecutionFailure } from './account-acceptance/run-account-refresh-acceptance.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        stage: 'account-acceptance-error',
        pass: false,
        errorCode: 'acceptance_execution_failed',
        failure: safeExecutionFailure(error),
      }),
    );
    process.exitCode = 1;
  }
}
export { safeSnapshot } from './account-acceptance/ensure.mjs';
export { verifyCompleteRefresh } from './account-acceptance/ensure.mjs';
export { runAccountRefreshAcceptance } from './account-acceptance/run-account-refresh-acceptance.mjs';
export { legacyReadsPassed } from './account-acceptance/run-account-refresh-acceptance.mjs';
export { writePrivateRefreshReceipt } from './account-acceptance/run-account-refresh-acceptance.mjs';
export { callAccountTool } from './account-acceptance/run-account-refresh-acceptance.mjs';
export { safeExecutionFailure } from './account-acceptance/run-account-refresh-acceptance.mjs';
export { main } from './account-acceptance/main.mjs';
