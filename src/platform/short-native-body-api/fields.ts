import { type OwnedStopSignal } from '../short-native-body-api.js';
interface Ports {
  STOPPED: OwnedStopSignal;
}
export function createBodyFields(ports: Ports) {
  return function fields(
    input: unknown,
    required: readonly string[],
    optional: readonly string[] = [],
  ): Record<string, unknown> {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      throw ports.STOPPED;
    if (Object.getOwnPropertySymbols(input).length) throw ports.STOPPED;
    const descriptors = Object.getOwnPropertyDescriptors<object>(input),
      names = Object.keys(descriptors);
    if (
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      names.some((key) => !required.includes(key) && !optional.includes(key))
    )
      throw ports.STOPPED;
    const out: Record<string, unknown> = Object.create(null);
    for (const key of names) {
      const d = descriptors[key]!;
      if (!d.enumerable || !Object.hasOwn(d, 'value')) throw ports.STOPPED;
      out[key] = d.value;
    }
    return out;
  };
}
