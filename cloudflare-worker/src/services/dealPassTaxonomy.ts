/**
 * Deal Flow — the pass taxonomy.
 *
 * A pass is the only pipeline outcome the fund re-reads. "Why did we say no to
 * this company in 2024?" is asked when the company raises again, when a
 * competitor breaks out, or when the same partner sees the same pattern twice.
 * Before task #127 the platform had no answer: `deals.status` carried a
 * terminal 'rejected', but nothing wrote it except an unvalidated PUT body and
 * no reason was captured anywhere.
 *
 * The reasons below are a CLOSED set, matching the Deal Flow canvas. Two
 * properties follow from that and both are deliberate:
 *
 *   - There is no 'other'. An escape hatch collects the majority of real
 *     passes within a quarter, and then the aggregate says nothing. Specifics
 *     belong in the free-text note, which travels WITH a categorised reason
 *     rather than instead of one.
 *   - Legacy rows are never backfilled. A deal already sitting at 'rejected'
 *     with no reason recorded reports as "Reason not recorded", not as a
 *     guess. Inventing a value would corrupt the one dataset this exists to
 *     make trustworthy.
 *
 * Pure module — no DB, no Env. The frontend mirrors this vocabulary and a test
 * asserts the two lists agree, so a reason added here cannot ship without the
 * label the operator actually reads.
 */

export interface PassReason {
  /** Stored verbatim in `deals.pass_reason`; also the CHECK constraint's enum. */
  key: string;
  label: string;
  /** Shown under the radio in the pass modal — the distinction being drawn. */
  hint: string;
  /**
   * Present only where passing implies a future re-look. This is the sentence
   * the operator sees before committing, so it must describe something the
   * fund actually does, not a promise the platform cannot keep: both triggers
   * below are re-queries a human runs against this table, which is exactly
   * what recording the reason makes possible.
   */
  revisit?: string;
}

export const PASS_TAXONOMY: readonly PassReason[] = Object.freeze([
  {
    key: 'early',
    label: 'Too early',
    hint: 'Right company, wrong moment — revisit at a defined trigger.',
    revisit:
      'Too-early passes get a revisit trigger. This deal will resurface when the company reports its first paid pilot.',
  },
  {
    key: 'valuation',
    label: 'Valuation',
    hint: 'Thesis holds, entry price does not.',
    revisit:
      'Valuation passes are re-queried at the next round. If the price corrects, this comes back to the board.',
  },
  {
    key: 'thesis',
    label: 'Outside thesis',
    hint: 'Not a sector or stage this fund underwrites.',
  },
  {
    key: 'team',
    label: 'Team',
    hint: 'Founder-market fit, completeness, or reference concerns.',
  },
  {
    key: 'competitive',
    label: 'Competitive dynamics',
    hint: 'Crowded, or an incumbent owns the wedge.',
  },
] as const);

export const PASS_REASON_KEYS: readonly string[] = Object.freeze(
  PASS_TAXONOMY.map((r) => r.key),
);

/** The bucket legacy `rejected` rows fall into. Never a stored value. */
export const PASS_REASON_UNRECORDED = 'unrecorded';
export const PASS_REASON_UNRECORDED_LABEL = 'Reason not recorded';

/**
 * Membership test for a caller-supplied reason.
 *
 * Deliberately strict: no trimming, no case folding, no aliasing. The value is
 * written into a CHECK-constrained column and read back by an aggregate, so
 * 'Valuation' and 'valuation' becoming two buckets is precisely the failure
 * this guards. Callers send the key from PASS_TAXONOMY or they get a 400.
 */
export function isPassReason(value: unknown): boolean {
  return typeof value === 'string' && PASS_REASON_KEYS.includes(value);
}

export function passReasonLabel(key: unknown): string {
  const found = PASS_TAXONOMY.find((r) => r.key === key);
  if (found) return found.label;
  return PASS_REASON_UNRECORDED_LABEL;
}

export function passReasonRevisit(key: unknown): string | null {
  return PASS_TAXONOMY.find((r) => r.key === key)?.revisit ?? null;
}
