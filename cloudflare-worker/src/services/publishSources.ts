/**
 * D1333 (#3481, part 2 of #2400) — what a founder's draft is built from: one
 * builder per Grow place (`PUBLISH_MODULES`), each reading only the fields
 * `PUBLISH_SOURCES` lists for its stores, and the read each Grow page needs to
 * show Publish to… and "Published from here".
 *
 * A DRAFT IS FACTS, QUOTED. Every line keeps its source and its date, and the
 * draft's chip says where it came from ("From Product improvement · 3 shipped
 * items · Oct 2026"). Nothing is sent from here: a draft is text the founder
 * edits, previews and confirms through `publishCore.ts`.
 *
 * THE NEVER-LIST (#2400 "Never in a draft"):
 *   - no customer's, applicant's or interviewee's name or contact, and no
 *     partner's name until "agreed to be named" is recorded;
 *   - no team-only figure (one from the founder's Mercury, or a bank figure)
 *     unless the founder ticks team-only figures in for this draft; a ticked
 *     one is marked on its source ref, so `publishLint` blocks it again if the
 *     tick is taken back;
 *   - a figure not recorded is left out, never written as 0.
 *
 * Every statement is a bound literal. Logs keep module keys and counts only.
 */
import type { Env, User } from '../types';
import { PUBLISH_MODULES, type PublishModule } from '../integrations/publishSources';
import { publishTarget } from '../integrations/publishTargets';
import { DURABILITY_ITEMS, GROW_MODULES, growFigures } from './growCycle';
import { isTeamViewer } from './mercury/growFeeds';
import { PublishRefusal, canPublish, refused, releaseStrandedSends } from './publishCore';

export interface DraftLine {
  /** The record this line quotes, `<store>:<id>` (or `figure:<key>`), so a draft can be made from a chosen few. */
  ref: string;
  store: string;
  /** The line as it goes into the draft. */
  line: string;
  /** Where it came from, in words ("Stripe", "Product improvement"). */
  source: string;
  /** The record's own date. */
  as_of: string | null;
  team_only: boolean;
  /** A team-only line's figure, as it reads in the text: what `publishLint` looks for. */
  figure?: string;
}
export interface BuiltDraft {
  module: PublishModule;
  lines: DraftLine[];
  /** What was left out, by why: counts only. */
  dropped: { team_only: number; not_recorded: number; unnamed: number };
}
interface BuildOpts { refs: Set<string> | null; teamOnly: boolean; now: number }

export const MODULE_LABEL: Readonly<Record<PublishModule, string>> = Object.freeze({
  overview: 'Overview', updates: 'Updates',
  ...Object.fromEntries(GROW_MODULES.map((m) => [m.slug, m.name])),
} as Record<PublishModule, string>);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const monthOf = (d: string | null) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : null);
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const grouped = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
/** A figure in its unit, or null when there is none: never 0 for missing. */
export function figureText(value: unknown, unit: string): string | null {
  const n = num(value);
  if (n == null) return null;
  if (unit === 'usd_cents' || unit === 'cents') return `$${grouped(n / 100)}`;
  if (unit === 'usd') return `$${grouped(n)}`;
  if (unit === 'pct') return `${grouped(n)}%`;
  if (unit === 'months') return `${grouped(n)} months`;
  return grouped(n);
}
const fromMercury = (source: unknown) => /mercury/i.test(String(source ?? ''));
const sourceWord = (source: unknown, fallback: string) => {
  const s = String(source ?? '').trim();
  if (!s || s === 'manual') return 'Typed';
  return s.length <= 40 ? s[0].toUpperCase() + s.slice(1) : fallback;
};
const empty = (module: PublishModule): BuiltDraft => ({ module, lines: [], dropped: { team_only: 0, not_recorded: 0, unnamed: 0 } });
const keep = (opts: BuildOpts, ref: string) => !opts.refs || opts.refs.has(ref);
/** A team-only line goes in only when ticked; otherwise it is counted as left out. */
function push(out: BuiltDraft, opts: BuildOpts, l: DraftLine) {
  if (!keep(opts, l.ref)) return;
  if (l.team_only && !opts.teamOnly) { out.dropped.team_only += 1; return; }
  out.lines.push(l);
}

type Rows<T> = Promise<T[]>;
const all = async <T>(env: Env, sql: string, ...args: unknown[]): Rows<T> => ((await env.DB.prepare(sql).bind(...args).all<T>()).results || []) as T[];

// ---------------------------------------------------------------- the nine builders

const BANK_KEYS = new Set(['net_burn', 'cash_balance', 'cash_in_cents', 'burn', 'runway', 'cash']);

