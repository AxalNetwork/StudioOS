#!/usr/bin/env node
/**
 * #2586 (D886 B8): builds the meeting bot's runtime image from `meeting-bot/`
 * only when its Dockerfile and ignore file both exist, through
 * `lib/meetingBotImage.mjs`; prints `image=<ref>` on a real build. `--fixture`
 * builds a scratch image to smoke-test CI plumbing and emits no publishable
 * output. No migrations, deployment, login or publication.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildImage } from './lib/meetingBotImage.mjs';

const fixture = process.argv.length === 3 && process.argv[2] === '--fixture';
let temporary;
try {
  if (process.argv.length > 2 && !fixture) throw new Error('invalid_arguments');
  let context = resolve('meeting-bot');
  if (fixture) {
    temporary = mkdtempSync(join(tmpdir(), 'meeting-bot-image-'));
    context = temporary;
    writeFileSync(join(context, 'Dockerfile'), 'FROM scratch\nLABEL org.axal.pipeline-fixture="true"\n');
    writeFileSync(join(context, '.dockerignore'), '*\n!Dockerfile\n');
  }
  const image = buildImage({ context, repository: process.env.GITHUB_REPOSITORY,
    revision: process.env.GITHUB_SHA, fixture,
    run: (command, args) => spawnSync(command, args, { stdio: ['ignore', 2, 2] }) });
  // Only successful real builds provide a publishable output. Fixture builds do not.
  if (!fixture) process.stdout.write(`image=${image}\n`);
} catch (error) {
  const codes = ['invalid_arguments', 'invalid_repository', 'invalid_revision', 'runtime_image_not_ready', 'image_build_failed'];
  console.error(codes.includes(error?.message) ? error.message : 'image_pipeline_failed');
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
