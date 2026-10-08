import {
  type NativeShortBodyApiOptions,
  captureNativeShortBodyWriteRequest,
} from '../short-native-body-api.js';

import { type BrowserCallOptions } from './contracts.js';

import { type Page, type BrowserContext } from 'playwright';

const BODY_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;

export function bodySignalAborted(signal: AbortSignal | undefined): boolean {
  return signal === undefined ? false : (BODY_ABORTED.call(signal) as boolean);
}

export type BodyFixtureBrowserOptions = Omit<
  NativeShortBodyApiOptions,
  'deadline' | 'assertBorrowedActive' | 'onQuarantine'
> &
  BrowserCallOptions;

/** Capture wrapper descriptors before FIFO without evaluating any raw accessor. */
export function captureBodyBrowserOptions(
  input: unknown,
  production: boolean,
): (BodyFixtureBrowserOptions & { authority?: unknown }) | null {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Object.getOwnPropertySymbols(input).length
    )
      return null;
    const required = [
      'accountId',
      'expectedOwner',
      'businessRequest',
      'assertLease',
      'onBeforePlatformRead',
      'onVerifiedAccount',
      ...(production ? ['authority'] : []),
    ];
    const optional = ['timeoutMs', 'signal', ...(production ? [] : ['onStage'])];
    const descriptors = Object.getOwnPropertyDescriptors<object>(input),
      keys = Object.keys(descriptors);
    if (
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => !required.includes(key) && !optional.includes(key))
    )
      return null;
    const values: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const d = descriptors[key]!;
      if (!d.enumerable || !Object.hasOwn(d, 'value')) return null;
      values[key] = d.value;
    }
    const owner = values.expectedOwner;
    if (
      !owner ||
      typeof owner !== 'object' ||
      Array.isArray(owner) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(owner)) ||
      Object.getOwnPropertySymbols(owner).length
    )
      return null;
    const od = Object.getOwnPropertyDescriptors<object>(owner),
      kind = od.kind,
      id = od.id;
    if (
      Object.keys(od).length !== 2 ||
      !kind ||
      !id ||
      !kind.enumerable ||
      !id.enumerable ||
      !Object.hasOwn(kind, 'value') ||
      !Object.hasOwn(id, 'value') ||
      kind.value !== 'account' ||
      typeof id.value !== 'string' ||
      !/^[0-9]{1,30}$/.test(id.value)
    )
      return null;
    if (
      typeof values.accountId !== 'string' ||
      !values.accountId ||
      /[\r\n\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        values.accountId,
      ) ||
      Buffer.byteLength(values.accountId) > 1024
    )
      return null;
    for (const key of ['assertLease', 'onBeforePlatformRead', 'onVerifiedAccount'])
      if (typeof values[key] !== 'function') return null;
    if (
      values.timeoutMs !== undefined &&
      (typeof values.timeoutMs !== 'number' ||
        !Number.isFinite(values.timeoutMs) ||
        values.timeoutMs < 1 ||
        values.timeoutMs > 2_147_483_647)
    )
      return null;
    if (
      (values.signal !== undefined && !(values.signal instanceof AbortSignal)) ||
      (values.onStage !== undefined && typeof values.onStage !== 'function')
    )
      return null;
    bodySignalAborted(values.signal as AbortSignal | undefined);
    const request = captureNativeShortBodyWriteRequest(values.businessRequest);
    if (!request) return null;
    return {
      accountId: values.accountId,
      expectedOwner: { kind: 'account', id: id.value },
      businessRequest: request,
      timeoutMs: values.timeoutMs as number | undefined,
      signal: values.signal as AbortSignal | undefined,
      assertLease: values.assertLease as () => void,
      onBeforePlatformRead: values.onBeforePlatformRead as () => void,
      onVerifiedAccount: values.onVerifiedAccount as NativeShortBodyApiOptions['onVerifiedAccount'],
      ...(production
        ? { authority: values.authority }
        : { onStage: values.onStage as NativeShortBodyApiOptions['onStage'] }),
    };
  } catch {
    return null;
  }
}

export interface BrowserPageSlot {
  readonly page: Page;
  readonly context: BrowserContext;
}
