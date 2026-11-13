/**
 * D4594 part 3 (#4594) — hosted Stage A, the pure half: names, the throwaway
 * Worker's config, the run's extra seed, the reconciliation reads and the
 * ceilings. No filesystem, no spawn, no network, so `stageARun.test.mjs`
 * holds every rule to account. `scripts/agent-stage-a.mjs` does the run.
 *
 * WHAT ONE RUN IS. A throwaway Worker `studioos-s4594-<run>` on workers.dev
 * over its own D1, KV, queues, DLQs, Workflow, R2 buckets and Durable Object
 * namespaces, all created for the run and deleted when it ends. The agent
 * engine is on for that Worker alone, and inference is the D4594 part 2 stub
 * (`AGENT_INFERENCE_STUB = "deterministic"`). Production is never touched.
 *
 * THE CONFIG IS DERIVED, never hand-written: `[env.preview]`'s tables, with
 * every identity replaced by the run's own. It is rendered ONCE as a list of
 * sections and printed two ways from that list:
 *   · flat (`renderFlat`), the file the deploy uses. Flat, so nothing is
 *     inherited from the top-level table: the top level holds `axal.vc`'s
 *     custom-domain routes, and an `[env.*]` inherits `routes` unless it
 *     overrides them. A flat config with no route cannot move the apex.
 *   · as `[env.s4594]` appended to the real `wrangler.toml` (`envView`), the
 *     text the #4566 preflight reads, so its production comparison is
 *     against the real production tables, not a copy.
 *
 * WHAT IS LEFT OUT, and why each is deliberate:
 *   · routes and custom domains: none; workers.dev only (`checkFlat`).
 *   · `[[services]]`, `[[tail_consumers]]`: none; nothing else is called.
 *   · the meeting bot's Durable Object: it lives in another Worker
 *     (`script_name`), so binding it would reach that Worker.
 *   · `[browser]`: the preflight passes only an unused browser.
 *   · analytics datasets and vectorize indexes: shared stores; not bound.
 *   · crons: none. A cron would run the platform's schedules on the run.
 *   · `[assets]`: the run calls `/api/*` only; no SPA is served.
 */

import { parseToml } from './branchConfig.mjs';
import { REHEARSAL_DB_PREFIX } from './migrationTargets.mjs';
import { KINDS } from './previewIsolation.mjs';

export const ISSUE = 4594;
/** A run id: the #4566 fixtures' shape (they mark every row with it). */
export const RUN_RE = /^[a-z0-9]{6,20}$/;
/** The env name the preflight reads the rendered tables under. */
export const STAGE_A_ENV = 's4594';

/** Owner decision 2 = A (2026-11-12): the run's ceilings. A ceiling that cannot be read stops the run. */
export const CEILINGS = Object.freeze({
  wallClockMs: 60 * 60 * 1000,
  d1RowsWritten: 1000,
  modelSpendMicrousd: 0,
  lifecyclesPerPath: 1,
});

/** The variables the throwaway Worker sets over `[env.preview.vars]`; nothing else changes. */
export const STAGE_A_VARS = Object.freeze({
  ENVIRONMENT: 'preview',
  AGENT_ENGINE: 'on',
  TEAM_AGENTS_ENABLED: 'true',
  AGENT_AUTONOMY: 'manual',
  AGENT_INFERENCE_STUB: 'deterministic',
  MEETING_BOT: 'off',
  MEETING_BOT_TEAMS: 'off',
});

