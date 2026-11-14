#!/usr/bin/env node
/**
 * D4870 part 2 (#4870): the hosted gateway live check, items 1 and 2 (owner
 * decisions Q1 = B and Q2 = A, 2026-11-14). Run by
 * `.github/workflows/gateway-live-check.yml` (dispatch only).
 *
 *   GATEWAY_SLUG=<id> node scripts/gateway-live-check.mjs --run <id> [--summary out.json]
 *
 * THE STEPS, each in the summary. The Worker is deleted in `finally`, pass or fail:
 *   1. config    `renderProbeConfig`, refused by `checkProbeConfig` if it could
 *                reach production: flat, workers.dev only, the AI binding only
 *   2. deploy    `studioos-s4870-<run>`, then a per-run PROBE_TOKEN secret
 *   3. check     one synthetic call through the owner's gateway, its log read
 *                with `logCarriesNoPayload`, the cost read
 *   4. verdict   `liveCheckVerdict`: answered on Unified Billing with the
 *                row's model, no payload in the log, the log's cost against
 *                D851's settled charge, and the rows marked for reconciliation
 *   5. teardown  `wrangler delete`
 *
 * The production switch, `AI_PROVIDER_GATEWAY_OPENAI`, is never set: the probe
 * calls the gateway itself and production's code path stays off. The log, the
 * step summary and the artifact hold states, counts and amounts only.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkProbeConfig, gatewaySlugOk, liveCheckNames, liveCheckVerdict, renderProbeConfig } from './lib/gatewayLiveCheck.mjs';

const ROOT = process.cwd();
const WORKER_DIR = resolve(ROOT, 'cloudflare-worker');
const args = process.argv.slice(2);
const value = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const SUMMARY = value('--summary');
const STARTED = Date.now();
const WALL_CLOCK_MS = 15 * 60 * 1000;

const n = liveCheckNames(value('--run'));
const CONFIG = resolve(ROOT, n.configFile);
const slug = process.env.GATEWAY_SLUG ?? '';
const log = (m) => console.log(`[gateway-live-check] ${m}`);
let deployed = false;
const summary = {
  issue: 4870, label: 'HOSTED GATEWAY LIVE CHECK', run: n.run, worker: n.worker, commit: process.env.GITHUB_SHA || null,
  started_at: new Date(STARTED).toISOString(), steps: {}, verdict: 'fail', reason: null,
};

/** One wrangler call; output is returned, never printed. A failure names its error codes only. */
function wrangler(argv, { input, allowFail = false } = {}) {
  const r = spawnSync('npx', ['--no-install', 'wrangler', ...argv], { cwd: WORKER_DIR, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) {
    const codes = [...new Set(`${r.stdout}\n${r.stderr}`.match(/Authentication error|not found|already exists|\b1\d{4}\b/g) || [])].join(' ');
    throw new Error(`wrangler ${argv.slice(0, 2).join(' ')} failed (${codes || 'output withheld'})`);
  }
  return r;
}

async function step(name, fn) {
  if (Date.now() - STARTED > WALL_CLOCK_MS) throw new Error(`the 15-minute ceiling ran out before ${name}`);
  const t0 = Date.now();
  try {
    const result = await fn();
    summary.steps[name] = { ok: true, ms: Date.now() - t0, ...(result || {}) };
    log(`✓ ${name}`);
    return result;
  } catch (e) {
    summary.steps[name] = { ok: false, ms: Date.now() - t0 };
    summary.reason = `${name}: ${e.message}`;
    throw e;
  }
}

try {
  if (!gatewaySlugOk(slug)) throw new Error('GATEWAY_SLUG is missing or not an AI Gateway id');

  await step('config', () => {
    const text = renderProbeConfig({ worker: n.worker, slug, toml: readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8') });
    checkProbeConfig(text, n.worker);
    writeFileSync(CONFIG, text);
  });

  let base = null;
  const token = randomBytes(32).toString('hex');
  await step('deploy', () => {
    const gen = spawnSync('node', ['scripts/build-generated.mjs'], { cwd: ROOT, encoding: 'utf8' });
    if (gen.status !== 0) throw new Error('could not write the generated modules');
    const out = wrangler(['deploy', '--config', CONFIG]);
    deployed = true;
    base = (`${out.stdout}\n${out.stderr}`.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/g) || []).find((u) => u.startsWith(`https://${n.worker}.`)) || null;
    if (!base) throw new Error('the deploy printed no workers.dev address');
    wrangler(['secret', 'put', 'PROBE_TOKEN', '--name', n.worker], { input: token });
  });

  const answer = await step('check', async () => {
    // A new secret can take a few seconds to reach every location: bounded retries on 403 only.
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/check?run=${n.run}`, { method: 'POST', headers: { 'x-probe-token': token }, signal: AbortSignal.timeout(120_000) });
      if (r.status === 403 && i < 5) { await new Promise((ok) => setTimeout(ok, 5_000)); continue; }
      if (r.status !== 200) throw new Error(`the probe answered ${r.status}`);
      const body = await r.json();
      if (body?.error) throw new Error(`the probe refused: ${body.error}`);
      return { probe: body };
    }
    throw new Error('the probe never accepted the run token');
  });

  await step('verdict', () => {
    const v = liveCheckVerdict(answer.probe);
    summary.checks = v.checks;
    summary.fails = v.fails;
    if (v.verdict !== 'pass') throw new Error(v.fails.join('; '));
  });
  summary.verdict = 'pass';
} catch (e) {
  summary.reason ||= e.message;
  log(`FAIL: ${summary.reason}`);
} finally {
  if (deployed) {
    const r = wrangler(['delete', '--name', n.worker, '--force'], { allowFail: true });
    summary.deleted = [{ what: `worker ${n.worker}`, ok: r.status === 0 }];
    if (r.status !== 0) log(`WARN: could not delete worker ${n.worker}; delete it by hand`);
  }
  if (existsSync(CONFIG)) rmSync(CONFIG);
  summary.finished_at = new Date().toISOString();
  if (SUMMARY) writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  log(`verdict: ${summary.verdict}`);
  if (summary.deleted?.some((d) => !d.ok) || summary.verdict !== 'pass') process.exitCode = 1;
}
