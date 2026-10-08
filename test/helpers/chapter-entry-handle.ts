import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import {
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
  type FixtureElement,
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
  volumeContainers: FixtureElement[];
  volumeViews: FixtureElement[];
  volumeControlOrder: FixtureElement[];
  element: (
    tagName: string,
    textContent: string,
    attributes?: Record<string, string>,
  ) => FixtureElement;
  page: Page & { closed: boolean; onClose?: () => void; evaluations: unknown[] };
  volumeClickCount: number;
  volumeExpanded: boolean;
  currentUrl: string;
  emit: (event: string, value: unknown) => void;
  volumeHandleDisposals: number;
}
export function createEntryHandle(ports: Ports) {
  const privateHandle = (value: unknown): any => ({
    asElement() {
      return value && typeof value === 'object' && 'tagName' in value ? this : null;
    },
    async getProperty(name: string) {
      const property =
        value && typeof value === 'object' ? (value as Record<string, unknown>)[name] : null;
      if (name === 'view' && ports.options.realChapterReadiness?.volumeBindingChange) {
        const kind = ports.options.realChapterReadiness.volumeBindingChange,
          original = ports.volumeContainers[0]!,
          originalView = ports.volumeViews[0]!;
        if (kind === 'reorder_status')
          ports.volumeControlOrder.unshift(
            ports.element('DIV', '', { class: 'serial-select chapter-status-select' }),
          );
        if (kind === 'status_change')
          original.setAttribute('class', 'serial-select chapter-status-select');
        if (kind === 'detach_view') originalView.isConnected = false;
        if (kind === 'replace_control') {
          original.isConnected = false;
          originalView.isConnected = false;
          const replacement = ports.element('DIV', '', { class: 'serial-select' }),
            replacementView = ports.element('DIV', '', { class: 'byte-select-view' });
          replacement.querySelectorAll = (selector) => {
            assert.equal(selector, '.byte-select-view');
            return [replacementView];
          };
          ports.volumeControlOrder.splice(0, 1, replacement);
        }
      }
      return privateHandle(property);
    },
    async evaluate(callback: unknown, other: { value?: unknown }) {
      return ports.page.evaluate(
        new Function('arg', `return (${String(callback)})(arg.node, arg.other);`) as never,
        { node: value, other: other.value } as never,
      );
    },
    async click() {
      assert.ok(ports.volumeViews.includes(value as FixtureElement));
      assert.equal((value as FixtureElement).isConnected, true);
      ports.volumeClickCount += 1;
      ports.volumeExpanded = true;
      if (ports.options.realChapterReadiness?.volumeNavigate) {
        ports.currentUrl = 'https://fanqienovel.com/main/writer/book-manage';
        ports.emit('framenavigated', null);
      }
    },
    async dispose() {
      ports.volumeHandleDisposals += 1;
    },
    value,
  });
  return privateHandle;
}
