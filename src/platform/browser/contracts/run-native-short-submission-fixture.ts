import { type APIRequest } from 'playwright';

import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
} from '../../short-native-submission-api.js';

import { type NativeShortSubmissionContract } from '../../short-native-submission.js';

export type RunNativeShortSubmissionFixtureOperation = (
  workId: string,
  options: NativeShortSubmissionBrowserOptions,
  factory: Pick<APIRequest, 'newContext'>,
  contract: NativeShortSubmissionContract,
) => Promise<NativeShortSubmissionApiResult>;
