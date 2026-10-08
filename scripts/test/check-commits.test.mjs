import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectCommitRange } from '../check-commits.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(root, 'node_modules/@commitlint/cli/cli.js');
const config = path.join(root, 'commitlint.config.mjs');
const sha = 'a'.repeat(40);

test('initial pushes and rewritten history validate the reachable history including its root', () => {
  assert.equal(selectCommitRange(undefined), 'HEAD');
  assert.equal(selectCommitRange('0'.repeat(40)), 'HEAD');
  assert.equal(
    selectCommitRange(sha, () => {
      throw Error('old history is not reachable');
    }),
    'HEAD',
  );
});

test('normal pushes and PRs validate every commit after their ancestor base', () => {
  assert.equal(
    selectCommitRange(sha, (args) =>
      assert.deepEqual(args, ['merge-base', '--is-ancestor', sha, 'HEAD']),
    ),
    `${sha}..HEAD`,
  );
});

test('commit range rejects option injection and abbreviated or malformed SHAs', () => {
  for (const input of [
    '--all',
    'HEAD~1',
    'a'.repeat(7),
    'g'.repeat(40),
    'a'.repeat(40) + '..HEAD',
  ]) {
    assert.throws(() => selectCommitRange(input, () => assert.fail('invalid base reached git')));
  }
});

for (const [message, valid] of [
  ['ci: split core tests into independent shards', true],
  ['fix(auth): 修复登录状态检查', true],
  ['docs: clarify installation\n\nExplain the first public query.', true],
  ['Prepare query-first open-source candidate', false],
  ['unknown: add a feature', false],
  ['fix: ' + 'a'.repeat(96), false],
]) {
  test(`commitlint ${valid ? 'accepts' : 'rejects'} ${JSON.stringify(message.split('\n')[0])}`, () => {
    const result = spawnSync(process.execPath, [cli, '--config', config, '--strict'], {
      input: message + '\n',
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status === 0, valid, result.stdout + result.stderr);
  });
}

test('CI checks intermediate messages and the initial root, not just the last commit', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-commit-range-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Synthetic contributor']);
  git(['config', 'user.email', 'contributor@example.invalid']);
  git(['config', 'core.hooksPath', '/dev/null']);
  git(['commit', '--quiet', '--allow-empty', '-m', 'chore: initialize project']);
  const base = git(['rev-parse', 'HEAD']).trim();
  git(['commit', '--quiet', '--allow-empty', '-m', 'invalid intermediate message']);
  const second = git(['rev-parse', 'HEAD']).trim();
  git(['commit', '--quiet', '--allow-empty', '-m', 'fix: update project']);
  const run = (commitBase) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/check-commits.mjs')], {
      cwd: directory,
      env: { ...process.env, COMMIT_BASE: commitBase },
      encoding: 'utf8',
    });
  assert.notEqual(run(base).status, 0);
  assert.notEqual(run('0'.repeat(40)).status, 0);
  assert.notEqual(run(sha).status, 0);
  assert.equal(run(second).status, 0);
});
