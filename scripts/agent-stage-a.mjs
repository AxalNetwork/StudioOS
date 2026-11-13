#!/usr/bin/env node
/**
 * D4594 part 3 (#4594) — hosted Stage A: one real agent lifecycle on a
 * throwaway Worker, with STUBBED INFERENCE. Owner decisions 1 = A and 2 = A
 * (2026-11-12). Run by `.github/workflows/agent-stage-a.yml` (dispatch only).
 *
 *   node scripts/agent-stage-a.mjs --run <id> [--summary out.json]
 *
 * THE STEPS, each in the summary's ledger. Everything created is deleted in
 * `finally`, pass or fail:
 *   1. create        D1 (a #4591 rehearsal side), three KV namespaces, the
 *                    queues and DLQs, three R2 buckets: all `-s4594-<run>`
 *   2. provision     `migrate-d1.mjs --rehearsal <run>-src`: bootstrap, apply,
 *                    then a dry run that must report nothing pending
 *   3. seed          #4566's fixtures (one tenant, one agent, two tasks,
 *                    synthetic.invalid only) and `extraSeed`
 *   4. deploy        the flat config (`renderFlat`), after `checkFlat`; a
 *                    per-run JWT_SECRET is the only secret
 *   5. preflight     the observation from read-only list commands, through
 *                    the #4566 `preflight()`. Anything but `isolated` stops
 *                    the run before any agent step.
 *   6. workflow path start → admission → queue → Workflow → proposal → the
 *                    sponsor accepts → the run is done
 *   7. manual path   the sponsor's own run → proposal → the sponsor accepts
 *   8. reconcile     the local harness's ledger reads (`RECONCILE`)
 *   9. ceilings      wall clock, rows added by the agent phase, model spend
 *  10. teardown      the Worker, the Workflow, the queues, KV, R2, D1
 *
 * AUTHORIZATION IS THE WORKER'S OWN. The driver signs the synthetic sponsor's
 * bearer token with the run's JWT_SECRET, the same HS256 token the Worker
 * issues at sign-in. No endpoint is added, and nothing is bypassed.
 *
 * NOT IN THIS SCRIPT YET: S1's #4555 pass with `AGENT_SKILL_RUNTIME =
 * "cloudflare_sdk"`. It needs a published skill pinned to the synthetic
 * agent, and the #4566 fixtures seed none (D4594-p3 §4).
 *
 * The log, the step summary and the artifact hold names, counts, states and
 * timings only. Wrangler output that could quote SQL or a secret is withheld.
 */
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  CEILINGS, RECONCILE, STAGE_A_ENV, STAGE_A_VARS, checkFlat, envView, extraSeed, fixtureIds, reconcile, renderFlat,
  stageANames, stageASections, toCreate,
} from './lib/stageARun.mjs';
import { createdDatabaseId, rehearsalConfig } from './lib/schemaRehearsal.mjs';
import { rehearsalConfigPath } from './lib/migrationTargets.mjs';
import { seedStatements, toSqlFile, SYNTHETIC_MODULE, SYNTHETIC_OPTION } from './lib/agentSyntheticFixtures.mjs';
import { preflight } from './lib/previewIsolation.mjs';

const ROOT = process.cwd();
const WORKER_DIR = resolve(ROOT, 'cloudflare-worker');
const args = process.argv.slice(2);
const value = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const SUMMARY = value('--summary');
const STARTED = Date.now();
const TOML = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');

const n = stageANames(value('--run'));
const FLAT_PATH = resolve(ROOT, `wrangler.s4594.${n.run}.toml`);
const TMP = mkdtempSync(join(tmpdir(), `stage-a-${n.run}-`));
const log = (m) => console.log(`[stage-a] ${m}`);
const created = { d1: null, kv: [], queues: [], buckets: [], worker: false, workflows: [] };
const summary = {
  issue: 4594, label: 'HOSTED PLATFORM WITH STUB', run: n.run, worker: n.worker, commit: process.env.GITHUB_SHA || null,
  started_at: new Date(STARTED).toISOString(), ceilings: CEILINGS, steps: {}, paths: {}, verdict: 'fail', reason: null,
};

