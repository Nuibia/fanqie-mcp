import { type APIRequest } from 'playwright';
import {
  type NativeShortBodyApiResult,
  unavailableNativeShortBodyApi,
} from '../../short-native-body-api.js';
import { captureBodyBrowserOptions, type BodyFixtureBrowserOptions } from '../body-options.js';
import { type RunNativeShortBodyOwnedOperation } from '../contracts/run-native-short-body-owned.js';
import { type RunNativeShortBodyFixtureUpdateOperation } from '../contracts/run-native-short-body-fixture-update.js';
interface Dependencies {
  runNativeShortBodyOwned: RunNativeShortBodyOwnedOperation;
}
export function createRunNativeShortBodyFixtureUpdate(
  deps: Dependencies,
): RunNativeShortBodyFixtureUpdateOperation {
  async function runNativeShortBodyFixtureUpdate(
    workId: string,
    options: BodyFixtureBrowserOptions,
    factory: Pick<APIRequest, 'newContext'>,
  ): Promise<NativeShortBodyApiResult> {
    const captured = captureBodyBrowserOptions(options, false);
    if (!captured || typeof workId !== 'string' || !/^[1-9][0-9]{9,21}$/.test(workId))
      return unavailableNativeShortBodyApi('invalid_input');
    return deps.runNativeShortBodyOwned(workId, captured, { kind: 'fixture', factory });
  }
  return runNativeShortBodyFixtureUpdate;
}
