/**
 * D714 (#1779) — the split a `returns_distribution` job writes, as one pure
 * function the job and `POST /api/funds/:id/distributions/preview` both call,
 * so the preview a Super Admin reads before Execute and the rows the job
 * inserts cannot disagree.
 *
 * THE ARITHMETIC IS THE JOB'S, UNCHANGED (`queueWorker.ts`, before D714):
 *   · basis returned is the LPs' summed `invested_amount` (dollars → cents),
 *     capped at the proceeds; the rest is profit;
 *   · carry is withheld on profit only, at the fund's `carried_interest`, or
 *     0.20 when none is recorded;
 *   · what is left is split by commitment, each LP's line rounded on its own,
 *     and a line that rounds to zero is dropped.
 *
 * Its gaps are D714.md's to record, not this file's to fix: there is no
 * hurdle, the carry withheld is recorded nowhere, per-line rounding leaves
 * cents no line received (or over-allocates by a cent), and a zero line
 * vanishes. The preview reports each of them instead of hiding them.
 */

/** The job's default when a fund has no carry recorded. */
export const DEFAULT_CARRY_RATE = 0.2;

export type DistributionLp = { id: number; commitment_amount: number | null; invested_amount: number | null };

export type DistributionLine = {
  lp_id: number;
  commitment_amount: number;
  amount_cents: number;
};

export type DistributionSplit = {
  proceeds_cents: number;
  /** False when the fund has no LP with a commitment, so the job writes nothing. */
  distributable: boolean;
  basis_returned_cents: number;
  profit_cents: number;
  carry_rate: number;
  /** True when the rate is the job's default because `carried_interest` is null. */
  carry_rate_defaulted: boolean;
  carry_withheld_cents: number;
  distributable_cents: number;
  distribution_type: 'exit_proceeds' | 'return_of_capital';
  lines: DistributionLine[];
  /** LPs whose rounded share was zero: the job writes no row for them. */
  dropped_lp_ids: number[];
  /** Distributable cents no line received; negative when rounding over-allocated. */
  unallocated_cents: number;
};

export function splitDistribution(
  proceedsCents: number,
  carriedInterest: number | null | undefined,
  lps: readonly DistributionLp[],
): DistributionSplit {
  const grossCents = Math.round(proceedsCents);
  const rows = [...lps];
  const totalCommit = rows.reduce((s, r) => s + Number(r.commitment_amount || 0), 0);
  const carryRate = carriedInterest ?? DEFAULT_CARRY_RATE;
  const carryRateDefaulted = carriedInterest === null || carriedInterest === undefined;

  // Without per-LP basis tracking the job approximates basis as the sum of
  // invested_amount; the rest is profit.
  const totalInvested = rows.reduce((s, r) => s + Number(r.invested_amount || 0), 0) * 100; // -> cents
  const basisReturnCents = Math.min(grossCents, Math.round(totalInvested));
  const profitCents = Math.max(0, grossCents - basisReturnCents);
  const carryCents = Math.round(profitCents * carryRate);
  const distributableCents = grossCents - carryCents;

  const distributable = rows.length > 0 && totalCommit > 0;
  const all = distributable
    ? rows.map((lp) => {
      const share = Number(lp.commitment_amount || 0) / totalCommit;
      return {
        lp_id: Number(lp.id),
        commitment_amount: Number(lp.commitment_amount || 0),
        amount_cents: Math.round(distributableCents * share),
      };
    })
    : [];
  const lines = all.filter((l) => l.amount_cents > 0);
  const allocated = lines.reduce((s, l) => s + l.amount_cents, 0);

  return {
    proceeds_cents: grossCents,
    distributable,
    basis_returned_cents: basisReturnCents,
    profit_cents: profitCents,
    carry_rate: carryRate,
    carry_rate_defaulted: carryRateDefaulted,
    carry_withheld_cents: carryCents,
    distributable_cents: distributableCents,
    distribution_type: profitCents > 0 ? 'exit_proceeds' : 'return_of_capital',
    lines,
    dropped_lp_ids: all.filter((l) => l.amount_cents <= 0).map((l) => l.lp_id),
    unallocated_cents: distributable ? distributableCents - allocated : distributableCents,
  };
}

/** The LPs a distribution splits across, as the job selects them. */
export const DISTRIBUTION_LPS_SQL =
  `SELECT id, commitment_amount, invested_amount FROM limited_partners
           WHERE fund_id = ? AND status IN ('committed','active')`;
