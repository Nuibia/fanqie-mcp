import { type APIRequest } from 'playwright';
import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
} from '../../short-native-submission-api.js';
import { type NativeShortSubmissionContract } from '../../short-native-submission.js';
import { type RunNativeShortSubmissionOwnedOperation } from '../contracts/run-native-short-submission-owned.js';
import { type RunNativeShortSubmissionFixtureOperation } from '../contracts/run-native-short-submission-fixture.js';
interface Dependencies {
  runNativeShortSubmissionOwned: RunNativeShortSubmissionOwnedOperation;
}
export function createRunNativeShortSubmissionFixture(
  deps: Dependencies,
): RunNativeShortSubmissionFixtureOperation {
  async function runNativeShortSubmissionFixture(
    workId: string,
    options: NativeShortSubmissionBrowserOptions,
    factory: Pick<APIRequest, 'newContext'>,
    contract: NativeShortSubmissionContract,
  ): Promise<NativeShortSubmissionApiResult> {
    return deps.runNativeShortSubmissionOwned(workId, options, { factory, contract });
  }
  return runNativeShortSubmissionFixture;
}
