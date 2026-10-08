import * as z from 'zod/v4';
import { type ToolDefinition } from '../../transport/mcp.js';
export type CaptureBodyToolInputOperation = (name: string, input: unknown) => unknown;
export type CaptureDirectoryToolInputOperation = (name: string, input: unknown) => unknown;
export type CaptureSubmissionToolInputOperation = (name: string, input: unknown) => unknown;
export type CaptureTrialToolInputOperation = (name: string, input: unknown) => unknown;
export type RawBodyToolSignalOperation = (input: unknown) => boolean;
export type RawTrialToolSignalOperation = (input: unknown) => boolean;
export type ReceiveCoverOperation = (body: unknown) => {
  uploadPath: string;
  sha256: string;
  size: number;
};
export type RequireEditorWritesEnabledOperation = () => void;
export type ToolOperation = (
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
  readOnly: boolean,
  run: ToolDefinition['run'],
  imageResultKey?: string,
) => void;
