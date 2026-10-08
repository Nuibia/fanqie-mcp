import { type CurrentChapterCollectionFailureDiagnostic } from '../../reads.js';

export type SourceObservation = NonNullable<
  CurrentChapterCollectionFailureDiagnostic['sourceObservation']
>;
export type SourceRequestObservation = Extract<
  SourceObservation['events'][number],
  { kind: 'request' }
>;
export type SourceClearObservation = Extract<
  SourceObservation['events'][number],
  { kind: 'clear' }
>;
export type BootstrapMetadata = NonNullable<
  CurrentChapterCollectionFailureDiagnostic['canonicalBootstrap']
>;
export type RejectedCheck = NonNullable<BootstrapMetadata['firstCdpFaultCheck']>;
