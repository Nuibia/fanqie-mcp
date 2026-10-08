import * as z from 'zod/v4';
import { datasets, accountDatasets, Dataset } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation, type RefreshOperation } from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  refresh: RefreshOperation;
}

export function registerRefreshAccountTool(deps: Dependencies): void {
  deps.tool(
    'refresh_account',
    '请求后真实读取所选全部数据集，默认短/长作品及指标；子集使用独立scope，部分失败不推进完整账号current。',
    z
      .object({
        datasets: z
          .array(z.enum(datasets))
          .min(1)
          .default([...accountDatasets]),
      })
      .strict(),
    true,
    async (args) => deps.wait(deps.refresh(args.datasets as Dataset[])),
  );
}
