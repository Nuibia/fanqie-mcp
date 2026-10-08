import { empty } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type StatusOperation } from '../contracts/capabilities.js';
interface Dependencies {
  tool: ToolOperation;
  status: StatusOperation;
}

export function registerGetServiceStatusTool(deps: Dependencies): void {
  deps.tool(
    'get_service_status',
    '读取服务状态与已知登录检查记录；不把profile存在当登录有效。',
    empty,
    true,
    async () => deps.status(),
  );
}
