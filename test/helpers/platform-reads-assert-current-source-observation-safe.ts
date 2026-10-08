import {
  type SourceObservationFixture,
  CURRENT_CHAPTER_ITEM,
  CURRENT_CHAPTER_VOLUME,
} from './platform-reads-assert-context-probe-safe.js';

import assert from 'node:assert/strict';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './platform-reads-chapter-entry-fixture-work.js';

export function assertCurrentSourceObservationSafe(value: SourceObservationFixture) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'count',
      'truncated',
      'unclassifiedRequests',
      'retainedAttempts',
      'currentSizes',
      'clearCounts',
      'removedTotals',
      'events',
    ].sort(),
  );
  assert.ok(value.count >= 0 && value.count <= 100);
  assert.ok(value.unclassifiedRequests >= 0 && value.unclassifiedRequests <= 100);
  assert.ok(value.events.length <= 32);
  assert.ok(value.events.length <= value.count);
  for (const counts of [value.retainedAttempts, value.currentSizes, value.removedTotals]) {
    assert.deepEqual(Object.keys(counts).sort(), ['volume', 'book', 'chapter'].sort());
    for (const count of Object.values(counts))
      assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 100);
  }
  assert.ok(Object.values(value.currentSizes).every((count) => count <= 2));
  for (const event of value.events) {
    assert.ok(['bootstrap', 'frozen', 'cleanup'].includes(event.phase));
    if (event.kind === 'clear') {
      assert.deepEqual(Object.keys(event).sort(), ['kind', 'phase', 'reason', 'removed'].sort());
      assert.ok(Object.values(event.removed).every((count) => count >= 0 && count <= 2));
    } else {
      assert.deepEqual(
        Object.keys(event).sort(),
        [
          'kind',
          'phase',
          'familyHint',
          'outcome',
          'method',
          'resource',
          'frame',
          'loader',
          'state',
          'filters',
        ].sort(),
      );
      assert.ok(Object.values(event.state).every((value) => typeof value === 'boolean'));
    }
  }
  for (const secret of [
    'PRIVATE_',
    'SYNTHETIC_',
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    CURRENT_CHAPTER_ITEM,
    CURRENT_CHAPTER_VOLUME,
    'https://',
    '?',
    'opaque_fixture',
    'book_id',
    'author_id',
    'rawUrl',
    'sourceUrl',
    'headers',
    'payload',
  ])
    assert.equal(JSON.stringify(value).includes(secret), false);
}
