#!/usr/bin/env node
/** Read-only public smoke checks for declared branches. Never provisions or deploys. */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH_CODE_RE, hqIds, validateBranch } from './lib/branchConfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Validate declarations before deriving any remote destination. */
export function liveBranchTargets(records, ids, selectedCode = null) {
  if (selectedCode !== null && !BRANCH_CODE_RE.test(selectedCode)) {
    throw new Error('Select a branch code, not a URL, HQ host, or command option.');
  }
  const declared = records.filter(({ file }) => file.endsWith('.json') && !file.startsWith('_'));
  const resources = new Map();
  for (const { file, entry } of declared) {
    const errors = validateBranch(entry, ids);
    if (entry?.code !== file.slice(0, -5)) errors.push('code does not match the registry filename');
    if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
    for (const [kind, id] of [['d1', entry.ids.d1], ['kv', entry.ids.kv_tokens], ['kv', entry.ids.kv_rate_limits]]) {
      const key = `${kind}:${id}`;
      if (resources.has(key)) {
        throw new Error(`${file} shares a ${kind} resource with ${resources.get(key)}; branch storage is not isolated.`);
      }
      resources.set(key, file);
    }
  }
  if (selectedCode && !declared.some(({ entry }) => entry.code === selectedCode)) {
    throw new Error(`No declaration for ${selectedCode} in infra/branches/.`);
  }
  const selected = declared.filter(({ entry }) => !selectedCode || entry.code === selectedCode);
  if (selectedCode && selected[0].entry.status === 'suspended') {
    throw new Error(`${selectedCode} is suspended; no live smoke requested.`);
  }
  const targets = selected.filter(({ entry }) => ['live', 'provisioning'].includes(entry.status));
  if (!targets.length) throw new Error('No live or provisioning branches are declared. The example is not a live target.');
  return targets.map(({ entry }) => ({ code: entry.code, host: `https://${entry.hostname}` }));
}

function main() {
  const args = process.argv.slice(2);
  const planOnly = args.includes('--plan');
  const codes = args.filter(arg => arg !== '--plan');
  if (codes.length > 1) throw new Error('Usage: node scripts/check-branch-live.mjs [code] [--plan]');
  const directory = join(ROOT, 'infra/branches');
  const records = readdirSync(directory).filter(file => file.endsWith('.json')).map(file => ({
    file, entry: JSON.parse(readFileSync(join(directory, file), 'utf8')),
  }));
  const targets = liveBranchTargets(records, hqIds(readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')), codes[0] ?? null);
  for (const target of targets) console.log(`[branch-live] ${target.code}: ${target.host}`);
  if (planOnly) {
    console.log('[branch-live] Plan only; no network checks performed. Permit the listed hostnames through the configured network policy before running.');
    return;
  }
  if (process.env.SKIP_LIVE_SMOKE === '1') throw new Error('SKIP_LIVE_SMOKE=1 would skip verification; remove it before running.');
  const config = spawnSync(process.execPath, [join(ROOT, 'scripts/check-branch-config.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (config.error) throw config.error;
  if (config.status !== 0) { process.exitCode = config.status || 1; return; }
  for (const target of targets) {
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts/check-spa-live.mjs'), target.host], { cwd: ROOT, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status || 1; return; }
  }
  console.log('[branch-live] Public smoke checks passed. This does not verify authenticated tenant isolation or HQ RPC access.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`[branch-live] ${error.message}`);
    process.exitCode = 2;
  }
}
