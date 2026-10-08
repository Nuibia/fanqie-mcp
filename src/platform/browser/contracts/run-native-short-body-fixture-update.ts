import { type APIRequest } from 'playwright';

import { type NativeShortBodyApiResult } from '../../short-native-body-api.js';

import { type BodyFixtureBrowserOptions } from '../body-options.js';

export type RunNativeShortBodyFixtureUpdateOperation = (
  workId: string,
  options: BodyFixtureBrowserOptions,
  factory: Pick<APIRequest, 'newContext'>,
) => Promise<NativeShortBodyApiResult>;
