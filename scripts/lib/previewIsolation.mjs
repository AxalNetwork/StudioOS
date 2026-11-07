/**
 * #4566 (Agent capacity A0) — is a preview environment provably separate from
 * production? The isolation matrix and the fail-closed preflight, pure: no
 * filesystem, no network, no Cloudflare call. `scripts/check-preview-isolation.mjs`
 * reads the files and prints; the tests call in here.
 *
 * TWO KINDS OF EVIDENCE, kept apart.
 *   · DECLARED: what `wrangler.toml` says an environment binds — its D1
 *     `database_id`, KV `id`s, queue and Workflow names, R2 buckets, Durable
 *     Object owners, the Worker's own name. Read from the file itself, never
 *     from a naming convention: a name ending in `-preview` proves nothing.
 *   · OBSERVED: what the owner's read-only commands report the deployed
 *     preview actually holds (`wrangler d1 info`, `kv namespace list`,
 *     `queues list`, `workflows list`, `secret list --env preview`), written
 *     to a JSON file (`OBSERVED_SHAPE` below) and passed in. Missing
 *     evidence — an absent field, a permission the token lacked — is
 *     UNVERIFIED, never safe.
 *
 * THE VERDICT, fail closed.
 *   unsafe      any binding SHARES a production identity, is declared one way
 *               and observed another, or is of a kind this file does not know;
 *               a billable or outbound secret is present; production's own
 *               agent switches are not off and manual.
 *   unverified  nothing shared, but at least one identity is a placeholder
 *               (`REPLACE_WITH_…`) or has no observation.
 *   isolated    every critical identity is declared, observed, equal to its
 *               declaration and unlike production's.
 * Only `isolated` lets a hosted test run. The static CI mode checks the
 * declared half alone and fails only on `unsafe`.
 *
 * ACCOUNT-WIDE BINDINGS cannot be isolated by configuration: Workers AI (`ai`)
 * and Browser Rendering (`browser`) are the account's. They are classed
 * `account_shared`, and a hosted run passes only when the observation says
 * inference is the synthetic stub (`inference: "stub"`) and the browser is
 * unused (`browser: "unused"`).
 */

import { parseToml } from './branchConfig.mjs';

/** Placeholder ids committed for preview until the owner creates the resource. */
export const PLACEHOLDER_RE = /^REPLACE_WITH_/;

/**
 * Every binding kind an environment may declare, how its identity is read,
 * and whether it is critical to agent execution validation (#4566 §1: Worker,
 * D1, Queue, DLQ, Workflow, DO namespace, RATE_LIMITS KV, usage ledger, R2,
 * AI Gateway). The usage ledger (`ai_usage_logs`, `ai_budget_reservations`,
 * `ai_credit_ledger`) lives in D1, so D1's isolation is the ledger's.
 */
export const KINDS = Object.freeze({
  d1_databases: { key: 'binding', identity: ['database_id', 'database_name'], critical: true },
  kv_namespaces: { key: 'binding', identity: ['id'], critical: true },
  'queues.producers': { key: 'binding', identity: ['queue'], critical: true },
  'queues.consumers': { key: 'queue', identity: ['queue', 'dead_letter_queue'], critical: true },
  workflows: { key: 'binding', identity: ['name'], critical: true },
  'durable_objects.bindings': { key: 'name', identity: ['script_name'], critical: true },
  r2_buckets: { key: 'binding', identity: ['bucket_name'], critical: true },
  vectorize: { key: 'binding', identity: ['index_name'], critical: false },
  analytics_engine_datasets: { key: 'binding', identity: ['dataset'], critical: false },
  tail_consumers: { key: 'service', identity: ['service'], critical: false },
  ai: { key: 'binding', identity: [], critical: true, account: 'inference' },
  browser: { key: 'binding', identity: [], critical: false, account: 'browser' },
  // Not bindings to another store: what the environment runs, how it is reached, its own config.
  vars: { key: null, identity: [], critical: false, config: true },
  triggers: { key: null, identity: [], critical: false, config: true },
  migrations: { key: 'tag', identity: [], critical: false, config: true },
  routes: { key: 'pattern', identity: ['pattern'], critical: true },
  images: { key: 'binding', identity: [], critical: false, account: 'images' },
  stream: { key: 'binding', identity: [], critical: false, account: 'stream' },
  assets: { key: 'binding', identity: [], critical: false, config: true },
});

