import { type Page } from 'playwright';

import { type LoginState } from '../own-identity.js';

export type OpenChapterDraftTabOperation = (
  page: Page,
  sources: ReadonlyMap<string, { raw: string; epoch: number }>,
  before: LoginState,
  timeoutMs: number,
) => Promise<
  | {
      tab: {
        blockedRequests?:
          | {
              entries: {
                method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'OTHER';
                resourceType:
                  | 'document'
                  | 'script'
                  | 'image'
                  | 'stylesheet'
                  | 'font'
                  | 'media'
                  | 'xhr'
                  | 'fetch'
                  | 'other';
                navigation: boolean;
                origin: 'platform' | 'external' | 'invalid';
                pathClass: 'known_author_api' | 'writer_route' | 'unknown' | 'invalid';
                pathTemplate: string;
                authorFamily:
                  | 'book'
                  | 'chapter'
                  | 'volume'
                  | 'account'
                  | 'inset'
                  | 'hot_word'
                  | 'banned'
                  | null;
                count: number;
              }[];
              count: number;
              truncated: boolean;
            }
          | undefined;
        tab: 'drafts';
        status: 'unavailable';
        reason: string;
        routeTemplate: null;
        targetRef: null;
      };
      login: LoginState;
    }
  | {
      tab: { tab: 'drafts'; status: 'opened'; routeTemplate: string; targetRef: string };
      login: LoginState;
    }
>;
