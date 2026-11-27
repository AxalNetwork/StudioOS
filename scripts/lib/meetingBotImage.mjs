/** #2586: image construction only. Hosting and runtime contracts belong to B0/B1/B2. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function imagePlan(repository, revision, fixture = false) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository ?? '')) throw new Error('invalid_repository');
  if (!/^[0-9a-f]{40}$/.test(revision ?? '')) throw new Error('invalid_revision');
  const image = fixture ? `meeting-bot-pipeline-fixture:sha-${revision}` : `ghcr.io/${repository.toLowerCase()}/meeting-bot:sha-${revision}`;
  return { image, args: ['build', '--pull', '--platform', 'linux/amd64', '--tag', image,
    '--label', `org.opencontainers.image.revision=${revision}`,
    '--label', `org.opencontainers.image.source=https://github.com/${repository}`] };
}

export function buildImage({ context, repository, revision, fixture = false, run }) {
  const plan = imagePlan(repository, revision, fixture);
  // Missing B2 input fails before any registry authentication or publication.
  if (!existsSync(join(context, 'Dockerfile')) || !existsSync(join(context, '.dockerignore'))) throw new Error('runtime_image_not_ready');
  const result = run('docker', [...plan.args, '--file', join(context, 'Dockerfile'), context]);
  if (result?.status !== 0) throw new Error('image_build_failed');
  return plan.image;
}
