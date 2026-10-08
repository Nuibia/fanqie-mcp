import { type ElementHandle, type JSHandle } from 'playwright';
import { type ChapterManagementCoverage } from '../../reads.js';

import { currentManagementDom } from '../chapter-dom.js';
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
  control: ElementHandle<any> | null;
  view: ElementHandle<any> | null;
  domState: (volumeId?: string) => Promise<boolean>;
  reason: (code: ChapterManagementCoverage['reasons'][number]) => void;
  budget: () => boolean;
  actions: number;
  deadline: number;
  own: <T extends { dispose(): Promise<void> }>(handle: T) => T;
  volumes: (import('../../reads.js').ChapterVolume & { index: number; name: string })[];
  property: (handle: JSHandle, name: string) => Promise<JSHandle<any>>;
  coverage: ChapterManagementCoverage;
}
export function createOpenManagementOptions(ports: Ports) {
  return async () => {
    ports.chapterReadScope.assertStable();
    const before = await ports.chapterReadScope.page.evaluate(currentManagementDom, {
      mode: 'control' as const,
      control: ports.control,
      view: ports.view,
    });
    ports.chapterReadScope.assertStable();
    if (!before.bound || !(await ports.domState())) {
      ports.reason('volume_option_changed');
      return null;
    }
    let portalOpeningObserved = false;
    if (!before.open) {
      if (before.popupCount !== 0 || before.openCount !== 0 || !ports.budget()) {
        ports.reason('volume_options_unbound');
        return null;
      }
      // Recheck the exact same handle immediately before clicking it.
      const bound = await ports.chapterReadScope.page.evaluate(currentManagementDom, {
        mode: 'control' as const,
        control: ports.control,
        view: ports.view,
      });
      ports.chapterReadScope.assertStable();
      if (!bound.bound || bound.open || bound.popupCount !== 0 || bound.openCount !== 0) {
        ports.reason('volume_option_changed');
        return null;
      }
      if (!ports.budget()) {
        ports.reason('read_budget_exceeded');
        return null;
      }
      ports.actions += 1;
      await ports.view!.click({
        timeout: Math.max(
          1,
          Math.min(ports.chapterReadScope.timeout, ports.deadline - performance.now()),
        ),
        noWaitAfter: true,
      });
      ports.chapterReadScope.assertStable();
      if (performance.now() >= ports.deadline) {
        ports.reason('read_budget_exceeded');
        return null;
      }
      portalOpeningObserved = true;
    }
    const opened = ports.own(
      await ports.chapterReadScope.page.evaluateHandle(currentManagementDom, {
        mode: 'popup' as const,
        control: ports.control,
        view: ports.view,
        portalOpeningObserved,
      }),
    );
    ports.chapterReadScope.assertStable();
    const value = await opened.evaluate((result) => ({
      bound: result.bound,
      extent: result.extent,
      allStatus: result.allStatus,
      names:
        result.options?.map((option) => ({ name: option.name, disabled: option.disabled })) ?? [],
    }));
    ports.chapterReadScope.assertStable();
    if (
      !value.bound ||
      !value.extent ||
      !value.allStatus ||
      value.names.length !== ports.volumes.length ||
      value.names.some(
        (option) =>
          option.disabled ||
          !option.name ||
          ports.volumes.filter((volume) => volume.name === option.name).length !== 1,
      ) ||
      new Set(value.names.map((option) => option.name)).size !== value.names.length
    ) {
      ports.reason('volume_inventory_unreconciled');
      return null;
    }
    const popup = (await ports.property(opened, 'popup')).asElement();
    if (!popup) {
      ports.reason('volume_options_unbound');
      return null;
    }
    const optionArray = await ports.property(opened, 'options'),
      items = await optionArray.getProperties();
    const optionsById = new Map<string, ElementHandle<Element>>();
    for (const [index, item] of items) {
      ports.own(item);
      if (!/^\d+$/.test(index)) continue;
      const name = value.names[Number(index)]?.name,
        volume = ports.volumes.find((volume) => volume.name === name);
      const node = (
        await ports.property(item, 'node')
      ).asElement() as ElementHandle<Element> | null;
      if (!volume || !node) {
        ports.reason('volume_inventory_unreconciled');
        return null;
      }
      optionsById.set(volume.volumeId, node);
    }
    if (optionsById.size !== ports.volumes.length) {
      ports.reason('volume_inventory_unreconciled');
      return null;
    }
    ports.coverage.inventoryReconciled = true;
    ports.coverage.matchedVolumes = optionsById.size;
    return { popup, optionsById, portalOpeningObserved };
  };
}
