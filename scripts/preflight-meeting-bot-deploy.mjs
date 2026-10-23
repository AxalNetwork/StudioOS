#!/usr/bin/env node
// The same image gate runs before D1 in npm predeploy and the deploy workflow.
// No fixture/bypass option: an absent runtime is a failed deployment preflight.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImage } from './lib/meetingBotImage.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  if (process.argv.length !== 2) throw Error('invalid_arguments');
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (commit.status !== 0) throw Error('invalid_revision');
  buildImage({ context: resolve(root, 'meeting-bot'), repository: 'AxalNetwork/StudioOS',
    revision: commit.stdout.trim(), run: (command, args) => spawnSync(command, args, { stdio: ['ignore', 2, 2] }) });
  process.stdout.write('Meeting bot image preflight passed.\n');
} catch (error) {
  const codes = ['invalid_arguments', 'invalid_revision', 'runtime_image_not_ready', 'image_build_failed'];
  console.error(codes.includes(error?.message) ? error.message : 'image_preflight_failed');
  process.exitCode = 1;
}