async function overview(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('overview');
  const figures = await growFigures({ env, projectId, now: opts.now, href: (s) => `/grow/${s}` });
  for (const f of figures) {
    // Only the fields PUBLISH_SOURCES lists for `grow_figures`.
    const { key, label, value, unit, source, as_of } = f;
    // A recorded value is quoted whatever its spark (`too_little` still has one); an unreadable or unrecorded one never is.
    const text = f.state === 'unreadable' || f.state === 'not_recorded' ? null : figureText(value, unit);
    if (text == null) { if (keep(opts, `figure:${key}`)) out.dropped.not_recorded += 1; continue; }
    const teamOnly = fromMercury(source) || BANK_KEYS.has(key);
    push(out, opts, { ref: `figure:${key}`, store: 'grow_figures', line: `${label}: ${text}`, source: sourceWord(source, 'Grow'), as_of: day(as_of), team_only: teamOnly, ...(teamOnly ? { figure: text } : {}) });
  }
  return out;
}

async function updates(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('updates');
  const chosen = opts.refs ? [...opts.refs].find((r) => r.startsWith('portfolio_updates:'))?.slice('portfolio_updates:'.length) ?? null : null;
  const u = await env.DB.prepare(
    `SELECT id, uid, title, period_start, period_end, metrics_json, network_includes_metrics, sent_at FROM portfolio_updates
      WHERE project_id = ? AND sent_at IS NOT NULL AND (? IS NULL OR uid = ?) ORDER BY sent_at DESC, id DESC LIMIT 1`,
  ).bind(projectId, chosen, chosen).first<{ id: number; uid: string; title: string; period_start: string | null; period_end: string | null; metrics_json: string | null; network_includes_metrics: number; sent_at: string }>();
  if (!u) return out;
  const ref = `portfolio_updates:${u.uid}`;
  const at = day(u.sent_at);
  const all1: BuildOpts = { ...opts, refs: null };
  push(out, all1, { ref, store: 'portfolio_updates', line: String(u.title || 'Our update').slice(0, 200), source: 'Updates', as_of: at, team_only: false });
  for (const a of await all<{ uid: string; kind: string; text: string }>(env, 'SELECT uid, kind, text FROM update_asks WHERE update_id = ? ORDER BY id', u.id)) {
    push(out, all1, { ref: `update_asks:${a.uid}`, store: 'update_asks', line: `We are looking for: ${String(a.text).slice(0, 280)}`, source: 'Updates', as_of: at, team_only: false });
  }
  // The network's version: the metrics only when the founder included them in it.
  if (Number(u.network_includes_metrics) === 1) {
    let metrics: Array<{ key?: string; label?: string; value?: unknown; unit?: string; source?: string | null; as_of?: string | null }> = [];
    try { const m = JSON.parse(u.metrics_json || '[]'); metrics = Array.isArray(m) ? m : []; } catch { metrics = []; }
    for (const m of metrics) {
      const text = figureText(m.value, String(m.unit || ''));
      if (text == null) { out.dropped.not_recorded += 1; continue; }
      const teamOnly = fromMercury(m.source) || BANK_KEYS.has(String(m.key));
      push(out, all1, { ref: `${ref}#${m.key}`, store: 'portfolio_updates', line: `${String(m.label || m.key)}: ${text}`, source: sourceWord(m.source, 'Updates'), as_of: day(m.as_of) ?? at, team_only: teamOnly, ...(teamOnly ? { figure: text } : {}) });
    }
  }
  return out;
}

async function productImprovement(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('product-improvement');
  const rows = await all<{ uid: string; theme: string | null; roadmap_item_label: string | null; shipped_on: string | null }>(env,
    `SELECT uid, theme, roadmap_item_label, shipped_on FROM product_feedback
      WHERE project_id = ? AND status = 'shipped' AND shipped_on IS NOT NULL AND shipped_on >= date(?, '-90 days') ORDER BY shipped_on DESC, id DESC LIMIT 50`,
    projectId, new Date(opts.now).toISOString().slice(0, 10));
  const seen = new Set<string>();
  for (const r of rows) {
    const what = String(r.roadmap_item_label || r.theme || '').trim();
    if (!what || seen.has(what.toLowerCase())) continue;
    seen.add(what.toLowerCase());
    push(out, opts, { ref: `product_feedback:${r.uid}`, store: 'product_feedback', line: `Shipped: ${what.slice(0, 200)}`, source: 'Product improvement', as_of: day(r.shipped_on), team_only: false });
  }
  return out;
}

