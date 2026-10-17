/**
 * D692 (#1701) — each cycle's phone root: One Next Thing.
 *
 * Every overview read (`routes/cycle_validate.ts`, `cycle_build.ts`,
 * `cycle_raise.ts`, `cycle_grow.ts`) returns three more parts beside its
 * figures and cards, in one shape, so a phone draws the four roots without a
 * Worker change of its own (D703):
 *
 *   focus  { rule, eyebrow, headline, why, cta: { label, href } | null, then }
 *   meter  { key, label, count, target, target_reason, display }
 *   index  [{ key, title, detail, value, href }]
 *
 * `index[].value` null draws Not recorded; `''` draws nothing at the right;
 * "Unreadable" says its source could not be read; any other string is the
 * value. Each part is null when it cannot be read, and a failed part never
 * fails the read (`part`).
 *
 * COMPUTED, NEVER TEMPLATED. Every number in a sentence is a stored value. A
 * missing value drops its clause, never prints a bracket, and never prints 0
 * for nothing recorded; a counted zero is a real 0.
 *
 * A FOCUS THAT ASKS FOR A WRITE GOES ONLY TO A WRITER. Anyone else gets the
 * card rule, which repeats a `next` their own cards already carry.
 *
 * Validate's parts live in `services/validateFocus.ts`; Raise's and Grow's are
 * here. Build's arrive with #1652's Worker PR (D692 PR 2).
 */
import type { User } from '../types';
import type { Card, Figure } from './cycleCards';
import {
  callsHistory, followUps, loadProspects, parseAllocation, type Ctx as RaiseCtx,
} from './raiseCycle';
import { roundCallsEnabled } from './roundCallPolicy';
import { checklist, type Ctx as GrowCtx } from './growCycle';
import { canAccessProject } from './projectAccess';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type FocusRule =
  | 'first_interview' | 'review' | 'next_interview'
  | 'first_feature' | 'connect_tools'
  | 'first_readiness' | 'call_for_capital'
  | 'first_kpi' | 'tell_customers'
  | 'card';

export interface Focus {
  rule: FocusRule;
  eyebrow: string;
  headline: string;
  why: string | null;
  cta: { label: string; href: string } | null;
  then: string | null;
}

export interface Meter {
  key: string;
  label: string;
  count: number | null;
  target: number | null;
  target_reason: string | null;
  /** The value text the canvas draws ("14 of 20", "$900k of $1.5M"), so the browser formats nothing. */
  display: string | null;
}

export interface IndexRow {
  key: string;
  title: string;
  detail: string;
  /** null: Not recorded. '': nothing at the right. "Unreadable": its source failed. */
  value: string | null;
  href: string;
}

export type Phone = { focus: Focus | null; meter: Meter | null; index: IndexRow[] | null };

export const UNREADABLE = 'Unreadable';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One part of the read: its value, or null when it cannot be read. */
export async function part<T>(name: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    console.warn('[cycleFocus] overview part unreadable:', name, (e as Error)?.message);
    return null;
  }
}

