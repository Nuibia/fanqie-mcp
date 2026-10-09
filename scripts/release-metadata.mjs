import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function releaseMetadata({ version, repository, ref, publish }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version))
    throw new Error('Invalid release version');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository');
  if (!['true', 'false'].includes(publish)) throw new Error('Invalid publish choice');
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`)
    throw new Error('Release tag must match package version');
  if (publish === 'true' && ref !== `refs/tags/v${version}`)
    throw new Error('Publishing requires the matching version tag');
  return { version, image: `ghcr.io/${repository.toLowerCase()}:${version}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const metadata = releaseMetadata({
    version,
    repository: process.env.GITHUB_REPOSITORY ?? '',
    ref: process.env.GITHUB_REF ?? '',
    publish: process.env.RELEASE_PUBLISH ?? 'false',
  });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${metadata.version}\nimage=${metadata.image}\n`,
    );
  console.log(JSON.stringify(metadata));
}
