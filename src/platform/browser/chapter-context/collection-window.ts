import { type ChapterReadState } from './chapterReadScope.js';
export function createCloseViewWindow(chapterReadScope: Pick<ChapterReadState, 'viewWindow'>) {
  return () => {
    const window = chapterReadScope.viewWindow;
    if (window) {
      window.open = false;
      if (window.timer !== null) {
        clearTimeout(window.timer);
        window.timer = null;
      }
      window.wake?.();
    }
  };
}

export function createSourceFamiliesReady(
  chapterReadScope: Pick<ChapterReadState, 'templates' | 'bookTemplates' | 'chapterTemplates'>,
) {
  return () =>
    chapterReadScope.templates.size === 1 &&
    chapterReadScope.bookTemplates.size === 1 &&
    chapterReadScope.chapterTemplates.size === 1;
}

export function createSourceFamiliesAmbiguous(
  chapterReadScope: Pick<ChapterReadState, 'templates' | 'bookTemplates' | 'chapterTemplates'>,
) {
  return () =>
    chapterReadScope.templates.size > 1 ||
    chapterReadScope.bookTemplates.size > 1 ||
    chapterReadScope.chapterTemplates.size > 1;
}

export function createCloseCollectionSourceWindow(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'collection'
    | 'collectionSourceWindowOpen'
    | 'closeViewWindow'
    | 'collectionSourceTimer'
    | 'options'
    | 'closeCollectionSourceWindow'
    | 'page'
    | 'collectionSourceWake'
  >,
) {
  return () => {
    if (!chapterReadScope.collection) return;
    chapterReadScope.collectionSourceWindowOpen = false;
    chapterReadScope.closeViewWindow();
    if (chapterReadScope.collectionSourceTimer !== null) {
      clearTimeout(chapterReadScope.collectionSourceTimer);
      chapterReadScope.collectionSourceTimer = null;
    }
    chapterReadScope.options.signal?.removeEventListener(
      'abort',
      chapterReadScope.closeCollectionSourceWindow,
    );
    chapterReadScope.page.off('close', chapterReadScope.closeCollectionSourceWindow);
    chapterReadScope.collectionSourceWake?.();
  };
}

export function createOpenCollectionSourceWindow(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'collection'
    | 'assertStable'
    | 'collectionSourceWindowOpen'
    | 'collectionSourceDeadline'
    | 'timeout'
    | 'collectionSourceTimer'
    | 'closeCollectionSourceWindow'
    | 'options'
    | 'page'
  >,
) {
  return () => {
    if (!chapterReadScope.collection) return;
    chapterReadScope.assertStable();
    chapterReadScope.collectionSourceWindowOpen = true;
    chapterReadScope.collectionSourceDeadline = performance.now() + chapterReadScope.timeout;
    chapterReadScope.collectionSourceTimer = setTimeout(
      chapterReadScope.closeCollectionSourceWindow,
      chapterReadScope.timeout,
    );
    chapterReadScope.options.signal?.addEventListener(
      'abort',
      chapterReadScope.closeCollectionSourceWindow,
      { once: true },
    );
    chapterReadScope.page.on('close', chapterReadScope.closeCollectionSourceWindow);
  };
}

export function createCanAcquireFrozenCollectionSource(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'collection'
    | 'collectionSourceWindowOpen'
    | 'sealedCollectionSources'
    | 'collectionSourceDeadline'
    | 'closeCollectionSourceWindow'
    | 'stable'
  >,
) {
  return () => {
    if (
      !chapterReadScope.collection ||
      !chapterReadScope.collectionSourceWindowOpen ||
      chapterReadScope.sealedCollectionSources
    )
      return false;
    // A queued timer cannot extend the capture interval. No event renews it.
    if (performance.now() >= chapterReadScope.collectionSourceDeadline) {
      chapterReadScope.closeCollectionSourceWindow();
      return false;
    }
    try {
      if (chapterReadScope.stable()) return true;
    } catch {
      /* The unchanged strict guard will fail closed on resumption. */
    }
    chapterReadScope.closeCollectionSourceWindow();
    return false;
  };
}

export function createAcquireCollectionSources(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'assertStable'
    | 'collectionSourceWindowOpen'
    | 'sourceFamiliesReady'
    | 'sourceFamiliesAmbiguous'
    | 'collectionSourceWake'
    | 'stable'
    | 'closeCollectionSourceWindow'
    | 'sealedCollectionSources'
    | 'templates'
    | 'bookTemplates'
    | 'chapterTemplates'
  >,
) {
  return async () => {
    chapterReadScope.assertStable();
    if (
      chapterReadScope.collectionSourceWindowOpen &&
      !chapterReadScope.sourceFamiliesReady() &&
      !chapterReadScope.sourceFamiliesAmbiguous()
    ) {
      await new Promise<void>((resolve) => {
        chapterReadScope.collectionSourceWake = () => {
          let done = true;
          try {
            done =
              !chapterReadScope.collectionSourceWindowOpen ||
              !chapterReadScope.stable() ||
              chapterReadScope.sourceFamiliesReady() ||
              chapterReadScope.sourceFamiliesAmbiguous();
          } catch {
            /* Resolve only; the original guard decides below. */
          }
          if (done) {
            chapterReadScope.collectionSourceWake = null;
            resolve();
          }
        };
        chapterReadScope.collectionSourceWake();
      });
    }
    chapterReadScope.assertStable();
    // Stop registration before reading any business response. All three exact
    // URLs are selected atomically only after fresh typed own-before matches.
    chapterReadScope.closeCollectionSourceWindow();
    if (chapterReadScope.sourceFamiliesReady())
      chapterReadScope.sealedCollectionSources = {
        volume: [...chapterReadScope.templates][0]!,
        book: [...chapterReadScope.bookTemplates][0]!,
        chapter: [...chapterReadScope.chapterTemplates][0]!,
      };
  };
}
