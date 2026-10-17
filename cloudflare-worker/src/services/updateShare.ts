/**
 * D654 (#1466) — Grow › Share an update, on top of `portfolio_updates`.
 *
 * One update, written once, sent to investors, the team and the Axal network.
 * This module holds the rules, as functions the route and the tests share:
 *
 *   METRICS     each figure from `project_metrics` (Revenue and traction), with
 *               its source and its date. A figure no snapshot in the period
 *               records is `value: null` — "Not recorded" — never 0. Growth is
 *               derived only from two recorded MRR figures, runway only from
 *               recorded cash and burn.
 *   LINES       highlights and lowlights. Every line names its source; a line
 *               without one is refused, whether Eadwyn or the founder wrote it.
 *   AUDIENCE    investors and the team get the full update. The Axal network
 *               gets the asks only, unless the founder includes the metrics.
 *   ASKS        typed (hire, customer, partner, market, capital), each linked
 *               to the module item it is for.
 *   REPLIES     a reply lands as an item in the module that asked. A module
 *               with no store yet keeps the reply on the ask and says why.
 */
import type { Env } from '../types';
import { run as runAI } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { ingestContact } from '../routes/contacts';

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface Snapshot {
  snapshot_date: string; source: string | null;
  mrr: number | null; paying_accounts: number | null; net_burn: number | null; cash_balance: number | null;
}

export interface Metric {
  key: string; label: string; value: number | null; unit: 'usd' | 'pct' | 'count' | 'months';
  source: string | null; as_of: string | null; reason: string | null;
}

export const NOT_RECORDED = 'Not recorded';

/** The figures the canvas draws, in its order. */
export const METRIC_KEYS = ['mrr', 'growth', 'customers', 'burn', 'runway'] as const;

// One label for a typed value everywhere in Grow, as `snapSource` gives it.
const sourceLabel = (s: string | null) => (s && s.trim() ? s.trim() : 'manual');

/** The latest snapshot in `rows` (sorted by date) that records `col`. */
function latest(rows: Snapshot[], col: keyof Snapshot): Snapshot | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = rows[i][col];
    if (typeof v === 'number' && Number.isFinite(v)) return rows[i];
  }
  return null;
}

/**
 * The period's metrics. `inPeriod` are the snapshots dated inside the period,
 * `before` those dated before it (for growth). Nothing missing becomes 0.
 */
export function buildMetrics(inPeriod: Snapshot[], before: Snapshot[], periodStart: string): Metric[] {
  const sort = (r: Snapshot[]) => [...r].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const cur = sort(inPeriod);
  const prev = sort(before);
  const pick = (key: string, label: string, unit: Metric['unit'], col: keyof Snapshot): Metric => {
    const s = latest(cur, col);
    return s
      ? { key, label, unit, value: s[col] as number, source: sourceLabel(s.source), as_of: s.snapshot_date, reason: null }
      : { key, label, unit, value: null, source: null, as_of: null, reason: `${NOT_RECORDED}: no snapshot in this period records it` };
  };
  const mrr = pick('mrr', 'MRR', 'usd', 'mrr');
  const [year, month] = periodStart.slice(0, 7).split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const prevMrr = latest(prev.filter((s) => s.snapshot_date.slice(0, 7) === previousMonth), 'mrr');
  const growth: Metric = mrr.value != null && prevMrr && (prevMrr.mrr as number) > 0
    ? { key: 'growth', label: 'Growth', unit: 'pct', value: Math.round((((mrr.value - (prevMrr.mrr as number)) / (prevMrr.mrr as number)) * 1000)) / 10,
        source: mrr.source, as_of: mrr.as_of, reason: null }
    : { key: 'growth', label: 'Growth', unit: 'pct', value: null, source: null, as_of: null,
        reason: `${NOT_RECORDED}: growth needs MRR recorded in this period and the month before` };
  const customers = pick('customers', 'Customers', 'count', 'paying_accounts');
  const burn = pick('burn', 'Burn', 'usd', 'net_burn');
  const cash = latest(cur, 'cash_balance');
  const runway: Metric = cash && burn.value != null && burn.value > 0
    ? { key: 'runway', label: 'Runway', unit: 'months', value: Math.round(((cash.cash_balance as number) / burn.value) * 10) / 10,
        source: sourceLabel(cash.source), as_of: cash.snapshot_date, reason: null }
    : { key: 'runway', label: 'Runway', unit: 'months', value: null, source: null, as_of: null,
        reason: `${NOT_RECORDED}: runway needs cash and burn recorded in this period` };
  return [mrr, growth, customers, burn, runway];
}