async function distribution(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('distribution');
  for (const c of await all<{ uid: string; name: string }>(env, "SELECT uid, name FROM growth_channels WHERE project_id = ? AND state = 'active' ORDER BY id LIMIT 20", projectId)) {
    push(out, opts, { ref: `growth_channels:${c.uid}`, store: 'growth_channels', line: `Now on ${String(c.name).slice(0, 120)}`, source: 'Distribution', as_of: null, team_only: false });
  }
  for (const e of await all<{ uid: string; title: string; run_on: string | null }>(env,
    `SELECT e.uid, e.title, e.run_on FROM channel_experiments e JOIN growth_channels c ON c.id = e.channel_id
      WHERE c.project_id = ? AND e.run_on IS NOT NULL ORDER BY e.run_on DESC, e.id DESC LIMIT 10`, projectId)) {
    push(out, opts, { ref: `channel_experiments:${e.uid}`, store: 'channel_experiments', line: `Tried: ${String(e.title).slice(0, 200)}`, source: 'Distribution', as_of: day(e.run_on), team_only: false });
  }
  return out;
}

/** Revenue and traction's figures, as `project_metrics` names them, with their units. */
const METRIC_FIELDS: ReadonlyArray<[string, string, string]> = [
  ['mrr', 'MRR', 'usd'], ['arr', 'ARR', 'usd'], ['paying_accounts', 'Paying customers', 'count'], ['new_users', 'New users', 'count'],
  ['nrr_pct', 'Net revenue retention', 'pct'], ['net_burn', 'Net burn', 'usd'], ['cash_balance', 'Cash', 'usd'], ['cash_in_cents', 'Cash in', 'cents'],
];
async function revenue(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('revenue-and-traction');
  const rows = await all<Record<string, unknown>>(env,
    `SELECT snapshot_date, source, mrr, arr, paying_accounts, new_users, nrr_pct, net_burn, cash_balance, cash_in_cents FROM project_metrics
      WHERE project_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 400`, projectId);
  for (const [col, label, unit] of METRIC_FIELDS) {
    const r = rows.find((x) => num(x[col]) != null);
    const ref = `figure:${col}`;
    if (!r) { if (keep(opts, ref)) out.dropped.not_recorded += 1; continue; }
    const text = figureText(r[col], unit)!;
    const teamOnly = fromMercury(r.source) || BANK_KEYS.has(col);
    push(out, opts, { ref, store: 'project_metrics', line: `${label}: ${text}`, source: sourceWord(r.source, 'Revenue and traction'), as_of: day(r.snapshot_date), team_only: teamOnly, ...(teamOnly ? { figure: text } : {}) });
  }
  return out;
}

async function team(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('team-expansion');
  for (const j of await all<{ slug: string; title: string; location_text: string | null; remote: number | null; summary: string | null; published_at: string | null }>(env,
    `SELECT slug, title, location_text, remote, summary, published_at FROM job_postings
      WHERE project_id = ? AND status = 'published' AND admin_published = 1 ORDER BY published_at DESC, id DESC LIMIT 10`, projectId)) {
    const where = Number(j.remote) === 1 ? 'Remote' : String(j.location_text || '').trim();
    const summary = String(j.summary || '').trim();
    push(out, opts, { ref: `job_postings:${j.slug}`, store: 'job_postings',
      line: `Hiring: ${String(j.title).slice(0, 120)}${where ? ` · ${where.slice(0, 80)}` : ''}${summary ? ` — ${summary.slice(0, 200)}` : ''} /jobs/${j.slug}`,
      source: 'Team expansion', as_of: day(j.published_at), team_only: false });
  }
  return out;
}

const PARTNER_WORD: Readonly<Record<string, string>> = Object.freeze({
  reseller: 'reseller', integration: 'integration', agency: 'agency', referral: 'referral', co_marketing: 'co-marketing', other: 'new',
});
const article = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
async function partners(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('partner-network');
  for (const p of await all<{ uid: string; type: string | null }>(env, "SELECT uid, type FROM growth_partners WHERE project_id = ? AND stage = 'signed' ORDER BY id DESC LIMIT 20", projectId)) {
    if (!keep(opts, `growth_partners:${p.uid}`)) continue;
    // The partner's name waits for a recorded "agreed to be named": the line says what was signed, not with whom.
    out.dropped.unnamed += 1;
    push(out, opts, { ref: `growth_partners:${p.uid}`, store: 'growth_partners', line: `Signed ${article(PARTNER_WORD[String(p.type)] ?? 'new')} partnership`, source: 'Partner network', as_of: null, team_only: false });
  }
  return out;
}

