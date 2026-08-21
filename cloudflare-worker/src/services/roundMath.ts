/**
 * Build queue #129 — round mechanics.
 *
 * Pure functions: round size, tranche subtotals, and pro-rata
 * entitlements. No D1, no env, no clock — the route layer loads rows
 * and calls in here, and the test file pins the arithmetic.
 *
 * The hard part is pro-rata. The naive formula (prior stake × round
 * size) routinely allocates more than the founder set aside, so this
 * engine always reconciles entitlements against the reserved pool and
 * says which rule it applied.
 */

export type AllocationStatus = 'soft' | 'signed' | 'wired';
export type CloseState = 'planned' | 'open' | 'closed';

export interface Allocation {
  amount: number;
  status: AllocationStatus;
  close_id?: number | null;
}

export interface RoundProgress {
  target: number | null;
  /** Money actually in the bank. */
  wired: number;
  /** Signed documents, not yet wired. */
  signed: number;
  /** Verbal or soft-circled commitments. */
  soft: number;
  /** wired + signed — what a founder may honestly call "committed". */
  committed: number;
  /** committed + soft — the optimistic top of the funnel. */
  pipeline: number;
  /** Percent of target that is committed (0-100), null without a target. */
  committed_pct: number | null;
  /** Target minus committed; null without a target, never negative. */
  remaining: number | null;
  oversubscribed: boolean;
}

