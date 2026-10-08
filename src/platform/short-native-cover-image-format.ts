import { NATIVE_SHORT_COVER_LIMITS } from './short-native-cover.js';

import { fail, CODES } from './short-native-cover-image-errors.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function dimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > NATIVE_SHORT_COVER_LIMITS.sourcePixels
  )
    fail(CODES.image);
  return { width, height };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    fail(CODES.image);
  const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  const bitDepth = bytes[24]!,
    color = bytes[25]!;
  const depths: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    !depths[color]?.includes(bitDepth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    ![0, 1].includes(bytes[28]!)
  )
    fail(CODES.image);
  let offset = 8,
    idat = false,
    ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(CODES.image);
    const length = bytes.readUInt32BE(offset),
      end = offset + length + 12;
    if (end > bytes.length) fail(CODES.image);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      (offset !== 8 && type === 'IHDR') ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      fail(CODES.image);
    if (type === 'IDAT') idat = true;
    if (type === 'IEND') {
      if (length !== 0 || !idat || end !== bytes.length) fail(CODES.image);
      ended = true;
    }
    offset = end;
  }
  if (!ended) fail(CODES.image);
  return size;
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail(CODES.image);
  let offset = 2,
    size: { width: number; height: number } | undefined,
    scanned = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail(CODES.image);
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      fail(CODES.image);
    if (marker === 0xd9) {
      if (!size || !scanned || offset !== bytes.length) fail(CODES.image);
      return size;
    }
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) fail(CODES.image);
    const length = bytes.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > bytes.length) fail(CODES.image);
    if (JPEG_SOF.has(marker)) {
      if (
        size ||
        length < 8 ||
        length !== 8 + 3 * bytes[offset + 7]! ||
        ![1, 2, 3, 4].includes(bytes[offset + 7]!)
      )
        fail(CODES.image);
      size = dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset = end;
    if (marker === 0xda) {
      if (!size || length < 6 || length !== 6 + 2 * bytes[end - length + 2]!) fail(CODES.image);
      scanned = true;
      // Entropy-coded 0xff bytes are stuffed; restart markers have no segment.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        const entropyMarker = bytes[next];
        if (
          entropyMarker === 0 ||
          (entropyMarker !== undefined && entropyMarker >= 0xd0 && entropyMarker <= 0xd7)
        ) {
          offset = next + 1;
          continue;
        }
        break;
      }
    }
  }
  fail(CODES.image);
}

export function sourceDimensions(bytes: Buffer, extension: string) {
  if (extension === '.png') return { ...pngDimensions(bytes), mimeType: 'image/png' as const };
  if (extension === '.jpg') return { ...jpegDimensions(bytes), mimeType: 'image/jpeg' as const };
  fail(CODES.image);
}