async function markets(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('market-expansion');
  for (const m of await all<{ uid: string; name: string; state: string | null; decision: string | null; decided_on: string | null; updated_at: string | null }>(env,
    `SELECT uid, name, state, decision, decided_on, updated_at FROM markets
      WHERE project_id = ? AND (state IN ('entering', 'served') OR decision = 'enter') ORDER BY id LIMIT 20`, projectId)) {
    push(out, opts, { ref: `markets:${m.uid}`, store: 'markets', line: `${m.state === 'served' ? 'Now serving' : 'Entering'} ${String(m.name).slice(0, 120)}`, source: 'Market expansion', as_of: day(m.decided_on) ?? day(m.updated_at), team_only: false });
  }
  for (const s of await all<{ uid: string; text: string; done_at: string | null }>(env,
    `SELECT s.uid, s.text, s.done_at FROM market_entry_steps s JOIN markets m ON m.id = s.market_id
      WHERE m.project_id = ? AND s.done_at IS NOT NULL ORDER BY s.done_at DESC, s.id DESC LIMIT 10`, projectId)) {
    push(out, opts, { ref: `market_entry_steps:${s.uid}`, store: 'market_entry_steps', line: `Done: ${String(s.text).slice(0, 200)}`, source: 'Market expansion', as_of: day(s.done_at), team_only: false });
  }
  return out;
}

async function durable(env: Env, projectId: number, opts: BuildOpts): Promise<BuiltDraft> {
  const out = empty('durable-company-building');
  const done = new Map((await all<{ item_key: string; done_at: string | null }>(env, 'SELECT item_key, done_at FROM durability_checklist WHERE project_id = ? AND done_at IS NOT NULL', projectId))
    .map((r) => [r.item_key, r.done_at]));
  for (const item of DURABILITY_ITEMS) {
    if (!done.has(item.key)) continue;
    // Runway is the founder's Mercury: team-only.
    const teamOnly = item.mercury === 'runway';
    push(out, opts, { ref: `durability_checklist:${item.key}`, store: 'durability_checklist', line: `${item.label}: complete`, source: 'Durable company-building', as_of: day(done.get(item.key)), team_only: teamOnly, ...(teamOnly ? { figure: item.label } : {}) });
  }
  return out;
}

export const DRAFT_BUILDERS: Readonly<Record<PublishModule, (env: Env, projectId: number, opts: BuildOpts) => Promise<BuiltDraft>>> = Object.freeze({
  overview, updates, 'product-improvement': productImprovement, distribution, 'revenue-and-traction': revenue,
  'team-expansion': team, 'partner-network': partners, 'market-expansion': markets, 'durable-company-building': durable,
});

const NOUN: Readonly<Record<PublishModule, [string, string]>> = Object.freeze({
  overview: ['figure', 'figures'], updates: ['line', 'lines'], 'product-improvement': ['shipped item', 'shipped items'],
  distribution: ['channel item', 'channel items'], 'revenue-and-traction': ['figure', 'figures'], 'team-expansion': ['open role', 'open roles'],
  'partner-network': ['signed partner', 'signed partners'], 'market-expansion': ['market item', 'market items'],
  'durable-company-building': ['item done', 'items done'],
});
/** "From Product improvement · 3 shipped items · Oct 2026": where the draft came from, and the newest date it quotes. */
export function sourceChip(b: BuiltDraft): string {
  const n = b.lines.length;
  const newest = b.lines.map((l) => l.as_of).filter((d): d is string => !!d).sort().at(-1) ?? null;
  return [`From ${MODULE_LABEL[b.module]}`, `${n} ${NOUN[b.module][n === 1 ? 0 : 1]}`, monthOf(newest)].filter(Boolean).join(' · ');
}

/**
 * A draft's text and source refs, pre-filled from the module's records. `refs`
 * narrows it to the records chosen; `teamOnly` is the founder's tick for this
 * draft. Each source ref keeps its source and date, and a team-only one its
 * figure, which `publishLint` checks again on every preview and confirm.
 */
export async function prefillDraft(env: Env, projectId: number, module: PublishModule, opts: { refs?: readonly string[] | null; teamOnly?: boolean; now?: number } = {}) {
  if (!(PUBLISH_MODULES as readonly string[]).includes(module)) throw refused('invalid');
  const refs = opts.refs && opts.refs.length ? new Set(opts.refs.map(String).slice(0, 50)) : null;
  const built = await DRAFT_BUILDERS[module](env, projectId, { refs, teamOnly: !!opts.teamOnly, now: opts.now ?? Date.now() });
  const sourceRefs = built.lines.map((l) => ({
    ref: l.ref, store: l.store, source: l.source, as_of: l.as_of, team_only: l.team_only,
    // `publishLint` looks for a team-only figure's own text; another line keeps its whole line.
    text: l.team_only ? l.figure ?? l.line : l.line,
  }));
  return { text: built.lines.map((l) => l.line).join('\n'), source_refs: sourceRefs, chip: sourceChip(built), dropped: built.dropped, lines: built.lines.length };
}

