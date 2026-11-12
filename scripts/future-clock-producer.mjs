#!/usr/bin/env node
// D5663: run one approved test part without issue/Slack credentials; atomically publish its exit and TAP digest.
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { partsOf } from './test-drift-parts.mjs';

export function produce(part, env = process.env, execute = spawnSync) {
  const expected = partsOf(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts).filter(p => p.name !== 'rest').map(p => p.name);
  if (!expected.includes(part) || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT || '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || Number(env.FUTURE_CLOCK_DAYS) !== 7) throw new Error('producer_identity_invalid');
  const dir = join(env.RUNNER_TEMP, 'future-clock'); mkdirSync(dir, { recursive: true });
  const log = join(dir, 'future-clock.tap'), fd = openSync(log, 'wx');
  let result;
  try { result = execute(process.execPath, ['scripts/test-drift-parts.mjs', part], { env, stdio: ['ignore', fd, fd] }); }
  finally { closeSync(fd); }
  const bytes = readFileSync(log);
  const manifest = { schema: 1, part, runId: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT), sha: env.GITHUB_SHA, days: 7,
    exitCode: Number.isInteger(result.status) ? result.status : null, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const temporary = join(dir, 'manifest.tmp'); writeFileSync(temporary, JSON.stringify(manifest), { flag: 'wx' }); renameSync(temporary, join(dir, 'manifest.json'));
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { produce(process.argv[2]); } catch { console.error('::error::future-clock producer evidence unavailable'); process.exitCode = 1; }
}
