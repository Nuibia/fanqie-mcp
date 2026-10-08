import { type Page, type Request } from 'playwright';
import {
  type PlatformIdentity,
  ownInfoSource,
  projectOwnResponseFields,
  parseOwnResponseIdentity,
} from '../own-identity.js';
import { type CurrentLoginDiagnostic, type OwnResponseStructure } from '../read-diagnostics.js';
import {
  type ReadResponseStructure,
  isReadSchemaSource,
  projectReadResponseFields,
} from '../../reads.js';
import { diagnosticRouteTemplate } from '../chapter-routes.js';
import { isLongStatsSchemaSource, projectLongStatsResponseFields } from '../long-statistics.js';
import { type RememberIdentityOperation } from '../contracts/remember-identity.js';
import { type ObserveIdentityOperation } from '../contracts/observe-identity.js';
interface Dependencies {
  ownInfoUrls: WeakMap<Page, Set<string>>;
  pageGetMetadata: WeakMap<
    Page,
    { entries: CurrentLoginDiagnostic['getResponses']; truncated: boolean }
  >;
  pageOwnStructures: WeakMap<Page, Map<string, OwnResponseStructure>>;
  pageReadStructures: WeakMap<Page, Map<string, ReadResponseStructure>>;
  page: Page | null;
  identityEpoch: number;
  identity: PlatformIdentity | null;
  closed: boolean;
  rememberIdentity: RememberIdentityOperation;
}
export function createObserveIdentity(deps: Dependencies): ObserveIdentityOperation {
  function observeIdentity(page: Page): void {
    const urls = new Set<string>();
    const requestEpochs = new WeakMap<Request, number>();
    const metadata = { entries: [] as CurrentLoginDiagnostic['getResponses'], truncated: false };
    const structures = new Map<string, OwnResponseStructure>();
    const readStructures = new Map<string, ReadResponseStructure>();
    deps.ownInfoUrls.set(page, urls);
    deps.pageGetMetadata.set(page, metadata);
    deps.pageOwnStructures.set(page, structures);
    deps.pageReadStructures.set(page, readStructures);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && page === deps.page && !page.isClosed()) {
        deps.identityEpoch += 1;
        deps.identity = null;
        urls.clear();
        structures.clear();
        readStructures.clear();
        metadata.entries.length = 0;
        metadata.truncated = false;
      }
    });
    page.on('request', (request) => {
      if (page !== deps.page || page.isClosed() || deps.closed) return;
      try {
        if (
          new URL(request.url()).origin === 'https://fanqienovel.com' &&
          request.method() === 'GET'
        )
          requestEpochs.set(request, deps.identityEpoch);
      } catch {
        /* No request URL is retained by the metadata cache. */
      }
    });
    page.on('response', (response) => {
      const request = response.request();
      const epoch = requestEpochs.get(request);
      if (
        epoch === undefined ||
        epoch !== deps.identityEpoch ||
        page !== deps.page ||
        page.isClosed() ||
        deps.closed
      )
        return;
      let url: URL;
      try {
        url = new URL(response.url());
      } catch {
        return;
      }
      if (
        url.origin === 'https://fanqienovel.com' &&
        request.method() === 'GET' &&
        ['fetch', 'xhr'].includes(request.resourceType()) &&
        url.pathname.startsWith('/api/')
      ) {
        const pathTemplate = diagnosticRouteTemplate(`${url.origin}${url.pathname}`)
          .replace(url.origin, '')
          .replace(/\/\d+(?=\/|$)/g, '/{id}');
        const entry = {
          pathTemplate,
          status: response.status(),
          resourceType: request.resourceType(),
        };
        if (
          !metadata.entries.some(
            (item) =>
              item.pathTemplate === entry.pathTemplate &&
              item.status === entry.status &&
              item.resourceType === entry.resourceType,
          )
        ) {
          if (metadata.entries.length < 100) metadata.entries.push(entry);
          else metadata.truncated = true;
        }
      }
      if (
        (isReadSchemaSource(url.href) || isLongStatsSchemaSource(url.href)) &&
        request.method() === 'GET' &&
        response.ok()
      ) {
        void response
          .json()
          .then((json: unknown) => {
            if (
              epoch !== deps.identityEpoch ||
              page !== deps.page ||
              page.isClosed() ||
              deps.closed
            )
              return;
            const pathTemplate = diagnosticRouteTemplate(url.href).replace(url.origin, '');
            readStructures.set(pathTemplate, {
              pathTemplate,
              status: response.status(),
              ...(isLongStatsSchemaSource(url.href)
                ? projectLongStatsResponseFields(json)
                : projectReadResponseFields(json)),
            });
          })
          .catch(() => undefined);
      }
      if (!ownInfoSource(url)) return;
      if (response.request().method() !== 'GET' || !response.ok()) return;
      urls.add(response.url());
      void response
        .json()
        .then((json: unknown) => {
          if (epoch !== deps.identityEpoch || page !== deps.page || page.isClosed() || deps.closed)
            return;
          const pathTemplate = `${url.origin}${url.pathname}`.replace(url.origin, '');
          structures.set(pathTemplate, {
            pathTemplate,
            status: response.status(),
            ...projectOwnResponseFields(json),
          });
          const identity = parseOwnResponseIdentity(json, url.href);
          if (
            identity &&
            epoch === deps.identityEpoch &&
            page === deps.page &&
            !page.isClosed() &&
            !deps.closed
          )
            deps.rememberIdentity(identity);
        })
        .catch(() => undefined);
    });
  }
  return observeIdentity;
}
