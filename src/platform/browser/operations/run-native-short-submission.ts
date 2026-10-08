import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
} from '../../short-native-submission-api.js';
import { type RunNativeShortSubmissionOwnedOperation } from '../contracts/run-native-short-submission-owned.js';
import { type RunNativeShortSubmissionOperation } from '../contracts/run-native-short-submission.js';
interface Dependencies {
  runNativeShortSubmissionOwned: RunNativeShortSubmissionOwnedOperation;
}
export function createRunNativeShortSubmission(
  deps: Dependencies,
): RunNativeShortSubmissionOperation {
  async function runNativeShortSubmission(
    workId: string,
    options: NativeShortSubmissionBrowserOptions,
  ): Promise<NativeShortSubmissionApiResult> {
    return deps.runNativeShortSubmissionOwned(workId, options);
  }
  return runNativeShortSubmission;
}
