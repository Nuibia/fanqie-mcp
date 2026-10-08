import {
  type UiWriteProfile,
  saveChapterDraft,
  type WriteTarget,
} from '../../src/platform/writes.js';

import {
  profile,
  workId,
  createdId,
  FixturePage,
  content,
  FixtureLocator,
  fixedNow,
  accountId,
  target,
  chapterId,
  options,
} from './platform-writes-fixture-page.js';

import assert from 'node:assert/strict';

export function chapterCreationProfile(): UiWriteProfile {
  const chapterProfile = structuredClone(profile);
  chapterProfile.kind = 'chapter';
  chapterProfile.editorRoute = '/main/writer/fixture-book/{workId}/fixture-chapter/{chapterId}';
  chapterProfile.newRoute = '/main/writer/fixture-book/{workId}/fixture-new-chapter';
  chapterProfile.targetPattern =
    '^/main/writer/fixture-book/(?<workId>\\d+)/fixture-chapter/(?<chapterId>\\d+)$';
  return chapterProfile;
}

export const chapterCreationUrl = `https://fanqienovel.com/main/writer/fixture-book/${workId}/fixture-new-chapter`;

export const createdChapterUrl = `https://fanqienovel.com/main/writer/fixture-book/${workId}/fixture-chapter/${createdId}`;

// Real fixture timers model an independently allocated route; they never invoke product operations.
export class ChapterCreationFixturePage extends FixturePage {
  routeDelayMs: number | undefined = 15;
  routeAfterCreation = createdChapterUrl;
  gotoDelayMs = 0;
  loseCreationResponse = false;
  creationReturnedUrl: string | undefined;
  creationNavigationTimeouts: number[] = [];
  routeUpdates = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  pause(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, delayMs);
      this.timers.add(timer);
    });
  }
  cleanup() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
  override async goto(url: string, navigation?: { timeout?: number; waitUntil?: string }) {
    if (!new URL(url).pathname.endsWith('/fixture-new-chapter')) return super.goto(url);
    this.gotoCalls.push(url);
    this.creationNavigationTimeouts.push(navigation?.timeout ?? 0);
    // Allocate first, including the lost-response case: this is already a remote zero-word draft.
    this.activeId = createdId;
    this.records.set(createdId, {
      content: { title: '', body: '', metadata: structuredClone(content.metadata) },
      state: 'draft',
    });
    this.data = structuredClone(this.records.get(createdId)!);
    this.currentUrl = url;
    if (this.routeDelayMs === 0) {
      this.currentUrl = this.routeAfterCreation;
      this.routeUpdates++;
    } else if (this.routeDelayMs !== undefined) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.currentUrl = this.routeAfterCreation;
        this.routeUpdates++;
      }, this.routeDelayMs);
      this.timers.add(timer);
    }
    if (this.gotoDelayMs) await this.pause(this.gotoDelayMs);
    this.creationReturnedUrl = this.currentUrl;
    if (this.loseCreationResponse) throw new Error('Creation response lost after allocation');
    return null;
  }
}

export function assertUnknownChapterCreation(
  result: Awaited<ReturnType<typeof saveChapterDraft>>,
  page: ChapterCreationFixturePage,
) {
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'outcome_unknown');
  assert.equal(result.contentHash, undefined);
  assert.equal(result.platformState, undefined);
  assert.deepEqual(page.fills, []);
  assert.deepEqual(page.clicks, []);
  assert.deepEqual(page.gotoCalls, [chapterCreationUrl]);
  assert.equal(page.records.has(createdId), true);
  assert.equal(page.records.get(createdId)!.content.title, '');
  assert.equal(page.records.get(createdId)!.content.body, '');
}

export const bookWrites = await import('../../src/platform/writes.js');

export const bookTarget: import('../../src/platform/writes.js').LongBookMetadataTarget = {
  kind: 'long-book',
  workId,
};

