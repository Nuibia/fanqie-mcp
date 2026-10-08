import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { errorPayload } from '../errors.js';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  readOnly: boolean;
  /** Only explicitly registered media tools may emit native MCP image content. */
  imageResultKey?: string;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export function createMcpServer(tools: ToolDefinition[]) {
  const server = new McpServer(
    { name: 'fanqie-mcp', version: '0.1.0' },
    {
      instructions:
        '自行维护的番茄平台服务。平台查询执行真实访问并保存证据；历史查询单独标明。维护动作校验目标版本并回读，结果不确定时先对账。',
    },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          const result = await tool.run(args);
          const envelope =
            result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
          const jobs = [
            envelope.job,
            ...['original', 'reconciliation'].map((key) => {
              const nested = envelope[key];
              return nested && typeof nested === 'object' && 'job' in nested ? nested.job : null;
            }),
          ];
          const failed = jobs.some(
            (job) =>
              job &&
              typeof job === 'object' &&
              'status' in job &&
              ['waiting_for_login', 'failed', 'partial', 'uncertain', 'cancelled'].includes(
                String(job.status),
              ),
          );
          let visibleResult = result;
          const content: Array<
            { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }
          > = [];
          if (tool.imageResultKey && Object.hasOwn(envelope, tool.imageResultKey)) {
            const media = envelope[tool.imageResultKey];
            const value =
              media && typeof media === 'object' ? (media as Record<string, unknown>) : {};
            if (
              value.mimeType !== 'image/png' ||
              typeof value.data !== 'string' ||
              value.data.length > 2_800_000
            )
              throw new Error('Invalid QR image result');
            const bytes = Buffer.from(value.data, 'base64');
            if (
              !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
              bytes.toString('base64') !== value.data
            )
              throw new Error('Invalid QR image result');
            visibleResult = Object.fromEntries(
              Object.entries(envelope).filter(([key]) => key !== tool.imageResultKey),
            );
            if (!failed) content.push({ type: 'image', mimeType: 'image/png', data: value.data });
          }
          content.unshift({ type: 'text', text: JSON.stringify(visibleResult) });
          return {
            ...(failed ? { isError: true } : {}),
            content,
            structuredContent: { result: visibleResult },
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          };
        }
      },
    );
  }
  return server;
}
