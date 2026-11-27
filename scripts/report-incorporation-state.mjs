#!/usr/bin/env node
/**
 * #6684: read-only incorporation state by jurisdiction id (orders by status, a
 * Stripe one-time price yes/no, template bodies and counsel approvals, ids
 * outside the six, multi-paid projects, a US beneficial-ownership step); counts
 * and yes/no only.
 *
 * #6684 (E4 of #6680) — which incorporation products can be paid for, which
 * have approved templates, and which have orders. READ ONLY: every database
 * statement is a SELECT (checked before it runs), and Stripe is only listed.
 *
 * What it prints, per jurisdiction id (the six of `routes/legal.ts`
 * JURISDICTIONS, read from that file):
 *   orders            `incorporations` rows counted by status
 *   stripe_price      a live catalogue product with `metadata.jurisdiction_id`
 *                     and an active one-time price: yes / no / not checked.
 *                     Never an amount.
 *   templates         per template key: an active, non-stub body (yes/no) and
 *                     a counsel approval of that exact version (D4811
 *                     `legal_reviews`: approved or approved with conditions,
 *                     bound to the body's SHA-256) (yes/no)
 * and, for the whole database:
 *   unknown_ids       any `incorporations.jurisdiction_id` outside the six, with counts
 *   projects_with_more_than_one_paid_order   a count (D367 PAID_STATUSES)
 *   us_beneficial_ownership_step   whether the incorporation flow's sources
 *                     (`US_FLOW`) show a beneficial-ownership (BOI / FinCEN)
 *                     filing step: yes/no, with the file paths
 *
 * COUNTS ONLY. No names, emails, company names, amounts or ids of people.
 * No secrets in the script: Stripe is read only when STRIPE_SECRET_KEY is in
 * the operator's environment, and the key is never printed.
 *
 * Run (an operator with production read access, step 2 of #6684):
 *   node scripts/report-incorporation-state.mjs --d1 [--env production] [--json]
 *   STRIPE_SECRET_KEY=… node scripts/report-incorporation-state.mjs --d1 --env production
 * Against a local SQLite copy (tests, a D1 export):
 *   node scripts/report-incorporation-state.mjs --sqlite path/to.db [--json]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** D367: the statuses of an order that was paid (`frontend/src/lib/incorporationPricing.js`). */
export const PAID_STATUSES = Object.freeze(['paid', 'packet_processing', 'packet_ready', 'filed']);

/** The six jurisdiction ids and their template keys, read from `routes/legal.ts` (never typed twice). */
export function jurisdictionsFromSource(root = ROOT) {
  const src = readFileSync(join(root, 'cloudflare-worker/src/routes/legal.ts'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/^\s*\{ id: '([a-z_]+)', label:.*?templates: \[([^\]]*)\]/gm)) {
    out.push({ id: m[1], templates: [...m[2].matchAll(/'([a-z0-9_]+)'/g)].map((t) => t[1]) });
  }
  return out;
}

const READ_ONLY = /^\s*(SELECT|WITH)\b/i;
const WRITES = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|PRAGMA|VACUUM)\b/i;
/** A statement this script may run: a SELECT (or WITH … SELECT) naming no write. */
export function assertReadOnly(sql) {
  if (!READ_ONLY.test(sql) || WRITES.test(sql)) throw new Error(`refused: not a read-only statement: ${sql.slice(0, 60)}`);
  return sql;
}

/** A query function over a local SQLite file, opened read only. */
export async function sqliteQuery(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  return async (sql, params = []) => db.prepare(assertReadOnly(sql)).all(...params);
}

