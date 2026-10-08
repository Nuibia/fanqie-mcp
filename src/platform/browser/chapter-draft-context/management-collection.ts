import { type ElementHandle } from 'playwright';

import { PlatformReadError, parseChapterDraftPage } from '../../reads.js';

import { currentDraftDirectoryDom } from '../chapter-dom.js';

import { type ChapterReadState } from './chapterReadScope.js';
export function createCollectDraftPages(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'assertStable'
    | 'page'
    | 'chapterPagesFetched'
    | 'draftPartialReason'
    | 'workId'
    | 'collected'
    | 'draftComplete'
    | 'deadline'
    | 'options'
    | 'timeout'
    | 'viewWindow'
    | 'closeViewWindow'
    | 'stable'
  >,
) {
  return async (initialSource: string, read: (source: string) => Promise<unknown>) => {
    const handles: Array<{
        dispose(): Promise<void>;
      }> = [],
      seen = new Set<string>();
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
    const state = async () => {
      chapterReadScope.assertStable();
      const value = await chapterReadScope.page.evaluate(currentDraftDirectoryDom, {
        mode: 'state' as const,
      });
      chapterReadScope.assertStable();
      return value.ready === true && value.activeDraft === true;
    };
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
        throw new PlatformReadError(
          'chapter_draft_query_unverified',
          'The natural draft source lacks canonical page fields',
        );
      return { index: Number(index[0]), capacity: Number(count[0]) };
    };
    let source = initialSource,
      query = pageQuery(initialSource),
      total: number | null = null,
      actions = 0;
    if (query.index !== 0)
      throw new PlatformReadError(
        'chapter_draft_first_page_unverified',
        'The actual initial draft source is not page zero',
      );
    try {
      while (true) {
        chapterReadScope.assertStable();
        if (chapterReadScope.chapterPagesFetched >= 64) {
          chapterReadScope.draftPartialReason = 'chapter_draft_page_limit';
          return;
        }
        if (!(await state()))
          throw new PlatformReadError(
            'chapter_draft_ui_unverified',
            'The actual draft-list scope is unavailable',
          );
        const snapshot = parseChapterDraftPage(await read(source), chapterReadScope.workId);
        chapterReadScope.assertStable();
        if (!(await state()))
          throw new PlatformReadError(
            'chapter_draft_ui_unverified',
            'The actual draft-list scope changed during reading',
          );
        if (
          (total !== null && snapshot.total !== total) ||
          snapshot.records.length > query.capacity ||
          (chapterReadScope.collected &&
            chapterReadScope.collected.records.length + snapshot.records.length > snapshot.total) ||
          (chapterReadScope.chapterPagesFetched > 0 && snapshot.records.length === 0)
        )
          throw new PlatformReadError(
            'chapter_draft_total_mismatch',
            'Draft page totals or extents changed',
          );
        total ??= snapshot.total;
        for (const row of snapshot.records) {
          if (seen.has(row.draftId))
            throw new PlatformReadError(
              'chapter_draft_id_missing_or_duplicate',
              'Draft IDs repeated across pages',
            );
          seen.add(row.draftId);
        }
        if (!chapterReadScope.collected) chapterReadScope.collected = { records: [], total };
        chapterReadScope.collected.records.push(...snapshot.records);
        chapterReadScope.chapterPagesFetched += 1;
        if (chapterReadScope.collected.records.length > 100000)
          throw new PlatformReadError(
            'chapter_draft_extent_exceeded',
            'The draft directory exceeds its record budget',
          );
        if (chapterReadScope.collected.records.length === total) {
          chapterReadScope.assertStable();
          if (!(await state()))
            throw new PlatformReadError(
              'chapter_draft_ui_unverified',
              'The final draft scope was not observed',
            );
          chapterReadScope.draftComplete = true;
          return;
        }
        if (actions >= 64 || chapterReadScope.chapterPagesFetched >= 64) {
          chapterReadScope.draftPartialReason = 'chapter_draft_page_limit';
          return;
        }
        let next: ElementHandle<Element> | null = null;
        const nextDeadline = Math.min(chapterReadScope.deadline, performance.now() + 2500);
        while (performance.now() < nextDeadline) {
          chapterReadScope.assertStable();
          if (!(await state()))
            throw new PlatformReadError(
              'chapter_draft_ui_unverified',
              'The draft scope changed while waiting for its next control',
            );
          const binding = own(
            await chapterReadScope.page.evaluateHandle(currentDraftDirectoryDom, {
              mode: 'next' as const,
            }),
          );
          chapterReadScope.assertStable();
          const property = own(await binding.getProperty('next'));
          chapterReadScope.assertStable();
          const candidate = property.asElement() as ElementHandle<Element> | null;
          if (!(await state()))
            throw new PlatformReadError(
              'chapter_draft_ui_unverified',
              'The draft scope changed while binding its next control',
            );
          if (performance.now() >= nextDeadline) break;
          if (candidate) {
            next = candidate;
            break;
          }
          await new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const done = () => {
              if (timer !== null) clearTimeout(timer);
              chapterReadScope.options.signal?.removeEventListener('abort', done);
              chapterReadScope.page.off('close', done);
              resolve();
            };
            chapterReadScope.options.signal?.addEventListener('abort', done, { once: true });
            chapterReadScope.page.on('close', done);
            timer = setTimeout(done, Math.max(1, Math.min(75, nextDeadline - performance.now())));
            if (chapterReadScope.options.signal?.aborted || chapterReadScope.page.isClosed())
              done();
          });
          chapterReadScope.assertStable();
        }
        if (!next) {
          chapterReadScope.assertStable();
          chapterReadScope.draftPartialReason = 'chapter_draft_next_unavailable';
          return;
        }
        const window = {
          deadline: Math.min(
            chapterReadScope.deadline,
            performance.now() + chapterReadScope.timeout,
          ),
          sources: new Set<string>(),
          requestIds: new Set<string>(),
          open: true,
          actionStarted: false,
          exhausted: false,
          timer: null as ReturnType<typeof setTimeout> | null,
          wake: null as (() => void) | null,
        };
        chapterReadScope.viewWindow = window;
        const terminate = () => chapterReadScope.closeViewWindow();
        chapterReadScope.options.signal?.addEventListener('abort', terminate, { once: true });
        chapterReadScope.page.on('close', terminate);
        window.timer = setTimeout(terminate, Math.max(1, window.deadline - performance.now()));
        try {
          if (!(await state()))
            throw new PlatformReadError(
              'chapter_draft_ui_unverified',
              'The draft scope changed before the next action',
            );
          const bound = await chapterReadScope.page.evaluate(currentDraftDirectoryDom, {
            mode: 'next' as const,
            next,
          });
          chapterReadScope.assertStable();
          if (!bound.bound || !bound.ready)
            throw new PlatformReadError(
              'chapter_draft_next_changed',
              'The original draft next control changed',
            );
          chapterReadScope.assertStable();
          if (!window.open || performance.now() >= window.deadline) {
            chapterReadScope.draftPartialReason = 'chapter_draft_view_source_missing';
            return;
          }
          window.actionStarted = true;
          actions += 1;
          await next.click({
            timeout: Math.max(
              1,
              Math.min(chapterReadScope.timeout, chapterReadScope.deadline - performance.now()),
            ),
            noWaitAfter: true,
          });
          chapterReadScope.assertStable();
          if (window.open && window.sources.size === 0)
            await new Promise<void>((resolve) => {
              window.wake = () => {
                if (!window.open || window.sources.size > 0 || !chapterReadScope.stable())
                  resolve();
              };
              window.wake();
            });
          chapterReadScope.assertStable();
          chapterReadScope.closeViewWindow();
          if (window.exhausted || window.sources.size > 1)
            throw new PlatformReadError(
              'chapter_draft_view_source_ambiguous',
              'The natural draft view source is ambiguous',
            );
          if (window.sources.size !== 1) {
            chapterReadScope.draftPartialReason = 'chapter_draft_view_source_missing';
            return;
          }
          source = [...window.sources][0]!;
          const nextQuery = pageQuery(source);
          if (nextQuery.index !== query.index + 1 || nextQuery.capacity !== query.capacity)
            throw new PlatformReadError(
              'chapter_draft_query_unverified',
              'The natural draft next source skipped or changed its page scope',
            );
          query = nextQuery;
        } finally {
          chapterReadScope.closeViewWindow();
          chapterReadScope.options.signal?.removeEventListener('abort', terminate);
          chapterReadScope.page.off('close', terminate);
          window.wake = null;
          window.requestIds.clear();
          chapterReadScope.viewWindow = null;
        }
      }
    } finally {
      chapterReadScope.closeViewWindow();
      const disposed = await Promise.allSettled(handles.map((handle) => handle.dispose()));
      chapterReadScope.assertStable();
      if (disposed.some((result) => result.status === 'rejected'))
        throw new PlatformReadError(
          'chapter_draft_handle_disposal_failed',
          'Draft list controls could not be released',
        );
    }
  };
}
