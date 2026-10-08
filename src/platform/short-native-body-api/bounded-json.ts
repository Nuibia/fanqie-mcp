import { type OwnedStopSignal } from '../short-native-body-api.js';
interface Ports {
  STOPPED: OwnedStopSignal;
  BAD_UNICODE: RegExp;
}
export function createBodyJson(ports: Ports) {
  return function boundedJson(bytes: Buffer): Record<string, unknown> {
    if (bytes.length > 3 * 1024 * 1024) throw ports.STOPPED;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    let nodes = 0;
    function visit(v: unknown, depth: number): void {
      if (++nodes > 100_000 || depth > 64) throw ports.STOPPED;
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'string') {
        if (ports.BAD_UNICODE.test(v)) throw ports.STOPPED;
        return;
      }
      if (typeof v === 'number') {
        if (!Number.isFinite(v) || Object.is(v, -0)) throw ports.STOPPED;
        return;
      }
      if (!v || typeof v !== 'object') throw ports.STOPPED;
      for (const [key, child] of Object.entries(v)) {
        if (ports.BAD_UNICODE.test(key)) throw ports.STOPPED;
        visit(child, depth + 1);
      }
    }
    visit(value, 0);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw ports.STOPPED;
    return value as Record<string, unknown>;
  };
}