export const bookProfile: import('../../src/platform/writes.js').UiLongBookMetadataProfile = {
  id: 'fixture-book-metadata-v1',
  evidenceRef: 'fixture://platform-writes/book-metadata',
  verifiedAt: profile.verifiedAt,
  kind: 'long-book',
  metadataRoute: '/main/writer/fixture-book-metadata/{workId}',
  targetPattern: '^/main/writer/fixture-book-metadata/(?<workId>\\d+)$',
  identity: profile.identity,
  state: profile.state,
  states: profile.states,
  editableStates: ['draft'],
  title: profile.title,
  save: profile.save,
  fields: profile.fields,
};

export class BookMetadataFixturePage extends FixturePage {
  metadataReads: string[] = [];
  selectReadback = new Map<string, string[]>();
  textReadback = new Map<string, string>();
  onResolved?: (key: string) => void;
  onFilled?: (key: string) => void;
  private observeLocator(locator: FixtureLocator, key: string) {
    const visible = locator.isVisible.bind(locator),
      fill = locator.fill.bind(locator);
    locator.isVisible = async () => {
      const result = await visible();
      this.onResolved?.(key);
      return result;
    };
    locator.fill = async (value) => {
      await fill(value);
      this.onFilled?.(key);
    };
    return locator;
  }
  override getByRole(role: string, options: { name: string }) {
    return this.observeLocator(super.getByRole(role, options), `${role}:${options.name}`);
  }
  override locator(css: string) {
    this.metadataReads.push(css);
    if (css === '#body') throw Error('Manuscript controls are outside the metadata fixture');
    const locator = this.observeLocator(super.locator(css), css);
    if (this.selectReadback.has(css))
      locator.evaluate = async <R>(fn: (element: never) => R): Promise<R> =>
        fn({
          tagName: 'INPUT',
          selectedOptions: this.selectReadback.get(css)!.map((value) => ({ value })),
        } as never);
    if (this.textReadback.has(css)) locator.inputValue = async () => this.textReadback.get(css)!;
    if (css === '#ai-select')
      locator.selectOption = async (value) => {
        this.data.content.metadata!.aiDeclaration =
          (Array.isArray(value) ? value[0] : value) === '1' ? 'yes' : 'no';
      };
    return locator;
  }
}

export const bookOptions = {
  profile: bookProfile,
  now: fixedNow,
  beforeSideEffect: async () => {},
};

export const bookInput = (
  changes: Partial<import('../../src/platform/writes.js').LongBookMetadataInput> = {},
) => ({
  accountId,
  target: bookTarget,
  expectedContentHash: bookWrites.hashLongBookMetadata({
    title: content.title,
    metadata: content.metadata!,
  }),
  expectedState: 'draft' as const,
  metadata: { description: 'Changed work description' },
  ...changes,
});

// Synthetic await boundaries: these pages never open a browser or call the platform.
export class WriteGuardFixturePage extends FixturePage {
  actions: string[] = [];
  afterAwait?: (event: string) => void;
  trialToken = '30';
  trialOptions = ['30'];
  trialChecked: unknown = false;
  event(event: string) {
    this.afterAwait?.(event);
  }
  moveToOtherTarget(kind: WriteTarget['kind']) {
    const otherId = '7691000000000000004';
    this.records.set(otherId, { content: structuredClone(content), state: 'draft' });
    this.activeId = otherId;
    this.data = structuredClone(this.records.get(otherId)!);
    this.currentUrl =
      kind === 'short'
        ? `https://fanqienovel.com/main/writer/publish-short/${otherId}`
        : `https://fanqienovel.com/main/writer/fixture-book/${otherId}/fixture-chapter/${otherId}`;
  }
  override locator(css: string) {
    return new WriteGuardFixtureLocator(this, css);
  }
  override getByRole(role: string, options: { name: string }) {
    return new WriteGuardFixtureLocator(this, `${role}:${options.name}`);
  }
  override getByLabel(label: string) {
    return new WriteGuardFixtureLocator(this, `label:${label}`);
  }
  override getByPlaceholder(placeholder: string) {
    return new WriteGuardFixtureLocator(this, `placeholder:${placeholder}`);
  }
}

