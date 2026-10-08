import { type ChapterManagementCoverage } from '../../reads.js';

import { type ChapterReadState } from './chapterReadScope.js';

interface Ports {
  chapterReadScope: Pick<
    ChapterReadState,
    | 'collected'
    | 'managementCoverage'
    | 'managementDeadline'
    | 'assertStable'
    | 'chapterPagesFetched'
    | 'page'
    | 'initialManagementQualified'
    | 'timeout'
    | 'viewWindow'
    | 'closeViewWindow'
    | 'options'
    | 'stable'
    | 'workId'
    | 'managementControlObservation'
  >;
  budget: () => boolean;
  reason: (code: ChapterManagementCoverage['reasons'][number]) => void;
  deadline: number;
  actions: number;
}
export function createAcquireManagementView(ports: Ports) {
  return async (volumeId: string, click: (activate: () => boolean) => Promise<void>) => {
    ports.chapterReadScope.assertStable();
    if (!ports.budget()) {
      ports.reason('read_budget_exceeded');
      return null;
    }
    const window = {
      volumeId,
      deadline: Math.min(ports.deadline, performance.now() + ports.chapterReadScope.timeout),
      sources: new Set<string>(),
      requestIds: new Set<string>(),
      open: true,
      actionStarted: false,
      exhausted: false,
      timer: null as ReturnType<typeof setTimeout> | null,
      wake: null as (() => void) | null,
    };
    ports.chapterReadScope.viewWindow = window;
    const terminate = () => ports.chapterReadScope.closeViewWindow();
    ports.chapterReadScope.options.signal?.addEventListener('abort', terminate, { once: true });
    ports.chapterReadScope.page.on('close', terminate);
    window.timer = setTimeout(terminate, Math.max(1, window.deadline - performance.now()));
    try {
      ports.actions += 1;
      await click(() => {
        ports.chapterReadScope.assertStable();
        if (
          !window.open ||
          performance.now() >= window.deadline ||
          performance.now() >= ports.deadline
        ) {
          ports.reason('read_budget_exceeded');
          return false;
        }
        window.actionStarted = true;
        return true;
      });
      ports.chapterReadScope.assertStable();
      if (window.open && window.sources.size === 0)
        await new Promise<void>((resolve) => {
          window.wake = () => {
            if (!window.open || window.sources.size > 0 || !ports.chapterReadScope.stable())
              resolve();
          };
          window.wake();
        });
      ports.chapterReadScope.assertStable();
      ports.chapterReadScope.closeViewWindow();
      if (performance.now() >= ports.deadline || !window.actionStarted) {
        ports.reason('read_budget_exceeded');
        return null;
      }
      if (window.exhausted) {
        ports.reason('read_budget_exceeded');
        return null;
      }
      if (window.sources.size !== 1) {
        ports.reason(window.sources.size > 1 ? 'view_source_ambiguous' : 'view_source_missing');
        return null;
      }
      // Synchronous seal; later events cannot replace the selected raw URL.
      return [...window.sources][0]!;
    } finally {
      ports.chapterReadScope.closeViewWindow();
      ports.chapterReadScope.options.signal?.removeEventListener('abort', terminate);
      ports.chapterReadScope.page.off('close', terminate);
      window.wake = null;
      window.requestIds.clear();
      ports.chapterReadScope.viewWindow = null;
    }
  };
}