/** Trimmed, no leading "Then ", a capital first letter, and one closing period. */
export function sentence(text: string): string {
  const s = String(text ?? '').trim().replace(/^then\s+/i, '').replace(/[.\s]+$/, '');
  if (!s) return '';
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 Oct" from a date or timestamp, in UTC; null when it is not one. */
export const dayMonth = (v: string | null | undefined): string | null => {
  const raw = v == null ? '' : String(v);
  const d = raw ? new Date(raw.replace(' ', 'T') + (raw.length > 10 && !/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? 'Z' : '')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
};

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "$610M", "$900k", "$1.5M": the client's `usdShort` (adapters/validate.js). Null stays null. */
export function usdShort(v: unknown): string | null {
  if (!num(v)) return null;
  const a = Math.abs(v);
  const t = (n: number) => (Math.round(n * 10) / 10).toString();
  if (a >= 1e9) return `$${t(v / 1e9)}B`;
  if (a >= 1e6) return `$${t(v / 1e6)}M`;
  if (a >= 1e3) return `$${t(v / 1e3)}k`;
  return `$${v.toLocaleString('en-US')}`;
}

const CYCLE_WORD: Record<string, string> = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };
const inApp = (href: unknown) => typeof href === 'string' && /^\/(?!\/)/.test(href);

/** The card rule: the first card whose `next` stays in the app, or null. */
export function cardFocus(cycle: string, cards: Card[]): Focus | null {
  const first = (cards || []).find((c) => c?.next?.text && inApp(c.next.href));
  if (!first) return null;
  return {
    rule: 'card', eyebrow: `${CYCLE_WORD[cycle] ?? cycle} · Next`,
    headline: sentence(first.next!.text),
    why: first.caption || first.reason || null,
    cta: { label: first.next!.text, href: first.next!.href },
    then: null,
  };
}

/** A card's own row value: '' when it draws, "Unreadable" when it failed, null otherwise. */
export function cardValue(card: Card | undefined | null): string | null {
  if (!card) return null;
  if (card.state === 'ok' || card.state === 'too_little') return '';
  if (card.state === 'unreadable') return UNREADABLE;
  return null;
}

const figureOf = (figures: Figure[], key: string) => (figures || []).find((f) => f.key === key);
const cardOf = (cards: Card[], slug: string) => (cards || []).find((c) => c.slug === slug);

/** A row read from a figure: its value when ok, "Unreadable" when it failed, Not recorded otherwise. */
function figureValue(f: Figure | undefined, format: (v: any, f: Figure) => string | null): string | null {
  if (!f) return null;
  if (f.state === 'unreadable') return UNREADABLE;
  if (f.state !== 'ok' || f.value == null) return null;
  return format(f.value, f);
}

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

const raiseHref = (ctx: RaiseCtx, slug: string) => `/raise/${slug}?project=${ctx.projectId}`;

/**
 * Nothing in Raise is recorded: no readiness item, no saved narrative version,
 * no pitch deck, no data-room file, no base cap-table scenario, no use-of-funds
 * allocation and no prospect. One query, every store bound to the venture.
 */
async function raiseNothingRecorded(ctx: RaiseCtx): Promise<boolean> {
  const r = await ctx.env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM readiness_items WHERE project_id = ?) AS readiness,
       EXISTS(SELECT 1 FROM spinout_deck_overrides WHERE project_id = ? AND version > 0) AS narrative,
       EXISTS(SELECT 1 FROM pitch_decks WHERE project_id = ?) AS decks,
       EXISTS(SELECT 1 FROM data_room_files WHERE project_id = ?) AS files,
       EXISTS(SELECT 1 FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0) AS cap,
       EXISTS(SELECT 1 FROM raise_prospects WHERE project_id = ?) AS prospects,
       (SELECT use_of_funds FROM projects WHERE id = ?) AS use_of_funds`,
  ).bind(ctx.projectId, ctx.projectId, ctx.projectId, ctx.projectId, ctx.projectId, ctx.projectId, ctx.projectId)
    .first<Record<string, number | string | null>>();
  if (!r) return false;
  const any = ['readiness', 'narrative', 'decks', 'files', 'cap', 'prospects'].some((k) => Number(r[k]) === 1);
  const alloc = parseAllocation(r.use_of_funds);
  return !any && !(alloc && alloc.some((v) => v > 0));
}

type CallsRead = { enabled: false } | { state: 'unreadable' } | { enabled: true; items: Array<{ effective_state: string }> };

async function raiseFocus(ctx: RaiseCtx, cards: Card[], calls: CallsRead): Promise<Focus | null> {
  if (await raiseNothingRecorded(ctx)) {
    return {
      rule: 'first_readiness', eyebrow: 'Raise · Next', headline: 'Score your readiness.',
      why: 'Nothing in Raise is recorded yet.',
      cta: { label: 'Score readiness', href: `/raise/fundraising-readiness?project=${ctx.projectId}&add=1` },
      then: null,
    };
  }
  // Only while round calls are on, and only while no call is open: with one
  // open, the next thing is its investors, not a second call (D692 decision 6).
  if (roundCallsEnabled(ctx.env) && 'items' in calls && !calls.items.some((i) => i.effective_state === 'open')) {
    const fu = followUps(await loadProspects(ctx.env, ctx.projectId), ctx.today);
    const n = fu.overdue + fu.due;
    return {
      rule: 'call_for_capital', eyebrow: 'Raise · Next', headline: 'Call for capital from investors who fit.',
      why: 'Verified investors whose thesis, stage and cheque fit see the round; each response lands in Capital relationships.',
      cta: { label: 'Call for Capital', href: `/raise/call?project_id=${ctx.projectId}` },
      then: n > 0 ? `Follow up with the ${plural(n, 'investor', 'investors')} due or overdue this week.` : null,
    };
  }
  return cardFocus('raise', cards);
}

/** Committed against the active round's target. */
function raiseMeter(figures: Figure[]): Meter | null {
  const f = figureOf(figures, 'committed');
  if (!f || f.state !== 'ok' || f.value == null) return null;
  if (Array.isArray(f.value)) {
    const [amt, target] = (f.value as unknown as number[]).map(Number);
    if (!num(amt) || !num(target)) return null;
    return { key: 'committed', label: 'Committed', count: amt, target, target_reason: null, display: `${usdShort(amt)} of ${usdShort(target)}` };
  }
  const amt = Number(f.value);
  if (!num(amt)) return null;
  return { key: 'committed', label: 'Committed', count: amt, target: null, target_reason: f.reason ?? 'No active round target is recorded', display: usdShort(amt) };
}

function raiseIndex(ctx: RaiseCtx, figures: Figure[], cards: Card[], calls: CallsRead): IndexRow[] {
  const rows: IndexRow[] = [];
  if (roundCallsEnabled(ctx.env)) {
    const items = 'items' in calls ? calls.items : null;
    rows.push({
      key: 'calls', title: 'Calls', detail: 'Calls for Capital',
      value: 'state' in calls ? UNREADABLE : items && items.length ? `${items.filter((i) => i.effective_state === 'open').length} open` : null,
      href: `/raise/calls?project=${ctx.projectId}`,
    });
  }
  rows.push({
    key: 'fundraising-readiness', title: 'Fundraising readiness', detail: 'Readiness score',
    value: figureValue(figureOf(figures, 'readiness_score'), (v) => `${v} of 100`),
    href: raiseHref(ctx, 'fundraising-readiness'),
  });
  const narrative = cardOf(cards, 'investor-narrative');
  const versions = narrative?.state === 'ok' && Array.isArray(narrative.series)
    ? ((narrative.series as any[])[0]?.items || []).reduce((n: number, i: any) => n + (num(i?.value) ? i.value : 0), 0)
    : null;
  rows.push({
    key: 'investor-narrative', title: 'Investor narrative',
    detail: versions != null && versions > 0 ? plural(versions, 'saved version', 'saved versions') : 'Saved versions',
    value: narrative?.state === 'unreadable' ? UNREADABLE : versions != null && versions > 0 ? '' : null,
    href: raiseHref(ctx, 'investor-narrative'),
  });
  const deck = cardOf(cards, 'pitch-deck');
  const weeks = deck?.state === 'ok' && Array.isArray(deck.series) ? (deck.series as any[])[0]?.values : null;
  const thisWeek = Array.isArray(weeks) && weeks.length ? Number(weeks[weeks.length - 1]) : null;
  rows.push({
    key: 'pitch-deck', title: 'Pitch deck', detail: 'Views this week',
    value: deck?.state === 'unreadable' ? UNREADABLE : num(thisWeek) ? String(thisWeek) : null,
    href: raiseHref(ctx, 'pitch-deck'),
  });
  rows.push({ key: 'data-room', title: 'Data room', detail: 'Checklist coverage', value: cardValue(cardOf(cards, 'data-room')), href: raiseHref(ctx, 'data-room') });
  rows.push({ key: 'cap-table', title: 'Cap table', detail: 'Before and after the round', value: cardValue(cardOf(cards, 'cap-table')), href: raiseHref(ctx, 'cap-table') });
  rows.push({
    key: 'use-of-funds', title: 'Use of funds', detail: 'Runway',
    value: figureValue(figureOf(figures, 'runway_months'), (v) => `${v} mo`), href: raiseHref(ctx, 'use-of-funds'),
  });
  rows.push({
    key: 'capital-relationships', title: 'Capital relationships', detail: 'In active conversation',
    value: figureValue(figureOf(figures, 'investors_in_conversation'), (v) => String(v)), href: raiseHref(ctx, 'capital-relationships'),
  });
  return rows;
}

/** Raise's focus, meter and index. Every Raise reader already passes `canWrite`. */
export async function raisePhone(ctx: RaiseCtx, figures: Figure[], cards: Card[]): Promise<Phone> {
  const calls = (await callsHistory(ctx)) as CallsRead;
  const [focus, meter, index] = await Promise.all([
    part('raise focus', () => raiseFocus(ctx, cards, calls)),
    part('raise meter', async () => raiseMeter(figures)),
    part('raise index', async () => raiseIndex(ctx, figures, cards, calls)),
  ]);
  return { focus, meter, index };
}

// ---------------------------------------------------------------------------
// Grow
// ---------------------------------------------------------------------------

/**
 * Nothing in Grow is recorded (D692 decision 5, #1652's rule): no feedback at
 * any date, no channel, no recurring ledger row, no metrics snapshot, with a
 * company no roster row, no open role, no partner, no market, no compliance
 * obligation of any source (seeded ones included), and nothing done on the
 * checklist. Every store is bound to the venture.
 */
async function growNothingRecorded(x: GrowCtx): Promise<boolean> {
  const pid = x.projectId;
  const r = await x.env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM product_feedback WHERE project_id = ?) AS feedback,
       EXISTS(SELECT 1 FROM growth_channels WHERE project_id = ?) AS channels,
       EXISTS(SELECT 1 FROM revenue_entries WHERE project_id = ? AND revenue_type = 'recurring') AS recurring,
       EXISTS(SELECT 1 FROM project_metrics WHERE project_id = ?) AS snapshots,
       EXISTS(SELECT 1 FROM job_postings WHERE project_id = ? AND status IN ('open', 'published')) AS roles,
       EXISTS(SELECT 1 FROM growth_partners WHERE project_id = ?) AS partners,
       EXISTS(SELECT 1 FROM markets WHERE project_id = ?) AS markets,
       EXISTS(SELECT 1 FROM compliance_events WHERE project_id = ?) AS obligations,
       (SELECT company_id FROM projects WHERE id = ?) AS company_id`,
  ).bind(pid, pid, pid, pid, pid, pid, pid, pid, pid).first<Record<string, number | null>>();
  if (!r) return false;
  if (['feedback', 'channels', 'recurring', 'snapshots', 'roles', 'partners', 'markets', 'obligations'].some((k) => Number(r[k]) === 1)) return false;
  if (r.company_id != null) {
    const roster = await x.env.DB.prepare('SELECT EXISTS(SELECT 1 FROM company_people WHERE company_id = ?) AS n')
      .bind(r.company_id).first<{ n: number }>();
    if (Number(roster?.n) === 1) return false;
  }
  return !(await checklist(x.env, pid)).some((i) => i.done);
}

