import test from 'node:test';

import { mkdtemp, writeFile, rm } from 'node:fs/promises';

import path from 'node:path';

import os from 'node:os';

import { createHash } from 'node:crypto';

import {
  BookMetadataFixturePage,
  bookProfile,
  bookWrites,
  bookTarget,
  bookOptions,
  bookInput,
} from './helpers/platform-writes-chapter-creation-profile.js';

import {
  workId,
  accountId,
  content,
  chapterId,
  rejectsCode,
} from './helpers/platform-writes-fixture-page.js';

import assert from 'node:assert/strict';

import { type DraftMetadata } from '../src/platform/writes.js';

test('long-book metadata update saves only requested controls after durable intent and verifies full reopened metadata including controlled cover', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fanqie-book-cover-'));
  try {
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    await writeFile(path.join(directory, 'cover.png'), image);
    const coverHash = createHash('sha256').update(image).digest('hex');
    const page = new BookMetadataFixturePage();
    page.records.get(workId)!.content.metadata!.cover = 'a'.repeat(64);
    const coverProfile = {
      ...bookProfile,
      fields: {
        ...bookProfile.fields,
        cover: {
          kind: 'upload' as const,
          selector: { css: '#cover' },
          readHash: { selector: { css: '#cover-hash' } },
        },
      },
    };
    const before = await bookWrites.readLongBookMetadataSnapshot(
      page.asPage(),
      accountId,
      bookTarget,
      { ...bookOptions, profile: coverProfile },
    );
    let captured:
      | Parameters<
          NonNullable<
            import('../src/platform/writes.js').LongBookMetadataOptions['beforeSideEffect']
          >
        >[0]
      | null = null;
    const result = await bookWrites.updateLongBookMetadata(
      page.asPage(),
      bookInput({
        expectedContentHash: before.metadataHash,
        metadata: {
          description: 'Changed work description',
          cover: { uploadPath: 'cover.png', sha256: coverHash },
        },
      }),
      {
        ...bookOptions,
        profile: coverProfile,
        uploadRoot: directory,
        beforeSideEffect: async (intent) => {
          assert.equal(page.fills.length, 0);
          assert.equal(page.clicks.length, 0);
          captured = structuredClone(intent);
        },
      },
    );
    assert.equal(result.status, 'succeeded');
    assert.equal(result.hashBasis, 'long-book-metadata/v1');
    assert.equal('contentHash' in result, false);
    assert.equal(captured !== null, true);
    assert.equal(captured!.snapshotScope, 'long_book_metadata');
    assert.equal(captured!.hashBasis, 'long-book-metadata/v1');
    assert.equal(captured!.desiredContentHash, result.metadataHash);
    assert.deepEqual(captured!.target, bookTarget);
    assert.deepEqual(page.fills, ['#description']);
    assert.deepEqual(page.clicks, ['button:存草稿']);
    assert.equal(page.metadataReads.includes('#body'), false);
    const saved = page.records.get(workId)!.content;
    assert.equal(saved.body === content.body, true);
    assert.equal(saved.title, content.title);
    assert.equal(saved.metadata!.cover, coverHash);
    assert.deepEqual(saved.metadata!.categories, content.metadata!.categories);
    assert.equal(saved.metadata!.aiDeclaration, content.metadata!.aiDeclaration);
    assert.equal(saved.metadata!.trialRatio, content.metadata!.trialRatio);
    assert.equal(
      result.metadataHash,
      bookWrites.hashLongBookMetadata({ title: saved.title, metadata: saved.metadata! }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('long-book metadata preconditions reject unsupported profiles, wrong owner/target/state/version and incomplete declared fields before any fill or save', async () => {
  const cases: Array<{
    code: string;
    setup?: (page: BookMetadataFixturePage) => void;
    input?: Partial<import('../src/platform/writes.js').LongBookMetadataInput>;
    profile?: import('../src/platform/writes.js').UiLongBookMetadataProfile;
  }> = [
    { code: 'version_conflict', input: { expectedContentHash: '0'.repeat(64) } },
    { code: 'version_conflict', input: { expectedState: 'published' } },
    { code: 'version_conflict', profile: { ...bookProfile, editableStates: ['reviewing'] } },
    {
      code: 'requires_login',
      setup: (page) => {
        page.account = '1002';
      },
    },
    {
      code: 'version_conflict',
      setup: (page) => {
        page.onReopen = () => {
          page.currentUrl = page.currentUrl.replace(workId, chapterId);
        };
      },
    },
    {
      code: 'capability_unavailable',
      setup: (page) => {
        page.missing.add('#description');
      },
    },
    {
      code: 'capability_unavailable',
      setup: (page) => {
        page.duplicate.add('#description');
      },
    },
    {
      code: 'capability_unavailable',
      setup: (page) => {
        page.records.get(workId)!.content.metadata!.trialRatio = NaN;
      },
    },
    {
      code: 'capability_unavailable',
      profile: {
        ...bookProfile,
        body: { css: '#body' },
      } as unknown as import('../src/platform/writes.js').UiLongBookMetadataProfile,
    },
    {
      code: 'capability_unavailable',
      profile: { ...bookProfile, metadataRoute: '/main/writer/new-book/{workId}' },
    },
    {
      code: 'invalid_input',
      input: { metadata: { unknown: 'not a declared field' } as DraftMetadata },
    },
    { code: 'version_conflict', profile: { ...bookProfile, fields: {} } },
  ];
  for (const entry of cases) {
    const page = new BookMetadataFixturePage();
    entry.setup?.(page);
    await assert.rejects(
      bookWrites.updateLongBookMetadata(page.asPage(), bookInput(entry.input), {
        ...bookOptions,
        profile: entry.profile ?? bookProfile,
      }),
      rejectsCode(entry.code),
    );
    assert.equal(page.fills.length, 0);
    assert.equal(page.clicks.length, 0);
    assert.equal(page.metadataReads.includes('#body'), false);
  }
  const rawCases = [
    {
      key: '#ai-select',
      raw: ['yes'],
      field: 'aiDeclaration',
      binding: {
        kind: 'select' as const,
        selector: { css: '#ai-select' },
        values: { yes: '1', no: '0' },
      },
    },
    {
      key: '#trial',
      raw: ['30', '50'],
      field: 'trialRatio',
      binding: bookProfile.fields!.trialRatio!,
    },
    {
      key: '#trial',
      raw: [''],
      field: 'trialRatio',
      binding: {
        kind: 'select' as const,
        selector: { css: '#trial' },
        values: { 30: '30', 0: '' },
      },
    },
    {
      key: '#trial',
      raw: [' '],
      field: 'trialRatio',
      binding: {
        kind: 'select' as const,
        selector: { css: '#trial' },
        values: { 30: '30', 0: ' ' },
      },
    },
    {
      key: '#ai-select',
      raw: ['1'],
      field: 'aiDeclaration',
      binding: {
        kind: 'select' as const,
        selector: { css: '#ai-select' },
        values: { yes: '1', no: '1' },
      },
    },
  ];
  for (const rawCase of rawCases) {
    const strictProfile = {
      ...bookProfile,
      fields: { ...bookProfile.fields, [rawCase.field]: rawCase.binding },
    };
    const page = new BookMetadataFixturePage();
    page.selectReadback.set(rawCase.key, rawCase.raw);
    await assert.rejects(
      bookWrites.readLongBookMetadataSnapshot(page.asPage(), accountId, bookTarget, {
        ...bookOptions,
        profile: strictProfile,
      }),
      rejectsCode('capability_unavailable'),
    );
    await assert.rejects(
      bookWrites.updateLongBookMetadata(page.asPage(), bookInput(), {
        ...bookOptions,
        profile: strictProfile,
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.equal(page.fills.length, 0);
    assert.equal(page.clicks.length, 0);
    const late = new BookMetadataFixturePage();
    late.onReopen = () => {
      if (late.gotoCalls.length >= 2) late.selectReadback.set(rawCase.key, rawCase.raw);
    };
    if (rawCase.key === '#ai-select') late.selectReadback.set(rawCase.key, ['0']);
    // Duplicate configured inverse is already invalid before saving; all other
    // cases become invalid only during the reopened readback.
    if (
      rawCase.field === 'aiDeclaration' &&
      rawCase.binding.kind === 'select' &&
      'values' in rawCase.binding &&
      rawCase.binding.values?.no === '1'
    )
      continue;
    const lateMetadata: DraftMetadata = {
      description: 'Changed work description',
      ...(rawCase.field === 'aiDeclaration'
        ? { aiDeclaration: 'yes' as const }
        : rawCase.raw[0]?.trim() === ''
          ? { trialRatio: 0 }
          : {}),
    };
    const result = await bookWrites.updateLongBookMetadata(
      late.asPage(),
      bookInput({ metadata: lateMetadata }),
      { ...bookOptions, profile: strictProfile },
    );
    assert.equal(result.status, 'uncertain');
    assert.equal('metadataHash' in result, false);
    assert.equal(late.clicks.length, 1);
  }
  for (const raw of ['', ' ', '30junk']) {
    const page = new BookMetadataFixturePage();
    page.textReadback.set('#trial-text', raw);
    const numericProfile = {
      ...bookProfile,
      fields: {
        ...bookProfile.fields,
        trialRatio: { kind: 'text' as const, selector: { css: '#trial-text' } },
      },
    };
    await assert.rejects(
      bookWrites.readLongBookMetadataSnapshot(page.asPage(), accountId, bookTarget, {
        ...bookOptions,
        profile: numericProfile,
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.equal(page.clicks.length, 0);
  }
  const page = new BookMetadataFixturePage();
  await assert.rejects(
    bookWrites.updateLongBookMetadata(page.asPage(), bookInput(), { profile: bookProfile }),
    rejectsCode('capability_unavailable'),
  );
  assert.equal(page.fills.length, 0);
  assert.equal(
    bookWrites.getLongBookMetadataCapabilities(bookProfile).verification,
    'not-verified-live',
  );
  assert.equal(bookWrites.getLongBookMetadataCapabilities().available, false);
});
