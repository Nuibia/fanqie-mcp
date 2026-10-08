import { empty } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type CapabilitiesOperation } from '../contracts/capabilities.js';
interface Dependencies {
  tool: ToolOperation;
  capabilities: CapabilitiesOperation;
}

export function registerGetCapabilitiesTool(deps: Dependencies): void {
  deps.tool(
    'get_capabilities',
    '区分已实现、已真实验证与当前可用的平台能力。',
    empty,
    true,
    async () => deps.capabilities(),
  );
}
