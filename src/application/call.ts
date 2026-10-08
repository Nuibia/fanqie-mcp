import { AppError } from '../errors.js';
import { Store } from '../runtime/store.js';
import { type ToolDefinition } from '../transport/mcp.js';
import { record } from './shared.js';
import { type CallOperation } from './contracts/lifecycle.js';

interface Dependencies {
  store: Store;
  tools: ToolDefinition[];
}

export function createCall(deps: Dependencies): CallOperation {
  async function call(name: string, args: unknown) {
    deps.store.assertPublicReadEntryAllowed();
    const item = deps.tools.find((tool) => tool.name === name);
    if (!item) throw new AppError('not_found', 'Tool not found', 404);
    return item.run(
      [
        'fanqie_update_short_body',
        'fanqie_get_short_body_snapshot',
        'fanqie_update_work_metadata',
        'fanqie_get_short_metadata_snapshot',
        'fanqie_list_short_drafts',
        'fanqie_prepare_submission',
        'fanqie_submit_short_story',
      ].includes(name)
        ? (args as Record<string, unknown>)
        : record(args),
    );
  }
  return call;
}