/** A query function over D1 through wrangler (remote, read only). Parameters are inlined as quoted literals. */
export function d1Query({ env = null, database = 'studioos-db' } = {}) {
  const lit = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return async (sql, params = []) => {
    let i = 0;
    const text = assertReadOnly(sql).replace(/\?/g, () => lit(params[i++]));
    const args = ['wrangler', 'd1', 'execute', database, '--remote', '--json', '--command', text, ...(env ? ['--env', env] : [])];
    const out = execFileSync('npx', args, { cwd: join(ROOT, 'cloudflare-worker'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(out);
    return (Array.isArray(parsed) ? parsed[0]?.results : parsed?.results) ?? [];
  };
}

/** Rows, or null when the table cannot be read (missing in this database). */
async function tryRows(query, sql, params) {
  try { return await query(sql, params); } catch (e) {
    if (/refused: not a read-only/.test(String(e?.message))) throw e;
    return null;
  }
}

const sha256 = (s) => createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');

/**
 * Stripe: per jurisdiction id, whether an active product carries
 * `metadata.jurisdiction_id` with an active one-time price. `fetchJson` is
 * injectable for tests; with no key the answer is "not checked".
 */
export async function stripeCoverage(ids, { key = process.env.STRIPE_SECRET_KEY, fetchJson = null } = {}) {
  if (!key && !fetchJson) return Object.fromEntries(ids.map((id) => [id, 'not checked']));
  const get = fetchJson ?? (async (path) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Stripe answered ${res.status}`);
    return res.json();
  });
  const found = new Set();
  let after = null;
  for (let page = 0; page < 50; page += 1) {
    const q = `prices?active=true&type=one_time&limit=100&expand[]=data.product${after ? `&starting_after=${after}` : ''}`;
    const body = await get(q);
    for (const price of body?.data ?? []) {
      const product = price?.product;
      const jid = product && typeof product === 'object' && product.active !== false ? product.metadata?.jurisdiction_id : null;
      if (jid) found.add(String(jid));
    }
    if (!body?.has_more || !body.data?.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return Object.fromEntries(ids.map((id) => [id, found.has(id) ? 'yes' : 'no']));
}

/**
 * The incorporation flow's sources: Incorporate's pages and models, its
 * pricing, and the Worker's legal routes and incorporation services. A
 * beneficial-ownership word elsewhere (the Terms, KYC, diligence) is not a
 * step of the US flow.
 */
export const US_FLOW = Object.freeze([
  'frontend/src/pages/incorporate',
  'frontend/src/lib/incorporationPricing.js',
  'cloudflare-worker/src/routes/legal.ts',
  'cloudflare-worker/src/routes/legal_incorporation_quote.ts',
  'cloudflare-worker/src/services/incorporationPacket.ts',
  'cloudflare-worker/src/services/incorporationQuote.ts',
  'cloudflare-worker/src/services/incorporationCompany.ts',
]);

/** Whether the incorporation flow's sources show a beneficial-ownership filing step, with the files. */
export function beneficialOwnershipStep(root = ROOT) {
  const pattern = /beneficial[\s-]+owner(ship)?|\bBOI\b|FinCEN|Corporate Transparency Act/i;
  const files = [];
  const scan = (p) => { if (/\.(jsx?|tsx?|mjs)$/.test(p) && pattern.test(readFileSync(p, 'utf8'))) files.push(relative(root, p)); };
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else scan(p);
    }
  };
  for (const d of US_FLOW) {
    try { statSync(join(root, d)).isDirectory() ? walk(join(root, d)) : scan(join(root, d)); } catch { /* a checkout without it */ }
  }
  return { shown: files.length ? 'yes' : 'no', files: files.sort() };
}

/** The whole report. Counts and yes/no only. */
export async function report({ query, stripe = null, root = ROOT }) {
  const juris = jurisdictionsFromSource(root);
  const ids = juris.map((j) => j.id);

  const byStatus = await tryRows(query, 'SELECT jurisdiction_id, status, COUNT(*) AS n FROM incorporations GROUP BY jurisdiction_id, status ORDER BY jurisdiction_id, status');
  const orders = Object.fromEntries(ids.map((id) => [id, byStatus == null ? 'not readable' : {}]));
  const unknown = {};
  for (const r of byStatus ?? []) {
    const id = String(r.jurisdiction_id);
    if (ids.includes(id)) orders[id][String(r.status)] = Number(r.n);
    else unknown[id] = (unknown[id] ?? 0) + Number(r.n);
  }

  const placeholders = PAID_STATUSES.map(() => '?').join(', ');
  const multi = await tryRows(query,
    `SELECT COUNT(*) AS n FROM (SELECT project_id FROM incorporations WHERE status IN (${placeholders}) GROUP BY project_id HAVING COUNT(*) > 1)`,
    [...PAID_STATUSES]);

  const keys = [...new Set(juris.flatMap((j) => j.templates))];
  const kp = keys.map(() => '?').join(', ');
  const bodies = await tryRows(query,
    `SELECT slug, version, body_md FROM legal_templates WHERE slug IN (${kp}) AND is_active = 1 AND is_stub = 0 AND length(trim(body_md)) > 0`, keys);
  const reviews = await tryRows(query,
    `SELECT object_ref, version, version_sha256 FROM legal_reviews WHERE object_kind = 'template' AND object_ref IN (${kp}) AND decision IN ('approved', 'approved_with_conditions')`, keys);
  const bodyOf = new Map((bodies ?? []).map((b) => [String(b.slug), b]));
  const approved = (slug) => {
    const b = bodyOf.get(slug);
    if (!b || reviews == null) return reviews == null ? 'not readable' : 'no';
    const sha = sha256(b.body_md);
    return reviews.some((r) => String(r.object_ref) === slug && Number(r.version) === Number(b.version) && String(r.version_sha256) === sha) ? 'yes' : 'no';
  };
  const templates = Object.fromEntries(juris.map((j) => [j.id, Object.fromEntries(j.templates.map((k) => [k, {
    active_body: bodies == null ? 'not readable' : bodyOf.has(k) ? 'yes' : 'no',
    counsel_approved: bodies == null ? 'not readable' : approved(k),
  }]))]));

  const stripePrice = stripe ? await stripe(ids) : Object.fromEntries(ids.map((id) => [id, 'not checked']));

  return {
    jurisdictions: Object.fromEntries(ids.map((id) => [id, { orders: orders[id], stripe_price: stripePrice[id], templates: templates[id] }])),
    unknown_ids: byStatus == null ? 'not readable' : unknown,
    projects_with_more_than_one_paid_order: multi == null ? 'not readable' : Number(multi[0]?.n ?? 0),
    us_beneficial_ownership_step: beneficialOwnershipStep(root),
  };
}

/** The report as lines a person reads (the same facts as the JSON). */
export function render(r) {
  const lines = [];
  for (const [id, j] of Object.entries(r.jurisdictions)) {
    const o = typeof j.orders === 'string' ? j.orders : Object.entries(j.orders).map(([s, n]) => `${s} ${n}`).join(', ') || 'none';
    lines.push(`${id}`, `  orders: ${o}`, `  stripe one-time price: ${j.stripe_price}`);
    for (const [k, t] of Object.entries(j.templates)) lines.push(`  template ${k}: active body ${t.active_body}, counsel approved ${t.counsel_approved}`);
  }
  const u = typeof r.unknown_ids === 'string' ? r.unknown_ids : Object.entries(r.unknown_ids).map(([id, n]) => `${id} ${n}`).join(', ') || 'none';
  lines.push(`jurisdiction ids outside the six: ${u}`);
  lines.push(`projects with more than one paid order: ${r.projects_with_more_than_one_paid_order}`);
  lines.push(`US beneficial-ownership filing step shown: ${r.us_beneficial_ownership_step.shown}${r.us_beneficial_ownership_step.files.length ? ` (${r.us_beneficial_ownership_step.files.join(', ')})` : ''}`);
  return lines.join('\n');
}

async function main(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  let query;
  if (at('--sqlite')) query = await sqliteQuery(at('--sqlite'));
  else if (argv.includes('--d1')) query = d1Query({ env: at('--env') });
  else {
    console.error('Usage: node scripts/report-incorporation-state.mjs (--sqlite <file> | --d1 [--env production]) [--json]');
    process.exit(2);
  }
  const r = await report({ query, stripe: (ids) => stripeCoverage(ids) });
  console.log(argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
}
