import { request } from 'playwright';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type FixtureElement,
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
} from '../platform-reads.test.js';

interface Ports {
  volumeContainers: FixtureElement[];
  replacementClickCount: number;
  volumeClickCount: number;
  volumeExpanded: boolean;
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
  currentUrl: string;
  emit: (event: string, value: unknown) => void;
  cards: FixtureElement[];
  buttons: FixtureElement[];
  clickCount: number;
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
  CHAPTER_ENTRY_FIXTURE_WORK: '7600000000000000001';
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
}
export function createEntryLocator(ports: Ports) {
  return (selector: string) => {
    if (selector === '.chapter-select-left .serial-select')
      return {
        nth(index: number) {
          assert.ok(index < ports.volumeContainers.length);
          return {
            locator(inner: string) {
              assert.equal(inner, '.byte-select-view');
              return {
                async count() {
                  return 1;
                },
                async click() {
                  ports.replacementClickCount += 1;
                  ports.volumeClickCount += 1;
                  ports.volumeExpanded = true;
                  if (ports.options.realChapterReadiness?.volumeNavigate) {
                    ports.currentUrl = 'https://fanqienovel.com/main/writer/book-manage';
                    ports.emit('framenavigated', null);
                  }
                },
              };
            },
          };
        },
      };
    assert.equal(selector, '.home-book-item');
    return {
      nth(index: number) {
        const card = ports.cards[index]!;
        return {
          locator(inner: string) {
            if (inner === '.info-content-title')
              return {
                async innerText() {
                  return card.querySelector(inner)!.textContent;
                },
              };
            assert.equal(inner, 'button.right-btn[type="button"]');
            return {
              filter({ hasText }: { hasText: RegExp }) {
                return {
                  async count() {
                    return ports.buttons.filter(
                      (button) => button.matches(inner) && hasText.test(button.textContent),
                    ).length;
                  },
                  async click() {
                    ports.clickCount += 1;
                    if (ports.options.postOnClick) {
                      await ports.throughGuard(
                        ports.request(
                          'https://fanqienovel.com/api/author/chapter/save/v0/',
                          'POST',
                        ),
                      );
                      return;
                    }
                    const destination =
                      ports.options.destination ??
                      `https://fanqienovel.com/main/writer/chapter-manage/${ports.CHAPTER_ENTRY_FIXTURE_WORK}`;
                    if (
                      !ports.options.spa &&
                      !(await ports.throughGuard(ports.request(destination, 'GET', true)))
                    )
                      return;
                    ports.currentUrl = destination;
                    ports.emit('framenavigated', null);
                    const source = ports.request(
                      ports.options.apiDestination ??
                        `https://fanqienovel.com/api/author/chapter/fixture-directory/v0/?book_id=${ports.CHAPTER_ENTRY_FIXTURE_WORK}&nonce=PRIVATE_DIRECTORY_NONCE`,
                    );
                    ports.emit('request', source);
                    ports.emit('response', ports.response(source));
                  },
                };
              },
            };
          },
        };
      },
    };
  };
}
