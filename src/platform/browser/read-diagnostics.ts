import { type ChapterTabStructureNode } from './chapter-diagnostics.js';

import { type LoginState } from './own-identity.js';

export interface ChapterTabStructure {
  rootMatches: number;
  scopedTabMatches: number;
  draftMatches: number;
  managementMatches: number;
  candidates: Array<
    ChapterTabStructureNode & {
      label: '草稿箱' | '章节管理';
      matchesScopedSelector: boolean;
      parents: ChapterTabStructureNode[];
      parentsTruncated: boolean;
    }
  >;
  truncated: { candidatePool: boolean; candidates: boolean; roots: boolean; scopedTabs: boolean };
}

export interface CurrentLoginDiagnostic {
  status: LoginState['status'];
  sourceUrl: string;
  checkedAt: string;
  identityObserved: { accountId: boolean; authorId: boolean; displayName: boolean };
  controls: Array<{
    tag: string;
    attributes: Record<string, string>;
    label: string | null;
    width: number;
    height: number;
  }>;
  getResponses: Array<{ pathTemplate: string; status: number; resourceType: string }>;
  routerStructure: Array<{ pathTemplate: string; fields: string[] }>;
  ownResponseStructure: OwnResponseStructure[];
  chapterTabStructure?: ChapterTabStructure;
  truncated: { controls: boolean; responses: boolean; router: boolean };
  limitations: string[];
}

export interface OwnResponseStructure {
  pathTemplate: string;
  status: number;
  fields: Array<{
    path: string;
    type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  }>;
  truncated: boolean;
}

export const DIAGNOSTIC_BASE_ROUTES = new Set([
  'short-manage',
  'short-data',
  'book-manage',
  'book-data',
  'chapter-manage',
  'chapter-data',
  'data',
]);

// account/info/v0 was observed as a current-page own-account GET on 2026-10-03.
export const OWN_INFO_PATH =
  /^(?:\/api\/(?:author|writer|user)\/(?:info|profile|account)(?:\/v\d+)?|\/api\/author\/account\/info\/v0)\/?$/;
