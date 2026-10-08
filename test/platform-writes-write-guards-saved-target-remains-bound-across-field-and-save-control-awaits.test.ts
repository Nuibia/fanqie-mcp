import test from 'node:test';

import { mkdtemp, writeFile, rm } from 'node:fs/promises';

import path from 'node:path';

import os from 'node:os';

import { createHash } from 'node:crypto';

import {
  WriteGuardFixturePage,
  writeGuardScope,
} from './helpers/platform-writes-chapter-creation-profile.js';

import assert from 'node:assert/strict';

import {
  readWriteSnapshot,
  type DraftContent,
  updateDraft,
  hashDraftContent,
  saveChapterDraft,
  prepareSubmission,
  submitShortStory,
  publishChapter,
  type WriteTarget,
  createDraft,
} from '../src/platform/writes.js';

import {
  accountId,
  rejectsCode,
  content,
  workId,
  chapterId,
  createdId,
} from './helpers/platform-writes-fixture-page.js';

test('write guards: saved target remains bound across field and save control awaits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanqie-write-guards-cover-'));
  try {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(root, 'cover.png'), bytes);
    for (const kind of ['short', 'chapter'] as const) {
      const readPage = new WriteGuardFixturePage();
      const readScope = writeGuardScope(kind, readPage);
      readPage.afterAwait = (event) => {
        if (event === 'evaluate:#trial') readPage.moveToOtherTarget(kind);
      };
      await assert.rejects(
        readWriteSnapshot(
          readPage.asPage(),
          accountId,
          readScope.currentTarget,
          readScope.currentOptions,
        ),
        rejectsCode('version_conflict'),
      );
      assert.equal(readPage.actions.length, 0);
      for (const boundary of [
        'visible:#title',
        'action:fill:#title',
        'visible:#body',
        'visible:#description',
        'visible:#ai-yes',
        'visible:#ai-checkbox',
        'visible:#categories',
        'visible:#trial',
        'visible:#cover',
        'visible:button:存草稿',
      ]) {
        const page = new WriteGuardFixturePage();
        const scope = writeGuardScope(kind, page);
        let supplied: DraftContent = {
          ...content,
          title: 'Guard changed title',
          body: 'Guard changed body',
          metadata: {
            description: 'Guard changed description',
            aiDeclaration: 'yes',
            categories: ['other-category'],
            trialRatio: 50,
          },
        };
        if (boundary === 'visible:#ai-checkbox')
          scope.currentProfile.fields!.aiDeclaration = {
            kind: 'checkbox',
            selector: { css: '#ai-checkbox' },
            values: { yes: true, no: false },
          };
        if (boundary === 'visible:#cover') {
          scope.currentProfile.fields!.cover = {
            kind: 'upload',
            selector: { css: '#cover' },
            readHash: { selector: { css: '#cover-hash' } },
          };
          page.records.get(kind === 'short' ? workId : chapterId)!.content.metadata!.cover = '';
          supplied = {
            ...supplied,
            metadata: { ...supplied.metadata, cover: { uploadPath: 'cover.png', sha256: digest } },
          };
        }
        const baselineContent = page.records.get(kind === 'short' ? workId : chapterId)!.content;
        let armed = false;
        let shifted = false;
        let atShift = -1;
        page.afterAwait = (event) => {
          if (armed && !shifted && event === boundary) {
            shifted = true;
            atShift = page.actions.length;
            page.moveToOtherTarget(kind);
          }
        };
        const saveOptions = {
          ...scope.currentOptions,
          uploadRoot: root,
          beforeSideEffect: async () => {
            armed = true;
          },
        };
        const result =
          kind === 'short'
            ? await updateDraft(
                page.asPage(),
                {
                  accountId,
                  target: scope.currentTarget,
                  expectedContentHash: hashDraftContent(baselineContent),
                  expectedState: 'draft',
                  content: supplied,
                },
                saveOptions,
              )
            : await saveChapterDraft(
                page.asPage(),
                {
                  accountId,
                  workId,
                  chapterId,
                  expectedContentHash: hashDraftContent(baselineContent),
                  expectedState: 'draft',
                  content: supplied,
                },
                saveOptions,
              );
        assert.equal(shifted, true);
        assert.equal(result.status, 'uncertain');
        assert.equal(result.code, 'outcome_unknown');
        assert.equal(
          result.target?.workId === scope.currentTarget.workId &&
            result.target?.chapterId === scope.currentTarget.chapterId,
          true,
        );
        assert.equal(page.actions.length - atShift, 0);
        assert.equal(page.clicks.length, 0);
        assert.equal(hashDraftContent(page.data.content) === hashDraftContent(content), true);
        assert.equal(page.gotoCalls.length, 1);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('write guards: prepared and submitted versions cannot cross a typed target await', async () => {
  for (const kind of ['short', 'chapter'] as const) {
    const prepPage = new WriteGuardFixturePage();
    const prepScope = writeGuardScope(kind, prepPage);
    prepPage.afterAwait = (event) => {
      if (event === 'text:#terms') prepPage.moveToOtherTarget(kind);
    };
    const input = {
      accountId,
      target: prepScope.currentTarget,
      expectedContentHash: hashDraftContent(content),
      expectedState: 'draft' as const,
    };
    await assert.rejects(
      prepareSubmission(prepPage.asPage(), input, prepScope.currentOptions),
      rejectsCode('version_conflict'),
    );
    assert.equal(prepPage.actions.length, 0);
    for (const boundary of [
      'text:#prompt',
      'visible:button:下一步',
      'action:click:button:下一步',
      'visible:#publication-agreement',
      'action:check:#publication-agreement',
      'visible:button:确认提交',
    ]) {
      const page = new WriteGuardFixturePage();
      const scope = writeGuardScope(kind, page);
      const preparedInput = { ...input, target: scope.currentTarget };
      const prepared = await prepareSubmission(page.asPage(), preparedInput, scope.currentOptions);
      let armed = false;
      let shifted = false;
      let atShift = -1;
      page.afterAwait = (event) => {
        if (armed && !shifted && event === boundary) {
          shifted = true;
          atShift = page.actions.length;
          page.moveToOtherTarget(kind);
        }
      };
      const submitOptions = {
        ...scope.currentOptions,
        beforeSideEffect: async () => {
          armed = true;
        },
      };
      const result = await (kind === 'short' ? submitShortStory : publishChapter)(
        page.asPage(),
        { ...preparedInput, prepared, acceptPublicationTerms: true },
        submitOptions,
      );
      assert.equal(shifted, true);
      assert.equal(result.status, 'uncertain');
      assert.equal(result.code, 'outcome_unknown');
      assert.equal(page.actions.length - atShift, 0);
      assert.equal(page.clicks.includes('button:确认提交'), false);
      assert.equal(
        result.target?.workId === scope.currentTarget.workId &&
          result.target?.chapterId === scope.currentTarget.chapterId,
        true,
      );
      assert.equal(page.gotoCalls.length, 2);
    }
  }
});

test('write guards: creation intent and discovered ID survive a later target drift without replay', async () => {
  for (const kind of ['short', 'chapter'] as const) {
    for (const boundary of [
      'target_recorded',
      'expected_intent',
      'action:fill:#title',
      'visible:button:存草稿',
    ]) {
      const page = new WriteGuardFixturePage();
      const scope = writeGuardScope(kind, page);
      const events: string[] = [];
      let shifted = false;
      let atShift = -1;
      let armed = false;
      const shift = () => {
        shifted = true;
        atShift = page.actions.length;
        page.moveToOtherTarget(kind);
      };
      page.afterAwait = (event) => {
        if (armed && !shifted && event === boundary) shift();
      };
      const createOptions = {
        ...scope.currentOptions,
        beforeSideEffect: async (intent: { target?: WriteTarget }) => {
          events.push(intent.target ? 'expected' : 'intent');
          if (intent.target) {
            armed = true;
            if (boundary === 'expected_intent') shift();
          }
        },
        onTargetDiscovered: async (discovered: WriteTarget) => {
          assert.equal(page.actions.length, 0);
          assert.equal(discovered.workId === (kind === 'short' ? createdId : workId), true);
          assert.equal(discovered.chapterId === (kind === 'chapter' ? createdId : undefined), true);
          events.push('target');
          if (boundary === 'target_recorded') shift();
        },
      };
      const result =
        kind === 'short'
          ? await createDraft(
              page.asPage(),
              { accountId, clientReference: 'write-guard-created-short', content },
              createOptions,
            )
          : await saveChapterDraft(
              page.asPage(),
              { accountId, workId, clientReference: 'write-guard-created-chapter', content },
              createOptions,
            );
      assert.equal(shifted, true);
      assert.equal(result.status, 'uncertain');
      assert.equal(result.code, 'outcome_unknown');
      assert.equal(page.actions.length - atShift, 0);
      assert.equal(page.clicks.length, 0);
      assert.deepEqual(
        events,
        boundary === 'target_recorded' ? ['intent', 'target'] : ['intent', 'target', 'expected'],
      );
      assert.equal(result.target?.workId === (kind === 'short' ? createdId : workId), true);
      assert.equal(result.target?.chapterId === (kind === 'chapter' ? createdId : undefined), true);
      assert.equal(page.records.has(createdId), true);
      assert.equal(page.gotoCalls.length, 1);
    }
  }
});
