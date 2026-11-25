#!/usr/bin/env node
/**
 * D8507 (#8507) — the sweep for hosted Stage A: lists the account's Workers,
 * D1 databases, KV namespaces, queues, R2 buckets and Workflows, deletes the
 * ones that are one run's own Stage A names (`stageASweep.mjs`), lists again
 * and reports how many are left. Run by `.github/workflows/agent-stage-a.yml`'s
 * second job, `if: always()`, after the Stage A job; a manual dispatch with an
 * earlier run's id sweeps that run instead.
 *
 *   node scripts/agent-stage-a-sweep.mjs --run <id> [--receipt receipt.jsonl] [--summary out.json] [--dry-run]
 *
 * Exits 1 when anything is left or a list could not be read. Prints and
 * writes names, counts and states only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { leftCount, parseReceipt, selectForSweep } from './lib/stageASweep.mjs';
import { stageANames as runIdOk } from './lib/stageARun.mjs';

const ROOT = process.cwd();
const WORKER_DIR = resolve(ROOT, 'cloudflare-worker');
const args = process.argv.slice(2);
const value = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const RUN = value('--run');
const RECEIPT = value('--receipt');
const SUMMARY = value('--summary');
const DRY = args.includes('--dry-run');
/** The commit this harness runs from: the workflow pins it, the summary states it. */
const harnessRevision = (cwd) => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : (process.env.GITHUB_SHA || null); };
const log = (m) => console.log(`[stage-a-sweep] ${m}`);

function wrangler(argv) {
  return spawnSync('npx', ['--no-install', 'wrangler', ...argv], { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
const json = (r) => { if (r.status !== 0) return undefined; try { return JSON.parse(r.stdout); } catch { return undefined; } };
/** `wrangler` prints some lists as tables only; the names are read with one fixed pattern. */
const names = (r) => (r.status === 0 ? [...new Set(String(r.stdout).match(/studioos-[a-z0-9_-]+/g) || [])] : undefined);

function list() {
  const d1 = json(wrangler(['d1', 'list', '--json']));
  const kv = json(wrangler(['kv', 'namespace', 'list']));
  // The run's one Worker, asked for by name. "Does not exist" (10007) is none listed; any other failure is unread.
  const worker = `studioos-s4594-${RUN}`;
  const w = wrangler(['deployments', 'list', '--name', worker]);
  return {
    worker: w.status === 0 ? [worker] : (/10007|does not exist|not found/i.test(`${w.stdout}\n${w.stderr}`) ? [] : undefined),
    d1: Array.isArray(d1) ? d1.map((x) => x?.name).filter(Boolean) : undefined,
    kv: Array.isArray(kv) ? kv.map((x) => ({ title: x?.title, id: x?.id })) : undefined,
    queue: names(wrangler(['queues', 'list'])),
    bucket: names(wrangler(['r2', 'bucket', 'list'])),
    workflow: names(wrangler(['workflows', 'list'])),
  };
}

function remove(d) {
  const argv = {
    worker: ['delete', '--name', d.name, '--force'],
    workflow: ['workflows', 'delete', d.name],
    queue: ['queues', 'delete', d.name],
    kv: ['kv', 'namespace', 'delete', '--namespace-id', d.id ?? ''],
    bucket: ['r2', 'bucket', 'delete', d.name],
    d1: ['d1', 'delete', d.name, '--skip-confirmation'],
  }[d.kind];
  if (d.kind === 'kv' && !d.id) return false;
  return wrangler(argv).status === 0;
}

const summary = { issue: 8507, run: RUN, harness: harnessRevision(ROOT), dry_run: DRY, receipt: null, selected: [], deleted: [], failed: [], unread: [], left: null };
try {
  runIdOk(RUN);
  let receipt = [];
  if (RECEIPT && existsSync(RECEIPT)) {
    const r = parseReceipt(readFileSync(RECEIPT, 'utf8'), RUN);
    receipt = r.entries;
    summary.receipt = { entries: r.entries.length, torn: r.torn, refused: r.refused.length };
  } else summary.receipt = { entries: 0, torn: 0, refused: 0, missing: true };
  const plan = selectForSweep({ run: RUN, listed: list(), receipt });
  summary.selected = plan.delete.map((d) => `${d.kind}:${d.name}`);
  summary.unread = plan.unread;
  summary.already_gone = plan.gone;
  if (!DRY) for (const d of plan.delete) (remove(d) ? summary.deleted : summary.failed).push(`${d.kind}:${d.name}`);
  const after = leftCount({ run: RUN, listed: list() });
  summary.left = after.left;
  summary.still_listed = after.still;
  summary.unread = after.unread;
} catch (e) {
  summary.error = e.message;
} finally {
  if (SUMMARY) writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  log(`run ${RUN}: selected ${summary.selected.length}, deleted ${summary.deleted.length}, failed ${summary.failed.length}, left ${summary.left ?? 'unknown'}`);
  if (summary.error || summary.left !== 0) process.exitCode = 1;
}
