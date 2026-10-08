import { NATIVE_SHORT_READ_DATASET } from '../platform/short-native-metadata-proof.js';
import { type UnavailableNativeViewOperation } from './contracts/evidence-context.js';

interface Dependencies {}

export function createUnavailableNativeView(deps: Dependencies): UnavailableNativeViewOperation {
  const unavailableNativeView = (): Record<string, unknown> => ({
    schema: 'fanqie-short-native-metadata-business/v1',
    dataset: NATIVE_SHORT_READ_DATASET,
    status: 'capability_unavailable',
    reason: 'response_unverified',
    state: 'unknown',
    statusFacts: null,
    statusSource: null,
  });
  return unavailableNativeView;
}
