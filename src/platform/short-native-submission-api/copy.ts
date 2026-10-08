import { type OwnedStopSignal } from '../short-native-submission-api.js';
interface Ports {
  STOPPED: OwnedStopSignal;
  fields: (
    input: unknown,
    allowed: readonly string[],
    required?: readonly string[],
  ) => Record<string, unknown>;
  freeze: <T>(value: T) => T;
}
export function createCopy(ports: Ports) {
  return function copy<T>(input: T): T {
    let nodes = 0;
    const visit = (value: unknown, depth: number): unknown => {
      // A private result repeats bounded native snapshots through prepared, plan
      // and held proof. Preserve the source envelope's legal budget in that graph.
      if (++nodes > 4_000_000 || depth > 64) throw ports.STOPPED;
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
          throw ports.STOPPED;
        return value;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) throw ports.STOPPED;
        return value;
      }
      if (Array.isArray(value)) {
        if (
          Object.getPrototypeOf(value) !== Array.prototype ||
          Object.getOwnPropertySymbols(value).length
        )
          throw ports.STOPPED;
        const ds = Object.getOwnPropertyDescriptors(value),
          keys = Object.keys(ds).filter((key) => key !== 'length');
        if (
          keys.length !== value.length ||
          keys.some(
            (key, i) =>
              key !== String(i) || !Object.hasOwn(ds[key]!, 'value') || !ds[key]!.enumerable,
          )
        )
          throw ports.STOPPED;
        return keys.map((key) => visit(ds[key]!.value, depth + 1));
      }
      const object = ports.fields(
        value,
        Object.keys(Object.getOwnPropertyDescriptors(value ?? {})),
      );
      return Object.fromEntries(
        Object.entries(object).map(([key, child]) => [key, visit(child, depth + 1)]),
      );
    };
    const result = visit(input, 0);
    if (Buffer.byteLength(JSON.stringify(result)) > 192 * 1024 * 1024) throw ports.STOPPED;
    return ports.freeze(result) as T;
  };
}
