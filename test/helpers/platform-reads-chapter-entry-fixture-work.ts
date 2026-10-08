export const CHAPTER_ENTRY_FIXTURE_WORK = '7600000000000000001';

export const CHAPTER_ENTRY_FIXTURE_TITLE = 'PRIVATE_CHAPTER_MANAGER_TITLE';

export type ChapterFixtureSource = {
  url: string;
  method?: string;
  json?: unknown;
  oldRequest?: boolean;
  resourceType?: string;
  subframe?: boolean;
  responseOnly?: boolean;
  replayJson?: unknown;
};

export type ChapterStaticUiFixtureElement = {
  tag?: string;
  text?: string;
  attributes?: Record<string, string>;
  hidden?: boolean;
  selected?: boolean;
};

export type ChapterStaticUiFixture = {
  tabs?: Array<{ label: string; active?: boolean; ariaSelected?: string; hidden?: boolean }>;
  statusLabels?: string[];
  volumeLabels?: string[];
  table?: boolean;
  hiddenFilters?: boolean;
  pagerRoots?: Array<{
    className?: string;
    hidden?: boolean;
    controls: ChapterStaticUiFixtureElement[];
  }>;
  volumeOptions?: ChapterStaticUiFixtureElement[][];
  unboundOptions?: ChapterStaticUiFixtureElement[];
  genericElementCount?: number;
};

export type ChapterRenderReadinessFixture = {
  render?: 'delayed' | 'missing';
  source?: 'during_render' | 'after_render' | 'missing' | 'old_request' | 'subframe';
  analyticsPost?: boolean;
  fatalRequest?: 'wrong_route' | 'wrong_parent' | 'write_route';
  changedOwner?: boolean;
  cleanupNavigation?: boolean;
  cleanupUnrouteFailure?: boolean;
  deferredCleanupRoute?: boolean;
  volumeExpansion?: 'descendant' | 'controls' | 'owns' | 'unassociated' | 'ambiguous';
  volumeDisabled?: boolean;
  volumeHidden?: boolean;
  volumeNavigate?: boolean;
  volumeOwnerChanged?: boolean;
  volumeBindingChange?: 'reorder_status' | 'replace_control' | 'status_change' | 'detach_view';
};