/** Every name one run creates. Throws on anything that is not a run id. */
export function stageANames(run) {
  if (!RUN_RE.test(String(run ?? ''))) throw new Error(`a Stage A run id is 6 to 20 of [a-z0-9]; got ${JSON.stringify(run)}`);
  const sfx = `s4594-${run}`;
  return {
    run,
    worker: `studioos-${sfx}`,
    // The database is a #4591 rehearsal side, so `migrate-d1.mjs --rehearsal <id>` provisions it unchanged.
    d1: { id: `${run}-src`, name: `${REHEARSAL_DB_PREFIX}${run}-src` },
    kv: ['TOKENS', 'RATE_LIMITS', 'OAUTH_KV'].map((binding) => ({ binding, title: `studioos-${sfx}-${binding.toLowerCase()}` })),
    /** A preview queue name, renamed for the run: `studioos-agent-queue-preview(-dlq)` → `studioos-agent-queue-s4594-<run>(-dlq)`. */
    queue: (preview) => {
      const m = /^(studioos-[a-z-]+?)-preview(-dlq)?$/.exec(String(preview));
      if (!m) throw new Error(`not a preview queue name: ${preview}`);
      return `${m[1]}-${sfx}${m[2] ?? ''}`;
    },
    workflow: (preview) => {
      const m = /^(studioos-[a-z-]+?)-preview$/.exec(String(preview));
      if (!m) throw new Error(`not a preview workflow name: ${preview}`);
      return `${m[1]}-${sfx}`;
    },
    bucket: (preview) => {
      const m = /^(studioos-[a-z-]+?)-preview$/.exec(String(preview));
      if (!m) throw new Error(`not a preview bucket name: ${preview}`);
      return `${m[1]}-${sfx}`;
    },
  };
}

const q = (s) => JSON.stringify(String(s));
const unq = (v) => { try { return JSON.parse(v); } catch { return String(v); } };
const PREVIEW = 'env.preview.';
/** Kinds copied with renamed identities; any other `[env.preview.*]` kind is dropped and named in `dropped`. */
const KEEP = new Set(['vars', 'd1_databases', 'kv_namespaces', 'ai', 'queues.producers', 'queues.consumers', 'durable_objects.bindings', 'migrations', 'workflows', 'r2_buckets']);
/** Top-level sections the flat config carries because the Worker's bundle needs them (module rules, logs). */
const CARRIED = new Set(['rules', 'observability', 'observability.logs', 'observability.traces']);

/**
 * The run's tables, as sections `{ kind, double, kv: Map }`, plus what was dropped.
 * `ids` are the identities `wrangler` printed when it created them:
 * `{ d1: <uuid>, kv: { TOKENS: <id>, RATE_LIMITS: <id>, OAUTH_KV: <id> } }`.
 */
export function stageASections(tomlSrc, run, ids) {
  const n = stageANames(run);
  if (!/^[0-9a-f-]{36}$/i.test(String(ids?.d1 ?? ''))) throw new Error('refusing a config without the run\'s database id');
  const { root, sections } = parseToml(tomlSrc);
  const out = [];
  const dropped = [];
  for (const s of sections) {
    if (!s.name.startsWith(PREVIEW)) continue;
    const kind = s.name.slice(PREVIEW.length);
    if (!KEEP.has(kind)) { dropped.push(kind); continue; }
    const kv = new Map(s.kv);
    switch (kind) {
      case 'vars':
        for (const [k, v] of Object.entries(STAGE_A_VARS)) kv.set(k, q(v));
        kv.set('APP_URL', q(`https://${n.worker}.workers.dev`));
        kv.set('EXTRA_DEV_ORIGINS', q(''));
        break;
      case 'd1_databases':
        if (unq(kv.get('binding')) !== 'DB') throw new Error(`an unexpected preview database: ${kv.get('binding')}`);
        kv.set('database_name', q(n.d1.name)); kv.set('database_id', q(ids.d1));
        break;
      case 'kv_namespaces': {
        const b = unq(kv.get('binding'));
        if (!ids.kv?.[b]) throw new Error(`no namespace was created for ${b}`);
        kv.set('id', q(ids.kv[b]));
        break;
      }
      case 'queues.producers': kv.set('queue', q(n.queue(unq(kv.get('queue'))))); break;
      case 'queues.consumers':
        kv.set('queue', q(n.queue(unq(kv.get('queue')))));
        if (kv.has('dead_letter_queue')) kv.set('dead_letter_queue', q(n.queue(unq(kv.get('dead_letter_queue')))));
        break;
      case 'durable_objects.bindings':
        // Another Worker's namespace (the meeting bot's container): never bound.
        if (kv.has('script_name')) { dropped.push(`durable_objects.bindings:${unq(kv.get('name'))}`); continue; }
        break;
      case 'workflows': kv.set('name', q(n.workflow(unq(kv.get('name'))))); break;
      case 'r2_buckets': kv.set('bucket_name', q(n.bucket(unq(kv.get('bucket_name'))))); break;
      default: break;
    }
    out.push({ kind, double: s.double, kv });
  }
  const carried = sections.filter((s) => CARRIED.has(s.name)).map((s) => ({ kind: s.name, double: s.double, kv: new Map(s.kv), top: true }));
  return {
    names: n,
    head: { main: root.get('main'), compatibility_date: root.get('compatibility_date'), compatibility_flags: root.get('compatibility_flags') },
    sections: out, carried, dropped,
  };
}

