import test from 'node:test';

import {
  workId,
  accountId,
  content,
  options,
  rejectsCode,
  createdId,
  profile,
  FixturePage,
  updateInput,
  target,
  fixedNow,
  chapterId,
} from './helpers/platform-writes-fixture-page.js';

import {
  ChapterCreationFixturePage,
  chapterCreationProfile,
  BookMetadataFixturePage,
  bookWrites,
  bookTarget,
  bookOptions,
} from './helpers/platform-writes-chapter-creation-profile.js';

import assert from 'node:assert/strict';

import {
  saveChapterDraft,
  hashDraftContent,
  updateDraft,
  readWriteSnapshot,
  diagnoseEditor,
  type WriteTarget,
} from '../src/platform/writes.js';

import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';

import path from 'node:path';

import os from 'node:os';

import { createHash } from 'node:crypto';

test('chapter creation invalid timeouts or missing bounded parent and client reference fail before intent and navigation', async () => {
  const invalidRequests = [
    ...[NaN, Infinity, -Infinity, 0, -0, -1].map((timeoutMs) => ({
      timeoutMs,
      workId,
      clientReference: 'chapter-invalid-time-fixture',
    })),
    ...['', '0', 'not-a-parent'].map((parent) => ({
      timeoutMs: 100,
      workId: parent,
      clientReference: 'chapter-invalid-parent-fixture',
    })),
    ...['', 'has whitespace', 'x'.repeat(129)].map((clientReference) => ({
      timeoutMs: 100,
      workId,
      clientReference,
    })),
  ];
  for (const request of invalidRequests) {
    const page = new ChapterCreationFixturePage();
    let intents = 0;
    let hookCalls = 0;
    try {
      await assert.rejects(
        saveChapterDraft(
          page.asPage(),
          { accountId, workId: request.workId, clientReference: request.clientReference, content },
          {
            ...options,
            profile: chapterCreationProfile(),
            timeoutMs: request.timeoutMs,
            beforeSideEffect: async () => {
              intents++;
            },
            onTargetDiscovered: async () => {
              hookCalls++;
            },
          },
        ),
        rejectsCode('invalid_input'),
      );
      assert.equal(intents, 0);
      assert.equal(hookCalls, 0);
      assert.deepEqual(page.gotoCalls, []);
      assert.equal(page.records.has(createdId), false);
      assert.deepEqual(page.fills, []);
      assert.deepEqual(page.clicks, []);
    } finally {
      page.cleanup();
    }
  }
});

