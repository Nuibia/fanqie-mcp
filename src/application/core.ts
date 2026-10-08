import { type NativeShortProvenance } from '../platform/short-native-metadata-proof.js';
import * as z from 'zod/v4';
import { type Config } from '../config.js';
import { Store, type GenericShortTrustedContext } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type CollectionEvidenceProfile } from '../platform/reads.js';
import * as writes from '../platform/writes.js';
import { type ToolDefinition } from '../transport/mcp.js';
import { AccountBinding } from './shared.js';

export interface CoreDependencies {
  store: Store;
  login: LoginState | null;
  bindingFile: string;
  bound: AccountBinding | undefined;
  config: Config;
  browser: BrowserSession;
  explicitBodyReadKey: 'explicit_body_read.';
  directoryApplicationOrigin: 'default' | 'injected';
  readProfiles:
    | Partial<Record<'long_works' | 'long_metrics' | 'chapters', CollectionEvidenceProfile>>
    | undefined;
  queue: JobQueue;
  bodyExecutorEligible: boolean;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  nativeProvenance: NativeShortProvenance;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  tools: ToolDefinition[];
  leaseLossShutdown: boolean;
  closing: Promise<void> | undefined;
  bodyTrialSchema: z.ZodDiscriminatedUnion<
    [
      z.ZodObject<{ action: z.ZodLiteral<'preserve'> }, z.core.$strict>,
      z.ZodObject<{ action: z.ZodLiteral<'clear'> }, z.core.$strict>,
      z.ZodObject<{ action: z.ZodLiteral<'set'>; beforeParagraph: z.ZodNumber }, z.core.$strict>,
    ],
    'action'
  >;
  submissionSchema: z.ZodObject<
    {
      expectedContentHash: z.ZodOptional<z.ZodString>;
      snapshotScope: z.ZodOptional<z.ZodString>;
      hashBasis: z.ZodOptional<z.ZodString>;
      expectedSnapshotVersionHash: z.ZodOptional<z.ZodString>;
      useAi: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
      preparationJobId: z.ZodString;
      acceptPublicationTerms: z.ZodLiteral<true>;
      target: z.ZodObject<
        {
          kind: z.ZodEnum<{ short: 'short'; chapter: 'chapter' }>;
          workId: z.ZodString;
          chapterId: z.ZodOptional<z.ZodString>;
        },
        z.core.$strict
      >;
      expectedState: z.ZodEnum<{
        draft: 'draft';
        reviewing: 'reviewing';
        submitted: 'submitted';
        published: 'published';
        rejected: 'rejected';
      }>;
      idempotencyKey: z.ZodString;
    },
    z.core.$strict
  >;
}