/** True when no metric in the list carries a recorded figure. */
export const noMetrics = (m: Metric[]) => !m.some((x) => x.value != null);

/** Keep only well-formed metrics the founder kept; a null stays null. */
export function cleanMetrics(raw: unknown): Metric[] {
  if (!Array.isArray(raw)) return [];
  const out: Metric[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (!(METRIC_KEYS as readonly string[]).includes(String(r.key))) continue;
    const value = typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
    out.push({
      key: String(r.key), label: String(r.label ?? r.key).slice(0, 60),
      unit: (['usd', 'pct', 'count', 'months'].includes(String(r.unit)) ? r.unit : 'count') as Metric['unit'],
      value,
      source: value == null ? null : (typeof r.source === 'string' && r.source.trim() ? r.source.trim().slice(0, 120) : null),
      as_of: value == null ? null : (typeof r.as_of === 'string' ? r.as_of.slice(0, 10) : null),
      reason: value == null ? `${NOT_RECORDED}` : null,
    });
  }
  // A recorded figure with no source is not a figure this update may send.
  return out.filter((m) => m.value == null || m.source);
}

// ── Highlights and lowlights ────────────────────────────────────────────────

export interface LineSource { label: string; ref: string | null; as_of: string | null }
export interface Line { text: string; source: LineSource }

/** A refused line. `sentence` is written by this file, safe for a refusal body (D278). */
export class LineError extends Error {
  sentence: string;
  constructor(sentence: string) { super(sentence); this.sentence = sentence; }
}

/** Every line needs text and a source label. A line without one is refused. */
export function cleanLines(raw: unknown, field: string): Line[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new LineError(`${field} must be a list`);
  return raw.slice(0, 12).map((l, i) => {
    const r = (l && typeof l === 'object' ? l : {}) as Record<string, any>;
    const text = typeof r.text === 'string' ? r.text.trim().slice(0, 400) : '';
    const label = typeof r.source?.label === 'string' ? r.source.label.trim().slice(0, 120) : '';
    if (!text) throw new LineError(`${field} ${i + 1} has no text`);
    if (!label) throw new LineError(`${field} ${i + 1} names no source. Every line cites where it comes from.`);
    return {
      text,
      source: {
        label,
        ref: typeof r.source.ref === 'string' ? r.source.ref.slice(0, 200) : null,
        as_of: typeof r.source.as_of === 'string' ? r.source.as_of.slice(0, 10) : null,
      },
    };
  });
}

/** A fact Eadwyn may draft from: stored data of the period, with its source. */
export interface Fact { kind: 'metric' | 'shipped' | 'role' | 'contacts'; text: string; source: LineSource }

export interface ShippedItem { label: string; shipped_on: string; kind: 'roadmap' | 'feedback'; customers?: number }