const sectionText = (name, double, kv) => [double ? `[[${name}]]` : `[${name}]`, ...[...kv].map(([k, v]) => `${k} = ${v}`)].join('\n');

/** The deploy's config: flat, no `[env.*]`, no route. */
export function renderFlat(r) {
  const lines = [
    `# GENERATED by scripts/agent-stage-a.mjs for run ${r.names.run} (#${ISSUE}); deleted when the run ends. Never commit.`,
    `name = ${q(r.names.worker)}`,
    `main = ${r.head.main}`,
    `compatibility_date = ${r.head.compatibility_date}`,
    ...(r.head.compatibility_flags ? [`compatibility_flags = ${r.head.compatibility_flags}`] : []),
    'workers_dev = true',
    '',
  ];
  for (const s of r.carried) lines.push(sectionText(s.kind, s.double, s.kv), '');
  for (const s of r.sections) lines.push(sectionText(s.kind, s.double, s.kv), '');
  lines.push('[triggers]', 'crons = []', '');
  // `main` is relative to the config's own directory; the script writes it at the repo root.
  return lines.join('\n');
}

/** The real wrangler.toml with the run's tables appended as `[env.s4594]`, for the #4566 preflight. */
export function envView(tomlSrc, r) {
  const lines = [tomlSrc.trimEnd(), '', `[env.${STAGE_A_ENV}]`, `name = ${q(r.names.worker)}`, 'workers_dev = true', ''];
  for (const s of r.sections) lines.push(sectionText(`env.${STAGE_A_ENV}.${s.kind}`, s.double, s.kv), '');
  return `${lines.join('\n')}\n`;
}

/**
 * The guard on the flat config, run before every deploy. Throws on a route, a
 * custom domain, an `axal.vc` host, an `[env.*]` table, a service binding, a
 * cron, a browser, or any production identity from `wrangler.toml`.
 */
