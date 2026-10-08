import * as trialRuntime from '../platform/short-native-trial-runtime.js';
import { type RawTrialToolSignalOperation } from './contracts/tool-input.js';

interface Dependencies {}

export function createRawTrialToolSignal(deps: Dependencies): RawTrialToolSignalOperation {
  /** Classify raw trial input without reading a caller's accessor. Inherited
   * discriminators and an unreadable metadata field cannot fall through Zod. */
  function rawTrialToolSignal(input: unknown): boolean {
    if (trialRuntime.hasReservedNativeShortTrialSignal(input)) return true;
    const pending: unknown[] = [input],
      seen = new Set<object>();
    try {
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        if (seen.size >= 200_000) return true;
        seen.add(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.hasOwn(descriptors, 'trial') || Object.hasOwn(descriptors, 'trialRatio'))
          return true;
        for (const key of ['snapshotScope', 'metadata'])
          if (descriptors[key] && !Object.hasOwn(descriptors[key]!, 'value')) return true;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype)
          pending.push(prototype);
        for (const [key, descriptor] of Object.entries(descriptors))
          if (Object.hasOwn(descriptor, 'value')) {
            if (
              typeof descriptor.value === 'string' &&
              ['schema', 'scope', 'snapshotScope', 'operation', 'dataset'].includes(key) &&
              trialRuntime.hasReservedNativeShortTrialSignal({ [key]: descriptor.value })
            )
              return true;
            if (descriptor.value && typeof descriptor.value === 'object')
              pending.push(descriptor.value);
          }
      }
      return false;
    } catch {
      return true;
    }
  }
  return rawTrialToolSignal;
}
