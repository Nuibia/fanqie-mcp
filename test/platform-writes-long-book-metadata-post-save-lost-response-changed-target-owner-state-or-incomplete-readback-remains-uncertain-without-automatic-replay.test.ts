import test from 'node:test';

import {
  BookMetadataFixturePage,
  bookWrites,
  bookInput,
  bookOptions,
  bookTarget,
  WriteGuardFixturePage,
  writeGuardScope,
} from './helpers/platform-writes-chapter-creation-profile.js';

import {
  workId,
  chapterId,
  accountId,
  content,
  rejectsCode,
} from './helpers/platform-writes-fixture-page.js';

import assert from 'node:assert/strict';

import { readWriteSnapshot, hashDraftContent } from '../src/platform/writes.js';

test('long-book metadata post-save lost response, changed target/owner/state or incomplete readback remains uncertain without automatic replay', async () => {
  for (const mode of ['after_first_fill', 'during_save_resolve', 'during_field_resolve'] as const) {
    const page = new BookMetadataFixturePage();
    let savesResolved = 0,
      descriptionsResolved = 0;
    if (mode === 'after_first_fill')
      page.onFilled = (key) => {
        if (key === '#title') page.currentUrl = page.currentUrl.replace(workId, chapterId);
      };
    if (mode === 'during_save_resolve')
      page.onResolved = (key) => {
        if (key === 'button:存草稿' && ++savesResolved === 2)
          page.currentUrl = page.currentUrl.replace(workId, chapterId);
      };
    if (mode === 'during_field_resolve')
      page.onResolved = (key) => {
        if (key === '#description' && ++descriptionsResolved === 3)
          page.currentUrl = page.currentUrl.replace(workId, chapterId);
      };
    const result = await bookWrites.updateLongBookMetadata(
      page.asPage(),
      bookInput({ title: 'Changed work title' }),
      bookOptions,
    );
    assert.equal(result.status, 'uncertain');
    assert.equal(page.clicks.length, 0);
    assert.equal('metadataHash' in result, false);
    if (mode === 'during_save_resolve') assert.deepEqual(page.fills, ['#title', '#description']);
    else assert.deepEqual(page.fills, ['#title']);
  }
  for (const mode of ['lost', 'owner', 'target', 'state', 'missing', 'subset'] as const) {
    const page = new BookMetadataFixturePage();
    let intents = 0;
    if (mode === 'lost') page.failAfterSave = true;
    else
      page.onReopen = () => {
        if (page.gotoCalls.length < 2) return;
        if (mode === 'owner') page.account = '1002';
        if (mode === 'target') page.currentUrl = page.currentUrl.replace(workId, chapterId);
        if (mode === 'state') page.records.get(workId)!.state = 'published';
        if (mode === 'missing') page.missing.add('#description');
        if (mode === 'subset') page.records.get(workId)!.content.metadata!.aiDeclaration = 'yes';
      };
    const result = await bookWrites.updateLongBookMetadata(page.asPage(), bookInput(), {
      ...bookOptions,
      beforeSideEffect: async () => {
        intents++;
      },
    });
    assert.equal(result.status, 'uncertain');
    assert.equal(result.code, 'outcome_unknown');
    assert.equal('metadataHash' in result, false);
    assert.equal('contentHash' in result, false);
    assert.equal(intents, 1);
    assert.equal(page.clicks.length, 1);
    assert.equal(page.metadataReads.includes('#body'), false);
    if (mode === 'lost') {
      page.failAfterSave = false;
      const later = await bookWrites.readLongBookMetadataSnapshot(
        page.asPage(),
        accountId,
        bookTarget,
        bookOptions,
      );
      assert.equal(
        later.metadataHash,
        bookWrites.hashLongBookMetadata({
          title: content.title,
          metadata: { ...content.metadata, description: 'Changed work description' },
        }),
      );
      assert.equal(page.clicks.length, 1);
    }
  }
});

