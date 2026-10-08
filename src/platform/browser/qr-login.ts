import { type LoginState } from './own-identity.js';

import jsQrModule from 'jsqr';

import { PNG } from 'pngjs';

export interface LoginQrExpiry {
  status: 'known' | 'unknown';
  raw?: string;
  remainingSeconds?: number;
  validitySeconds?: number;
}

export interface LoginQrcodeMetadata {
  login: LoginState;
  checkedAt: string;
  sourceUrl: string;
  platform: 'fanqie';
  appInstructions: string | null;
  expiry: LoginQrExpiry;
}

export type LoginQrcodeResult = LoginQrcodeMetadata &
  (
    | {
        status: 'ready';
        image: Buffer;
        mimeType: 'image/png';
        qrVerified: true;
        reason?: undefined;
      }
    | {
        status: 'authenticated' | 'challenge' | 'expired' | 'unsupported';
        reason: string;
        image?: undefined;
        mimeType?: undefined;
        qrVerified?: undefined;
      }
  );

// Observed in an anonymous official login page on 2026-10-03. No guessed generic image selectors.
export const LOGIN_SCAN_TAB = '.slogin-pc-form-header__title__tab';

export const LOGIN_QR_IMAGE = 'img.slogin-qrcode-scan-page__content__code__img';

export const LOGIN_QR_PANEL = '.slogin-qrcode-scan-page__content__code';

type QrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { inversionAttempts: 'attemptBoth' },
) => unknown;

const decodeQr = (typeof jsQrModule === 'function' ? jsQrModule : jsQrModule.default) as QrDecoder;

/** A decoded QR proves the crop contains a QR; its payload is deliberately neither returned nor retained. */
export function verifyQrPng(image: Buffer): boolean {
  try {
    if (
      image.length < 24 ||
      image.length > 4_000_000 ||
      !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return false;
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    if (width < 80 || height < 80 || width > 2048 || height > 2048) return false;
    const png = PNG.sync.read(image, { checkCRC: true });
    return Boolean(
      decodeQr(new Uint8ClampedArray(png.data), png.width, png.height, {
        inversionAttempts: 'attemptBoth',
      }),
    );
  } catch {
    return false;
  }
}

/** Reads explicit platform duration/countdown only, never inventing a QR lifetime. */
export function parseLoginQrExpiry(text: string | null): LoginQrExpiry {
  if (!text) return { status: 'unknown' };
  const remaining =
    /(?:二维码(?:将)?(?:在)?\s*(\d{1,4})\s*(秒|分钟)(?:后)?(?:失效|过期)|剩余\s*(\d{1,4})\s*(秒|分钟))/.exec(
      text,
    );
  const validity = /有效期[:：]?\s*(\d{1,4})\s*(秒|分钟)/.exec(text);
  const match = remaining ?? validity;
  if (!match) return { status: 'unknown' };
  const value = Number(remaining ? (remaining[1] ?? remaining[3]) : validity![1]);
  const unit = remaining ? (remaining[2] ?? remaining[4]) : validity![2];
  const seconds = value * (unit === '分钟' ? 60 : 1);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 3600) return { status: 'unknown' };
  return {
    status: 'known',
    raw: match[0],
    ...(remaining ? { remainingSeconds: seconds } : { validitySeconds: seconds }),
  };
}
