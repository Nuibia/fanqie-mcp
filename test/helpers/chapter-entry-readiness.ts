import { request, type Page } from 'playwright';

import assert from 'node:assert/strict';

import {
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
} from '../platform-reads.test.js';

interface Ports {
  options: {
    rows?: unknown[];
    titles?: string[];
    buttons?: Array<{ label: string; type?: string; className?: string; disabled?: boolean }>;
    method?: string;
    destination?: string;
    apiDestination?: string;
    spa?: boolean;
    postOnClick?: boolean;
    changedOwner?: boolean;
    oldRequest?: boolean;
    navigateDuringReplay?: boolean;
    directorySources?: ChapterFixtureSource[];
    navigateDuringDirectoryReplay?: boolean;
    directoryReplayError?: boolean;
    directoryNavigationAfterIndex?: number;
    navigateDuringDiagnosticDom?: boolean;
    cancelDuringDirectoryReplay?: AbortController;
    ownerAfterDirectoryReplay?: boolean;
    navigateBeforeVolumeRefresh?: boolean;
    duplicateFreshVolumeRequest?: boolean;
    suppressFreshVolumeEvents?: boolean;
    replayVolumeStatus?: number;
    freshVolumeUrlDrift?: boolean;
    volumeInputWrapper?: 'strings' | 'all';
    freshVolumeOverride?: {
      query?: string;
      resourceType?: string;
      subframe?: boolean;
      frameUnavailable?: boolean;
    };
    extraFreshVolumeEvents?: number;
    oldVolumeResponseDuringFresh?: boolean;
    suppressFreshVolumeResponse?: boolean;
    delayedFreshVolumeResponse?: boolean;
    mismatchedFreshResponseStatus?: number;
    oldResponseDuringVolumeWait?: boolean;
    navigateDuringVolumeWait?: boolean;
    cancelDuringVolumeWait?: AbortController;
    duplicateDuringVolumeWait?: boolean;
    bootstrapNavigation?: string[];
    loseSlotDuringDirectoryReplay?: boolean;
    chapterUi?: ChapterStaticUiFixture;
    realChapterReadiness?: ChapterRenderReadinessFixture;
  };
  request: (
    url: string,
    method?: string,
    navigation?: boolean,
    resource?: string,
    subframe?: boolean,
  ) => {
    url: () => string;
    method: () => string;
    isNavigationRequest: () => boolean;
    frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
    resourceType: () => string;
  };
  emit: (event: string, value: unknown) => void;
  response: (
    source: ReturnType<
      (
        url: string,
        method?: string,
        navigation?: boolean,
        resource?: string,
        subframe?: boolean,
      ) => {
        url: () => string;
        method: () => string;
        isNavigationRequest: () => boolean;
        frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
        resourceType: () => string;
      }
    >,
    json?: unknown,
    status?: number,
  ) => {
    url: () => string;
    status: () => number;
    ok: () => boolean;
    request: () => {
      url: () => string;
      method: () => string;
      isNavigationRequest: () => boolean;
      frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
      resourceType: () => string;
    };
    json: () => Promise<unknown>;
  };
  page: Page & { closed: boolean; onClose?: () => void; evaluations: unknown[] };
  readinessChecks: number;
  entryPage: {
    throughGuard: (
      source: ReturnType<
        (
          url: string,
          method?: string,
          navigation?: boolean,
          resource?: string,
          subframe?: boolean,
        ) => {
          url: () => string;
          method: () => string;
          isNavigationRequest: () => boolean;
          frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
          resourceType: () => string;
        }
      >,
    ) => Promise<boolean>;
    readonly activeRoute: ((route: unknown) => Promise<void>) | null;
  };
  readinessWasInitiallyBlank: boolean;
  throughGuard: (
    source: ReturnType<
      (
        url: string,
        method?: string,
        navigation?: boolean,
        resource?: string,
        subframe?: boolean,
      ) => {
        url: () => string;
        method: () => string;
        isNavigationRequest: () => boolean;
        frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
        resourceType: () => string;
      }
    >,
  ) => Promise<boolean>;
  readinessRendered: boolean;
}
export function createEntryReadiness(ports: Ports) {
  return () => {
    if (ports.options.realChapterReadiness) {
      const naturalSource = ports.options.directorySources?.find(
        (value) => new URL(value.url).pathname === '/api/author/chapter/chapter_list/v1',
      );
      const oldNaturalRequest = naturalSource ? ports.request(naturalSource.url) : null;
      const emitNatural = () => {
        if (!naturalSource) return;
        const source =
          ports.options.realChapterReadiness?.source === 'old_request'
            ? oldNaturalRequest!
            : ports.request(
                naturalSource.url,
                'GET',
                false,
                'xhr',
                ports.options.realChapterReadiness?.source === 'subframe',
              );
        if (ports.options.realChapterReadiness?.source !== 'old_request')
          ports.emit('request', source);
        ports.emit('response', ports.response(source, naturalSource.json));
      };
      if (ports.options.realChapterReadiness.source === 'old_request' && oldNaturalRequest)
        ports.emit('request', oldNaturalRequest);
      ports.page.waitForFunction = (async (
        callback: unknown,
        arg: unknown,
        waitOptions?: { timeout?: number },
      ) => {
        if (!String(callback).includes('.chapter-table')) return;
        ports.readinessChecks += 1;
        assert.equal(ports.entryPage.activeRoute !== null, true);
        assert.ok(waitOptions?.timeout !== undefined && waitOptions.timeout > 0);
        ports.readinessWasInitiallyBlank = !(await ports.page.evaluate(callback as never, arg));
        if (ports.options.realChapterReadiness?.analyticsPost)
          assert.equal(
            await ports.throughGuard(
              ports.request('https://fanqienovel.com/api/author/sa_stats/analytics/v0/', 'POST'),
            ),
            false,
          );
        if (ports.options.realChapterReadiness?.fatalRequest) {
          const raw =
            ports.options.realChapterReadiness.fatalRequest === 'wrong_route'
              ? 'https://fanqienovel.com/main/writer/book-manage'
              : ports.options.realChapterReadiness.fatalRequest === 'wrong_parent'
                ? 'https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=7600000000000000002'
                : 'https://fanqienovel.com/api/author/chapter/save/v0/';
          assert.equal(
            await ports.throughGuard(
              ports.request(
                raw,
                'GET',
                ports.options.realChapterReadiness.fatalRequest === 'wrong_route',
              ),
            ),
            false,
          );
        }
        if (ports.options.realChapterReadiness?.render === 'delayed')
          await new Promise((resolve) => setTimeout(resolve, 2));
        ports.readinessRendered = ports.options.realChapterReadiness?.render !== 'missing';
        if (
          ports.options.realChapterReadiness?.source !== 'missing' &&
          ports.options.realChapterReadiness?.source !== 'after_render'
        )
          emitNatural();
        if (!(await ports.page.evaluate(callback as never, arg)))
          throw new Error('PRIVATE_CHAPTER_RENDER_TIMEOUT');
        if (ports.options.realChapterReadiness?.source === 'after_render')
          setTimeout(emitNatural, 2);
        if (ports.options.realChapterReadiness?.deferredCleanupRoute)
          void ports.throughGuard(
            ports.request(
              'https://fanqienovel.com/api/author/sa_stats/analytics_deferred/v0/',
              'POST',
            ),
          );
      }) as unknown as Page['waitForFunction'];
    }
  };
}