async function growFocus(x: GrowCtx, writer: boolean, cards: Card[]): Promise<Focus | null> {
  if (writer && (await growNothingRecorded(x))) {
    return {
      rule: 'first_kpi', eyebrow: 'Grow · Next', headline: 'Enter the first KPI.',
      why: 'Nothing in Grow is recorded yet.',
      cta: { label: 'Enter a KPI', href: `/grow/focus?project_id=${x.projectId}` },
      then: null,
    };
  }
  return cardFocus('grow', cards);
}

const usdWhole = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

async function growIndex(x: GrowCtx, figures: Figure[], cards: Card[]): Promise<IndexRow[]> {
  const href = (slug: string) => `/grow/${slug}?project=${x.projectId}`;
  // The Updates tab's own filter (routes/cycle_grow.ts updatesHistory): sent, or submitted.
  let updates: string | null;
  try {
    const n = await x.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM portfolio_updates WHERE project_id = ? AND (sent_at IS NOT NULL OR status = 'submitted')`,
    ).bind(x.projectId).first<{ n: number }>();
    updates = Number(n?.n ?? 0) > 0 ? String(Number(n!.n)) : null;
  } catch (e) {
    console.warn('[cycleFocus] grow updates unreadable:', (e as Error)?.message);
    updates = UNREADABLE;
  }
  const card = (slug: string, title: string, detail: string): IndexRow => ({ key: slug, title, detail, value: cardValue(cardOf(cards, slug)), href: href(slug) });
  return [
    { key: 'updates', title: 'Updates', detail: 'Updates shared', value: updates, href: `/grow/updates?project=${x.projectId}` },
    card('product-improvement', 'Product improvement', 'Feedback themes by status'),
    card('distribution', 'Distribution', 'Cost per customer by channel'),
    {
      key: 'revenue-and-traction', title: 'Revenue and traction', detail: 'MRR',
      value: figureValue(figureOf(figures, 'mrr'), (v) => (num(Number(v)) ? usdWhole(Number(v)) : null)), href: href('revenue-and-traction'),
    },
    card('team-expansion', 'Team expansion', 'Headcount against plan'),
    card('partner-network', 'Partner network', 'Partners by stage'),
    card('market-expansion', 'Market expansion', 'Readiness by market'),
    card('durable-company-building', 'Durable company-building', 'Compliance, next 90 days'),
  ];
}

/**
 * Grow's focus and index; no meter (the canvas draws none). The write gate is
 * Grow's own (`canAccessProject(…, { write: true })`): it admits partners, as
 * Grow's writes do, and refuses an advisor member.
 */
export async function growPhone(x: GrowCtx, user: User, figures: Figure[], cards: Card[]): Promise<Phone> {
  const [focus, index] = await Promise.all([
    part('grow focus', async () => {
      const p = await x.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
        .bind(x.projectId).first<{ id: number; founder_id: number | null }>();
      const writer = !!p && (await canAccessProject(x.env, user, p, { write: true }));
      return growFocus(x, writer, cards);
    }),
    part('grow index', () => growIndex(x, figures, cards)),
  ]);
  return { focus, meter: null, index };
}

