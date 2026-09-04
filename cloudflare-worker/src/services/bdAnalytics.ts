/**
 * Build queue #122 — service-partner BD pipeline analytics.
 *
 * Pure functions over the existing `quotes` and `engagements` rows
 * (routes/needs.ts). No I/O, no clock — every as-of date is passed in.
 *
 * Win rate is the number a partner will quote to a prospect, so its
 * DENOMINATOR is the whole design problem. Three populations get
 * conflated in naive implementations, each inflating or deflating the
 * figure in a different direction:
 *
 *   accepted / rejected   decided — the only fair denominator
 *   submitted             undecided; counting them as losses punishes
 *                         a partner for having a full pipeline
 *   withdrawn             the partner walked away; not a loss to a
 *                         competitor, and counting it as one
 *                         understates their actual conversion
 *
 * So `win_rate` is accepted ÷ (accepted + rejected), and the excluded
 * counts are returned alongside it so the UI can show its work.
 */

/**
 * Verified against the live schema (sql/t13_t14_t15.sql:354):
 *   quotes.status      submitted | accepted | rejected | withdrawn
 *   engagements.status accepted | in_progress | delivered | cancelled
 * Both tables store money in a `price` column, not `amount`; the route
 * layer aliases it, and `amount` here is the engine's own field name.
 */
export type QuoteStatus = 'submitted' | 'accepted' | 'rejected' | 'withdrawn';

export interface QuoteRow {
  status: QuoteStatus | string;
  /** Quoted value in dollars. */
  amount?: number | null;
  created_at?: string | null;
  decided_at?: string | null;
  /**
   * `founder_needs.category`, joined in by the route. Optional because the
   * headline pipeline, forecast and delivery figures never read it — only
   * `analyseByShape` does, and it treats an absent one as unrecorded rather
   * than folding it into a real category.
   */
  shape?: string | null;
}

export interface EngagementRow {
  status: string; // accepted | in_progress | delivered | cancelled
  amount?: number | null;
}

const DECIDED = new Set(['accepted', 'rejected']);
const PENDING = new Set(['submitted']);
const MS_PER_DAY = 86_400_000;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function money(n: number): number { return Math.round(n * 100) / 100; }
function pct(n: number): number { return Math.round(n * 1000) / 10; }

export interface BdPipeline {
  /** accepted ÷ (accepted + rejected), 0-100. Null with nothing decided. */
  win_rate_pct: number | null;
  accepted: number;
  rejected: number;
  /** Excluded from the win rate, and why — surfaced, not hidden. */
  pending: number;
  withdrawn: number;
  /** Total value of quotes still undecided. */
  open_value: number;
  /** Total value won. */
  won_value: number;
  /** Median days from quote to decision. Null without decided quotes. */
  median_cycle_days: number | null;
  /** Average won-deal size. Null with no wins. */
  average_deal_size: number | null;
  quote_count: number;
  /** How the win rate was computed, for the UI's tooltip. */
  win_rate_basis: string;
}

/** Median rather than mean: one stalled deal should not move the number. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function analysePipeline(quotes: QuoteRow[]): BdPipeline {
  const rows = quotes || [];
  let accepted = 0, rejected = 0, pending = 0, withdrawn = 0;
  let openValue = 0, wonValue = 0;
  const cycles: number[] = [];

  for (const q of rows) {
    const status = String(q?.status || '');
    const amount = Math.max(0, num(q?.amount) ?? 0);
    if (status === 'accepted') {
      accepted++; wonValue += amount;
    } else if (status === 'rejected') {
      rejected++;
    } else if (PENDING.has(status)) {
      pending++; openValue += amount;
    } else if (status === 'withdrawn') {
      withdrawn++;
    }
    if (DECIDED.has(status) && q?.created_at && q?.decided_at) {
      const a = Date.parse(String(q.created_at));
      const b = Date.parse(String(q.decided_at));
      if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) cycles.push((b - a) / MS_PER_DAY);
    }
  }

  const decided = accepted + rejected;
  const med = median(cycles);
  return {
    win_rate_pct: decided > 0 ? pct(accepted / decided) : null,
    accepted, rejected, pending, withdrawn,
    open_value: money(openValue),
    won_value: money(wonValue),
    median_cycle_days: med === null ? null : Math.round(med * 10) / 10,
    average_deal_size: accepted > 0 ? money(wonValue / accepted) : null,
    quote_count: rows.length,
    win_rate_basis: decided > 0
      ? `${accepted} won of ${decided} decided. ${pending} still open and ${withdrawn} withdrawn are excluded — an undecided quote is not a loss, and withdrawing is not losing.`
      : 'No quotes decided yet, so there is no win rate to report.',
  };
}

// ---------- weighted pipeline ----------

/**
 * Default stage probabilities. Deliberately conservative: a partner
 * forecasting off these should under-promise. Callers may override.
 */
