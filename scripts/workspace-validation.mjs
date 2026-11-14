#!/usr/bin/env node
/**
 * D5573 (#5573) — the LOCAL MOCKED workspace validation run: synthetic tasks for synthetic ventures through the
 * D5565/D5567 contracts and an in-process fake provider with injectable faults. Deterministic for a seed. No network,
 * no credentials, no cloud or production call; the report's evidence class is always `local_mocked`.
 *
 *   node scripts/workspace-validation.mjs [--tasks 10] [--tenants 2] [--concurrency 10]
 *        [--faults all|none|f1,f2] [--seed 5573] [--commit <sha>] [--out <dir>]
 *
 * Writes `<out>/workspace-validation.json` and `.md` when `--out` is given; prints counts and the verdict.
 * Exit 0 on a pass, 1 on a failed invariant or a dishonest report, 2 on a usage error.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LOADER = pathToFileURL(join(ROOT, 'cloudflare-worker/test/_ts-loader.mjs')).href;
const HARNESS = pathToFileURL(join(ROOT, 'cloudflare-worker/test/_workspace_validation_5573.ts')).href;
const FLAGS = new Set(['--tasks', '--tenants', '--concurrency', '--faults', '--seed', '--commit', '--out']);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!FLAGS.has(flag) || value === undefined || value.startsWith('--')) throw new Error(`Unknown or incomplete option: ${flag}`);
    out[flag.slice(2)] = value;
  }
  return out;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  if (!process.env.WORKSPACE_VALIDATION_TS) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', LOADER, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, WORKSPACE_VALIDATION_TS: '1' } });
    return child.status ?? 1;
  }
  const { runValidation, FAULTS } = await import(HARNESS);
  const { validateReport } = await import(pathToFileURL(join(ROOT, 'scripts/lib/workspaceReport.mjs')).href);
  const num = (name) => (args[name] === undefined ? undefined : Number(args[name]));
  const faults = args.faults === undefined || args.faults === 'all' ? [...FAULTS] : args.faults === 'none' ? [] : args.faults.split(',');
  let commit = args.commit;
  if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { commit = 'unknown'; } }
  let run;
  try {
    run = await runValidation({ tasks: num('tasks'), tenants: num('tenants'), concurrency: num('concurrency'), seed: num('seed'), faults }, commit);
  } catch (e) { console.error(e.message); return 2; }
  const { report, markdown } = run;
  const problems = validateReport(report);
  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, 'workspace-validation.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(args.out, 'workspace-validation.md'), markdown);
  }
  console.log(`evidence_class=${report.evidence_class} tasks=${report.sample_size.tasks} executions=${report.sample_size.executions} `
    + `success_pct=${report.success_pct} prs=${report.pr_count} verdict=${report.verdict}`);
  for (const i of report.invariants) console.log(`${i.ok ? 'pass' : 'FAIL'} ${i.name} checked=${i.checked} violations=${i.violations.length}`);
  for (const p of problems) console.error(`report problem: ${p}`);
  return report.verdict === 'pass' && !problems.length ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
