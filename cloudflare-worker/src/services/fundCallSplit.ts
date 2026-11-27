/**
 * The pro-rata split of a capital call, in integer cents (D371).
 *
 * One function decides what each LP owes on a call, and three places ask it:
 * the preview a GP reads before issuing, the route that issues, and the queue
 * job that writes the lines. If they each did the arithmetic, the preview could
 * promise one set of figures and the ledger record another.
 *
 * THE RULE. Each LP's share is floor(amount × commitment ÷ total commitment)
 * cents. Flooring every line leaves between 0 and (lines − 1) cents unassigned;
 * that residual goes to ONE named line — the largest commitment, the lowest LP
 * id on a tie — so the lines always sum to the call exactly and the header
 * records where the difference went. The old job stored each share as an
 * unrounded REAL dollar figure: three equal LPs on a $1,000 call owed
 * 333.333… each, and no line said which LP would be asked for the extra cent.
 *
 * BigInt for the product. amount_cents × commitment_cents can pass 2^53 (a
 * $100M call against a $100M commitment is 10^20), where a Number product
 * silently loses the low digits this function exists to account for.
 */

export interface SplitLp {
  id: number;
  /** `limited_partners.commitment_amount`: REAL dollars, as the table stores it. */
  commitment_amount: number | string | null | undefined;
}

export interface SplitLine {
  lpId: number;
  commitmentCents: number;
  /** What this LP owes on the call, residual included. */
  shareCents: number;
  /** True on the one line that carries the rounding residual. */
  residual: boolean;
}

export interface CallSplit {
  amountCents: number;
  totalCommitmentCents: number;
  /** One per billable LP, in the order the LPs were given. Sums to amountCents. */
  lines: SplitLine[];
  residualCents: number;
  /** The LP whose line carries the residual; null when the split is exact. */
  residualLpId: number | null;
  /** LPs with no positive commitment, so no share. */
  excluded: Array<{ lpId: number; reason: 'no_commitment' }>;
}

/** Dollars (REAL) to cents, or null when the value is not a positive amount. */
export function commitmentCents(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents > 0 ? cents : null;
}

/** Split `amountCents` across `lps` by commitment. Throws on an amount that is not a positive integer. */
export function splitCall(amountCents: number, lps: SplitLp[]): CallSplit {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error('a capital call amount is a positive whole number of cents');
  }
  const excluded: CallSplit['excluded'] = [];
  const billable: Array<{ lpId: number; commitmentCents: number }> = [];
  for (const lp of lps) {
    const cents = commitmentCents(lp.commitment_amount);
    if (cents === null) excluded.push({ lpId: Number(lp.id), reason: 'no_commitment' });
    else billable.push({ lpId: Number(lp.id), commitmentCents: cents });
  }
  const total = billable.reduce((s, l) => s + l.commitmentCents, 0);
  if (!billable.length || total <= 0) {
    return { amountCents, totalCommitmentCents: 0, lines: [], residualCents: 0, residualLpId: null, excluded };
  }

  const amount = BigInt(amountCents);
  const totalBig = BigInt(total);
  const lines: SplitLine[] = billable.map((l) => ({
    lpId: l.lpId,
    commitmentCents: l.commitmentCents,
    shareCents: Number((amount * BigInt(l.commitmentCents)) / totalBig),
    residual: false,
  }));
  const floored = lines.reduce((s, l) => s + l.shareCents, 0);
  const residualCents = amountCents - floored;

  let residualLpId: number | null = null;
  if (residualCents > 0) {
    // The largest commitment carries it; the lowest LP id breaks a tie, so the
    // choice does not depend on the order the LPs were read in.
    let pick = lines[0];
    for (const l of lines) {
      if (l.commitmentCents > pick.commitmentCents
        || (l.commitmentCents === pick.commitmentCents && l.lpId < pick.lpId)) pick = l;
    }
    pick.shareCents += residualCents;
    pick.residual = true;
    residualLpId = pick.lpId;
  }

  // A line that floors to nothing and carries no residual owes nothing; it is
  // not billed. Its commitment still counted towards the total above, which is
  // what keeps every other line's share proportional.
  const owed = lines.filter((l) => l.shareCents > 0);
  return { amountCents, totalCommitmentCents: total, lines: owed, residualCents, residualLpId, excluded };
}
