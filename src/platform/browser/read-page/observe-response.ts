import { type Page, type Request } from 'playwright';
import { isChapterReadSchemaSource } from '../../reads.js';

import {
  diagnosticRouteTemplate,
  chapterDirectoryWorkId,
  projectChapterGetQuerySchema,
} from '../chapter-routes.js';
import { isLongStatsSchemaSource } from '../long-statistics.js';
import { type DiagnosticOptions, type ChapterGetQuerySchema } from '../chapter-diagnostics.js';

import { type Dependencies } from '../operations/diagnose-read-page.js';
interface Ports {
  options: DiagnosticOptions;
  requestEpochs: WeakMap<object, number>;
  managerGeneration: number;
  observedManagerSources: Set<string>;
  observedLongStats: Map<string, string>;
  directoryRequestEpochs: WeakMap<Request, number>;
  directoryObservation: number;
  deps: Dependencies;
  page: Page;
  observedDirectorySources: Map<string, { raw: string; epoch: number; observation: number }>;
  directoryMetadata: {
    pathTemplate: string;
    status: number;
    querySchema: ChapterGetQuerySchema;
    epoch: number | undefined;
    stored: boolean;
    observation: number;
  }[];
  maxResponses: number;
  responseCount: number;
  responses: { pathTemplate: string; status: number; resourceType: string }[];
}
export function createReadPageResponseObserver(ports: Ports) {
  return (response: { url(): string; status(): number; request(): Request }) => {
    try {
      const responseUrl = new URL(response.url());
      if (
        responseUrl.origin !== 'https://fanqienovel.com' ||
        response.request().method() !== 'GET' ||
        !['fetch', 'xhr'].includes(response.request().resourceType())
      )
        return;
      if (
        ports.options.openChaptersForWorkId &&
        responseUrl.pathname === '/api/author/book/book_list/v0/' &&
        responseUrl.searchParams.has('page_index') &&
        responseUrl.searchParams.has('page_count') &&
        ![...responseUrl.searchParams.keys()].some((key) =>
          /^(?:author|writer|user|target|account|owner)_?id$|^(?:uid|id)$/i.test(key),
        ) &&
        ports.requestEpochs.get(response.request()) === ports.managerGeneration &&
        ports.observedManagerSources.size < 5
      )
        ports.observedManagerSources.add(response.url());
      if (isLongStatsSchemaSource(response.url())) {
        const key = diagnosticRouteTemplate(response.url()).replace(responseUrl.origin, '');
        if (ports.observedLongStats.has(key) || ports.observedLongStats.size < 10)
          ports.observedLongStats.set(key, response.url());
      }
      const directoryEpoch = ports.directoryRequestEpochs.get(response.request());
      if (isChapterReadSchemaSource(response.url())) {
        const pathTemplate = responseUrl.pathname,
          observation = ++ports.directoryObservation;
        const stored =
          response.status() >= 200 &&
          response.status() < 300 &&
          directoryEpoch === ports.deps.identityEpoch &&
          ports.page === ports.deps.page &&
          !ports.page.isClosed() &&
          !ports.deps.closed;
        if (stored)
          ports.observedDirectorySources.set(pathTemplate, {
            raw: response.url(),
            epoch: directoryEpoch!,
            observation,
          });
        if (ports.directoryMetadata.length < ports.maxResponses)
          ports.directoryMetadata.push({
            pathTemplate,
            status: response.status(),
            querySchema: projectChapterGetQuerySchema(
              response.url(),
              chapterDirectoryWorkId(ports.page.url()),
            ),
            epoch: directoryEpoch,
            stored,
            observation,
          });
      }
      ports.responseCount += 1;
      if (ports.responses.length < ports.maxResponses)
        ports.responses.push({
          pathTemplate: isChapterReadSchemaSource(response.url())
            ? responseUrl.pathname
            : diagnosticRouteTemplate(response.url()).replace('https://fanqienovel.com', ''),
          status: response.status(),
          resourceType: response.request().resourceType(),
        });
    } catch {
      /* No untrusted URL or response body is emitted. */
    }
  };
}
