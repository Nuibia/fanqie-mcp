import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = process.env.FANQIE_TEST_URL ?? 'http://127.0.0.1:18062';
const token = readFileSync(
  process.env.FANQIE_TEST_TOKEN_FILE ?? '.secrets/api-token',
  'utf8',
).trim();
mkdirSync('.runtime/acceptance', { recursive: true, mode: 0o700 });
chmodSync('.runtime/acceptance', 0o700);
const client = new Client(
  { name: 'fanqie-read-page-acceptance-local', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);
try {
  for (const sourceUrl of process.argv.slice(2)) {
    const response = await client.callTool(
      { name: 'fanqie_diagnose_read_page', arguments: { sourceUrl } },
      { timeout: 135_000 },
    );
    const result =
      response.structuredContent?.result ??
      JSON.parse(response.content.find((item) => item.type === 'text')?.text ?? '{}');
    const receipt = {
      isError: response.isError === true,
      jobId: result.job?.id,
      status: result.job?.status,
      errorCode: result.job?.error?.code ?? null,
      requestedAt: result.job?.requestedAt,
      platformReadStartedAt: result.job?.platformReadStartedAt,
      endedAt: result.job?.endedAt,
      evidence: (result.evidence ?? []).map(({ id, dataset, sha256 }) => ({ id, dataset, sha256 })),
      diagnostics: result.data ?? [],
    };
    writeFileSync(
      `.runtime/acceptance/read-page-${result.job.id}.json`,
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(receipt));
  }
} finally {
  await client.close();
}
