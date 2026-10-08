import {
  type NativeShortSubmissionSourceDocument,
  UNKNOWN_VALIDATION,
  hash,
  NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  object,
  capture,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  string,
  reject,
  sha,
  time,
  TERMS_START,
  TERMS_END,
  TERM_SLICE_HASH,
  BAD_UNICODE,
  freeze,
  exactHash,
} from './reject.js';

import { validateNativeShortSubmissionContract } from './validate-native-short-submission-contract.js';

export interface NativeShortSubmissionSourceDocuments {
  readonly writer: NativeShortSubmissionSourceDocument;
  readonly main: NativeShortSubmissionSourceDocument;
  readonly publishShort: NativeShortSubmissionSourceDocument;
  readonly asyncMain: NativeShortSubmissionSourceDocument;
}

export interface SourceObservation {
  readonly url: string;
  readonly sha256: string;
  readonly observedAt: string;
}

export interface NativeShortSubmissionContract {
  readonly schema: 'short-native-submission-contract/v1';
  readonly mode: 'production-fixed-contract' | 'fixture-no-live';
  readonly observedAt: string;
  readonly sourceHash: string;
  readonly sources: {
    readonly writer: SourceObservation;
    readonly main: SourceObservation;
    readonly publishShort: SourceObservation;
    readonly asyncMain: SourceObservation;
  };
  readonly terms: {
    readonly title: '短故事发布事项';
    readonly text: string;
    readonly sha256: string;
    readonly sourceUrl: string;
    readonly sourceSha256: string;
    readonly byteStart: 192356;
    readonly byteEndExclusive: 202397;
  };
  readonly validation: typeof UNKNOWN_VALIDATION;
}

export function contractSourceHash(sources: NativeShortSubmissionContract['sources']): string {
  // Writer raw bytes and observation times are evidence, not contract-version identity (HTML nonce changes).
  const fixed = Object.fromEntries(
    Object.entries(sources).map(([key, value]) => [
      key,
      key === 'writer' ? { url: value.url } : { url: value.url, sha256: value.sha256 },
    ]),
  );
  return hash({
    basis: 'current-writer-main-publish-and-async-references/v1',
    sources: fixed,
    termsHash: NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  });
}

/** No eval, import, VM or DOM execution. The immutable source hashes fix every parsed literal. */
export function verifyNativeShortSubmissionSources(input: unknown): NativeShortSubmissionContract {
  const raw = object(capture(input), ['writer', 'main', 'publishShort', 'asyncMain']);
  const documents = {} as Record<
    keyof NativeShortSubmissionSourceDocuments,
    NativeShortSubmissionSourceDocument
  >;
  for (const key of ['writer', 'main', 'publishShort', 'asyncMain'] as const) {
    const doc = object(raw[key], ['url', 'body', 'observedAt']),
      pin = NATIVE_SHORT_SUBMISSION_SOURCE_PINS[key];
    const body = string(doc.body);
    if (doc.url !== pin.url || Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024)
      reject('official_source_unavailable');
    if ('sha256' in pin && sha(body) !== pin.sha256) reject('official_source_unavailable');
    documents[key] = { url: pin.url, body, observedAt: time(doc.observedAt) };
  }
  nativeShortSubmissionWriterScriptReferences(documents.writer.body);
  const main = documents.main.body;
  if (
    !main.includes('3587:"PublishShort"') ||
    !main.includes('3587:"4c89ddd6"') ||
    !main.includes('5534:"async-main"') ||
    !main.includes('5534:"93c6ad0a"') ||
    !main.includes(
      'u.p="//lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/toutiao/muye/main/"',
    )
  )
    reject('official_reference_unavailable');
  const routeStart = documents.asyncMain.body.indexOf('path:"/publish-short/:iid?",component:');
  const route = documents.asyncMain.body.slice(routeStart, routeStart + 1200);
  if (routeStart < 0 || !route.includes('t.e("3587")]).then(t.bind(t,67603))'))
    reject('official_reference_unavailable');
  const bytes = Buffer.from(documents.publishShort.body, 'utf8'),
    slice = bytes.subarray(TERMS_START, TERMS_END).toString('utf8');
  if (
    sha(slice) !== TERM_SLICE_HASH ||
    !slice.startsWith('lC=') ||
    bytes.subarray(TERMS_END, TERMS_END + 4).toString('utf8') !== ',lE='
  )
    reject('terms_unavailable');
  const leaves: string[] = [];
  for (const match of slice.matchAll(/children:"((?:\\.|[^"\\])*)"/g)) {
    try {
      leaves.push(JSON.parse(`"${match[1]!}"`) as string);
    } catch {
      reject('terms_unavailable');
    }
  }
  const text = `${leaves.join('\n')}\n`;
  if (
    leaves.length !== 29 ||
    Buffer.byteLength(text, 'utf8') !== 4419 ||
    sha(text) !== NATIVE_SHORT_SUBMISSION_TERMS_HASH
  )
    reject('terms_unavailable');
  const sources = Object.fromEntries(
    Object.entries(documents).map(([key, doc]) => [
      key,
      { url: doc.url, sha256: sha(doc.body), observedAt: doc.observedAt },
    ]),
  ) as unknown as NativeShortSubmissionContract['sources'];
  return validateNativeShortSubmissionContract({
    schema: 'short-native-submission-contract/v1',
    mode: 'production-fixed-contract',
    observedAt: sources.writer.observedAt,
    sourceHash: contractSourceHash(sources),
    sources,
    terms: {
      title: '短故事发布事项',
      text,
      sha256: NATIVE_SHORT_SUBMISSION_TERMS_HASH,
      sourceUrl: NATIVE_SHORT_SUBMISSION_SOURCE_PINS.publishShort.url,
      sourceSha256: NATIVE_SHORT_SUBMISSION_SOURCE_PINS.publishShort.sha256,
      byteStart: TERMS_START,
      byteEndExclusive: TERMS_END,
    },
    validation: UNKNOWN_VALIDATION,
  });
}

