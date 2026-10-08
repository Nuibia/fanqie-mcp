import { empty } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation, type RefreshOperation } from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  refresh: RefreshOperation;
}

export function registerListActivitiesTool(deps: Dependencies): void {
  deps.tool(
    'list_activities',
    '实时读取番茄官方活动，保留原始起止时间和原文URL；详情可用get_writer_article读取。',
    empty,
    true,
    async () => deps.wait(deps.refresh(['activities'], 'activities')),
  );
}
