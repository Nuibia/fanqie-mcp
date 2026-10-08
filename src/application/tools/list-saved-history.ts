import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { Store, RuntimeError, type Manifest } from '../../runtime/store.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type ManifestViewOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  store: Store;
  config: Config;
  manifestView: ManifestViewOperation;
}

export function registerListSavedHistoryTool(deps: Dependencies): void {
  deps.tool(
    'list_saved_history',
    '只读完整历史manifest，不访问平台；可按scope及manifestId检索不可变证据。',
    z
      .object({
        scope: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
          .optional(),
        manifestId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    true,
    async (args) => {
      let history: Manifest[];
      try {
        history = deps.store.history(deps.config.accountId, args.scope as string | undefined);
      } catch {
        throw new RuntimeError('capability_unavailable', 'Saved data is unavailable.');
      }
      const manifests = history
        .filter((manifest) => !args.manifestId || manifest.id === args.manifestId)
        .slice(0, Number(args.limit));
      return {
        sourceMode: 'saved',
        manifests: manifests.map((manifest) => deps.manifestView(manifest, false)),
      };
    },
  );
}
