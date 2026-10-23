#!/usr/bin/env node
// Offline Wrangler bundle/config validation only. The scratch image is an
// explicitly isolated fixture; it cannot reach a publish/deploy command.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderBranchConfig } from './lib/branchConfig.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'meeting-bot-dry-run-'));
try {
  if (process.argv.length !== 2) throw Error('invalid_arguments');
  writeFileSync(join(temporary, 'Dockerfile'), 'FROM scratch\nLABEL org.axal.pipeline-fixture="true"\n');
  mkdirSync(join(temporary, 'assets'));
  writeFileSync(join(temporary, 'assets', 'index.html'), '<!doctype html><title>Pipeline fixture</title>');
  let source = readFileSync(join(root, 'wrangler.toml'), 'utf8');
  source = source.replace(/^main\s*=.*$/m, `main = ${JSON.stringify(join(root, 'cloudflare-worker/src/index.ts'))}`)
    .replaceAll('"./meeting-bot/Dockerfile"', JSON.stringify(join(temporary, 'Dockerfile')))
    .replaceAll('"./meeting-bot"', JSON.stringify(temporary))
    .replace(/^(\s*directory\s*=)\s*"[^"]*"/gm, `$1 ${JSON.stringify(join(temporary, 'assets'))}`);
  const config = join(temporary, 'wrangler.toml');
  writeFileSync(config, source);
  const branch=join(temporary,'wrangler.branch.fixture.toml');
  const fixture=JSON.parse(readFileSync(join(root,'infra/branches/_example.json'),'utf8'));
  writeFileSync(branch,renderBranchConfig(source,fixture));
  for (const target of [{config,environment:'production'},{config,environment:'preview'},{config:branch}]) {
    const result = spawnSync(process.execPath, [join(root, 'cloudflare-worker/node_modules/wrangler/bin/wrangler.js'),
      'deploy', '--config', target.config, ...(target.environment?['--env',target.environment]:[]), '--dry-run', '--outdir', join(temporary, target.environment??'branch')],
    { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH:join(temporary,'wrangler.log') } });
    if (result.status !== 0) throw Error('container_dry_run_failed');
  }
} catch {
  console.error('container_dry_run_failed');
  process.exitCode = 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
