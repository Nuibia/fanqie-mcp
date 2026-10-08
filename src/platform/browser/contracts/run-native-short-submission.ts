import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
} from '../../short-native-submission-api.js';

export type RunNativeShortSubmissionOperation = (
  workId: string,
  options: NativeShortSubmissionBrowserOptions,
) => Promise<NativeShortSubmissionApiResult>;
