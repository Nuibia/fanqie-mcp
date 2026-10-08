import { type ElementHandle, type JSHandle } from 'playwright';
import {
  type ChapterRecord,
  PlatformReadError,
  type ChapterManagementCoverage,
  parseChapterPage,
} from '../../reads.js';

import { currentManagementDom, currentManagementNextObservation } from '../chapter-dom.js';
import { type ChapterReadState } from './chapterReadScope.js';

interface Ports {
  volumes: (import('../../reads.js').ChapterVolume & { index: number; name: string })[];
  budget: () => boolean;
  reason: (code: ChapterManagementCoverage['reasons'][number]) => void;
  read: (source: string) => Promise<unknown>;
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
  deadline: number;
  seen: Set<string>;
  pageQuery: (source: string) => { index: number; capacity: number } | null;
  coverage: ChapterManagementCoverage;
  domState: (volumeId?: string) => Promise<boolean>;
  own: <T extends { dispose(): Promise<void> }>(handle: T) => T;
  property: (handle: JSHandle, name: string) => Promise<JSHandle<any>>;
  acquireView: (
    volumeId: string,
    click: (activate: () => boolean) => Promise<void>,
  ) => Promise<string | null>;
}
export function createReadManagementVolume(ports: Ports) {
  return async (
    volumeId: string,
    source: string,
    first: {
      records: ChapterRecord[];
      total: number;
    } | null,
  ) => {
    const volume = ports.volumes.find((volume) => volume.volumeId === volumeId)!;
    if (!ports.budget()) {
      ports.reason('read_budget_exceeded');
      return false;
    }
    let snapshot =
      first ?? parseChapterPage(await ports.read(source), ports.chapterReadScope.workId, volumeId);
    if (performance.now() >= ports.deadline) {
      ports.reason('read_budget_exceeded');
      return false;
    }
    if (
      !first &&
      ports.chapterReadScope.collected!.records.length + snapshot.records.length > 100000
    )
      throw new PlatformReadError(
        'chapter_management_extent_exceeded',
        'The observed management extent exceeds this read budget',
      );
    if (!first) {
      ports.chapterReadScope.chapterPagesFetched += 1;
      for (const record of snapshot.records) {
        if (ports.seen.has(record.chapterId))
          throw new PlatformReadError(
            'chapter_id_missing_or_duplicate',
            'Chapter IDs repeated across views',
          );
        ports.seen.add(record.chapterId);
        ports.chapterReadScope.collected!.records.push(record);
      }
    }
    let count = snapshot.records.length,
      query = ports.pageQuery(source),
      total = snapshot.total;
    ports.coverage.pagesFetched = ports.chapterReadScope.chapterPagesFetched;
    ports.coverage.recordsFetched = ports.chapterReadScope.collected!.records.length;
    if (!query || count > query.capacity) {
      ports.reason('pagination_query_unverified');
      return false;
    }
    if (total !== volume.itemCount) {
      ports.reason('volume_count_mismatch');
      return false;
    }
    while (count < total) {
      if (!ports.budget()) {
        ports.reason('read_budget_exceeded');
        return false;
      }
      if (!(await ports.domState(volumeId))) {
        ports.reason('management_ui_unverified');
        return false;
      }
      // The natural request can precede its page response and pager render.
      // Wait only for the existing exact control; no source/GET is retried.
      const nextDeadline = Math.min(ports.deadline, performance.now() + 2500);
      let next: ElementHandle<Element> | null = null;
      while (performance.now() < nextDeadline) {
        if (!ports.budget()) {
          ports.reason('read_budget_exceeded');
          return false;
        }
        if (!(await ports.domState(volumeId))) {
          ports.reason('management_ui_unverified');
          return false;
        }
        const binding = ports.own(
          await ports.chapterReadScope.page.evaluateHandle(currentManagementDom, {
            mode: 'next' as const,
          }),
        );
        ports.chapterReadScope.assertStable();
        const candidate = (
          await ports.property(binding, 'next')
        ).asElement() as ElementHandle<Element> | null;
        if (!(await ports.domState(volumeId))) {
          ports.reason('management_ui_unverified');
          return false;
        }
        if (performance.now() >= ports.deadline) {
          ports.reason('read_budget_exceeded');
          return false;
        }
        if (performance.now() >= nextDeadline) break;
        if (candidate) {
          next = candidate;
          break;
        }
        // Resolve-only cancellation leaves no abandoned rejecting promise.
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const done = () => {
            if (timer !== null) clearTimeout(timer);
            ports.chapterReadScope.options.signal?.removeEventListener('abort', done);
            ports.chapterReadScope.page.off('close', done);
            resolve();
          };
          ports.chapterReadScope.options.signal?.addEventListener('abort', done, { once: true });
          ports.chapterReadScope.page.on('close', done);
          timer = setTimeout(done, Math.max(1, Math.min(75, nextDeadline - performance.now())));
          if (
            ports.chapterReadScope.options.signal?.aborted ||
            ports.chapterReadScope.page.isClosed()
          )
            done();
        });
        ports.chapterReadScope.assertStable();
        if (!(await ports.domState(volumeId))) {
          ports.reason('management_ui_unverified');
          return false;
        }
      }
      if (!next) {
        if (performance.now() >= ports.deadline) {
          ports.reason('read_budget_exceeded');
          return false;
        }
        if (!(await ports.domState(volumeId))) {
          ports.reason('management_ui_unverified');
          return false;
        }
        try {
          const observed = await ports.chapterReadScope.page.evaluate(
            currentManagementNextObservation,
          );
          ports.chapterReadScope.assertStable();
          if (performance.now() >= ports.deadline) {
            ports.reason('read_budget_exceeded');
            return false;
          }
          if (await ports.domState(volumeId))
            ports.chapterReadScope.managementControlObservation = observed;
          else {
            ports.reason('management_ui_unverified');
            return false;
          }
        } catch {
          ports.chapterReadScope.assertStable();
        }
        ports.reason('next_unavailable');
        return false;
      }
      const nextSource = await ports.acquireView(volumeId, async (activate) => {
        const current = await ports.chapterReadScope.page.evaluate(currentManagementDom, {
          mode: 'next' as const,
          next,
        });
        ports.chapterReadScope.assertStable();
        if (!current.bound || !current.allStatus)
          throw new PlatformReadError(
            'chapter_next_control_changed',
            'The observed next-page control changed',
          );
        if (!activate()) return;
        await next.click({
          timeout: Math.max(
            1,
            Math.min(ports.chapterReadScope.timeout, ports.deadline - performance.now()),
          ),
          noWaitAfter: true,
        });
      });
      if (!nextSource) return false;
      const nextQuery = ports.pageQuery(nextSource);
      if (
        !nextQuery ||
        nextQuery.index <= query.index ||
        nextQuery.capacity !== query.capacity ||
        new URL(nextSource).searchParams.get('volume_id') !== volumeId
      ) {
        ports.reason('pagination_query_unverified');
        return false;
      }
      if (performance.now() >= ports.deadline) {
        ports.reason('read_budget_exceeded');
        return false;
      }
      snapshot = parseChapterPage(
        await ports.read(nextSource),
        ports.chapterReadScope.workId,
        volumeId,
      );
      if (performance.now() >= ports.deadline) {
        ports.reason('read_budget_exceeded');
        return false;
      }
      ports.chapterReadScope.chapterPagesFetched += 1;
      if (
        snapshot.total !== total ||
        snapshot.records.length === 0 ||
        snapshot.records.length > nextQuery.capacity ||
        count + snapshot.records.length > total
      )
        throw new PlatformReadError(
          'chapter_total_count_mismatch',
          'The chapter page total or page extent changed',
        );
      for (const record of snapshot.records) {
        if (ports.seen.has(record.chapterId))
          throw new PlatformReadError(
            'chapter_id_missing_or_duplicate',
            'Chapter IDs repeated across pages',
          );
        ports.seen.add(record.chapterId);
        ports.chapterReadScope.collected!.records.push(record);
      }
      if (ports.chapterReadScope.collected!.records.length > 100000)
        throw new PlatformReadError(
          'chapter_management_extent_exceeded',
          'The observed management extent exceeds this read budget',
        );
      count += snapshot.records.length;
      query = nextQuery;
      ports.coverage.pagesFetched = ports.chapterReadScope.chapterPagesFetched;
      ports.coverage.recordsFetched = ports.chapterReadScope.collected!.records.length;
      if (!(await ports.domState(volumeId))) {
        ports.reason('management_ui_unverified');
        return false;
      }
    }
    if (!(await ports.domState(volumeId))) {
      ports.reason('management_ui_unverified');
      return false;
    }
    ports.coverage.completedVolumes += 1;
    ports.coverage.status = 'partial';
    return true;
  };
}
