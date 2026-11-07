#!/usr/bin/env node
/**
 * #4566 — write the synthetic seed, cleanup or residual check for one run as
 * a SQL file (rules: `scripts/lib/agentSyntheticFixtures.mjs`).
 *
 *   node scripts/agent-validation-fixtures.mjs seed --run a0run01 --tenants 2 --agents 1 --tasks 2 \
 *     --preflight preflight.json --out seed.sql
 *   node scripts/agent-validation-fixtures.mjs cleanup  --run a0run01 --preflight preflight.json --out cleanup.sql
 *   node scripts/agent-validation-fixtures.mjs residual --run a0run01 --preflight preflight.json --out residual.sql
 *
 * FAIL CLOSED. It writes a file only when `--preflight` names the JSON that
 * `scripts/check-preview-isolation.mjs --observed … --json` produced, with the
 * verdict `isolated`, taken within the last 24 hours. `--local` writes for a
 * local SQLite copy instead and marks the file so; it is never for a hosted
 * database. It applies nothing: the owner runs the file with
 * `wrangler d1 execute <preview database> --env preview --remote --file …`
 * (the runbook, documentation/operations/AGENT_EXECUTION_VALIDATION.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cleanupStatements, residualStatements, seedStatements, toSqlFile } from './lib/agentSyntheticFixtures.mjs';

const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const die = (m) => { console.error(`✗ agent-validation-fixtures: ${m}`); process.exit(1); };
const what = args[0];
const run = value('--run');
const out = value('--out');
if (!['seed', 'cleanup', 'residual'].includes(what)) die('first argument is seed, cleanup or residual');
if (!out) die('--out <file.sql> is required');

const local = args.includes('--local');
if (!local) {
  const path = value('--preflight');
  if (!path) die('--preflight <check-preview-isolation --json output> is required; without it the target is not known to be isolated');
  let pre;
  try { pre = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(`the preflight could not be read (${e.message})`); }
  if (pre?.verdict !== 'isolated') die(`the preflight verdict is ${JSON.stringify(pre?.verdict ?? null)}, not "isolated"; nothing was written`);
  const taken = Date.parse(pre?.observed_at ?? '');
  if (!Number.isFinite(taken) || Date.now() - taken > 24 * 3600_000) die('the preflight is older than 24 hours or has no observed_at; run it again');
}

let stmts;
try {
  if (what === 'seed') stmts = seedStatements({ run, tenants: Number(value('--tenants') ?? 1), agentsPerTenant: Number(value('--agents') ?? 1), tasksPerAgent: Number(value('--tasks') ?? 1) });
  else if (what === 'cleanup') stmts = cleanupStatements(run);
  else stmts = residualStatements(run);
} catch (e) { die(e.message); }

const head = `-- #4566 synthetic ${what} for run ${run}${local ? ' — LOCAL SQLite only, never a hosted database' : ''}.\n`;
writeFileSync(out, head + toSqlFile(stmts));
console.log(`✓ agent-validation-fixtures: wrote ${stmts.length} statements to ${out}`);
