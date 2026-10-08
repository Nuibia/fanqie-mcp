import { createReadManagementVolume } from './read-volume.js';
import { createAcquireManagementView } from './acquire-management-view.js';
import { createOpenManagementOptions } from './open-management-options.js';
import { type JSHandle } from 'playwright';

import {
  PlatformReadError,
  type ChapterManagementCoverage,
  parseCurrentChapterVolumes,
} from '../../reads.js';
import { BrowserSessionError } from '../errors.js';

import { currentManagementDom } from '../chapter-dom.js';

import { type ChapterReadState } from './chapterReadScope.js';
export function createCollectManagementViews(
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
  >,
) {
  return async (
    volumes: ReturnType<typeof parseCurrentChapterVolumes>,
    initialVolumeId: string,
    initialSource: string,
    read: (source: string) => Promise<unknown>,
  ) => {
    if (!chapterReadScope.collected || !chapterReadScope.managementCoverage) return;
    if (chapterReadScope.collected.records.length > 100000 || volumes.length > 10000)
      throw new PlatformReadError(
        'chapter_management_extent_exceeded',
        'The observed management extent exceeds this read budget',
      );
    const coverage = chapterReadScope.managementCoverage,
      seen = new Set(chapterReadScope.collected.records.map((record) => record.chapterId));
    const deadline = chapterReadScope.managementDeadline;
    let actions = 0;
    const reason = (code: ChapterManagementCoverage['reasons'][number]) => {
      if (code === 'management_ui_unverified') coverage.allStatusObserved = false;
      if (!coverage.reasons.includes(code)) coverage.reasons.push(code);
      coverage.status = 'partial';
    };
    const budget = () => {
      chapterReadScope.assertStable();
      return (
        performance.now() < deadline && chapterReadScope.chapterPagesFetched < 64 && actions < 64
      );
    };
    const domState = async (volumeId?: string) => {
      chapterReadScope.assertStable();
      if (performance.now() >= deadline) {
        reason('read_budget_exceeded');
        return false;
      }
      const state = await chapterReadScope.page.evaluate(currentManagementDom, {
        mode: 'state' as const,
      });
      chapterReadScope.assertStable();
      if (performance.now() >= deadline) {
        reason('read_budget_exceeded');
        return false;
      }
      return (
        state.allStatus === true &&
        (!volumeId ||
          volumes.find((volume) => volume.volumeId === volumeId)?.name === state.selectedName)
      );
    };
    // The initial business page belongs to this scope only when its actual
    // management/all-status qualification was observed before and after reading.
    if (performance.now() >= deadline) {
      reason('read_budget_exceeded');
      return;
    }
    if (!chapterReadScope.initialManagementQualified) {
      reason('management_ui_unverified');
      return;
    }
    // Existing partial data remains valid if the UI extent cannot be proved.
    try {
      coverage.allStatusObserved = await domState();
    } catch (error) {
      chapterReadScope.assertStable();
      if (error instanceof BrowserSessionError) throw error;
      reason('management_ui_unverified');
      return;
    }
    if (!coverage.allStatusObserved) {
      reason('management_ui_unverified');
      return;
    }
    const handles: Array<{
      dispose(): Promise<void>;
    }> = [];
    const own = <
      T extends {
        dispose(): Promise<void>;
      },
    >(
      handle: T,
    ): T => {
      handles.push(handle);
      return handle;
    };
    const property = async (handle: JSHandle, name: string) => {
      const result = own(await handle.getProperty(name));
      chapterReadScope.assertStable();
      return result;
    };
    try {
      const initialBinding = own(
        await chapterReadScope.page.evaluateHandle(currentManagementDom, {
          mode: 'control' as const,
        }),
      );
      chapterReadScope.assertStable();
      const control = (await property(initialBinding, 'control')).asElement(),
        view = (await property(initialBinding, 'view')).asElement();
      if (!control || !view) {
        reason('volume_options_unbound');
        return;
      }
      const openOptions = createOpenManagementOptions({
        chapterReadScope,
        control,
        view,
        domState,
        reason,
        budget,
        get actions() {
          return actions;
        },
        set actions(value) {
          actions = value;
        },
        deadline,
        own,
        volumes,
        property,
        coverage,
      });
      const pageQuery = (source: string) => {
        const url = new URL(source),
          index = url.searchParams.getAll('page_index'),
          count = url.searchParams.getAll('page_count');
        if (
          index.length !== 1 ||
          count.length !== 1 ||
          !/^(?:0|[1-9]\d*)$/.test(index[0]!) ||
          !/^[1-9]\d*$/.test(count[0]!) ||
          !Number.isSafeInteger(Number(index[0])) ||
          !Number.isSafeInteger(Number(count[0]))
        )
          return null;
        return { index: Number(index[0]), capacity: Number(count[0]) };
      };
      const acquireView = createAcquireManagementView({
        chapterReadScope,
        budget,
        reason,
        deadline,
        get actions() {
          return actions;
        },
        set actions(value) {
          actions = value;
        },
      });
      const readVolume = createReadManagementVolume({
        volumes,
        budget,
        reason,
        read,
        chapterReadScope,
        deadline,
        seen,
        pageQuery,
        coverage,
        domState,
        own,
        property,
        acquireView,
      });
      if (!(await readVolume(initialVolumeId, initialSource, chapterReadScope.collected))) return;
      const firstOptions = await openOptions();
      if (!firstOptions) return;
      let openedOptions: typeof firstOptions | null = firstOptions;
      for (const volume of volumes) {
        if (volume.volumeId === initialVolumeId) continue;
        const opened = openedOptions ?? (await openOptions());
        if (!opened) return;
        openedOptions = null;
        const option = opened.optionsById.get(volume.volumeId)!;
        const source = await acquireView(volume.volumeId, async (activate) => {
          const bound = await chapterReadScope.page.evaluate(currentManagementDom, {
            mode: 'option' as const,
            control,
            view,
            popup: opened.popup,
            option,
            optionName: volume.name,
            portalOpeningObserved: opened.portalOpeningObserved,
          });
          chapterReadScope.assertStable();
          if (!bound.bound)
            throw new PlatformReadError(
              'chapter_volume_control_changed',
              'The verified volume option changed',
            );
          if (!activate()) return;
          await option.click({
            timeout: Math.max(1, Math.min(chapterReadScope.timeout, deadline - performance.now())),
            noWaitAfter: true,
          });
        });
        if (!source || !(await domState(volume.volumeId))) {
          if (source) reason('management_ui_unverified');
          return;
        }
        if (!(await readVolume(volume.volumeId, source, null))) return;
      }
      if (performance.now() >= deadline) {
        reason('read_budget_exceeded');
        return;
      }
      coverage.status =
        coverage.completedVolumes === volumes.length && coverage.inventoryReconciled
          ? 'complete'
          : 'partial';
    } finally {
      chapterReadScope.closeViewWindow();
      const disposed = await Promise.allSettled(handles.map((handle) => handle.dispose()));
      chapterReadScope.assertStable();
      if (disposed.some((result) => result.status === 'rejected'))
        throw new PlatformReadError(
          'chapter_context_disposal_failed',
          'Management control handles could not be released',
        );
    }
  };
}
