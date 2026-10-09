import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseMetadata } from '../release-metadata.mjs';

const input = {
  version: '0.1.0',
  repository: 'Example/Fanqie-MCP',
  ref: 'refs/heads/main',
  publish: 'false',
};
test('release rehearsal uses a version tag and normalizes the registry repository', () => {
  assert.deepEqual(releaseMetadata(input), {
    version: '0.1.0',
    image: 'ghcr.io/example/fanqie-mcp:0.1.0',
  });
});
test('publishing requires an explicit choice and the matching package tag', () => {
  assert.throws(() => releaseMetadata({ ...input, publish: 'true' }), /matching version tag/);
  assert.throws(() => releaseMetadata({ ...input, ref: 'refs/tags/v0.2.0' }), /match package/);
  assert.doesNotThrow(() =>
    releaseMetadata({ ...input, ref: 'refs/tags/v0.1.0', publish: 'true' }),
  );
});
test('invalid metadata cannot inject registry names or workflow output lines', () => {
  for (const version of ['latest', '0.1.0\nimage=other', '0.1.0;echo', 'v0.1.0'])
    assert.throws(() => releaseMetadata({ ...input, version }), /Invalid release version/);
  for (const repository of ['', 'example/repo/other', 'example/repo\npublish=true'])
    assert.throws(() => releaseMetadata({ ...input, repository }), /Invalid repository/);
  assert.throws(() => releaseMetadata({ ...input, publish: 'yes' }), /Invalid publish choice/);
});
