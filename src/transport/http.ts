import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { Config } from '../config.js';
import { AppError, errorPayload } from '../errors.js';
import { createMcpServer, type ToolDefinition } from './mcp.js';
import type { ServiceLeaseLostSignal } from '../runtime/store.js';

export interface Api {
  tools: ToolDefinition[];
  /** Check runtime admission without renewing or acquiring its service lease. */
  assertReadiness?(): void;
  dispatch(
    method: string,
    pathname: string,
    query: URLSearchParams,
    body: unknown,
  ): Promise<unknown>;
  /** Trusted process composition only; not exposed through HTTP or MCP arguments. */
  onServiceLeaseLost?(listener: (signal: ServiceLeaseLostSignal) => void): () => void;
  abortForLeaseLoss?(): void;
  close(reason?: 'lease_lost'): Promise<void>;
}

function json(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > limit) throw new AppError('body_too_large', 'Request body exceeds limit', 413);
    chunks.push(data);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError('invalid_json', 'Body must be JSON');
  }
}

export function createHttpServer(config: Config, api: Api) {
  const handler = createMcpHandler(() => createMcpServer(api.tools));
  const mcp = toNodeHandler(handler, { maxRequestBodySize: config.bodyLimit });
  let stopping = false;
  let leaseLost = false;
  let closing: Promise<void> | undefined;
  const abortForLeaseLoss = () => {
    stopping = true;
    leaseLost = true;
    api.abortForLeaseLoss?.();
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (stopping) throw new AppError('service_stopping', 'Service is stopping', 503);
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') {
        try {
          api.assertReadiness?.();
        } catch {
          json(res, 503, {
            status: 'unavailable',
            service: 'fanqie-mcp',
            version: '0.1.0',
            code: 'runtime_unavailable',
          });
          return;
        }
        json(res, 200, { status: 'ok', service: 'fanqie-mcp', version: '0.1.0' });
        return;
      }
      const rawHost = req.headers.host ?? '';
      const hostname = new URL(`http://${rawHost}`).hostname;
      if (!config.allowedHosts.has(hostname))
        throw new AppError('invalid_host', 'Host is not allowed', 403);
      const origin = req.headers.origin;
      if (origin && !config.allowedOrigins.has(origin))
        throw new AppError('invalid_origin', 'Origin is not allowed', 403);
      const credential = req.headers.authorization?.replace(/^Bearer /i, '') ?? '';
      const expected = Buffer.from(config.token);
      const supplied = Buffer.from(credential);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
        throw new AppError('unauthorized', 'A valid service credential is required', 401);
      if (url.pathname === '/mcp') {
        await mcp(req, res);
        return;
      }
      if (!url.pathname.startsWith('/api/v1/'))
        throw new AppError('not_found', 'Endpoint not found', 404);
      const body = req.method === 'POST' ? await readBody(req, config.bodyLimit) : {};
      const result = await api.dispatch(req.method ?? 'GET', url.pathname, url.searchParams, body);
      json(res, req.method === 'POST' && url.pathname.endsWith('/refresh') ? 202 : 200, result);
    } catch (error) {
      if (!res.headersSent)
        json(res, error instanceof AppError ? error.httpStatus : 500, {
          error: errorPayload(error),
        });
      else res.end();
    }
  });
  return {
    server,
    onServiceLeaseLost(listener: (signal: ServiceLeaseLostSignal) => void) {
      return api.onServiceLeaseLost?.(listener) ?? (() => {});
    },
    abortForLeaseLoss,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    close(reason?: 'lease_lost') {
      if (reason === 'lease_lost') abortForLeaseLoss();
      if (closing) return closing;
      stopping = true;
      closing = (async () => {
        const closed = server.listening
          ? new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            )
          : Promise.resolve();
        void closed.catch(() => {});
        server.closeIdleConnections();
        let incomplete = false;
        try {
          await api.close(leaseLost ? 'lease_lost' : undefined);
        } catch (error) {
          if (!leaseLost) throw error;
          incomplete = true;
        }
        try {
          await handler.close();
        } catch (error) {
          if (!leaseLost) throw error;
          incomplete = true;
        }
        try {
          await closed;
        } catch (error) {
          if (!leaseLost) throw error;
          incomplete = true;
        }
        if (incomplete)
          throw new AppError(
            'shutdown_incomplete',
            'Service resource cleanup did not complete.',
            503,
          );
      })().catch((error) => {
        // Normal cleanup recovery can retry without reopening request admission.
        if (!leaseLost) closing = undefined;
        throw error;
      });
      return closing;
    },
  };
}