export function checkFlat(flat, tomlSrc) {
  const problems = [];
  if (/^\s*\[\[?routes\]?\]/m.test(flat) || /^\s*routes\s*=/m.test(flat) || /^\s*route\s*=/m.test(flat)) problems.push('declares a route');
  if (/custom_domain/.test(flat)) problems.push('declares a custom domain');
  if (/axal\.vc/.test(flat)) problems.push('names an axal.vc host');
  if (/^\s*\[\[?env\./m.test(flat)) problems.push('has an [env.*] table');
  if (/^\s*\[\[?(services|tail_consumers|browser|vectorize|analytics_engine_datasets)\]?\]/m.test(flat)) problems.push('binds a shared or outbound service');
  if (!/^\[triggers\]\ncrons = \[\]$/m.test(flat)) problems.push('runs crons');
  if (!/^workers_dev = true$/m.test(flat)) problems.push('is not on workers.dev');
  const { sections } = parseToml(tomlSrc);
  const prodValues = new Set();
  // The identity fields are the #4566 preflight's own (`KINDS`), so this guard and the preflight never disagree.
  for (const s of sections) {
    if (!s.name.startsWith('env.production.')) continue;
    const def = KINDS[s.name.slice('env.production.'.length)];
    for (const f of def?.identity ?? []) if (s.kv.has(f)) prodValues.add(unq(s.kv.get(f)));
  }
  prodValues.add('studioos');
  for (const v of prodValues) if (v && new RegExp(`= ${JSON.stringify(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(flat)) problems.push(`names production's ${v}`);
  if (problems.length) throw new Error(`refusing the Stage A config: ${problems.join('; ')}`);
  return true;
}

/** What the run must create before it can deploy, from the rendered sections. */
export function toCreate(r) {
  const queues = new Set();
  const workflows = [];
  const buckets = [];
  for (const s of r.sections) {
    if (s.kind === 'queues.producers') queues.add(unq(s.kv.get('queue')));
    if (s.kind === 'queues.consumers') { queues.add(unq(s.kv.get('queue'))); if (s.kv.has('dead_letter_queue')) queues.add(unq(s.kv.get('dead_letter_queue'))); }
    if (s.kind === 'workflows') workflows.push(unq(s.kv.get('name')));
    if (s.kind === 'r2_buckets') buckets.push(unq(s.kv.get('bucket_name')));
  }
  return { d1: r.names.d1.name, kv: r.names.kv.map((k) => k.title), queues: [...queues].sort(), workflows, buckets };
}

/**
 * The run's own seed beyond the #4566 fixtures: the sponsor's plan and the
 * licence cap row the router reads (the local harness sets the same,
 * `test/_agent_lifecycle_fixture.ts`). Synthetic money only; one tenant.
 */
export function extraSeed(run) {
  stageANames(run);
  const sponsor = `syn-${run}-t0@synthetic.invalid`;
  return [
    { sql: "UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE email = ?", args: [sponsor] },
    { sql: "INSERT OR IGNORE INTO ai_licence_caps (licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES ('founder:growth', 0, 0, (SELECT id FROM users WHERE email = ?))", args: [sponsor] },
  ];
}

/** The fixtures' ids for tenant 0, agent 0: the sponsor, the agent and its first task. */
export function fixtureIds(run) {
  stageANames(run);
  return { sponsorEmail: `syn-${run}-t0@synthetic.invalid`, agentUid: `syn-${run}-t0-a0`, taskUid: `syn-${run}-t0-a0-k0` };
}

/**
 * The reconciliation reads, after the paths ran: the local harness's own
 * ledger (`test/_agent_lifecycle_fixture.ts`, `ledger()`), so a hosted verdict
 * and a local one are computed the same way. Counts and states only; no text.
 */
export const RECONCILE = Object.freeze({
  holds: 'SELECT idempotency_key, status, operation, included_microusd + topup_microusd AS held, COALESCE(actual_included_microusd, 0) + COALESCE(actual_topup_microusd, 0) AS actual FROM ai_budget_reservations',
  usage: 'SELECT id, agent_id, model, charged_microusd FROM ai_usage_logs WHERE agent_id IS NOT NULL',
  proposals: 'SELECT uid, run_key, status, usage_log_id FROM ai_rail_proposals WHERE agent_id IS NOT NULL',
  runs: 'SELECT uid, status, step FROM agent_task_runs',
});

/**
 * The verdict from the reconciliation rows: no pending hold, at most one
 * proposal and one settled hold per key, settled equals charged, no run left
 * live. A read that failed is a failure, never a pass.
 */
export function reconcile({ holds, usage, proposals, runs }) {
  if (![holds, usage, proposals, runs].every(Array.isArray)) return { ok: false, reason: 'a reconciliation read failed', counts: null };
  const problems = [];
  const pending = holds.filter((h) => h.status === 'pending' || h.status === 'review').length;
  if (pending) problems.push(`${pending} hold(s) still pending`);
  const dupOf = (xs, key) => { const m = new Map(); for (const x of xs) if (x[key] != null) m.set(x[key], (m.get(x[key]) || 0) + 1); return [...m.values()].filter((v) => v > 1).length; };
  const dupProposals = dupOf(proposals, 'run_key');
  if (dupProposals) problems.push(`${dupProposals} run key(s) with more than one proposal`);
  const dupSettled = dupOf(holds.filter((h) => h.status === 'settled'), 'idempotency_key');
  if (dupSettled) problems.push(`${dupSettled} hold key(s) settled more than once`);
  const settled = holds.filter((h) => h.status === 'settled').reduce((s, h) => s + Number(h.actual || 0), 0);
  const charged = usage.reduce((s, u) => s + Number(u.charged_microusd || 0), 0);
  if (settled !== charged) problems.push(`settled ${settled} is not charged ${charged}`);
  const live = runs.filter((r) => ['admitted', 'running'].includes(r.status)).length;
  if (live) problems.push(`${live} run(s) still live`);
  if (!proposals.length) problems.push('no proposal was made');
  return {
    ok: !problems.length, reason: problems.join('; ') || null,
    counts: {
      holds: holds.length, settled_holds: holds.filter((h) => h.status === 'settled').length, usage_rows: usage.length,
      proposals: proposals.length, runs: runs.length, charged_microusd: charged, settled_microusd: settled,
    },
  };
}
