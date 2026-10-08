import { type APIRequest } from 'playwright';

import {
  type NativeShortBodyApiResult,
  type NativeShortBodyProductionStart,
} from '../../short-native-body-api.js';

import { type BodyFixtureBrowserOptions } from '../body-options.js';

export type RunNativeShortBodyOwnedOperation = (
  workId: string,
  options: BodyFixtureBrowserOptions,
  execution:
    | { kind: 'fixture'; factory: Pick<APIRequest, 'newContext'> }
    | { kind: 'production'; start: NativeShortBodyProductionStart },
) => Promise<NativeShortBodyApiResult>;