/**
 * Secrets a preview under test may hold: each is used inside the Worker only
 * (signing, hashing, encryption) and reaches no provider. Any other secret
 * name — a mail, payment, messaging, model or OAuth credential, or one added
 * after this list — fails: it could send a production notification, email,
 * webhook or provider call (#4566 tests).
 */
export const INTERNAL_SECRETS = Object.freeze(new Set([
  'JWT_SECRET', 'SCORING_HMAC_SECRET', 'AXAL_ENCRYPTION_SECRET', 'MAIL_LINK_SECRET', 'NEWSLETTER_TOKEN_KEY', 'RPC_SECRET',
]));

/** Variables whose production values are the agent kill switches (D1528): they must read off and manual. */
export const PRODUCTION_AGENT_VARS = Object.freeze({ AGENT_ENGINE: 'off', AGENT_AUTONOMY: 'manual' });
/** Variables that name an AI Gateway: a preview naming production's gateway shares its logs and limits. */
export const GATEWAY_VAR_RE = /^CF_AI_GATEWAY_SLUG_/;

/**
 * The shape of an observation file, as the runbook's read-only commands fill
 * it. Every field optional: a missing one is unverified.
 *   {
 *     "taken_at": "2026-11-06T12:00:00Z", "account_permissions": ["d1:read", ...],
 *     "worker": "studioos-preview",
 *     "d1": { "DB": { "database_id": "…", "database_name": "…" } },
 *     "kv": { "RATE_LIMITS": "<id>", "TOKENS": "<id>", "OAUTH_KV": "<id>" },
 *     "queues": ["studioos-agent-queue-preview", …],
 *     "workflows": ["studioos-agent-task-preview"],
 *     "r2": ["studioos-files-preview", …],
 *     "secrets": ["JWT_SECRET", …],        // names only, never values
 *     "vars": { "AI_GATEWAY_…": "…" },     // non-secret only
 *     "inference": "stub" | "live", "browser": "unused" | "used"
 *   }
 */
export const OBSERVED_SHAPE = Object.freeze(['taken_at', 'account_permissions', 'worker', 'd1', 'kv', 'queues', 'workflows', 'r2', 'secrets', 'vars', 'inference', 'browser']);

const unq = (v) => {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return String(v); }
};

/**
 * One environment's bindings as declared: `[{ kind, binding, identity: {field: value}, critical }]`,
 * plus its Worker name, vars, and every section kind this file does not know.
 * `env` is `null` for the top-level (dev) table, else e.g. `"production"`.
 */
export function declaredBindings(tomlSrc, env) {
  const { root, sections } = parseToml(tomlSrc);
  const prefix = env ? `env.${env}.` : '';
  const head = env ? sections.find((s) => s.name === `env.${env}`) : null;
  const workerName = unq(head?.kv.get('name')) ?? unq(root.get('name'));
  const out = { env: env ?? 'top', worker: workerName, bindings: [], vars: {}, unknown: [] };
  for (const s of sections) {
    if (env ? !s.name.startsWith(prefix) : s.name.startsWith('env.')) continue;
    const kind = s.name.slice(prefix.length);
    if (kind.startsWith('observability')) continue;
    const def = KINDS[kind];
    if (!def) { out.unknown.push(kind); continue; }
    if (kind === 'vars') { for (const [k, v] of s.kv) out.vars[k] = unq(v); continue; }
    if (def.config && kind !== 'routes') continue;
    const identity = {};
    for (const f of def.identity) { const v = unq(s.kv.get(f)); if (v != null) identity[f] = v; }
    const binding = def.key ? unq(s.kv.get(def.key)) : kind;
    out.bindings.push({ kind, binding: binding ?? kind, identity, critical: def.critical, account: def.account ?? null });
  }
  return out;
}

