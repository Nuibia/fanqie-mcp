import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import { type RawBodyToolSignalOperation } from './contracts/tool-input.js';

interface Dependencies {}

export function createRawBodyToolSignal(deps: Dependencies): RawBodyToolSignalOperation {
  // Body namespace classification precedes trial capture: body legitimately has
  // a trial policy, while another native namespace can never consume that DTO.
  function rawBodyToolSignal(input: unknown): boolean {
    if (bodyRuntime.hasReservedNativeShortBodySignal(input)) return true;
    const pending: unknown[] = [input],
      seen = new Set<object>();
    try {
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        if (seen.size >= 200_000) return true;
        seen.add(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (
          Object.hasOwn(descriptors, 'paragraphs') ||
          Object.hasOwn(descriptors, 'representation')
        )
          return true;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype)
          pending.push(prototype);
        for (const descriptor of Object.values(descriptors))
          if (
            Object.hasOwn(descriptor, 'value') &&
            descriptor.value &&
            typeof descriptor.value === 'object'
          )
            pending.push(descriptor.value);
      }
      return false;
    } catch {
      return true;
    }
  }
  return rawBodyToolSignal;
}
