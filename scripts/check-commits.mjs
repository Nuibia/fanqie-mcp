import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function selectCommitRange(base, runGit = git) {
  if (!base || /^0+$/.test(base)) return 'HEAD';
  if (!/^[a-f0-9]{40}$/i.test(base)) throw new Error('Commit base must be a full Git SHA.');
  try {
    runGit(['merge-base', '--is-ancestor', base, 'HEAD']);
    return `${base}..HEAD`;
  } catch {
    // Initial history replacement can point to a missing or unrelated old SHA.
    return 'HEAD';
  }
}

export function checkCommits(base = process.env.COMMIT_BASE) {
  const range = selectCommitRange(base);
  const messages = git(['log', '--reverse', '--format=%B%x00', range])
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean);
  if (!messages.length) throw new Error('The selected commit range is empty.');
  for (const message of messages) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'node_modules/@commitlint/cli/cli.js'),
        '--config',
        path.join(root, 'commitlint.config.mjs'),
        '--strict',
      ],
      { input: `${message}\n`, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  console.log(`Validated ${messages.length} commit message(s).`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = checkCommits();
}