/**
 * A new draft for one venture and one place, as `POST /api/publish/drafts` and
 * a sent update's Publish to… make it. With the founder's own `text` it holds
 * that text; without it, the module's records pre-fill it. The caller has
 * checked `canPublish`.
 */
export async function createDraft(env: Env, projectId: number, module: PublishModule, authorId: number,
  b: { text?: unknown; source_refs?: unknown; team_only_included?: unknown }) {
  const own = typeof b.text === 'string' && b.text.trim() !== '';
  const teamOnly = b.team_only_included === true;
  const chosen = Array.isArray(b.source_refs) ? b.source_refs.filter((r): r is string => typeof r === 'string').slice(0, 50) : [];
  const filled = own ? null : await prefillDraft(env, projectId, module, { refs: chosen, teamOnly });
  const project = await env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(projectId).first<{ company_id: number | null }>();
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO publish_drafts (uid, project_id, company_id, module, source_refs_json, author_user_id, body_json, team_only_included) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, projectId, project?.company_id ?? null, module, JSON.stringify(filled ? filled.source_refs : chosen.map((ref) => ({ ref }))), authorId,
    JSON.stringify({ text: own ? String(b.text).slice(0, 20_000) : filled!.text, per_destination: {} }), filled && teamOnly ? 1 : 0).run();
  return { uid, prefill: filled ? { chip: filled.chip, lines: filled.lines, dropped: filled.dropped } : null };
}

// ---------------------------------------------------------------- the gate and "Published from here"

/** What one Grow page shows of publishing (PUB8): Publish to…, its empty states, and the last three sends from here. */
export async function publishPart(env: Env, user: User, support: boolean, projectId: number, module: PublishModule) {
  try {
    const project = await env.DB.prepare(
      'SELECT p.company_id, cp.company_name FROM projects p LEFT JOIN company_profiles cp ON cp.id = p.company_id WHERE p.id = ?',
    ).bind(projectId).first<{ company_id: number | null; company_name: string | null }>();
    const company = String(project?.company_name || '').trim() || 'this company';
    let refusal: string | null = null;
    try { await canPublish(env, { user, support, projectId }); } catch (e) { refusal = e instanceof PublishRefusal ? e.code : 'publish_not_allowed'; }
    let on = 0;
    if (!refusal && project?.company_id != null) {
      const rows = await all<{ provider_key: string }>(env,
        `SELECT d.provider_key FROM publish_destinations d JOIN integrations i ON i.id = d.integration_id
          WHERE i.user_id = ? AND i.status = 'active' AND d.company_id = ? AND d.enabled = 1`, user.id, project.company_id);
      on = rows.filter((r) => publishTarget(r.provider_key)).length;
    }
    const can = !refusal && on > 0;
    const emptyState = refusal === 'support_session' ? { kind: 'support', sentence: 'A support session cannot publish.' }
      : refusal ? { kind: 'founder_only', sentence: `Only the founder publishes for ${company}.` }
        : on === 0 ? { kind: 'connect', sentence: 'Connect a place to publish', href: '/account/connectors' } : null;
    let recent: unknown[] | null = null;
    if (await isTeamViewer(env, user, projectId)) {
      await releaseStrandedSends(env, projectId);
      recent = (await all<Record<string, unknown>>(env,
        `SELECT uid, provider_key, destination_label, audience_label, status, sent_at, confirmed_at, external_url FROM publish_sends
          WHERE project_id = ? AND module = ? ORDER BY COALESCE(sent_at, confirmed_at) DESC, id DESC LIMIT 3`, projectId, module))
        .map((r) => ({ uid: r.uid, provider_key: r.provider_key, destination: r.destination_label, audience: r.audience_label, status: r.status, sent_at: r.sent_at ?? r.confirmed_at, external_url: r.external_url }));
    }
    return { state: 'ok' as const, module, can_publish: can, destinations_on: refusal ? null : on, empty: emptyState, recent };
  } catch (e) {
    console.error('[publish] gate unreadable:', module, (e as Error)?.name);
    return { state: 'unreadable' as const, module, can_publish: false, destinations_on: null, empty: null, recent: null, reason: 'Publishing could not be read for this page. Try again.' };
  }
}
