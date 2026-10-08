import { type Page } from 'playwright';

import { type LoginState } from '../own-identity.js';

import { type ChapterRouteQuerySchema } from '../chapter-diagnostics.js';

export type OpenExistingChapterDirectoryOperation = (
  page: Page,
  sources: ReadonlySet<string>,
  workId: string,
  before: LoginState,
  timeoutMs: number,
) => Promise<
  | {
      entry: {
        querySchema?: ChapterRouteQuerySchema | undefined;
        status: 'unavailable';
        reason: string;
        routeTemplate: string | null;
        routeObservation: 'landed' | 'navigation-request' | null;
        targetRef: null;
      };
      login: LoginState;
      ready: boolean;
      redactions: string[];
    }
  | {
      entry: {
        querySchema?: ChapterRouteQuerySchema | undefined;
        status: 'opened';
        routeTemplate: string;
        routeObservation: 'landed';
        targetRef: string;
      };
      login: LoginState;
      ready: true;
      redactions: string[];
    }
>;
