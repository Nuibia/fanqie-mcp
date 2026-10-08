import * as writes from '../../platform/writes.js';
export type CapabilitiesOperation = () => {
  service: string;
  version: string;
  accountId: string;
  reads: (
    | {
        dataset:
          | 'short_works'
          | 'long_works'
          | 'long_metrics'
          | 'short_metrics'
          | 'activities'
          | 'writer_classes';
        implementationStatus: string;
        verificationStatus: string;
        available: boolean;
      }
    | {
        dataset: string;
        scope: string;
        atomicRevision: boolean;
        bodyIncluded: boolean;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean | null;
        availabilityStatus: string;
        supportedReadFields: string[];
        metadataWritesAvailable: boolean | null;
        snapshotScope?: undefined;
        trialWritesAvailable?: undefined;
        publishedVersionVerified?: undefined;
        titleAvailable?: undefined;
        publicationStatus?: undefined;
        signingStatus?: undefined;
      }
    | {
        dataset: 'short_native_trial';
        snapshotScope: string;
        scope: string;
        atomicRevision: boolean;
        bodyIncluded: boolean;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean | null;
        availabilityStatus: string;
        supportedReadFields: string[];
        trialWritesAvailable: boolean | null;
        metadataWritesAvailable?: undefined;
        publishedVersionVerified?: undefined;
        titleAvailable?: undefined;
        publicationStatus?: undefined;
        signingStatus?: undefined;
      }
    | {
        dataset: string;
        snapshotScope: 'short-native-body/v1';
        scope: string;
        publishedVersionVerified: boolean;
        atomicRevision: boolean;
        bodyIncluded: boolean;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean | null;
        availabilityStatus: string;
        supportedReadFields: string[];
        metadataWritesAvailable?: undefined;
        trialWritesAvailable?: undefined;
        titleAvailable?: undefined;
        publicationStatus?: undefined;
        signingStatus?: undefined;
      }
    | {
        dataset: string;
        scope: string;
        atomicRevision: boolean;
        bodyIncluded: boolean;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean;
        availabilityStatus?: undefined;
        supportedReadFields?: undefined;
        metadataWritesAvailable?: undefined;
        snapshotScope?: undefined;
        trialWritesAvailable?: undefined;
        publishedVersionVerified?: undefined;
        titleAvailable?: undefined;
        publicationStatus?: undefined;
        signingStatus?: undefined;
      }
    | {
        dataset: string;
        scope: string;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean;
        atomicRevision?: undefined;
        bodyIncluded?: undefined;
        availabilityStatus?: undefined;
        supportedReadFields?: undefined;
        metadataWritesAvailable?: undefined;
        snapshotScope?: undefined;
        trialWritesAvailable?: undefined;
        publishedVersionVerified?: undefined;
        titleAvailable?: undefined;
        publicationStatus?: undefined;
        signingStatus?: undefined;
      }
    | {
        dataset: string;
        scope: string;
        publishedVersionVerified: boolean;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean;
        atomicRevision?: undefined;
        bodyIncluded?: undefined;
        availabilityStatus?: undefined;
        supportedReadFields?: undefined;
        metadataWritesAvailable?: undefined;
        snapshotScope?: undefined;
        trialWritesAvailable?: undefined;
        titleAvailable?: undefined;
        publicationStatus?: undefined;
        signingStatus?: undefined;
      }
    | {
        dataset: string;
        snapshotScope: 'native_short_draft_directory.v1';
        scope: string;
        atomicRevision: boolean;
        bodyIncluded: boolean;
        implementationStatus: string;
        verificationStatus: string;
        available: boolean | null;
        availabilityStatus: string;
        supportedReadFields: string[];
        titleAvailable: boolean;
        publicationStatus: string;
        signingStatus: string;
        metadataWritesAvailable?: undefined;
        trialWritesAvailable?: undefined;
        publishedVersionVerified?: undefined;
      }
  )[];
  writesEnabled: boolean;
  writes: {
    nativeShortSubmission: {
      implementationStatus: string;
      verificationStatus: string;
      available: boolean | null;
      availabilityStatus: string;
      reason: string;
      snapshotScope: string;
      atomicRevision: boolean;
      bodyIncluded: boolean;
      supportedWriteFields: string[];
      clientFullGate: string;
      preparation: {
        implementationStatus: string;
        readOnlyPlatformAccess: boolean;
        writesRequired: boolean;
      };
      reconciliation: {
        implementationStatus: string;
        readOnlyPlatformAccess: boolean;
        writesRequired: boolean;
      };
    };
    nativeShortBody: {
      implementationStatus: string;
      available: boolean | null;
      availabilityStatus: string;
      verificationStatus: string;
      reason: string;
      atomicRevision: boolean;
      bodyIncluded: boolean;
      supportedWriteFields: string[];
      reconciliation: {
        implementationStatus: string;
        readOnlyPlatformAccess: boolean;
        writesRequired: boolean;
      };
    };
    nativeShortTrial: {
      implementationStatus: string;
      available: boolean | null;
      availabilityStatus: string;
      verificationStatus: string;
      reason: string;
      atomicRevision: boolean;
      supportedWriteFields: string[];
      bodyIncluded: boolean;
      reconciliation: {
        implementationStatus: string;
        readOnlyPlatformAccess: boolean;
        writesRequired: boolean;
      };
    };
    short: Record<
      writes.WriteCapability,
      {
        available: boolean;
        reason?: string;
      }
    >;
    chapter: Record<
      writes.WriteCapability,
      {
        available: boolean;
        reason?: string;
      }
    >;
    'long-book': {
      implemented: boolean;
      available: boolean;
      verification: 'not-verified-live';
      scope: 'existing-long-book-metadata';
      hashBasis: 'long-book-metadata/v1';
      bodyIncluded: boolean;
      createAvailable: boolean;
      submissionAvailable: boolean;
    };
    nativeShortMetadata: {
      implementationStatus: string;
      available: boolean | null;
      availabilityStatus: string;
      verificationStatus: string;
      reason: string;
      atomicRevision: boolean;
      supportedWriteFields: string[];
      reconciliation: {
        implementationStatus: string;
        readOnlyPlatformAccess: boolean;
        writesRequired: boolean;
      };
    };
    nativeShortRecommendedCover: {
      implementationStatus: string;
      available: boolean | null;
      availabilityStatus: string;
      verificationStatus: string;
      reason: string;
      atomicRevision: boolean;
      supportedWriteFields: string[];
      reconciliation: {
        implementationStatus: string;
        readOnlyPlatformAccess: boolean;
        writesRequired: boolean;
      };
      uploadOutcomeRecovery: string;
    };
  };
  limitations: string[];
};
export type NativeBoundAccountOperation = () => string | null;
export type PlatformAccountOperation = () => string;
export type StatusOperation = () => {
  service: string;
  version: string;
  status: 'unavailable' | 'ready';
  loginFallback: import('../../runtime/login-fallback.js').LoginFallbackState;
  platform: {
    status: 'authenticated' | 'login_required' | 'unknown';
    checkedAt: string | null;
  };
  writesEnabled: boolean;
  jobCounts: Record<string, number>;
};
