import path from 'node:path';
import * as z from 'zod/v4';
import { AppError } from '../errors.js';
import { Store } from '../runtime/store.js';
import { type ToolDefinition } from '../transport/mcp.js';
import {
  type ToolOperation,
  type CaptureTrialToolInputOperation,
  type CaptureDirectoryToolInputOperation,
  type CaptureBodyToolInputOperation,
  type CaptureSubmissionToolInputOperation,
} from './contracts/tool-input.js';
import { type GenericCaptureOperation } from './contracts/generic-write.js';

interface Dependencies {
  tools: ToolDefinition[];
  store: Store;
  genericCapture: GenericCaptureOperation;
  captureTrialToolInput: CaptureTrialToolInputOperation;
  captureDirectoryToolInput: CaptureDirectoryToolInputOperation;
  captureBodyToolInput: CaptureBodyToolInputOperation;
  captureSubmissionToolInput: CaptureSubmissionToolInputOperation;
}

export function createTool(deps: Dependencies): ToolOperation {
  function tool(
    name: string,
    description: string,
    schema: z.ZodObject<z.ZodRawShape>,
    readOnly: boolean,
    run: ToolDefinition['run'],
    imageResultKey?: string,
  ) {
    deps.tools.push({
      name: `fanqie_${name}`,
      description,
      schema,
      readOnly,
      ...(imageResultKey ? { imageResultKey } : {}),
      run: async (args) => {
        deps.store.assertPublicReadEntryAllowed();
        const capturedGeneric = [
          'create_draft',
          'update_draft',
          'resume_create_draft',
          'repair_created_draft',
          'get_editable_snapshot',
          'reconcile_write',
        ].includes(name)
          ? deps.genericCapture(args)
          : args;
        const parsed = schema.safeParse(
          deps.captureTrialToolInput(
            name,
            deps.captureDirectoryToolInput(
              name,
              deps.captureBodyToolInput(
                name,
                deps.captureSubmissionToolInput(name, capturedGeneric),
              ),
            ),
          ),
        );
        if (!parsed.success)
          throw new AppError(
            'invalid_input',
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; '),
          );
        return run(parsed.data);
      },
    });
  }
  return tool;
}