export const DEFAULT_STAGE_WEIGHTS: Record<string, number> = {
  submitted: 0.3,
  accepted: 1,
  rejected: 0,
  withdrawn: 0,
};

export interface WeightedPipeline {
  /** Σ amount × stage probability, over UNDECIDED quotes only. */
  weighted_value: number;
  /** Raw Σ amount over undecided quotes. */
  unweighted_value: number;
  by_stage: Array<{ stage: string; count: number; value: number; weighted: number; weight: number }>;
  note: string;
}

/**
 * Weighted forecast over the OPEN pipeline only.
 *
 * Won deals are excluded on purpose: adding closed revenue to a
 * forecast double-counts it against the actuals a partner is already
 * reporting, and makes a quiet quarter look full.
 */
export function weightedPipeline(
  quotes: QuoteRow[],
  weights: Record<string, number> = DEFAULT_STAGE_WEIGHTS,
): WeightedPipeline {
  const byStage = new Map<string, { count: number; value: number; weighted: number; weight: number }>();
  let weighted = 0, unweighted = 0;
  for (const q of quotes || []) {
    const stage = String(q?.status || '');
    if (!PENDING.has(stage)) continue;
    const amount = Math.max(0, num(q?.amount) ?? 0);
    const w = num(weights[stage]);
    const weight = w === null ? 0 : Math.min(1, Math.max(0, w));
    const cur = byStage.get(stage) || { count: 0, value: 0, weighted: 0, weight };
    cur.count++; cur.value += amount; cur.weighted += amount * weight; cur.weight = weight;
    byStage.set(stage, cur);
    weighted += amount * weight;
    unweighted += amount;
  }
  return {
    weighted_value: money(weighted),
    unweighted_value: money(unweighted),
    by_stage: [...byStage.entries()].map(([stage, v]) => ({
      stage, count: v.count, value: money(v.value), weighted: money(v.weighted), weight: v.weight,
    })),
    note: 'Forecast covers open quotes only. Won work is excluded so it is not double-counted against booked revenue.',
  };
}

// ---------- delivery ----------

export interface DeliverySummary {
  active: number;
  delivered: number;
  cancelled: number;
  /** delivered ÷ (delivered + cancelled), 0-100. */
  completion_rate_pct: number | null;
  active_value: number;
  delivered_value: number;
}

/**
 * Engagement delivery health. Completion rate excludes work still in
 * flight for the same reason the win rate excludes open quotes: an
 * unfinished engagement is not a failed one.
 */
export function analyseDelivery(engagements: EngagementRow[]): DeliverySummary {
  let active = 0, delivered = 0, cancelled = 0, activeValue = 0, deliveredValue = 0;
  for (const e of engagements || []) {
    const status = String(e?.status || '');
    const amount = Math.max(0, num(e?.amount) ?? 0);
    if (status === 'delivered') { delivered++; deliveredValue += amount; }
    else if (status === 'cancelled') cancelled++;
    else if (status === 'accepted' || status === 'in_progress') { active++; activeValue += amount; }
  }
  const closed = delivered + cancelled;
  return {
    active, delivered, cancelled,
    completion_rate_pct: closed > 0 ? pct(delivered / closed) : null,
    active_value: money(activeValue),
    delivered_value: money(deliveredValue),
  };
}

// ---------- the two breakdowns the pipeline canvas asks for ----------

/**
 * The canvas at `/pipeline/analytics` asks for the win rate "broken out by
 * shape", and for the same rate quarter over quarter. Both are derivable from
 * rows the store already holds — a quote's status, its two timestamps and,
 * through `need_id`, the need's own `category` — so neither is invented and
 * neither needs a schema change.
 *
 * WHAT `shape` IS, EXACTLY. It is `founder_needs.category` and nothing richer:
 * the category the founder filed the need under. No engagement-shape column
 * exists anywhere — no retainer/project/embedded distinction is stored — so
 * this is the only decomposition the store can honestly support, and the zone
 * says so beside the table rather than letting a column header imply more.
 *
 * WHAT NEITHER OF THESE IS. The canvas's third analytic block is a loss-reason
 * taxonomy, and it stays absent: `quotes` carries `status` and `decided_at`,
 * with no reason, no competitor and no price-against-won column. A "lost on
 * price" count derived from anything here would be a guess wearing a number's
 * clothes. The zone names that gap instead of filling it.
 */