/** Conservative HTML tokenizer for current script src declarations; ambiguous execution attributes fail closed. */
export function nativeShortSubmissionWriterScriptReferences(input: string): readonly string[] {
  if (
    typeof input !== 'string' ||
    BAD_UNICODE.test(input) ||
    Buffer.byteLength(input, 'utf8') > 2 * 1024 * 1024
  )
    reject('official_reference_unavailable');
  const urls: string[] = [];
  let cursor = 0,
    templateDepth = 0;
  while (cursor < input.length) {
    const start = input.indexOf('<', cursor);
    if (start < 0) break;
    if (input.startsWith('<!--', start)) {
      const end = input.indexOf('-->', start + 4);
      if (end < 0) reject('official_reference_unavailable');
      cursor = end + 3;
      continue;
    }
    let end = start + 1,
      quote = '';
    for (; end < input.length; end++) {
      const char = input[end]!;
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === input.length) reject('official_reference_unavailable');
    const token = input.slice(start + 1, end),
      match = /^(\/?)([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)$/.exec(token);
    cursor = end + 1;
    if (!match) continue;
    const closing = !!match[1],
      tag = match[2]!.toLowerCase();
    if (tag === 'base' || tag === 'svg' || tag === 'math' || tag === 'plaintext')
      reject('official_reference_unavailable');
    if (closing) {
      if (tag === 'template') {
        if (!templateDepth) reject('official_reference_unavailable');
        templateDepth--;
      }
      continue;
    }
    let rest = match[3]!,
      selfClosing = false;
    if (/\/\s*$/.test(rest)) {
      selfClosing = true;
      rest = rest.replace(/\/\s*$/, '');
    }
    const attrs: Record<string, string | null> = Object.create(null);
    while (rest.trim()) {
      const attr =
        /^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/.exec(
          rest,
        );
      if (!attr) reject('official_reference_unavailable');
      const name = attr[1]!.toLowerCase();
      if (Object.hasOwn(attrs, name)) reject('official_reference_unavailable');
      attrs[name] = attr[2] ?? attr[3] ?? attr[4] ?? null;
      rest = rest.slice(attr[0].length);
    }
    if (tag === 'template') {
      if (selfClosing) reject('official_reference_unavailable');
      templateDepth++;
      continue;
    }
    if (
      [
        'script',
        'style',
        'textarea',
        'title',
        'xmp',
        'iframe',
        'noembed',
        'noframes',
        'noscript',
      ].includes(tag)
    ) {
      if (selfClosing) reject('official_reference_unavailable');
      const close = new RegExp(`</${tag}\\s*>`, 'ig');
      close.lastIndex = cursor;
      const found = close.exec(input);
      if (!found) reject('official_reference_unavailable');
      // Script escaped/double-escaped states require a full HTML parser. Fail closed on their introducers.
      if (tag === 'script' && /<!--|<!\[CDATA\[/.test(input.slice(cursor, found.index)))
        reject('official_reference_unavailable');
      if (
        tag === 'script' &&
        (Object.hasOwn(attrs, 'language') || Object.hasOwn(attrs, 'integrity'))
      )
        reject('official_reference_unavailable');
      if (
        tag === 'script' &&
        !templateDepth &&
        !Object.hasOwn(attrs, 'nomodule') &&
        (!attrs.type ||
          ['text/javascript', 'application/javascript', 'module'].includes(
            attrs.type.toLowerCase(),
          ))
      ) {
        if (Object.hasOwn(attrs, 'src')) {
          if (!attrs.src || attrs.src.includes('&')) reject('official_reference_unavailable');
          try {
            urls.push(new URL(attrs.src, NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url).href);
          } catch {
            reject('official_reference_unavailable');
          }
        }
      }
      cursor = found.index + found[0].length;
    }
  }
  if (templateDepth) reject('official_reference_unavailable');
  const mains = urls.filter((url) => /\/main(?:\.[^/]+)?\.js$/.test(new URL(url).pathname));
  if (mains.length !== 1 || mains[0] !== NATIVE_SHORT_SUBMISSION_SOURCE_PINS.main.url)
    reject('official_reference_unavailable');
  return freeze(urls);
}

/** Fixed-build version hash; excludes observation time and nonce-bearing writer raw-byte hash. */
export function nativeShortSubmissionContractVersionHash(
  input: NativeShortSubmissionContract['sources'],
): string {
  const raw = object(capture(input), ['writer', 'main', 'publishShort', 'asyncMain']);
  const sources = {} as Record<keyof NativeShortSubmissionSourceDocuments, SourceObservation>;
  for (const key of ['writer', 'main', 'publishShort', 'asyncMain'] as const) {
    const item = object(raw[key], ['url', 'sha256', 'observedAt']),
      pin = NATIVE_SHORT_SUBMISSION_SOURCE_PINS[key];
    if (item.url !== pin.url || ('sha256' in pin && item.sha256 !== pin.sha256))
      reject('contract_invalid');
    sources[key] = {
      url: pin.url,
      sha256: exactHash(item.sha256),
      observedAt: time(item.observedAt),
    };
  }
  return contractSourceHash(sources);
}
