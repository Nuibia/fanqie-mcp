import test from 'node:test';

import { writeFixture, writeFailed } from './helpers/short-native-metadata-api-write-fixture.js';

import assert from 'node:assert/strict';

// All inputs below are synthetic raw edit facts, not platform observations.
test('native metadata current status facts veto before any durable callback or POST', async (t) => {
  const cases = [
    [0, 1],
    [0, 4],
    [0, 5],
    [0, 7],
    [0, 10],
    [0, 12],
    [0, 99],
    [0, 'invalid'],
    [1, undefined],
    [1, 0],
    [1, 4],
    [1, 7],
    [1, 10],
    [1, 12],
  ] as const;
  for (const [editor, display] of cases)
    await t.test(`${editor}/${String(display)}`, async () => {
      const f = writeFixture({
        beforeMutation: (raw) => {
          raw.publish_status = editor;
          if (display !== undefined) raw.display_status = display;
        },
      });
      const observed = await f.run.run();
      writeFailed(observed, 'unsupported_schema');
      assert.equal(f.posts.length, 0);
      assert.equal(f.marks, 0);
      assert.equal(f.events.includes('held'), false);
      assert.equal(f.apiCloses, 1);
      assert.equal(f.borrowedCloses, 0);
    });
});

test('metadata ACK cannot upgrade conflicting clean-after facts to draft saved', async () => {
  const f = writeFixture({
    afterMutation: (raw) => {
      raw.display_status = 7;
    },
  });
  const observed = await f.run.run();
  writeFailed(observed, 'readback_mismatch');
  assert.equal(f.posts.length, 1);
  assert.equal(f.marks, 1);
  assert.equal(observed.post.acknowledged, true);
  assert.equal(f.apiCloses, 1);
  assert.equal(f.borrowedCloses, 0);
});