/** Each production identity, by kind and field, so a sharing check is one lookup. */
export function productionIdentities(tomlSrc) {
  const prod = declaredBindings(tomlSrc, 'production');
  const ids = new Map();
  const add = (kind, field, value) => {
    const k = `${kind}:${field}`;
    if (!ids.has(k)) ids.set(k, new Set());
    ids.get(k).add(value);
  };
  for (const b of prod.bindings) for (const [f, v] of Object.entries(b.identity)) add(b.kind, f, v);
  // A queue is one namespace whichever table names it: a producer, a consumer or a DLQ.
  for (const b of prod.bindings) {
    if (!b.kind.startsWith('queues.')) continue;
    for (const v of Object.values(b.identity)) add('queue', 'name', v);
  }
  add('worker', 'name', prod.worker);
  for (const [k, v] of Object.entries(prod.vars)) if (GATEWAY_VAR_RE.test(k) && v) add('gateway', 'slug', v);
  return { ids, worker: prod.worker, vars: prod.vars };
}

const has = (ids, key, value) => !!ids.get(key)?.has(value);

/**
 * The matrix: one row per binding of the environment under test, with its
 * status. Statuses: `isolated`, `shared`, `mismatch`, `placeholder`,
 * `unverified`, `account_shared`, `unknown_binding`, `not_applicable`.
 */
export function isolationMatrix(tomlSrc, env, observed = null) {
  const prod = productionIdentities(tomlSrc);
  const decl = declaredBindings(tomlSrc, env);
  const rows = [];
  const row = (r) => rows.push({ critical: true, ...r });
  const obs = observed && typeof observed === 'object' ? observed : null;

  // The Worker itself: every Durable Object namespace without a `script_name` is the Worker's own.
  {
    const name = decl.worker;
    const seen = obs?.worker;
    let status = 'isolated';
    if (!name) status = 'unverified';
    else if (name === prod.worker) status = 'shared';
    else if (obs && seen == null) status = 'unverified';
    else if (obs && seen !== name) status = 'mismatch';
    else if (!obs) status = 'unverified';
    row({ kind: 'worker', binding: 'script', declared: name, observed: seen ?? null, status });
  }

  for (const b of decl.bindings) {
    if (b.account) {
      // Account-wide: never isolated by configuration; safe only when unused or stubbed.
      const want = b.account === 'inference' ? 'stub' : 'unused';
      const seen = obs?.[b.account] ?? null;
      const status = seen == null ? 'unverified' : seen === want ? 'account_shared' : 'shared';
      row({ kind: b.kind, binding: b.binding, declared: null, observed: seen, status, critical: b.critical, needs: want });
      continue;
    }
    for (const [field, value] of Object.entries(b.identity)) {
      let status;
      let seen = null;
      const queue = b.kind.startsWith('queues.');
      if (PLACEHOLDER_RE.test(String(value))) status = 'placeholder';
      else if (has(prod.ids, `${b.kind}:${field}`, value) || (queue && has(prod.ids, 'queue:name', value))) status = 'shared';
      else if (b.kind === 'durable_objects.bindings' && field === 'script_name' && value === prod.worker) status = 'shared';
      else {
        seen = observedFor(obs, b, field, value);
        status = seen === undefined ? 'unverified' : seen === value ? 'isolated' : (seen != null && hasAny(prod.ids, seen)) ? 'shared' : 'mismatch';
      }
      row({ kind: b.kind, binding: b.binding, field, declared: value, observed: seen ?? null, status, critical: b.critical });
    }
    // A Durable Object with no `script_name` lives in this Worker's own namespace: its isolation is the Worker's.
    if (b.kind === 'durable_objects.bindings' && !b.identity.script_name) {
      row({ kind: b.kind, binding: b.binding, field: 'namespace', declared: `${decl.worker}::${b.binding}`, observed: null,
        status: decl.worker && decl.worker !== prod.worker ? 'isolated' : 'shared', critical: b.critical });
    }
  }

  // AI Gateway: a preview slug equal to production's shares its logs, caching and limits.
  for (const [k, v] of Object.entries(decl.vars)) {
    if (!GATEWAY_VAR_RE.test(k)) continue;
    const status = !v ? 'not_applicable' : has(prod.ids, 'gateway:slug', v) ? 'shared' : 'isolated';
    row({ kind: 'ai_gateway', binding: k, declared: v || null, observed: null, status });
  }

  for (const kind of decl.unknown) row({ kind, binding: kind, declared: null, observed: null, status: 'unknown_binding' });

  // Secrets: names only. Any not on the internal list could reach a provider.
  if (obs) {
    if (!Array.isArray(obs.secrets)) row({ kind: 'secrets', binding: 'names', declared: null, observed: null, status: 'unverified' });
    else for (const name of obs.secrets) {
      row({ kind: 'secrets', binding: String(name), declared: null, observed: 'present',
        status: INTERNAL_SECRETS.has(String(name)) ? 'isolated' : 'outbound_secret' });
    }
  }
  return { env: decl.env, worker: decl.worker, rows };
}