const dayMonth = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The period's facts: metric figures, roles open, customers captured. */
export function periodFacts(metrics: Metric[], openRoles: Array<{ title: string; opened: string | null }>,
  contactsInPeriod: number | null, periodEnd: string, shipped: ShippedItem[] = []): Fact[] {
  const facts: Fact[] = [];
  for (const m of metrics) {
    if (m.value == null) continue;
    facts.push({ kind: 'metric', text: `${m.label}: ${m.value}${m.unit === 'pct' ? '%' : ''}`, source: { label: `${m.source} · ${m.label}`, ref: 'revenue_and_traction', as_of: m.as_of } });
  }
  for (const item of shipped) facts.push({ kind: 'shipped', text: `${item.label} shipped${item.customers ? `, asked for by ${item.customers} customers` : ''}`,
    source: { label: `${item.kind === 'roadmap' ? 'Product roadmap' : 'Product improvement'} · ${item.label} shipped ${dayMonth(item.shipped_on)}`,
      ref: item.kind === 'roadmap' ? 'roadmap' : 'product_feedback', as_of: item.shipped_on } });
  for (const r of openRoles) {
    if (!r.opened || r.opened > periodEnd) continue;
    const days = Math.max(0, Math.floor((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${r.opened}T00:00:00Z`)) / 86_400_000));
    facts.push({ kind: 'role', text: `Open role: ${r.title}`, source: { label: `Team expansion · ${r.title} open ${days} days`, ref: 'job_postings', as_of: r.opened } });
  }
  if (contactsInPeriod != null && contactsInPeriod > 0) {
    facts.push({ kind: 'contacts', text: `${contactsInPeriod} new customer contacts`, source: { label: 'Distribution · customer contacts captured', ref: 'contacts', as_of: null } });
  }
  return facts;
}

/**
 * Parse Eadwyn's answer: `{ highlights: [{ text, fact }], lowlights: [...] }`
 * where `fact` is the index of the fact it draws on. A line naming no fact, or
 * a fact that does not exist, is dropped: no line leaves without its source.
 */
export function parseDraft(output: string, facts: Fact[]): { highlights: Line[]; lowlights: Line[] } {
  let parsed: any = null;
  try {
    const at = output.indexOf('{');
    const to = output.lastIndexOf('}');
    parsed = at >= 0 && to > at ? JSON.parse(output.slice(at, to + 1)) : null;
  } catch { parsed = null; }
  const take = (list: unknown): Line[] => (Array.isArray(list) ? list : []).flatMap((l: any) => {
    const i = Number(l?.fact);
    const text = typeof l?.text === 'string' ? l.text.trim().slice(0, 400) : '';
    if (!text || !Number.isInteger(i) || i < 0 || i >= facts.length) return [];
    return [{ text, source: facts[i].source }];
  }).slice(0, 6);
  return { highlights: take(parsed?.highlights), lowlights: take(parsed?.lowlights) };
}

/**
 * Eadwyn's draft. With no fact in the period it does not call the model: the
 * answer is "nothing new", and the sheet offers "Skip this month" or "Write
 * by hand".
 */
export async function draftLines(env: Env, userId: number, facts: Fact[]) {
  if (!facts.some((f) => f.kind === 'metric' || f.kind === 'shipped')) return { status: 'nothing' as const, highlights: [], lowlights: [] };
  const prompt = [
    'Draft a monthly company update\'s highlights and lowlights from these facts only.',
    'Each line must draw on exactly one fact, named by its number. Never add a figure the facts do not hold.',
    'Answer as JSON: {"highlights":[{"text":"…","fact":0}],"lowlights":[{"text":"…","fact":1}]}',
    '',
    ...facts.map((f, i) => `${i}. ${f.text} (source: ${f.source.label})`),
  ].join('\n');
  const out = await runAI(env, { task: 'publication', userId, surface: AI_SURFACE.growUpdate, text: prompt, maxTokens: 500 });
  if (!out?.ok || !out.output) return { status: 'unavailable' as const, highlights: [], lowlights: [], reason: 'Eadwyn could not draft this time. Write the lines by hand.' };
  return { status: 'drafted' as const, ...parseDraft(String(out.output), facts) };
}

// ── Asks ────────────────────────────────────────────────────────────────────

export const ASK_KINDS = ['hire', 'customer', 'partner', 'market', 'capital'] as const;
export type AskKind = typeof ASK_KINDS[number];

/** The module each kind of ask belongs to, and where its replies land. */
export const ASK_MODULE: Record<AskKind, { module: string; label: string; lands: string | null; reason: string | null }> = {
  hire: { module: 'talent', label: 'Team expansion', lands: 'job_applications', reason: null },
  customer: { module: 'customers', label: 'Distribution', lands: 'contacts', reason: null },
  partner: { module: 'partnerships', label: 'Partner network', lands: 'contacts', reason: null },
  // D664 (#1477, answer A1 on #1466): once `markets` exists (migration 443), a
  // market ask links to one market and its replies are read under it.
  market: { module: 'market-expansion', label: 'Market expansion', lands: 'markets', reason: null },
  capital: { module: 'capital', label: 'Capital relationships', lands: 'contacts', reason: null },
};

export const ASK_AGAIN_DAYS = 14;

/** True when an ask with no replies may be asked again. */
export function canAskAgain(sentAt: string | null, replies: number, askedAgainAt: string | null, now = Date.now()): boolean {
  if (!sentAt || replies > 0) return false;
  const from = Date.parse(askedAgainAt || sentAt);
  return Number.isFinite(from) && now - from >= ASK_AGAIN_DAYS * 86_400_000;
}

// ── Audience ────────────────────────────────────────────────────────────────

export type Audience = 'investor' | 'team' | 'network';
export interface AudienceChoice { investors: boolean; team: boolean; network: boolean }

export function cleanAudience(raw: unknown): AudienceChoice {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { investors: r.investors !== false, team: r.team !== false, network: r.network !== false };
}

/**
 * What one recipient may read. Investors and the team: the whole update. The
 * Axal network: the asks only, and the metrics only when the founder chose to
 * include them. Highlights and lowlights never reach the network.
 */
export function payloadFor(audience: Audience, u: {
  title: string; period_start: string | null; period_end: string | null; metrics: Metric[];
  highlights: Line[]; lowlights: Line[]; asks: unknown[]; network_includes_metrics: boolean;
}) {
  const base = { title: u.title, period_start: u.period_start, period_end: u.period_end, audience, asks: u.asks };
  if (audience === 'network') {
    return u.network_includes_metrics ? { ...base, metrics: u.metrics } : base;
  }
  return { ...base, metrics: u.metrics, highlights: u.highlights, lowlights: u.lowlights };
}

// ── Replies land in their module ────────────────────────────────────────────

export interface LandedIn { module: string | null; ref: string | null; reason: string | null }

/**
 * Put a reply where the ask's module keeps its items:
 *   hire     → a candidate on the linked open role (`job_applications`);
 *   customer → a customer contact (`ingestContact`);
 *   partner  → a partner contact;
 *   capital  → an investor contact (Raise reads `investor` contacts);
 *   market   → the market the ask links to (`markets`, migration 443); the
 *              reply stays on the ask and the market reads it, never copied.
 *              An ask linked to no market keeps the reply, with the reason.
 */
export async function landReply(env: Env, projectId: number, ask: { kind: AskKind; link_ref: string | null; text: string },
  reply: { name: string | null; email: string | null; message: string; userId: number | null }): Promise<LandedIn> {
  const m = ASK_MODULE[ask.kind];
  if (!m.lands) return { module: null, ref: null, reason: m.reason };
  if (ask.kind === 'market') {
    const marketId = ask.link_ref == null ? NaN : Number(ask.link_ref);
    const market = Number.isInteger(marketId) && marketId > 0
      ? await env.DB.prepare('SELECT uid FROM markets WHERE id = ? AND project_id = ?').bind(marketId, projectId).first<{ uid: string }>()
      : null;
    return market
      ? { module: m.module, ref: market.uid, reason: null }
      : { module: null, ref: null, reason: `${NOT_RECORDED}: the ask is linked to no market, so the reply stays on the ask` };
  }
  if (!reply.email) return { module: null, ref: null, reason: `${NOT_RECORDED}: the reply gave no email, so it stays on the ask` };
  if (ask.kind === 'hire') {
    const postingId = Number(ask.link_ref);
    const posting = Number.isInteger(postingId)
      ? await env.DB.prepare(`SELECT id FROM job_postings WHERE id = ? AND project_id = ?`).bind(postingId, projectId).first<{ id: number }>()
      : null;
    if (!posting) return { module: null, ref: null, reason: `${NOT_RECORDED}: the ask is linked to no open role, so the reply stays on the ask` };
    try {
      const r = await env.DB.prepare(
        `INSERT INTO job_applications (posting_id, user_id, name, email, cover_note) VALUES (?, ?, ?, ?, ?)`,
      ).bind(posting.id, reply.userId, reply.name || reply.email, reply.email.toLowerCase(),
        `Proposed in reply to an update: ${reply.message}`.slice(0, 4000)).run();
      return { module: m.module, ref: String((r as any).meta?.last_row_id ?? posting.id), reason: null };
    } catch (e) {
      if (String((e as Error).message).toLowerCase().includes('unique')) {
        return { module: m.module, ref: String(posting.id), reason: 'Already a candidate on this role' };
      }
      throw e;
    }
  }
  const audience = ask.kind === 'customer' ? 'customer' : ask.kind === 'partner' ? 'partner' : 'investor';
  await ingestContact(env, {
    projectId, email: reply.email, name: reply.name, audience,
    message: reply.message.slice(0, 4000), source: 'update_ask', cta: ask.text.slice(0, 200),
  });
  return { module: m.module, ref: reply.email.toLowerCase(), reason: null };
}
