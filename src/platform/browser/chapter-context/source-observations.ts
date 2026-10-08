import { type ChapterReadState } from './chapterReadScope.js';
export function createBeginSourceObservation(
  chapterReadScope: Pick<ChapterReadState, 'collection' | 'sourceObservation'>,
) {
  return () => {
    if (!chapterReadScope.collection) return false;
    if (chapterReadScope.sourceObservation.count >= 100) {
      chapterReadScope.sourceObservation.truncated = true;
      return false;
    }
    chapterReadScope.sourceObservation.count += 1;
    return true;
  };
}

import {
  type SourceObservation,
  type SourceClearObservation,
  type SourceRequestObservation,
} from './contracts.js';

export function createAppendSourceObservation(
  chapterReadScope: Pick<ChapterReadState, 'sourceObservation'>,
) {
  return (event: SourceObservation['events'][number]) => {
    if (chapterReadScope.sourceObservation.events.length < 32)
      chapterReadScope.sourceObservation.events.push(event);
    else chapterReadScope.sourceObservation.truncated = true;
  };
}

export function createRecordSourceClear(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'beginSourceObservation'
    | 'sourceSizes'
    | 'sourceObservation'
    | 'appendSourceObservation'
    | 'navigationPhase'
  >,
) {
  return (reason: SourceClearObservation['reason']) => {
    if (!chapterReadScope.beginSourceObservation()) return;
    const removed = chapterReadScope.sourceSizes();
    chapterReadScope.sourceObservation.clearCounts[reason] += 1;
    for (const family of ['volume', 'book', 'chapter'] as const)
      chapterReadScope.sourceObservation.removedTotals[family] = Math.min(
        100,
        chapterReadScope.sourceObservation.removedTotals[family] + removed[family],
      );
    chapterReadScope.appendSourceObservation({
      kind: 'clear',
      phase: chapterReadScope.navigationPhase(),
      reason,
      removed,
    });
  };
}

export function createRecordUnclassifiedSource(
  chapterReadScope: Pick<ChapterReadState, 'collection' | 'sourceObservation'>,
) {
  return () => {
    if (!chapterReadScope.collection) return;
    if (chapterReadScope.sourceObservation.unclassifiedRequests < 100)
      chapterReadScope.sourceObservation.unclassifiedRequests += 1;
    else chapterReadScope.sourceObservation.truncated = true;
  };
}

export function createRecordSourceRequest(
  chapterReadScope: Pick<
    ChapterReadState,
    | 'collection'
    | 'recordUnclassifiedSource'
    | 'beginSourceObservation'
    | 'navigationPhase'
    | 'rootFrame'
    | 'pendingNavigation'
    | 'pendingLoader'
    | 'loader'
    | 'pendingSameDocument'
    | 'committed'
    | 'frozen'
    | 'violated'
    | 'controlledGoto'
    | 'workId'
    | 'sourceObservation'
    | 'appendSourceObservation'
  >,
) {
  return (
    value: {
      url: unknown;
      method: unknown;
      type: unknown;
      frameId: unknown;
      loaderId: unknown;
    },
    outcome: SourceRequestObservation['outcome'],
  ) => {
    if (!chapterReadScope.collection) return;
    // This isolated projection uses only copied primitive strings. No raw URL,
    // query name/value or object coercion is retained or fed back into a guard.
    try {
      if (typeof value.url !== 'string') {
        chapterReadScope.recordUnclassifiedSource();
        return;
      }
      const hint = new URL(value.url);
      const familyHint =
        hint.pathname === '/api/author/volume/volume_list/v1'
          ? 'volume'
          : hint.pathname === '/api/author/book/book_detail/v0/'
            ? 'book'
            : hint.pathname === '/api/author/chapter/chapter_list/v1'
              ? 'chapter'
              : null;
      if (familyHint === null) {
        chapterReadScope.recordUnclassifiedSource();
        return;
      }
      if (!chapterReadScope.beginSourceObservation()) return;
      const parents = hint.searchParams.getAll('book_id');
      const event: SourceRequestObservation = {
        kind: 'request',
        phase: chapterReadScope.navigationPhase(),
        familyHint,
        outcome,
        method:
          typeof value.method !== 'string'
            ? 'unavailable'
            : value.method === 'GET'
              ? 'get'
              : 'other',
        resource:
          typeof value.type !== 'string'
            ? 'unavailable'
            : ['XHR', 'Fetch'].includes(value.type)
              ? 'xhr_fetch'
              : 'other',
        frame:
          typeof value.frameId !== 'string' || value.frameId.length === 0
            ? 'unavailable'
            : value.frameId === chapterReadScope.rootFrame
              ? 'root'
              : 'other',
        loader:
          typeof value.loaderId !== 'string' || value.loaderId.length === 0
            ? 'unavailable'
            : chapterReadScope.pendingNavigation &&
                value.loaderId === chapterReadScope.pendingLoader
              ? 'pending'
              : value.loaderId === chapterReadScope.loader
                ? 'current'
                : 'other',
        state: {
          pendingNewDocument: chapterReadScope.pendingNavigation,
          pendingSameDocument: chapterReadScope.pendingSameDocument,
          committed: chapterReadScope.committed,
          frozen: chapterReadScope.frozen,
          violated: chapterReadScope.violated,
          controlled: chapterReadScope.controlledGoto,
        },
        filters: {
          origin: hint.origin === 'https://fanqienovel.com' ? 'platform' : 'external',
          credentialsPresent: Boolean(hint.username || hint.password),
          fragmentPresent: Boolean(hint.hash),
          duplicateQueryKeys: new Set(hint.searchParams.keys()).size !== hint.searchParams.size,
          parentBinding:
            parents.length === 0
              ? 'missing_work'
              : parents.length !== 1
                ? 'ambiguous_work'
                : parents[0] === chapterReadScope.workId
                  ? 'current_work'
                  : 'other_work',
          identityFilter: [...hint.searchParams.keys()].some((key) =>
            /^(?:author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id|bookId|work_id|workId)$/i.test(
              key,
            ),
          ),
        },
      };
      if (outcome === 'retained_add_attempt')
        chapterReadScope.sourceObservation.retainedAttempts[familyHint] += 1;
      chapterReadScope.appendSourceObservation(event);
    } catch {
      chapterReadScope.recordUnclassifiedSource();
    }
  };
}

export function createSnapshotSourceObservation(
  chapterReadScope: Pick<ChapterReadState, 'sourceObservation' | 'sourceSizes'>,
) {
  return (): SourceObservation => ({
    count: chapterReadScope.sourceObservation.count,
    truncated: chapterReadScope.sourceObservation.truncated,
    unclassifiedRequests: chapterReadScope.sourceObservation.unclassifiedRequests,
    retainedAttempts: { ...chapterReadScope.sourceObservation.retainedAttempts },
    currentSizes: chapterReadScope.sourceSizes(),
    clearCounts: { ...chapterReadScope.sourceObservation.clearCounts },
    removedTotals: { ...chapterReadScope.sourceObservation.removedTotals },
    events: chapterReadScope.sourceObservation.events.map((event) =>
      event.kind === 'clear'
        ? { ...event, removed: { ...event.removed } }
        : { ...event, state: { ...event.state }, filters: { ...event.filters } },
    ),
  });
}
