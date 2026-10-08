import { type ChapterReadState } from './chapterReadScope.js';
export function createClearTemplates(
  chapterReadScope: Pick<ChapterReadState, 'templates' | 'bookTemplates' | 'chapterTemplates'>,
) {
  return () => {
    chapterReadScope.templates.clear();
    chapterReadScope.bookTemplates.clear();
    chapterReadScope.chapterTemplates.clear();
  };
}

import { currentChapterObservedReason } from '../chapter-dom.js';

export function createRecordCollectionFailureStage(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'diagnostic'
    | 'collection'
    | 'collectionFailureStageRecorded'
    | 'collectionStage'
    | 'snapshotCanonicalBootstrap'
    | 'snapshotSourceObservation'
  >,
) {
  return (observedReason: unknown = chapterReadScope.diagnostic.reason) => {
    if (chapterReadScope.collection && !chapterReadScope.collectionFailureStageRecorded) {
      chapterReadScope.collection.failureMetadata.failedStage = chapterReadScope.collectionStage;
      chapterReadScope.collection.failureMetadata.observedReason =
        currentChapterObservedReason(observedReason);
      chapterReadScope.collection.failureMetadata.canonicalBootstrap =
        chapterReadScope.collectionStage === 'canonical_bootstrap'
          ? chapterReadScope.snapshotCanonicalBootstrap()
          : null;
      chapterReadScope.collection.failureMetadata.sourceObservation =
        chapterReadScope.snapshotSourceObservation();
      chapterReadScope.collectionFailureStageRecorded = true;
    }
  };
}

export function createClearBootstrapSources(
  chapterReadScope: Pick<ChapterReadState, 'clearTemplates' | 'requestIds'>,
) {
  return () => {
    chapterReadScope.clearTemplates();
    chapterReadScope.requestIds.clear();
  };
}