test('write guards: trial ratio needs a complete scalar observation before snapshot versioning', async () => {
  for (const kind of ['short', 'chapter'] as const) {
    for (const token of [
      '',
      ' ',
      '\t',
      '0 ',
      '0\n',
      '.5',
      '1e1',
      '+0',
      '-0',
      '101',
      'NaN',
      '0x10',
    ]) {
      const page = new WriteGuardFixturePage();
      const scope = writeGuardScope(kind, page);
      scope.currentProfile.fields = {
        trialRatio: { kind: 'text', selector: { css: '#trial-token' } },
      };
      page.trialToken = token;
      await assert.rejects(
        readWriteSnapshot(page.asPage(), accountId, scope.currentTarget, scope.currentOptions),
        rejectsCode('capability_unavailable'),
      );
      assert.equal(page.actions.length, 0);
    }
    const rejectedSelections: {
      raw: string[];
      values: Record<string, string>;
      multiple?: boolean;
    }[] = [
      { raw: [], values: { 0: '0' } },
      { raw: [''], values: { 0: '' } },
      { raw: [' '], values: { 0: ' ' } },
      { raw: ['30', '30'], values: { 30: '30' } },
      { raw: ['30', '50'], values: { 30: '30', 50: '50' } },
      { raw: ['30'], values: { 30: 'different' } },
      { raw: ['same'], values: { 0: 'same', 30: 'same' } },
      { raw: ['0'], values: { 0: '0' }, multiple: true },
    ];
    for (const selection of rejectedSelections) {
      const page = new WriteGuardFixturePage();
      const scope = writeGuardScope(kind, page);
      scope.currentProfile.fields = {
        trialRatio: {
          kind: 'select',
          selector: { css: '#trial' },
          values: selection.values,
          multiple: selection.multiple,
        },
      };
      page.trialOptions = selection.raw;
      await assert.rejects(
        readWriteSnapshot(page.asPage(), accountId, scope.currentTarget, scope.currentOptions),
        rejectsCode('capability_unavailable'),
      );
      assert.equal(page.actions.length, 0);
    }
    for (const token of ['0', '0.5', '100']) {
      const page = new WriteGuardFixturePage();
      const scope = writeGuardScope(kind, page);
      scope.currentProfile.fields = {
        trialRatio: { kind: 'text', selector: { css: '#trial-token' } },
      };
      page.trialToken = token;
      const snapshot = await readWriteSnapshot(
        page.asPage(),
        accountId,
        scope.currentTarget,
        scope.currentOptions,
      );
      assert.equal(snapshot.metadata?.trialRatio, Number(token));
      assert.equal(
        snapshot.contentHash ===
          hashDraftContent({ ...content, metadata: { trialRatio: Number(token) } }),
        true,
      );
    }
    const page = new WriteGuardFixturePage();
    const scope = writeGuardScope(kind, page);
    scope.currentProfile.fields = {
      trialRatio: { kind: 'select', selector: { css: '#trial' }, values: { 0: 'platform-zero' } },
    };
    page.trialOptions = ['platform-zero'];
    assert.equal(
      (await readWriteSnapshot(page.asPage(), accountId, scope.currentTarget, scope.currentOptions))
        .metadata?.trialRatio,
      0,
    );
    const checkboxPage = new WriteGuardFixturePage();
    const checkboxScope = writeGuardScope(kind, checkboxPage);
    checkboxScope.currentProfile.fields = {
      trialRatio: {
        kind: 'checkbox',
        selector: { css: '#trial-checked' },
        values: { 0: false, 100: true },
      },
    };
    assert.equal(
      (
        await readWriteSnapshot(
          checkboxPage.asPage(),
          accountId,
          checkboxScope.currentTarget,
          checkboxScope.currentOptions,
        )
      ).metadata?.trialRatio,
      0,
    );
    checkboxPage.trialChecked = undefined;
    await assert.rejects(
      readWriteSnapshot(
        checkboxPage.asPage(),
        accountId,
        checkboxScope.currentTarget,
        checkboxScope.currentOptions,
      ),
      rejectsCode('capability_unavailable'),
    );
  }
});
