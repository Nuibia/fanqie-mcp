import { type OwnedStopSignal } from '../short-native-submission-api.js';
interface Ports {
  STOPPED: OwnedStopSignal;
}
export function createFields(ports: Ports) {
  return function fields(
    input: unknown,
    allowed: readonly string[],
    required: readonly string[] = allowed,
  ): Record<string, unknown> {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Object.getOwnPropertySymbols(input).length
    )
      throw ports.STOPPED;
    const own = Object.getOwnPropertyDescriptors(input);
    if (
      Object.keys(own).some(
        (key) =>
          !allowed.includes(key) || !Object.hasOwn(own[key]!, 'value') || !own[key]!.enumerable,
      ) ||
      required.some((key) => !Object.hasOwn(own, key))
    )
      throw ports.STOPPED;
    return Object.fromEntries(
      Object.entries(own).map(([key, descriptor]) => [key, descriptor.value]),
    );
  };
}
