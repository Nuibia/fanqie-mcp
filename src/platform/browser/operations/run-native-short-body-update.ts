import {
  type NativeShortBodyApiResult,
  type NativeShortBodyBrowserOptions,
  unavailableNativeShortBodyApi,
  prepareNativeShortBodyProductionStart,
} from '../../short-native-body-api.js';
import { captureBodyBrowserOptions } from '../body-options.js';
import { type RunNativeShortBodyOwnedOperation } from '../contracts/run-native-short-body-owned.js';
import { type RunNativeShortBodyUpdateOperation } from '../contracts/run-native-short-body-update.js';
interface Dependencies {
  runNativeShortBodyOwned: RunNativeShortBodyOwnedOperation;
}
export function createRunNativeShortBodyUpdate(
  deps: Dependencies,
): RunNativeShortBodyUpdateOperation {
  async function runNativeShortBodyUpdate(
    workId: string,
    options: NativeShortBodyBrowserOptions,
  ): Promise<NativeShortBodyApiResult> {
    const captured = captureBodyBrowserOptions(options, true);
    if (!captured) return unavailableNativeShortBodyApi('invalid_input');
    const decision = prepareNativeShortBodyProductionStart({
      accountId: captured.accountId,
      workId,
      businessRequest: captured.businessRequest,
      authority: captured.authority,
    });
    if (!decision.allowed) return decision.result;
    const { authority: _authority, ...ownedOptions } = captured;
    // The registered Store authority is consumed before the owned FIFO/context bridge.
    return deps.runNativeShortBodyOwned(workId, ownedOptions, {
      kind: 'production',
      start: decision.start,
    });
  }
  return runNativeShortBodyUpdate;
}
