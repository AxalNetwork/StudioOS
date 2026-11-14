import React from 'react';
import { currencyCode, parseMinor } from '../../../lib/money.js';
import { UNRECORDED_CURRENCY, money, statementAllowsPaidInFull } from './revenueModel.js';
import { actionAvailability } from './statementActionModel.js';

/** D5039 part 3 — all editable statement facts open governed flows from this footer. */

/** Quarter period the statement routes accept (YYYY-Qn). */
export const STATEMENT_PERIOD_RE = /^\d{4}-Q[1-4]$/;

export function statementDrawPayload({ licenceUid, period }) {
  if (!licenceUid) return { error: 'Choose the licence to draw a statement for.' };
  const p = String(period || '').trim();
  if (!STATEMENT_PERIOD_RE.test(p)) return { error: 'The period is a quarter, written YYYY-Qn.' };
  return { licenceUid, period: p };
}

/**
 * D514 — 0 clears a dispute (and needs no reason); anything above 0 must say
 * why. The worker refuses paid and disputed together above owed.
 */
export function statementDisputePayload({ amountText, note, currency }) {
  const text = String(amountText ?? '').trim();
  if (text === '') return { error: 'Enter the disputed amount, or 0 to clear the dispute.' };
  if (!currencyCode(currency)) return { error: 'This statement has no recorded currency, so the disputed amount cannot be read.' };
  const parsed = parseMinor(text, currency);
  if (!parsed.ok) return { error: `The disputed amount: ${parsed.message}` };
  const disputed_cents = parsed.minor;
  if (disputed_cents === 0) return { body: { disputed_cents: 0 } };
  const dispute_note = String(note ?? '').trim();
  if (!dispute_note) return { error: 'A dispute must say why — a subsidiary will ask HQ to justify it.' };
  return { body: { disputed_cents, dispute_note } };
}

/** D514 — "Mark as issued" is offered on a complete draft only; the worker refuses a floor. */
export function statementAllowsIssue(statement) {
  return !!statement && statement.status === 'draft' && statementAllowsPaidInFull(statement);
}

/** Licences that carry a revenue share and are active can be drawn. */
export function licencesDrawableForStatements(licences) {
  if (!Array.isArray(licences)) return [];
  return licences.filter(
    (l) => l.revenue_share_bps !== null && l.revenue_share_bps !== undefined && l.status === 'active',
  );
}

/** D514 — how many statements in `currency` are floors (drawn over unreported or estimated streams). */
export function floorsInCurrency(items, currency) {
  return (Array.isArray(items) ? items : [])
    .filter((s) => (currencyCode(s.currency) || UNRECORDED_CURRENCY) === currency && s.status !== 'void' && !statementAllowsPaidInFull(s)).length;
}

/**
 * D514 — the facts the payload carried and the row never drew (canvas H10):
 * the balance outstanding, when the payment was entered, and how fresh the
 * reports were. A dispute stores no who or when, and the row says so rather
 * than leaving the reader to assume one.
 */
export function StatementFacts({ statement: s }) {
  if (!s) return null;
  const when = (v) => (v ? String(v).slice(0, 10) : null);
  return (
    <div className="mt-0.5 text-[12px] tabular-nums text-axal-faint" data-testid={`hq-statement-facts-${s.uid}`}>
      {Number.isFinite(Number(s.outstanding_cents)) ? `outstanding ${money(s.outstanding_cents, s.currency)}` : 'outstanding not recorded'}
      {' · '}{s.paid_at ? `paid total entered ${when(s.paid_at)}` : 'no payment entered'}
      {' · '}{s.reports_as_of ? `reports as of ${when(s.reports_as_of)}` : 'reports as of: Not recorded'}
      {s.disputed_cents > 0 && ' · who entered the dispute, and when, is not recorded'}
    </div>
  );
}

/**
 * The drawer's footer: the governed actions this statement offers, each
 * opening its flow through `onStart(kind)`, with the reason beside one that is
 * not offered. Disputes and due dates use the same review and receipt steps.
 */
export function StatementActions({ statement, onStart }) {
  if (!statement?.uid) return null;
  const rowLabel = `${statement.brand_name || statement.licence_ref || statement.licence_uid || statement.uid} ${statement.period || ''}`.trim();
  const can = actionAvailability(statement);

  // D514 — A VOID ROW OFFERS NOTHING FURTHER, and says so: a period holds one
  // statement, and a void one cannot be drawn again.
  if (statement.status === 'void') {
    return (
      <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid={`hq-statement-void-${statement.uid}`}>
        Void. Nothing further can be entered, and this period cannot be drawn again.
      </p>
    );
  }

  const btn = 'min-h-[44px] rounded-lg border border-axal-hairline px-3 text-[13.5px] font-bold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:border-gray-700 sm:min-h-[36px]';
  const why = [can.issue, can.record_payment, can.void].map((x) => x.why).filter(Boolean);

  return (
    <div className="flex flex-col gap-2" data-testid={`hq-statement-actions-${statement.uid}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {can.record_payment.offered && (
          <button type="button" className={`${btn} border-transparent bg-axal-violet text-white hover:bg-violet-800 dark:hover:bg-violet-600`}
            onClick={() => onStart?.('record_payment')} aria-label={`Record a payment for ${rowLabel}`}>
            Record payment…
          </button>
        )}
        {can.issue.offered && (
          <button type="button" className={btn} onClick={() => onStart?.('issue')} aria-label={`Mark ${rowLabel} as issued`}>
            Mark issued…
          </button>
        )}
        {can.void.offered && (
          <button type="button" className={`${btn} border-red-300 text-red-800 dark:border-red-500/40 dark:text-red-300`}
            onClick={() => onStart?.('void')} aria-label={`Void ${rowLabel}`}>
            Void…
          </button>
        )}
      </div>
      {why.map((w) => (
        <p key={w} className="text-[12.5px] text-amber-800 dark:text-amber-200" data-testid={w === can.issue.why ? 'hq-statement-no-issue' : undefined}>
          <span aria-hidden="true">◐ </span>{w}
        </p>
      ))}
      {['draft', 'issued'].includes(statement.status) && <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={btn} onClick={() => onStart?.('record_dispute')}>Record dispute…</button>
        <button type="button" className={btn} onClick={() => onStart?.('set_due_date')}>Set due date…</button>
      </div>}
      <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Super Admin · each change asks for a reason and is audited; payments, voids, disputes and due dates require recent authentication.</p>
    </div>
  );
}