function pos(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Roll allocations into the funnel a founder actually reports on.
 *
 * `committed` deliberately EXCLUDES soft commitments: a soft circle is
 * not money, and a round tracker that blends the two is how founders
 * end up announcing a close they cannot fund.
 */
export function computeRoundProgress(allocations: Allocation[], target: number | null): RoundProgress {
  let wired = 0, signed = 0, soft = 0;
  for (const a of allocations) {
    const amt = pos(a.amount);
    if (amt === 0) continue;
    if (a.status === 'wired') wired += amt;
    else if (a.status === 'signed') signed += amt;
    else if (a.status === 'soft') soft += amt;
  }
  const committed = wired + signed;
  const pipeline = committed + soft;
  const tgt = target != null && Number.isFinite(Number(target)) && Number(target) > 0 ? Number(target) : null;
  return {
    target: tgt,
    wired: round2(wired),
    signed: round2(signed),
    soft: round2(soft),
    committed: round2(committed),
    pipeline: round2(pipeline),
    committed_pct: tgt ? Math.round((committed / tgt) * 1000) / 10 : null,
    remaining: tgt ? round2(Math.max(0, tgt - committed)) : null,
    oversubscribed: tgt != null && committed > tgt,
  };
}

export interface TrancheInput {
  id: number;
  name: string;
  state: CloseState;
  target_date?: string | null;
  closed_date?: string | null;
}

export interface TrancheRollup extends TrancheInput {
  wired: number;
  signed: number;
  soft: number;
  committed: number;
  allocation_count: number;
  /** Share of the round's total committed capital, 0-100. */
  pct_of_round: number | null;
}

/**
 * Subtotal each tranche. Allocations with no close_id are not silently
 * dropped — the caller gets them back under `unassigned` so a founder
 * can see money that has not been slotted into a close yet.
 */
export function rollUpTranches(
  tranches: TrancheInput[],
  allocations: Array<Allocation & { close_id?: number | null }>,
): { tranches: TrancheRollup[]; unassigned: RoundProgress } {
  const byClose = new Map<number, Array<Allocation>>();
  const loose: Allocation[] = [];
  for (const a of allocations) {
    if (a.close_id == null) { loose.push(a); continue; }
    const arr = byClose.get(Number(a.close_id)) || [];
    arr.push(a);
    byClose.set(Number(a.close_id), arr);
  }
  const totalCommitted = allocations.reduce(
    (acc, a) => acc + (a.status === 'wired' || a.status === 'signed' ? pos(a.amount) : 0), 0,
  );
  const rolled = tranches.map(t => {
    const mine = byClose.get(t.id) || [];
    const p = computeRoundProgress(mine, null);
    return {
      ...t,
      wired: p.wired, signed: p.signed, soft: p.soft, committed: p.committed,
      allocation_count: mine.length,
      pct_of_round: totalCommitted > 0 ? Math.round((p.committed / totalCommitted) * 1000) / 10 : null,
    };
  });
  return { tranches: rolled, unassigned: computeRoundProgress(loose, null) };
}

// ---------- pro-rata ----------

export interface ProRataHolder {
  key: string;
  /** Fully-diluted ownership BEFORE this round, as a percent (0-100). */
  prior_stake_pct: number;
  /** What they have said they will take, if anything. */
  taking?: number | null;
  state?: 'offered' | 'taking' | 'waived' | 'expired' | null;
}

export interface ProRataRow extends ProRataHolder {
  /** Raw right: prior stake × round size. */
  entitlement_raw: number;
  /** Entitlement after reconciling against the reserved pool. */
  entitlement: number;
  /** Entitlement actually available after waivers and takings. */
  scaled: boolean;
}

export interface ProRataResult {
  rows: ProRataRow[];
  round_size: number;
  reserved: number | null;
  /** Σ raw entitlements of holders who have not waived. */
  entitlement_total: number;
  /** Σ taking. */
  taking_total: number;
  /**
   * How entitlements were reconciled:
   *   'raw'      — no reserve set; entitlements are the naive right.
   *   'fits'     — reserve covers every entitlement in full.
   *   'scaled'   — entitlements exceed the reserve and were cut back
   *                pro rata to each other.
   */
  rule: 'raw' | 'fits' | 'scaled';
  /** Reserve left after subtracting what holders are actually taking. */
  reserve_remaining: number | null;
}

/**
 * Pro-rata entitlements for existing holders in a new round.
 *
 * Waived and expired holders are excluded from the entitlement pool
 * (that is the point of a waiver — it frees allocation for everyone
 * else), but they still appear in `rows` with a zero entitlement so the
 * UI can show the full cap table rather than quietly dropping names.
 *
 * When the reserve cannot cover every right, entitlements are scaled
 * back in proportion to each other rather than first-come-first-served:
 * the alternative silently advantages whoever the founder called first.
 */
export function computeProRata(
  holders: ProRataHolder[],
  roundSize: number,
  reserved: number | null,
): ProRataResult {
  const size = pos(roundSize);
  const pool = reserved != null && Number.isFinite(Number(reserved)) && Number(reserved) >= 0
    ? Number(reserved) : null;

  const eligible = (h: ProRataHolder) => h.state !== 'waived' && h.state !== 'expired';

  const raw = holders.map(h => {
    const stake = Math.max(0, Math.min(100, Number(h.prior_stake_pct) || 0));
    return { holder: h, rawAmount: eligible(h) ? round2(size * (stake / 100)) : 0 };
  });
  const entitlementTotal = raw.reduce((a, r) => a + r.rawAmount, 0);

  let rule: ProRataResult['rule'] = 'raw';
  let factor = 1;
  if (pool != null) {
    if (entitlementTotal <= pool) rule = 'fits';
    else {
      rule = 'scaled';
      factor = entitlementTotal > 0 ? pool / entitlementTotal : 0;
    }
  }

  const rows: ProRataRow[] = raw.map(({ holder, rawAmount }) => ({
    ...holder,
    entitlement_raw: rawAmount,
    entitlement: round2(rawAmount * factor),
    scaled: rule === 'scaled' && rawAmount > 0,
  }));

  const takingTotal = holders.reduce((a, h) => a + pos(h.taking), 0);
  return {
    rows,
    round_size: round2(size),
    reserved: pool != null ? round2(pool) : null,
    entitlement_total: round2(entitlementTotal),
    taking_total: round2(takingTotal),
    rule,
    reserve_remaining: pool != null ? round2(Math.max(0, pool - takingTotal)) : null,
  };
}

/**
 * Post-round ownership for a holder who takes `taking` of a round that
 * issues new capital at `preMoney`. Returns null when the inputs cannot
 * support the arithmetic rather than emitting a misleading zero.
 */
export function postRoundStake(
  priorStakePct: number,
  taking: number,
  preMoney: number,
  roundSize: number,
): number | null {
  const pre = pos(preMoney);
  const size = pos(roundSize);
  const post = pre + size;
  if (post <= 0) return null;
  const stake = Math.max(0, Math.min(100, Number(priorStakePct) || 0));
  // Prior holding is diluted by the new money; the new cheque buys
  // (taking / post-money) of the company.
  const priorValue = pre * (stake / 100);
  const newValue = priorValue + pos(taking);
  return Math.round((newValue / post) * 100 * 100) / 100;
}
