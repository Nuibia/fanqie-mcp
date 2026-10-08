import {
  type NativeShortTrialWriteRequest,
  object,
  jsonCopy,
  HASH,
  reject,
  freeze,
  action,
  type NativeShortTrialBusinessInput,
  NATIVE_SHORT_TRIAL_SCOPE,
  hash,
  BAD_UNICODE,
  type NativeShortTrialMarkerAttributes,
  type NativeShortTrialDocument,
  type NativeShortTrialParagraph,
} from './reject.js';

import { NATIVE_SHORT_HASH_BASES, NATIVE_SHORT_RESOURCE_LIMITS } from '../short-native-metadata.js';

export function validateNativeShortTrialWriteRequest(input: unknown): NativeShortTrialWriteRequest {
  const value = object(jsonCopy(input, 8192), [
    'expectedSnapshotVersionHash',
    'hashBasis',
    'expectedState',
    'metadata',
  ]);
  if (
    typeof value.expectedSnapshotVersionHash !== 'string' ||
    !HASH.test(value.expectedSnapshotVersionHash) ||
    value.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
    value.expectedState !== 'draft'
  )
    reject('request_binding');
  const metadata = object(value.metadata!, ['trial']);
  return freeze({
    expectedSnapshotVersionHash: value.expectedSnapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    metadata: { trial: action(metadata.trial!) },
  });
}

export function validateNativeShortTrialBusinessInput(
  input: unknown,
): NativeShortTrialBusinessInput {
  const value = object(jsonCopy(input, 8192), [
    'target',
    'snapshotScope',
    'hashBasis',
    'expectedSnapshotVersionHash',
    'expectedState',
    'metadata',
  ]);
  const target = object(value.target!, ['kind', 'workId']);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(target.workId) ||
    value.snapshotScope !== NATIVE_SHORT_TRIAL_SCOPE
  )
    reject('business_binding');
  const request = validateNativeShortTrialWriteRequest({
    expectedSnapshotVersionHash: value.expectedSnapshotVersionHash,
    hashBasis: value.hashBasis,
    expectedState: value.expectedState,
    metadata: value.metadata,
  });
  return freeze({
    target: { kind: 'short', workId: target.workId },
    snapshotScope: NATIVE_SHORT_TRIAL_SCOPE,
    ...request,
  });
}

export function nativeShortTrialWriteRequest(
  input: NativeShortTrialBusinessInput,
): NativeShortTrialWriteRequest {
  const value = validateNativeShortTrialBusinessInput(input);
  return validateNativeShortTrialWriteRequest({
    expectedSnapshotVersionHash: value.expectedSnapshotVersionHash,
    hashBasis: value.hashBasis,
    expectedState: value.expectedState,
    metadata: value.metadata,
  });
}

export function nativeShortTrialBusinessInputHash(input: NativeShortTrialBusinessInput): string {
  return hash({
    basis: 'native-short-trial-business-input/v1',
    business: validateNativeShortTrialBusinessInput(input),
  });
}

/** Exact tU whitelist from the frozen anonymous official client; emoji and rare Han do not count. */
export function officialNativeShortTrialCharacterCount(text: string): number {
  if (typeof text !== 'string' || BAD_UNICODE.test(text)) reject('invalid_unicode');
  return text.replace(
    /[^\u4e00-\u9fa5\u2019!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~|A-Za-z0-9\u3002\uff1f\uff01\uff0c\u3001\uff1b\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b\u3008\u3009\u3010\u3011\u300e\u300f\u300c\u300d\ufe43\ufe44\u3014\u3015\u2026\u2014\uff5e\ufe4f\uffe5]/gi,
    '',
  ).length;
}

function decodeText(raw: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  };
  // HTML numeric character references use the standard legacy C1 table.
  // It affects semantic text and tU counts only; the original entity bytes stay intact.
  const legacy: Record<number, number> = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178,
  };
  let result = '',
    cursor = 0;
  while (cursor < raw.length) {
    const index = raw.indexOf('&', cursor);
    if (index === -1) {
      result += raw.slice(cursor);
      break;
    }
    result += raw.slice(cursor, index);
    const end = raw.indexOf(';', index + 1);
    if (end === -1 || end - index > 16) reject('unsupported_entity');
    const token = raw.slice(index + 1, end);
    let decoded = Object.hasOwn(entities, token) ? entities[token] : undefined;
    if (decoded === undefined) {
      if (!/^#(?:[0-9]+|[xX][0-9a-fA-F]+)$/.test(token)) reject('unsupported_entity');
      const scalar = /^#x/i.test(token)
        ? Number.parseInt(token.slice(2), 16)
        : Number(token.slice(1));
      if (
        !Number.isSafeInteger(scalar) ||
        scalar <= 0 ||
        scalar > 0x10ffff ||
        (scalar >= 0xd800 && scalar <= 0xdfff) ||
        scalar === 13
      )
        reject('invalid_entity_scalar');
      decoded = String.fromCodePoint(legacy[scalar] ?? scalar);
    }
    result += decoded;
    cursor = end + 1;
  }
  if (/[\r\u0000]/u.test(result)) reject('unsupported_text');
  return result;
}

export const ATTRIBUTES = [
  'data-percentage',
  'data-fanqie-type',
  'data-min-text',
  'data-min-paragraphs',
  'data-min-radio',
  'data-para-nums',
  'class',
] as const;