test('controlled cover upload rejects path escape, symlink escape and wrong hash before side effects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanqie-cover-fixture-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'fanqie-cover-outside-'));
  try {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
    const digest = createHash('sha256').update(png).digest('hex');
    await writeFile(path.join(root, 'cover.png'), png);
    await writeFile(path.join(outside, 'outside.png'), png);
    await symlink(path.join(outside, 'outside.png'), path.join(root, 'escape.png'));
    const coverProfile = structuredClone(profile);
    coverProfile.fields!.cover = {
      kind: 'upload',
      selector: { css: '#cover' },
      readHash: { selector: { css: '#cover-hash' } },
    };
    const baseline = { ...content, metadata: { ...content.metadata, cover: '' } };
    for (const [uploadPath, sha256] of [
      [path.join(outside, 'outside.png'), digest],
      ['escape.png', digest],
      ['cover.png', '0'.repeat(64)],
    ]) {
      const page = new FixturePage();
      page.records.get(workId)!.content = structuredClone(baseline);
      const input = {
        ...updateInput(),
        expectedContentHash: hashDraftContent(baseline),
        content: { ...content, metadata: { cover: { uploadPath: uploadPath!, sha256: sha256! } } },
      };
      await assert.rejects(
        updateDraft(page.asPage(), input, { ...options, profile: coverProfile, uploadRoot: root }),
        rejectsCode('invalid_input'),
      );
      assert.deepEqual(page.fills, []);
      assert.deepEqual(page.clicks, []);
    }
    const page = new FixturePage();
    page.records.get(workId)!.content = structuredClone(baseline);
    const result = await updateDraft(
      page.asPage(),
      {
        ...updateInput(),
        expectedContentHash: hashDraftContent(baseline),
        content: { ...content, metadata: { cover: { uploadPath: 'cover.png', sha256: digest } } },
      },
      { ...options, profile: coverProfile, uploadRoot: root },
    );
    assert.equal(result.status, 'succeeded');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('readback changing stable target rejects; metadata hash always comes from the reopened page', async () => {
  const page = new FixturePage();
  page.onReopen = () => {
    page.currentUrl = `https://fanqienovel.com/main/writer/publish-short/${createdId}`;
  };
  await assert.rejects(
    readWriteSnapshot(page.asPage(), accountId, target, options),
    rejectsCode('version_conflict'),
  );
});

test('read-only editor diagnostic exposes generic controls and body hash without private field values', async () => {
  const page = new FixturePage();
  const privateBody = 'PRIVATE_BODY_DO_NOT_RETURN\n\nAnother private paragraph';
  page.records.get(workId)!.content = {
    title: 'PRIVATE_TITLE_DO_NOT_RETURN',
    body: privateBody,
    metadata: structuredClone(content.metadata),
  };
  const result = await diagnoseEditor(page.asPage(), { target }, { now: fixedNow });
  const serialized = JSON.stringify(result);
  assert.equal(result.readOnly, true);
  assert.equal(result.routeBasis, 'observed-short-editor');
  assert.equal(result.state, 'unknown');
  assert.equal(result.contentHash, undefined);
  assert.deepEqual(result.labels, ['正文', '存草稿']);
  assert.equal(
    result.bodyCandidates[0]!.sha256,
    createHash('sha256').update(privateBody).digest('hex'),
  );
  assert.equal(result.bodyCandidates[0]!.characterCount, privateBody.length);
  assert.equal(result.bodyCandidates[0]!.paragraphCount, 3);
  assert.ok(!serialized.includes('PRIVATE_BODY_DO_NOT_RETURN'));
  assert.ok(!serialized.includes('PRIVATE_TITLE_DO_NOT_RETURN'));
  assert.ok(!serialized.includes('session-token-private'));
  assert.deepEqual(page.fills, []);
  assert.deepEqual(page.clicks, []);
  assert.deepEqual(page.gotoCalls, [`https://fanqienovel.com/main/writer/publish-short/${workId}`]);
});

test('diagnostic uses a verified complete snapshot for content hash and state without returning its content', async () => {
  const page = new FixturePage();
  const result = await diagnoseEditor(page.asPage(), { accountId, target }, options);
  assert.equal(result.contentHash, hashDraftContent(content));
  assert.equal(result.state, 'draft');
  assert.equal(result.verifiedSnapshotAt, fixedNow().toISOString());
  assert.ok(!JSON.stringify(result).includes(content.title));
  assert.ok(!JSON.stringify(result).includes(content.body));
  assert.ok(!JSON.stringify(result).includes(content.metadata!.description!));
  assert.deepEqual(page.clicks, []);
  assert.deepEqual(page.fills, []);
});

test('diagnostic refuses new/action routes and missing chapter route evidence before navigation', async () => {
  const chapterTarget: WriteTarget = { kind: 'chapter', workId, chapterId };
  for (const route of [
    `/main/writer/fixture-book/${workId}/new/${chapterId}`,
    `/main/writer/fixture-book/${workId}/submit/${chapterId}`,
    `/main/writer/fixture-book/${workId}/fixture-chapter/${chapterId}?action=create`,
    `/main/writer/fixture-book/${createdId}/fixture-chapter/${chapterId}`,
  ]) {
    const page = new FixturePage();
    await assert.rejects(
      diagnoseEditor(page.asPage(), {
        target: chapterTarget,
        editorUrl: route,
        routeEvidenceRef: 'fixture://observed-editor',
      }),
      rejectsCode('invalid_input'),
    );
    assert.deepEqual(page.gotoCalls, []);
  }
  const page = new FixturePage();
  await assert.rejects(
    diagnoseEditor(page.asPage(), { target: chapterTarget }),
    rejectsCode('capability_unavailable'),
  );
  assert.deepEqual(page.gotoCalls, []);
});

test('diagnostic permits only operator-evidenced existing chapter editor with exact stable IDs', async () => {
  const page = new FixturePage();
  page.records.set(chapterId, structuredClone(page.records.get(workId)!));
  const chapterTarget: WriteTarget = { kind: 'chapter', workId, chapterId };
  const result = await diagnoseEditor(page.asPage(), {
    target: chapterTarget,
    editorUrl: `/main/writer/fixture-book/${workId}/fixture-chapter/${chapterId}`,
    routeEvidenceRef: 'fixture://management-observed-editor',
  });
  assert.equal(result.routeBasis, 'operator-read-evidence');
  assert.deepEqual(result.target, chapterTarget);
  assert.deepEqual(page.clicks, []);
  assert.deepEqual(page.fills, []);
});

test('long-book metadata snapshot reads all declared fields without body and has its own stable full-field hash', async () => {
  const page = new BookMetadataFixturePage();
  const first = await bookWrites.readLongBookMetadataSnapshot(
    page.asPage(),
    accountId,
    bookTarget,
    bookOptions,
  );
  const later = await bookWrites.readLongBookMetadataSnapshot(
    page.asPage(),
    accountId,
    bookTarget,
    { ...bookOptions, now: () => new Date('2026-10-03T10:00:00Z') },
  );
  assert.equal(first.metadataHash, later.metadataHash);
  assert.notEqual(first.platformReadAt, later.platformReadAt);
  assert.equal(first.hashBasis, 'long-book-metadata/v1');
  assert.equal(first.snapshotScope, 'long_book_metadata');
  assert.equal('body' in first, false);
  assert.equal('contentHash' in first, false);
  assert.equal(page.metadataReads.includes('#body'), false);
  assert.deepEqual(first.metadata, content.metadata);
  assert.notEqual(first.metadataHash, hashDraftContent(content));
  assert.equal(
    first.metadataHash,
    bookWrites.hashLongBookMetadata({
      title: content.title,
      metadata: {
        trialRatio: 30,
        categories: ['fixture-category'],
        aiDeclaration: 'no',
        description: 'Fixture description',
      },
    }),
  );
  assert.notEqual(
    first.metadataHash,
    bookWrites.hashLongBookMetadata({
      title: content.title,
      metadata: { ...content.metadata, description: 'Different complete source' },
    }),
  );
  assert.notEqual(
    bookWrites.hashLongBookMetadata({ title: 'T', metadata: {} }),
    bookWrites.hashLongBookMetadata({ title: 'T', metadata: { description: '' } }),
  );
  assert.notEqual(
    bookWrites.hashLongBookMetadata({ title: 'T', metadata: { description: 'A\r\n B' } }),
    bookWrites.hashLongBookMetadata({ title: 'T', metadata: { description: 'A\n B' } }),
  );
  assert.equal(
    bookWrites.hashLongBookMetadata({
      title: 'T',
      metadata: { cover: { uploadPath: 'one.png', sha256: 'a'.repeat(64) } },
    }),
    bookWrites.hashLongBookMetadata({
      title: 'T',
      metadata: { cover: { uploadPath: 'two.png', sha256: 'a'.repeat(64) } },
    }),
  );
  assert.notEqual(
    bookWrites.hashLongBookMetadata({ title: 'T', metadata: { cover: 'a'.repeat(64) } }),
    bookWrites.hashLongBookMetadata({ title: 'T', metadata: { cover: 'b'.repeat(64) } }),
  );
});
