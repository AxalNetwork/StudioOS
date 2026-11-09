/**
 * D5039 (#5039, part 2) — the governed actions on a subsidiary statement:
 * Mark issued, Record a payment and Void (migration 202611090909).
 *
 * WHY THIS IS A PURE FUNCTION. Which status an action may start from, what a
 * payment does to paid and outstanding, and when a payment settles the claim
 * are the rules that must be right, and none of them needs a database. The
 * route (`routes/admin_statements.ts`) reads the row, asks `planStatementAction`
 * what would happen, and writes exactly that, guarded by the revision.
 *
 * THE STATE MACHINE (migration 260's four statuses):
 *
 *   draft  --issue-->           issued     only a complete statement (D514: a
 *                                          floor is not sent out as the claim)
 *   issued --record_payment-->  issued     a partial payment; outstanding stays
 *                         \-->  paid       when paid reaches owed (settled)
 *   draft  --void-->            void       with nothing paid against it
 *   issued --void-->            void
 *
 * "Disputed" is not a status: it is an amount HQ records beside the claim
 * (`disputed_cents`, the dispute PATCH), and the receivables table derives the
 * Disputed chip from it. A payment is bounded by owed minus disputed, so paid
 * and disputed together never exceed owed (D514's rule, kept).
 *
 * A PAYMENT ADDS; IT DOES NOT REPLACE. The old PATCH set a running total, so
 * a second wire typed as its own amount overwrote the first. A governed
 * payment is one receipt: its amount is added to what was paid, and the
 * before and after are both stored on the action row.
 */

export const STATEMENT_ACTIONS = ['issue', 'record_payment', 'void'] as const;
export type StatementActionKind = (typeof STATEMENT_ACTIONS)[number];

/** Every governed action says why, in words an auditor can read in a year. */
export const ACTION_REASON_MIN = 10;
export const ACTION_REASON_MAX = 500;
export const PAYMENT_REFERENCE_MAX = 120;
/** A client key: what the SPA mints once per prepared action and resends on retry. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;

/** Money moves on these, so they take the write bar (TOTP session, recent step-up, Super Admin). */
export const STEP_UP_ACTIONS: ReadonlySet<StatementActionKind> = new Set(['record_payment', 'void']);

/** The audit action name each governed action writes. */
export const AUDIT_ACTION: Record<StatementActionKind, string> = {
  issue: 'subsidiary_statement_issued',
  record_payment: 'subsidiary_statement_payment_recorded',
  void: 'subsidiary_statement_void',
};

export type StatementFigures = {
  status: string;
  owed_cents: number;
  paid_cents: number;
  disputed_cents: number;
  unreported_streams: number;
  estimated_streams: number;
};

export type ActionFigures = {
  status: string;
  owed_cents: number;
  paid_cents: number;
  disputed_cents: number;
  outstanding_cents: number;
};

export type ActionPlan =
  | { ok: true; to_status: string; paid_cents: number; settled: boolean; before: ActionFigures; after: ActionFigures }
  | { ok: false; status: 400 | 409; error: string; message: string };

const outstanding = (owed: number, paid: number, disputed: number) => Math.max(0, owed - paid - disputed);

function figures(status: string, owed: number, paid: number, disputed: number): ActionFigures {
  return { status, owed_cents: owed, paid_cents: paid, disputed_cents: disputed, outstanding_cents: outstanding(owed, paid, disputed) };
}

/** The statuses each action may start from. */
export const FROM_STATUSES: Record<StatementActionKind, readonly string[]> = {
  issue: ['draft'],
  record_payment: ['issued'],
  void: ['draft', 'issued'],
};

const STATUS_REFUSAL: Record<StatementActionKind, (status: string) => string> = {
  issue: (s) => `This statement is ${s}, so it cannot be marked issued: only a draft is issued.`,
  record_payment: (s) => (s === 'draft'
    ? 'This statement is a draft, so no payment can be recorded against it: a claim nobody was sent cannot be paid. Mark it issued first.'
    : `This statement is ${s}, so no payment can be recorded against it.`),
  void: (s) => `This statement is ${s}, so it cannot be voided: only a draft or an issued statement is withdrawn.`,
};

/**
 * What `kind` would do to `row`, or why it is refused. `amountCents` is the
 * payment's own amount (record_payment only), already checked to be a whole
 * number of minor units above 0.
 */
export function planStatementAction(kind: StatementActionKind, row: StatementFigures, amountCents: number | null = null): ActionPlan {
  const owed = Number(row.owed_cents) || 0;
  const paid = Number(row.paid_cents) || 0;
  const disputed = Number(row.disputed_cents) || 0;
  const before = figures(row.status, owed, paid, disputed);
  const complete = Number(row.unreported_streams) === 0 && Number(row.estimated_streams) === 0;

  if (!FROM_STATUSES[kind].includes(row.status)) {
    return { ok: false, status: 409, error: 'invalid_status', message: STATUS_REFUSAL[kind](row.status) };
  }

  if (kind === 'issue') {
    if (!complete) {
      return {
        ok: false, status: 409, error: 'incomplete_statement',
        message: 'This owed figure is a floor: some streams were not reported or were estimated. '
          + 'It cannot be marked as issued until every stream is reported in full.',
      };
    }
    return { ok: true, to_status: 'issued', paid_cents: paid, settled: false, before, after: figures('issued', owed, paid, disputed) };
  }

  if (kind === 'void') {
    // MONEY RECORDED AGAINST A CLAIM IS NOT WITHDRAWN WITH IT. Voiding a
    // statement somebody has paid against would leave a receipt with nothing
    // it was a receipt for; the payment has to be dealt with first.
    if (paid > 0) {
      return {
        ok: false, status: 409, error: 'payment_recorded',
        message: 'A payment is recorded against this statement, so it cannot be voided. '
          + 'Record a dispute for the part that is wrong instead.',
      };
    }
    return { ok: true, to_status: 'void', paid_cents: paid, settled: false, before, after: figures('void', owed, paid, disputed) };
  }

  // record_payment
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, status: 400, error: 'bad_amount', message: 'amount_cents must be a whole number of minor units above 0.' };
  }
  const newPaid = paid + amount;
  const open = outstanding(owed, paid, disputed);
  if (newPaid + disputed > owed) {
    return {
      ok: false, status: 409, error: 'over_owed',
      message: `This payment is more than the ${open} minor units still open on this statement`
        + (disputed > 0 ? ` (owed less paid less the ${disputed} disputed).` : '.')
        + ' Check the amount; nothing was recorded.',
    };
  }
  // A FLOOR SETTLED AS A TOTAL (D458). An issued statement is complete today,
  // but the rule is the payment's own, not an accident of the issue rule.
  if (newPaid === owed && !complete) {
    return {
      ok: false, status: 409, error: 'incomplete_statement',
      message: 'This owed figure is a floor: some streams were not reported or were estimated. It cannot be paid in full.',
    };
  }
  const settled = newPaid === owed;
  const to = settled ? 'paid' : 'issued';
  return { ok: true, to_status: to, paid_cents: newPaid, settled, before, after: figures(to, owed, newPaid, disputed) };
}

/** SHA-256 hex of the request's canonical form, for telling a reused key from a retry. */
export async function requestHash(parts: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(Object.keys(parts).sort().map((k) => [k, parts[k] ?? null]));
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