/** One wrangler call; output is returned, never printed. A failure names its error codes only. */
function wrangler(argv, { input, allowFail = false } = {}) {
  const r = spawnSync('npx', ['--no-install', 'wrangler', ...argv], { cwd: WORKER_DIR, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) {
    const codes = [...new Set(`${r.stdout}\n${r.stderr}`.match(/D1_[A-Z_]+|SQLITE_[A-Z_]+|Authentication error|not found|already exists|\b1\d{4}\b/g) || [])].join(' ');
    throw new Error(`wrangler ${argv.slice(0, 3).join(' ')} failed (${codes || 'output withheld'})`);
  }
  return r;
}
const d1 = (rest, opts) => wrangler(['d1', ...rest.slice(0, 1), n.d1.name, ...rest.slice(1), '--config', rehearsalConfigPath(n.d1.id), '--remote'], opts);
const query = (sql) => {
  const r = d1(['execute', '--command', sql, '--json']);
  const parsed = JSON.parse(r.stdout);
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
};

function step(name, fn) {
  if (Date.now() - STARTED > CEILINGS.wallClockMs) throw new Error(`the ${CEILINGS.wallClockMs / 60000}-minute ceiling ran out before ${name}`);
  const t0 = Date.now();
  return Promise.resolve().then(fn).then((result) => {
    summary.steps[name] = { ok: true, ms: Date.now() - t0, ...(result || {}) };
    log(`✓ ${name}`);
    return result;
  }, (e) => {
    summary.steps[name] = { ok: false, ms: Date.now() - t0 };
    summary.reason = `${name}: ${e.message}`;
    throw e;
  });
}

/** HS256, as `auth.ts` verifies it: `{ user_id, iat, exp }` signed with the Worker's JWT_SECRET. */
function bearer(secret, userId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ user_id: userId, iat: now, exp: now + 3600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

let BASE = null;
async function api(token, method, path, body) {
  const r = await fetch(`${BASE}/api/teams${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, body: json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls the run until `want(status)`; a deadline, never an open wait. */
async function until(token, runUid, want, what, limitMs = 10 * 60 * 1000) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const r = await api(token, 'GET', `/runs/${encodeURIComponent(runUid)}`);
    const run = r.body?.run;
    if (r.status === 200 && run && want(run.status)) return run;
    if (r.status === 200 && run && ['failed', 'cancelled'].includes(run.status)) throw new Error(`the run ended ${run.status} (${run.refusal || 'no refusal recorded'}) before ${what}`);
    await sleep(5000);
  }
  throw new Error(`no ${what} within ${limitMs / 60000} minutes`);
}

/** Rows in every table, summed: the agent phase's rows added (a lower bound of its writes; updates are not counted). */
function totalRows() {
  const tables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").map((r) => r.name);
  const file = join(TMP, 'count.sql');
  writeFileSync(file, `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}")`).join(' + ') || '0'} AS n;\n`);
  const r = d1(['execute', '--file', file, '--json']);
  const parsed = JSON.parse(r.stdout);
  return Number((Array.isArray(parsed) ? parsed[0] : parsed)?.results?.[0]?.n);
}

function observe(r) {
  const perms = [];
  const tryJson = (argv, perm) => {
    const out = wrangler(argv, { allowFail: true });
    if (out.status !== 0) return undefined;
    perms.push(perm);
    try { return JSON.parse(out.stdout); } catch { return out.stdout; }
  };
  const info = tryJson(['d1', 'info', n.d1.name, '--json', '--config', rehearsalConfigPath(n.d1.id)], 'd1:read');
  const kvList = tryJson(['kv', 'namespace', 'list'], 'kv:read');
  const mine = new RegExp(`studioos-[a-z-]+-s4594-${n.run}(?:-dlq)?`, 'g');
  const names = (out) => (typeof out === 'string' ? [...new Set(out.match(mine) || [])] : undefined);
  const queues = names(tryJson(['queues', 'list'], 'queues:read'));
  const workflows = names(tryJson(['workflows', 'list'], 'workflows:read'));
  const r2 = names(tryJson(['r2', 'bucket', 'list'], 'r2:read'));
  const secrets = tryJson(['secret', 'list', '--name', n.worker], 'workers:read');
  const kvIds = Array.isArray(kvList) ? Object.fromEntries(n.kv.map((k) => [k.binding, kvList.find((x) => x.title === k.title)?.id ?? null])) : undefined;
  return {
    taken_at: new Date().toISOString(), account_permissions: perms, worker: created.worker ? n.worker : undefined,
    d1: info && typeof info === 'object' ? { DB: { database_id: info.uuid ?? info.database_id ?? null, database_name: info.name ?? null } } : undefined,
    kv: kvIds, queues, workflows, r2,
    secrets: Array.isArray(secrets) ? secrets.map((s) => s.name) : undefined,
    vars: {},
    // Declared, then proven after the run: every proposal must carry the stub's answer (`verify_stub`).
    inference: r.sections.some((s) => s.kind === 'vars' && s.kv.get('AGENT_INFERENCE_STUB') === JSON.stringify(STAGE_A_VARS.AGENT_INFERENCE_STUB)) ? 'stub' : 'live',
    browser: 'unused',
  };
}

function teardown() {
  const del = (what, argv) => { const r = wrangler(argv, { allowFail: true }); (summary.deleted ||= []).push({ what, ok: r.status === 0 }); if (r.status !== 0) log(`WARN: could not delete ${what}; delete it by hand`); };
  if (created.worker) del(`worker ${n.worker}`, ['delete', '--name', n.worker, '--force']);
  for (const w of created.workflows) del(`workflow ${w}`, ['workflows', 'delete', w]);
  for (const q of created.queues) del(`queue ${q}`, ['queues', 'delete', q]);
  for (const k of created.kv) del(`kv ${k.title}`, ['kv', 'namespace', 'delete', '--namespace-id', k.id]);
  for (const b of created.buckets) del(`r2 ${b}`, ['r2', 'bucket', 'delete', b]);
  if (created.d1) del(`d1 ${n.d1.name}`, ['d1', 'delete', n.d1.name, '--skip-confirmation']);
  for (const p of [FLAT_PATH, resolve(ROOT, `wrangler.rehearsal.${n.d1.id}.toml`)]) if (existsSync(p)) rmSync(p);
  rmSync(TMP, { recursive: true, force: true });
}

try {
  const ids = { d1: null, kv: {} };
  await step('create', () => {
    const r = wrangler(['d1', 'create', n.d1.name, '--jurisdiction', 'eu']);
    ids.d1 = createdDatabaseId(r.stdout);
    created.d1 = ids.d1;
    writeFileSync(resolve(ROOT, `wrangler.rehearsal.${n.d1.id}.toml`), rehearsalConfig({ dbName: n.d1.name, databaseId: ids.d1 }));
    for (const k of n.kv) {
      const out = wrangler(['kv', 'namespace', 'create', k.title]);
      const id = (`${out.stdout}`.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/) || [])[1];
      if (!id) throw new Error(`kv namespace create printed no id for ${k.binding}`);
      created.kv.push({ title: k.title, id }); ids.kv[k.binding] = id;
    }
    const plan = toCreate(stageASections(TOML, n.run, ids));
    for (const q of plan.queues) { wrangler(['queues', 'create', q]); created.queues.push(q); }
    for (const b of plan.buckets) { wrangler(['r2', 'bucket', 'create', b]); created.buckets.push(b); }
    created.workflows.push(...plan.workflows);
    return { d1: 1, kv: created.kv.length, queues: created.queues.length, buckets: created.buckets.length };
  });

  await step('provision', () => {
    const migrate = (...flags) => {
      const r = spawnSync('node', ['scripts/migrate-d1.mjs', '--rehearsal', n.d1.id, ...flags], { cwd: ROOT, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`migrate-d1 ${flags.join(' ') || '(apply)'} failed`);
      return r.stdout;
    };
    migrate('--bootstrap'); migrate();
    const pending = Number((migrate('--dry-run').match(/(\d+) pending/) || [])[1]);
    if (pending !== 0) throw new Error(`the dry run after provisioning reports ${Number.isNaN(pending) ? 'no count' : pending} pending`);
    return { pending_after: 0 };
  });

  const ids0 = fixtureIds(n.run);
  let sponsorId;
  await step('seed', () => {
    const file = join(TMP, 'seed.sql');
    writeFileSync(file, toSqlFile([...seedStatements({ run: n.run, tenants: 1, agentsPerTenant: 1, tasksPerAgent: 2 }), ...extraSeed(n.run)]));
    d1(['execute', '--file', file]);
    sponsorId = Number(query(`SELECT id FROM users WHERE email = '${ids0.sponsorEmail}'`)[0]?.id);
    if (!Number.isSafeInteger(sponsorId)) throw new Error('the synthetic sponsor was not seeded');
    return { tenants: 1, agents: 1, tasks: 2 };
  });

  const rendered = stageASections(TOML, n.run, ids);
  const secret = randomBytes(48).toString('hex');
  await step('deploy', () => {
    const flat = renderFlat(rendered);
    checkFlat(flat, TOML);
    writeFileSync(FLAT_PATH, flat);
    const gen = spawnSync('node', ['scripts/build-generated.mjs'], { cwd: ROOT, encoding: 'utf8' });
    if (gen.status !== 0) throw new Error('could not write the generated modules');
    const out = wrangler(['deploy', '--config', FLAT_PATH]);
    created.worker = true;
    BASE = (`${out.stdout}\n${out.stderr}`.match(new RegExp(`https://${n.worker}\\.[a-z0-9-]+\\.workers\\.dev`)) || [])[0] || null;
    if (!BASE) throw new Error('the deploy printed no workers.dev address');
    wrangler(['secret', 'put', 'JWT_SECRET', '--name', n.worker], { input: secret });
    return { dropped: rendered.dropped };
  });

  await step('preflight', () => {
    const observed = observe(rendered);
    const p = preflight(envView(TOML, rendered), { env: STAGE_A_ENV, observed });
    summary.preflight = { verdict: p.verdict, rows: p.rows.length, unsafe: p.unsafe.map((u) => `${u.kind}:${u.binding}:${u.status}`), pending: p.pending.map((u) => `${u.kind}:${u.binding}:${u.status}`) };
    if (p.verdict !== 'isolated') throw new Error(`the #4566 preflight says ${p.verdict}; no agent step ran`);
    return { verdict: p.verdict };
  });

  const token = bearer(secret, sponsorId);
  const rowsBefore = totalRows();

  await step('workflow_path', async () => {
    const t0 = Date.now();
    const started = await api(token, 'POST', `/tasks/${encodeURIComponent(ids0.taskUid)}/start`);
    if (started.status !== 202 || !started.body?.run?.uid) throw new Error(`start answered ${started.status}`);
    const uid = started.body.run.uid;
    const waiting = await until(token, uid, (s) => s === 'waiting_decision', 'proposal');
    const tProposal = Date.now() - t0;
    const decided = await api(token, 'POST', `/queue/${encodeURIComponent(waiting.proposal_uid)}/decide`, { decision: 'accept' });
    if (decided.status !== 200) throw new Error(`the decision answered ${decided.status}`);
    const done = await until(token, uid, (s) => s === 'done', 'done');
    summary.paths.workflow = { status: done.status, ms_to_proposal: tProposal, ms_total: Date.now() - t0 };
    return { status: done.status };
  });

  await step('manual_path', async () => {
    const t0 = Date.now();
    const ran = await api(token, 'POST', `/agents/${encodeURIComponent(ids0.agentUid)}/run`, { module: SYNTHETIC_MODULE, option: SYNTHETIC_OPTION, prompt: 'Draft the plan for the next quarter.' });
    if (ran.status !== 200 || !ran.body?.proposal?.uid) throw new Error(`the sponsor run answered ${ran.status}`);
    const decided = await api(token, 'POST', `/queue/${encodeURIComponent(ran.body.proposal.uid)}/decide`, { decision: 'accept' });
    if (decided.status !== 200) throw new Error(`the decision answered ${decided.status}`);
    summary.paths.manual = { charged: ran.body.charged ?? null, ms_total: Date.now() - t0 };
    return { status: 'accepted' };
  });

  await step('reconcile', () => {
    const rows = Object.fromEntries(Object.entries(RECONCILE).map(([k, sql]) => [k, query(sql)]));
    const v = reconcile(rows);
    summary.reconcile = v.counts;
    if (!v.ok) throw new Error(v.reason);
    return v.counts;
  });

  await step('verify_stub', () => {
    const marked = query("SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE agent_id IS NOT NULL AND payload_json LIKE '%synthetic inference stub%'")[0]?.n;
    const all = query('SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE agent_id IS NOT NULL')[0]?.n;
    if (!(Number(all) > 0) || Number(marked) !== Number(all)) throw new Error(`${marked} of ${all} proposals carry the stub's answer`);
    return { proposals: Number(all) };
  });

  await step('ceilings', () => {
    const added = totalRows() - rowsBefore;
    if (!Number.isFinite(added)) throw new Error('the rows the agent phase added could not be read');
    if (added > CEILINGS.d1RowsWritten) throw new Error(`the agent phase added ${added} rows, over ${CEILINGS.d1RowsWritten}`);
    const elapsed = Date.now() - STARTED;
    if (elapsed > CEILINGS.wallClockMs) throw new Error('the wall-clock ceiling ran out');
    return { rows_added: added, rows_written: 'Not recorded (D1 analytics lag; rows added is a lower bound)', elapsed_ms: elapsed, model_spend_microusd: 0 };
  });

  summary.verdict = 'pass';
} catch (e) {
  summary.reason ||= e.message;
  log(`FAIL: ${summary.reason}`);
} finally {
  try { teardown(); } catch (e) { log(`WARN: teardown: ${e.message}`); }
  summary.finished_at = new Date().toISOString();
  if (SUMMARY) writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  log(`verdict: ${summary.verdict}`);
  if (summary.deleted?.some((d) => !d.ok) || summary.verdict !== 'pass') process.exitCode = 1;
}
