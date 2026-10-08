import {
  diagnosticRouteTemplate,
  isDiagnosticReadQueryKey,
  isChapterDirectoryRoute,
} from '../chapter-routes.js';

import { createHash } from 'node:crypto';

import { type Dependencies } from '../operations/diagnose-read-page.js';
interface Ports {
  observed: {
    elements: { tag: string; attributes: Record<string, string>; label: string | null }[];
    links: { href: string; label: string | null }[];
    navigationLabels: string[];
    internalBookTitles: string[];
    chapterUi: import('../chapter-diagnostics.js').ChapterDirectoryUiStructure | undefined;
    truncated: boolean;
  };
  deps: Dependencies;
  links: { routeTemplate: string; targetRef: string; label: string | null }[];
}
export function createObservedLinkRegistrar(ports: Ports) {
  return () => {
    for (const link of ports.observed.links) {
      try {
        const target = new URL(link.href);
        if (target.origin !== 'https://fanqienovel.com' || target.username || target.password)
          continue;
        if (
          !/^\/main\/writer\/(?:(?:short-manage|short-data|book-manage|book-data|chapter-manage|chapter-data|data)\/?|(?:preview-short|preview-book|preview-chapter|chapter-manage|chapter-data|book-manage|book-data)\/\d{10,30}(?:\/\d{10,30})?\/?)$/.test(
            target.pathname,
          )
        )
          continue;
        if (new Set(target.searchParams.keys()).size !== target.searchParams.size) continue;
        if (
          isChapterDirectoryRoute(target.pathname) &&
          [...target.searchParams].some(
            ([key, value]) =>
              !isDiagnosticReadQueryKey(target.pathname, key) || !/^\d{1,30}$/.test(value),
          )
        )
          continue;
        for (const [key, value] of [...target.searchParams])
          if (!isDiagnosticReadQueryKey(target.pathname, key) || !/^\d{1,30}$/.test(value))
            target.searchParams.delete(key);
        target.hash = '';
        ports.deps.discoveredStableTargets.add(`${target.origin}${target.pathname}`);
        const targetRef = createHash('sha256').update(target.toString()).digest('hex').slice(0, 24);
        ports.deps.diagnosticTargets.set(targetRef, target.toString());
        if (!ports.links.some((item) => item.targetRef === targetRef))
          ports.links.push({
            routeTemplate: diagnosticRouteTemplate(target.toString()),
            targetRef,
            label: link.label,
          });
      } catch {
        /* Unverified links are excluded, including all create/publish/edit routes. */
      }
    }
  };
}