function markerAttributes(raw: string): NativeShortTrialMarkerAttributes {
  const values: Record<string, string> = Object.create(null);
  let rest = raw;
  while (rest.length) {
    const match = /^\s+([a-z-]+)="([^"<>]*)"/.exec(rest);
    if (!match) reject('marker_attributes');
    const name = match[1]!,
      value = match[2]!;
    if (
      !(ATTRIBUTES as readonly string[]).includes(name) ||
      Object.hasOwn(values, name) ||
      value.includes('&')
    )
      reject('marker_attributes');
    values[name] = value;
    rest = rest.slice(match[0].length);
  }
  if (
    Object.keys(values).length !== ATTRIBUTES.length ||
    values['data-fanqie-type'] !== 'pay_tag' ||
    values['data-min-text'] !== '200' ||
    values['data-min-paragraphs'] !== '3' ||
    values['data-min-radio'] !== '0.3' ||
    !['', 'fq-pay-node-animation'].includes(values.class!)
  )
    reject('marker_attributes');
  return values as unknown as NativeShortTrialMarkerAttributes;
}

export function eligibleBoundary(
  document: Pick<
    NativeShortTrialDocument,
    'paragraphs' | 'characterCount' | 'eligibleParagraphCount'
  >,
  boundary: number,
): number {
  if (
    !Number.isSafeInteger(boundary) ||
    Object.is(boundary, -0) ||
    boundary < 1 ||
    boundary >= document.paragraphs.length ||
    !document.paragraphs.slice(boundary).some((p) => p.eligible)
  )
    reject('trial_boundary');
  if (document.characterCount < 200) reject('trial_min_text');
  if (document.eligibleParagraphCount < 3) reject('trial_min_paragraphs');
  const prefix = document.paragraphs
    .slice(0, boundary)
    .reduce((sum, p) => sum + p.characterCount, 0);
  if (10 * prefix < 3 * document.characterCount || prefix <= 0 || prefix >= document.characterCount)
    reject('trial_ratio');
  return prefix;
}

/** No HTML parser or repair. Every original paragraph, entity spelling and BR token remains byte-identical. */
export function parseNativeShortTrialDocument(rawHtml: string): NativeShortTrialDocument {
  if (
    typeof rawHtml !== 'string' ||
    Buffer.byteLength(rawHtml, 'utf8') > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes ||
    BAD_UNICODE.test(rawHtml) ||
    /[\r\u0000]/u.test(rawHtml)
  )
    reject('document_extent_or_unicode');
  const paragraphs: NativeShortTrialParagraph[] = [];
  let cursor = 0,
    boundary: number | null = null,
    attrs: NativeShortTrialMarkerAttributes | null = null;
  while (cursor < rawHtml.length) {
    if (rawHtml.startsWith('<p>', cursor)) {
      const end = rawHtml.indexOf('</p>', cursor + 3);
      if (end === -1) reject('document_grammar');
      const inner = rawHtml.slice(cursor + 3, end);
      if (!/^(?:[^<>]|<br>|<br\/>|<br \/>)*$/.test(inner)) reject('document_grammar');
      const text = inner
        .split(/<br(?:\/>| \/>|>)/)
        .map(decodeText)
        .join('\n');
      paragraphs.push({
        rawHtml: rawHtml.slice(cursor, end + 4),
        text,
        characterCount: officialNativeShortTrialCharacterCount(text),
        eligible: text.trim().length > 0,
      });
      if (paragraphs.length > NATIVE_SHORT_RESOURCE_LIMITS.nodes) reject('document_resource_limit');
      cursor = end + 4;
    } else if (rawHtml.startsWith('<div', cursor)) {
      if (attrs) reject('multiple_markers');
      const end = rawHtml.indexOf('>', cursor + 4);
      if (end === -1 || !rawHtml.startsWith('</div>', end + 1)) reject('marker_not_empty');
      attrs = markerAttributes(rawHtml.slice(cursor + 4, end));
      boundary = paragraphs.length;
      cursor = end + 7;
    } else reject('document_grammar');
  }
  const characterCount = paragraphs.reduce((sum, p) => sum + p.characterCount, 0),
    eligibleParagraphCount = paragraphs.filter((p) => p.eligible).length;
  let prefixCharacterCount = 0;
  if (attrs) {
    prefixCharacterCount = eligibleBoundary(
      { paragraphs, characterCount, eligibleParagraphCount },
      boundary!,
    );
    if (
      attrs['data-percentage'] !== String(prefixCharacterCount / characterCount) ||
      attrs['data-para-nums'] !== String(eligibleParagraphCount)
    )
      reject('marker_derived_values');
  }
  return freeze({
    rawHtml,
    markerFreeHtml: paragraphs.map((p) => p.rawHtml).join(''),
    bodyText: paragraphs.map((p) => p.text).join('\n'),
    paragraphs,
    paragraphCount: paragraphs.length,
    eligibleParagraphCount,
    characterCount,
    markerCount: attrs ? 1 : 0,
    boundary,
    prefixCharacterCount,
    displayPercent: attrs ? Math.floor((100 * prefixCharacterCount) / characterCount) : null,
    markerAttrs: attrs,
  });
}
