/**
 * Build queue #120 — audience-scoped cap-table sharing.
 *
 * Pure functions: given a simulation result and an audience, return the
 * subset that audience is allowed to see. No I/O, no crypto — the route
 * layer handles tokens; this decides what the token unlocks.
 *
 * A cap table is not one document. Sending an employee the same view an
 * investor gets leaks every colleague's holding; sending an investor a
 * summary-only view is useless to them. So a share link carries an
 * AUDIENCE, and the redaction is enforced server-side before the
 * payload is serialised — never by hiding columns in the client, which
 * would ship the private data to the browser and rely on the UI not to
 * draw it.
 *
 * Three audiences, narrowest first:
 *
 *   summary   Ownership percentages by STAKEHOLDER GROUP only. No
 *             per-holder rows, no share counts, no dollar amounts.
 *             For a candidate, a journalist, or an early conversation.
 *
 *   investor  Full round history, per-round pricing, and the preferred
 *             stack — everything needed to model a new round. Employee
 *             option grants stay aggregated into the pool: an investor
 *             needs the pool SIZE, never who holds what inside it.
 *
 *   full      Everything the owner sees, including per-holder rows.
 *             For a co-founder, counsel, or an accountant.
 */

export type ShareAudience = 'summary' | 'investor' | 'full';

export const SHARE_AUDIENCES: ReadonlyArray<ShareAudience> = ['summary', 'investor', 'full'];

export function isShareAudience(v: unknown): v is ShareAudience {
  return typeof v === 'string' && (SHARE_AUDIENCES as ReadonlyArray<string>).includes(v);
}

/** Human-readable scope lines for the share UI's "Can see" list. */
export const AUDIENCE_SCOPE: Record<ShareAudience, { label: string; sees: string[]; hidden: string[] }> = {
  summary: {
    label: 'Summary',
    sees: [
      'Ownership split by stakeholder group (founders, investors, option pool)',
      'Number of financing rounds completed',
    ],
    hidden: [
      'Individual holders and their stakes',
      'Share counts and price per share',
      'Investment amounts and valuations',
    ],
  },
  investor: {
    label: 'Investor',
    sees: [
      'Full round history with pre-money, investment, and price per share',
      'Every investor and founder position',
      'The option pool as a single line',
      'Liquidation preferences and exit waterfall',
    ],
    hidden: ['Individual employee option grants inside the pool'],
  },
  full: {
    label: 'Full',
    sees: ['Everything the cap-table owner sees, including every individual holder'],
    hidden: [],
  },
};

type Holder = { holder: string; type: string; shares: number; pct?: number };

/** Stakeholder groups used by the summary view. */
function groupOf(type: string): 'Founders' | 'Investors' | 'Option pool' | 'Other' {
  if (type === 'founder') return 'Founders';
  if (type === 'preferred' || type === 'safe') return 'Investors';
  if (type === 'option_pool') return 'Option pool';
  return 'Other';
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/**
 * Collapse a ledger to group-level percentages. Share counts are
 * dropped entirely rather than rounded — a summary viewer who can see
 * counts can reconstruct the dollar figures from any single known
 * price, which defeats the point of the audience.
 */
export function summariseLedger(ledger: Holder[]): Array<{ group: string; pct: number }> {
  const total = ledger.reduce((s, h) => s + (Number(h.shares) || 0), 0);
  if (total <= 0) return [];
  const by = new Map<string, number>();
  for (const h of ledger) {
    const g = groupOf(h.type);
    by.set(g, (by.get(g) || 0) + (Number(h.shares) || 0));
  }
  const order = ['Founders', 'Investors', 'Option pool', 'Other'];
  return [...by.entries()]
    .map(([group, shares]) => ({ group, pct: round4((shares / total) * 100) }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/**
 * Fold individual option grants into a single pool line. An investor
 * audience gets the pool's total size — which they need, since it
 * dilutes them — without the per-employee breakdown, which they do not.
 */
export function aggregatePool(ledger: Holder[]): Holder[] {
  const out: Holder[] = [];
  let poolShares = 0;
  let poolPct = 0;
  let sawPool = false;
  for (const h of ledger) {
    if (h.type === 'option_pool') {
      sawPool = true;
      poolShares += Number(h.shares) || 0;
      poolPct += Number(h.pct) || 0;
      continue;
    }
    out.push({ ...h });
  }
  if (sawPool) out.push({ holder: 'Option Pool', type: 'option_pool', shares: poolShares, pct: round4(poolPct) });
  return out;
}

export interface SharedCapTable {
  audience: ShareAudience;
  scenario_name: string;
  /** Present for every audience — the headline is not secret. */
  rounds_completed: number;
  /** summary only. */
  summary?: Array<{ group: string; pct: number }>;
  /** investor + full. */
  founding?: Holder[];
  rounds?: Array<Record<string, unknown>>;
  waterfall?: unknown;
  totals?: { shares_outstanding: number; rounds_completed: number };
  /** Always stated, so a viewer knows what they are NOT being shown. */
  disclosure: string;
}

/**
 * Build the payload a share link returns.
 *
 * Everything is constructed by EXPLICITLY COPYING allowed fields, never
 * by deleting disallowed ones from a spread of the full result. A
 * delete-based redactor silently leaks any field added to the source
 * later; a copy-based one silently omits it, which is the safe
 * direction to fail.
 */
export function redactForAudience(
  result: {
    founding?: Holder[];
    rounds?: Array<Record<string, unknown>>;
    waterfall?: unknown;
    totals?: { shares_outstanding: number; rounds_completed: number };
  } | null | undefined,
  audience: ShareAudience,
  scenarioName: string,
): SharedCapTable {
  const rounds = Array.isArray(result?.rounds) ? result!.rounds! : [];
  const roundsCompleted = Number(result?.totals?.rounds_completed ?? rounds.length) || 0;
  const finalLedger: Holder[] = rounds.length > 0
    ? ((rounds[rounds.length - 1] as any)?.ledger || [])
    : (result?.founding || []);

  if (audience === 'summary') {
    return {
      audience,
      scenario_name: scenarioName,
      rounds_completed: roundsCompleted,
      summary: summariseLedger(finalLedger),
      disclosure: 'Summary view: ownership by group only. Share counts, valuations, and individual holders are not included.',
    };
  }

  const mapRound = (r: Record<string, unknown>) => {
    const ledger: Holder[] = ((r as any).ledger || []) as Holder[];
    return {
      name: r.name,
      pre_money: r.pre_money,
      post_money: r.post_money,
      investment: r.investment,
      price_per_share: r.price_per_share,
      shares_pre: r.shares_pre,
      shares_post: r.shares_post,
      ledger: audience === 'full' ? ledger.map(h => ({ ...h })) : aggregatePool(ledger),
      // `events` carries free-text narration that can name individuals;
      // it is owner-only.
      ...(audience === 'full' ? { events: (r as any).events } : {}),
    };
  };

  return {
    audience,
    scenario_name: scenarioName,
    rounds_completed: roundsCompleted,
    founding: audience === 'full'
      ? (result?.founding || []).map(h => ({ ...h }))
      : aggregatePool(result?.founding || []),
    rounds: rounds.map(mapRound),
    waterfall: result?.waterfall ?? null,
    totals: result?.totals,
    disclosure: audience === 'investor'
      ? 'Investor view: full round and ownership detail. Individual employee option grants are aggregated into the pool.'
      : 'Full view: the complete cap table as the owner sees it.',
  };
}