class WriteGuardFixtureLocator extends FixtureLocator {
  constructor(
    private guardPage: WriteGuardFixturePage,
    private guardKey: string,
  ) {
    super(guardPage, guardKey);
  }
  override async count() {
    const value = await super.count();
    this.guardPage.event(`count:${this.guardKey}`);
    return value;
  }
  override async isVisible() {
    const value = await super.isVisible();
    this.guardPage.event(`visible:${this.guardKey}`);
    return value;
  }
  override locator(css: string) {
    return new WriteGuardFixtureLocator(this.guardPage, `${this.guardKey} ${css}`);
  }
  override async allTextContents() {
    const value = await super.allTextContents();
    this.guardPage.event(`paragraphs:${this.guardKey}`);
    return value;
  }
  override async innerText() {
    const value = await super.innerText();
    this.guardPage.event(`text:${this.guardKey}`);
    return value;
  }
  override async inputValue() {
    const value =
      this.guardKey === '#trial-token' ? this.guardPage.trialToken : await super.inputValue();
    this.guardPage.event(`value:${this.guardKey}`);
    return value;
  }
  override async evaluate<R>(fn: (element: never) => R): Promise<R> {
    const value =
      this.guardKey === '#trial'
        ? fn({
            tagName: 'SELECT',
            selectedOptions: this.guardPage.trialOptions.map((value) => ({ value })),
          } as never)
        : await super.evaluate(fn);
    this.guardPage.event(`evaluate:${this.guardKey}`);
    return value;
  }
  override async isChecked() {
    const value =
      this.guardKey === '#trial-checked'
        ? (this.guardPage.trialChecked as boolean)
        : await super.isChecked();
    this.guardPage.event(`checked:${this.guardKey}`);
    return value;
  }
  override async fill(value: string) {
    this.guardPage.actions.push(`fill:${this.guardKey}`);
    await super.fill(value);
    this.guardPage.event(`action:fill:${this.guardKey}`);
  }
  override async check() {
    this.guardPage.actions.push(`check:${this.guardKey}`);
    await super.check();
    this.guardPage.event(`action:check:${this.guardKey}`);
  }
  override async setChecked(value: boolean) {
    this.guardPage.actions.push(`setChecked:${this.guardKey}`);
    await super.setChecked(value);
    this.guardPage.event(`action:setChecked:${this.guardKey}`);
  }
  override async selectOption(value: string | string[]) {
    this.guardPage.actions.push(`selectOption:${this.guardKey}`);
    await super.selectOption(value);
    this.guardPage.event(`action:selectOption:${this.guardKey}`);
  }
  override async setInputFiles(file: string) {
    this.guardPage.actions.push(`setInputFiles:${this.guardKey}`);
    await super.setInputFiles(file);
    this.guardPage.event(`action:setInputFiles:${this.guardKey}`);
  }
  override async click() {
    this.guardPage.actions.push(`click:${this.guardKey}`);
    await super.click();
    this.guardPage.event(`action:click:${this.guardKey}`);
  }
}

export function writeGuardScope(kind: WriteTarget['kind'], page: WriteGuardFixturePage) {
  const currentProfile = structuredClone(profile);
  const currentTarget: WriteTarget = kind === 'short' ? { ...target } : { kind, workId, chapterId };
  if (kind === 'chapter') {
    currentProfile.kind = kind;
    currentProfile.editorRoute = '/main/writer/fixture-book/{workId}/fixture-chapter/{chapterId}';
    currentProfile.newRoute = '/main/writer/fixture-book/{workId}/fixture-new-chapter';
    currentProfile.targetPattern =
      '^/main/writer/fixture-book/(?<workId>\\d+)/fixture-chapter/(?<chapterId>\\d+)$';
    page.records.set(chapterId, structuredClone(page.records.get(workId)!));
  }
  return { currentProfile, currentTarget, currentOptions: { ...options, profile: currentProfile } };
}