/** What an observation says a declared binding actually is; `undefined` when it does not say. */
function observedFor(obs, b, field, declared) {
  if (!obs) return undefined;
  switch (b.kind) {
    case 'd1_databases': return obs.d1?.[b.binding]?.[field];
    case 'kv_namespaces': return obs.kv?.[b.binding];
    case 'queues.producers': case 'queues.consumers':
      return Array.isArray(obs.queues) ? (obs.queues.includes(declared) ? declared : null) : undefined;
    case 'workflows': return Array.isArray(obs.workflows) ? (obs.workflows.includes(declared) ? declared : null) : undefined;
    case 'r2_buckets': return Array.isArray(obs.r2) ? (obs.r2.includes(declared) ? declared : null) : undefined;
    case 'durable_objects.bindings': return obs.worker === undefined ? undefined : declared;
    default: return undefined;
  }
}
const hasAny = (ids, value) => [...ids.values()].some((s) => s.has(value));

const UNSAFE = new Set(['shared', 'mismatch', 'unknown_binding', 'outbound_secret']);

/**
 * The preflight. `static: true` checks the declared half only (CI): it fails
 * on `unsafe` and reports placeholders without failing. Otherwise every
 * critical row must be `isolated` or a satisfied `account_shared`, and the
 * production agent switches must still read off and manual.
 */
export function preflight(tomlSrc, { env = 'preview', observed = null, static: isStatic = false } = {}) {
  const matrix = isolationMatrix(tomlSrc, env, isStatic ? null : observed);
  const problems = [];
  const prodVars = productionIdentities(tomlSrc).vars;
  for (const [k, want] of Object.entries(PRODUCTION_AGENT_VARS)) {
    if (prodVars[k] !== want) problems.push({ kind: 'production_var', binding: k, status: 'shared', detail: `production ${k} reads ${JSON.stringify(prodVars[k] ?? null)}, not "${want}"` });
  }
  const unsafe = [...matrix.rows.filter((r) => UNSAFE.has(r.status)), ...problems];
  const pending = matrix.rows.filter((r) => r.critical && !UNSAFE.has(r.status) && !['isolated', 'account_shared', 'not_applicable'].includes(r.status));
  if (!isStatic && observed && !Array.isArray(observed.account_permissions)) {
    pending.push({ kind: 'account_permissions', binding: 'token', status: 'unverified', detail: 'the observation does not say which read permissions it had' });
  }
  const verdict = unsafe.length ? 'unsafe' : (isStatic ? 'declared_only' : pending.length || !observed ? 'unverified' : 'isolated');
  return { verdict, ok: isStatic ? !unsafe.length : verdict === 'isolated', env: matrix.env, worker: matrix.worker, rows: matrix.rows, unsafe, pending };
}