export interface ShapeBreakdown {
  /** `founder_needs.category`. Null when the need row is unreadable. */
  shape: string | null;
  quote_count: number;
  accepted: number;
  rejected: number;
  pending: number;
  withdrawn: number;
  /** accepted over (accepted + rejected) within this shape, 0-100. */
  win_rate_pct: number | null;
  median_cycle_days: number | null;
  won_value: number;
  open_value: number;
}

/**
 * Win rate and cycle time per need category.
 *
 * Each shape's win rate uses the SAME denominator rule as the headline one —
 * decided quotes only — so a shape with four open quotes and one loss reads
 * 0% of one decision, not 0% of five. Shapes come back in descending quote
 * count with the name as the tie-break and an unrecorded shape last, so the
 * order cannot shift between two reads of identical data.
 */
export function analyseByShape(quotes: QuoteRow[]): ShapeBreakdown[] {
  const by = new Map<string, { shape: string | null; accepted: number; rejected: number;
    pending: number; withdrawn: number; won: number; open: number; cycles: number[] }>();

  for (const q of quotes || []) {
    const raw = q?.shape;
    const shape = raw === null || raw === undefined || String(raw).trim() === '' ? null : String(raw);
    const key = shape === null ? ' unrecorded' : shape;
    const cur = by.get(key)
      || { shape, accepted: 0, rejected: 0, pending: 0, withdrawn: 0, won: 0, open: 0, cycles: [] };
    const status = String(q?.status || '');
    const amount = Math.max(0, num(q?.amount) ?? 0);
    if (status === 'accepted') { cur.accepted++; cur.won += amount; }
    else if (status === 'rejected') cur.rejected++;
    else if (PENDING.has(status)) { cur.pending++; cur.open += amount; }
    else if (status === 'withdrawn') cur.withdrawn++;
    if (DECIDED.has(status) && q?.created_at && q?.decided_at) {
      const a = Date.parse(String(q.created_at));
      const b = Date.parse(String(q.decided_at));
      if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) cur.cycles.push((b - a) / MS_PER_DAY);
    }
    by.set(key, cur);
  }

  return [...by.values()]
    .map((v) => {
      const decided = v.accepted + v.rejected;
      const med = median(v.cycles);
      return {
        shape: v.shape,
        quote_count: v.accepted + v.rejected + v.pending + v.withdrawn,
        accepted: v.accepted,
        rejected: v.rejected,
        pending: v.pending,
        withdrawn: v.withdrawn,
        win_rate_pct: decided > 0 ? pct(v.accepted / decided) : null,
        median_cycle_days: med === null ? null : Math.round(med * 10) / 10,
        won_value: money(v.won),
        open_value: money(v.open),
      };
    })
    .sort((a, b) => {
      if (b.quote_count !== a.quote_count) return b.quote_count - a.quote_count;
      if (a.shape === null) return b.shape === null ? 0 : 1;
      if (b.shape === null) return -1;
      return a.shape.localeCompare(b.shape);
    });
}

export interface QuarterBreakdown {
  /** Calendar quarter of the DECISION, e.g. `2026-Q3`. */
  quarter: string;
  accepted: number;
  rejected: number;
  decided: number;
  win_rate_pct: number | null;
  won_value: number;
}

/**
 * Win rate quarter over quarter, keyed on WHEN THE DECISION LANDED rather
 * than when the quote was sent. A quote sent in March and lost in July is a
 * Q3 loss: the quarter a partner is judging is the quarter its decisions came
 * in, and keying on `created_at` would move a result into a quarter whose
 * outcome was still unknown at the time.
 *
 * Only decided quotes appear. An open quote belongs to no quarter yet, and
 * withdrawn ones are excluded here for the same reason they are excluded from
 * the headline rate — the partner walked away, which is not a loss. Quarters
 * come back chronologically, because a trend is read left to right.
 */
export function analyseByQuarter(quotes: QuoteRow[]): QuarterBreakdown[] {
  const by = new Map<string, { accepted: number; rejected: number; won: number }>();
  for (const q of quotes || []) {
    const status = String(q?.status || '');
    if (!DECIDED.has(status)) continue;
    const t = Date.parse(String(q?.decided_at || ''));
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const quarter = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const cur = by.get(quarter) || { accepted: 0, rejected: 0, won: 0 };
    if (status === 'accepted') { cur.accepted++; cur.won += Math.max(0, num(q?.amount) ?? 0); }
    else cur.rejected++;
    by.set(quarter, cur);
  }
  return [...by.entries()]
    .map(([quarter, v]) => {
      const decided = v.accepted + v.rejected;
      return {
        quarter,
        accepted: v.accepted,
        rejected: v.rejected,
        decided,
        win_rate_pct: decided > 0 ? pct(v.accepted / decided) : null,
        won_value: money(v.won),
      };
    })
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
}
