import { type DraftContent, hashDraftContent } from '../../src/platform/writes.js';

import {
  content,
  options,
  FixturePage,
  fixedNow,
  accountId,
  target,
} from './platform-writes-fixture-page.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

export const nativeContent: DraftContent = {
  title: content.title,
  body: content.body + '\n',
  metadata: {},
};

// Existing fixture identity callback supplies the same two trusted local owner observations.
export const nativeOptions = {
  ...options,
  identityType: 'account' as const,
  verifyAccount: async (page: Page) => ({
    status: 'authenticated' as const,
    identity: { accountId: (page as unknown as FixturePage).account, authorId: null },
    sourceUrl: 'https://fanqienovel.com/api/author/user/info/v0/',
    checkedAt: fixedNow().toISOString(),
  }),
};

export const legacyNativeReadInput = () => ({
  accountId,
  target,
  expectedContentHash: hashDraftContent(nativeContent),
  expectedState: 'draft' as const,
});

export const nativeUpdateInput = (changes: Partial<DraftContent> = {}) => ({
  accountId,
  target,
  expectedContentHash: hashDraftContent(nativeContent),
  expectedState: 'draft' as const,
  content: { ...nativeContent, ...changes },
});

const fixtureEscape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const fixtureHTML = (text: string) =>
  text === ''
    ? ''
    : text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => '<p>' + fixtureEscape(line) + '</p>')
        .join('');

export const fixtureDecode = (text: string) =>
  text.replace(
    /&(?:amp|lt|gt|quot|apos|#39);/g,
    (token) =>
      ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[
        token
      ]!,
  );

export function fixtureTemplateDocument() {
  return {
    createElement: (tag: string) => {
      assert.equal(tag, 'template');
      const template = {
        content: { childNodes: [] as unknown[] },
        set innerHTML(html: string) {
          const nodes: unknown[] = [];
          for (const match of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
            const children: unknown[] = [];
            for (const part of match[1]!.split(/(<br\s*\/?>)/g)) {
              if (!part) continue;
              children.push(
                part.startsWith('<br')
                  ? { nodeType: 1, tagName: 'BR', attributes: [], childNodes: [] }
                  : { nodeType: 3, textContent: fixtureDecode(part), childNodes: [] },
              );
            }
            nodes.push({ nodeType: 1, tagName: 'P', attributes: [], childNodes: children });
          }
          this.content.childNodes = nodes;
        },
      };
      return template;
    },
  };
}
