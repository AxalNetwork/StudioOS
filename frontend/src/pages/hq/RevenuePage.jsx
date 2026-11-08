/**
 * HQ · Revenue — canvas H5, "the money rails, and the token P&L".
 *
 * FIVE ZONES, AND NOW THREE OF THEM HAVE A STORE. That is the fact this page
 * is built around, and it has moved once: D111 gave statements and promo
 * ceilings a real ledger, so two zones that used to carry a stated refusal
 * now carry figures. What has NOT moved is the token line, and the page says
 * which is which.
 *
 *   By stream          licence fees are a CONTRACTED RUN-RATE (D5036: a
 *                      quarter of each active annual fee, never called
 *                      revenue); subscriptions cannot be totalled; the token
 *                      line is the D762 margin.
 *   Licence invoices   D5036 — the invoice ledger (migration 513): invoiced,
 *                      collected, outstanding, overdue and void per currency
 *                      for the period, the receivable as at today, and the
 *                      billable licences not yet invoiced, shown as a gap.
 *   Token P&L by sub.  U1 — nothing ties spend to a licence.
 *   Statements         REAL (migration 260) — one row per subsidiary per
 *                      period, owed computed from the branch's reported
 *                      gross, paid and disputed entered by HQ. Read from its
 *                      OWN endpoint, so a slow ledger costs this zone only.
 *   Open disputes      real, and read from its OWN endpoint so that Stripe
 *                      being slow or down costs this zone and not the page.
 *   Promo ceilings     REAL — HQ sets a ceiling per licence per period, here
 *                      since D228 (the editor under the list), and pushes it
 *                      to the branch, where checkout ENFORCES it atomically
 *                      (D4855, `services/promoRedemption.ts`). Five facts are
 *                      kept apart per row (`ceilingFacts`): saved at HQ,
 *                      pushed to the branch, enforced by the branch, issued
 *                      reported to HQ, remaining known. What HQ does not
 *                      have is the branch's live ISSUED figure: nothing
 *                      carries it to HQ (D266 retired the pull), so HQ's
 *                      copy is null until a branch reports — and a null there
 *                      is not a zero, and gives no remaining.
 *
 *   Billing exceptions H21 (D224) — refunds HQ issued in the last 30 days,
 *                      read from their audit rows, beside open disputes from
 *                      Stripe, each block with its own loading, empty and
 *                      unreadable state. The refund itself is here: HQ's
 *                      super admin, after a step-up, with a written reason.
 *                      LTV and token margin per branch are Not recorded with
 *                      the canvas's own reasons — no store computes either.
 *
 * NO CROSS-CURRENCY TOTAL. Licence fees are denominated per licence and the
 * token cost is USD. The canvas's single "Q3 · €X platform revenue" headline
 * would be wrong by the exchange rate and stated to the cent, so the header
 * carries the quarter and the streams are shown apart. D56/D68: absent is
 * "Not recorded" with its reason, never a plausible zero and never a dash.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { api } from '../../lib/api';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { bpsPercent } from '../../lib/bps';
import { currencyCode, formatMicro, formatMinor, parseMinor } from '../../lib/money';
import RefundReviewFlow from '../../components/RefundReviewFlow.jsx';
import { reportError } from '../../lib/log';
import { Card, RailFrame, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import { revenueAbsenceForLicence, usageCoverageLabel } from '../../lib/hqRevenuePerSub';
import HeaderAsk from '../../ui/HeaderAsk.jsx';

export const UNAVAILABLE = Symbol('unavailable');

/** D5029: the bucket for a statement whose currency is missing or not a listed one. It is never read as euros. */
export const UNRECORDED_CURRENCY = 'UNRECORDED';

/** A number, or null when there is not one. Never a default. */
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());

/**
 * Minor units to a readable amount, in the currency the row is denominated in, at that currency's own number of
 * decimals (D5029: `lib/money.js`; nothing here divides by 100). A row with no usable currency is NOT shown in a
 * guessed one: the count of minor units is shown with the missing currency named, so a real amount is not dropped
 * and not mistaken for euros.
 */
export function money(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  const shown = formatMinor(Number(cents), currency);
  if (shown !== null) return shown;
  return `${Number(cents).toLocaleString()} minor units (currency ${currency ? `"${currency}" is not one we can price in` : 'not recorded'})`;
}
const usd = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
  ? null
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(v)));

/**
 * A statement's state, as a pill.
 *
 * `void` IS NOT TINTED LIKE A FAILURE and `paid` is the only green. A drawn
 * statement nobody has sent is a working figure, an issued one is a claim
 * somebody has seen, and reading the second as the first is the mistake this
 * colour exists to prevent.
 */
const PILL = 'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';
const STATEMENT_PILL = {
  draft: `${PILL} bg-axal-hairline text-axal-muted`,
  issued: `${PILL} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`,
  paid: `${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`,
  void: `${PILL} bg-axal-hairline text-axal-faint line-through`,
};

function Zone({ title, sub, children }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-faint">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

/** A figure the platform does not have, with the server's own reason. */
function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unrecorded /> — {reason}
    </p>
  );
}

function Stat({ label, value, note, tone = 'text-axal-ink' }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

/**
 * H21's two figures no store computes, with the canvas's own reasons. Named
 * once so the tiles and the rail cannot say different things.
 */
export const NOT_RECORDED_H21 = {
  ltv: 'No store reconciles revenue to account lifetime.',
  tokenMargin: 'A margin per branch is not recorded: AI spend is not tied to a licence (U1). The platform-wide margin is under Token P&L.',
};

/** Open means Stripe has not closed it: not won, not lost. */
export const isOpenDispute = (d) => d && d.status !== 'won' && d.status !== 'lost';

/** Stripe's evidence deadline has passed and no evidence is on file. */
export const evidenceOverdue = (d, nowSec) =>
  Number.isFinite(Number(d?.due_by)) && Number(d.due_by) > 0 && Number(d.due_by) < nowSec && !d.has_evidence;

/**
 * H21 — Billing exceptions (D224). Pure over its props so every state renders
 * in a test: `refunds` and `disputes` are each null (loading), UNAVAILABLE (the
 * read failed) or the endpoint's payload. One block failing leaves the other.
 */
export function BillingExceptions({ refunds, disputes, nowSec, onRetryRefunds, onRetryDisputes, refundForm = null }) {
  const refundsReady = refunds && refunds !== UNAVAILABLE && refunds.available;
  const disputesReady = disputes && disputes !== UNAVAILABLE;
  const open = disputesReady ? (disputes.disputes || []).filter(isOpenDispute) : null;
  const overdue = open ? open.filter((d) => evidenceOverdue(d, nowSec)).length : null;

  const refundValue = refundsReady
    ? (refunds.by_currency.length
      ? refunds.by_currency.map((b) => money(b.amount_cents, b.currency)).join(' · ')
      : 'None')
    : null;
  const refundNote = refundsReady
    ? `${refunds.count} issued through HQ in ${refunds.window_days} days · each after a step-up`
    : (refunds === UNAVAILABLE ? 'the refund rows could not be read'
      : (refunds && !refunds.available ? refunds.reason : 'loading…'));

  const rows = [
    ...(refundsReady ? refunds.items.map((r) => ({
      key: `r:${r.audit_id}`,
      who: r.target_user_id ? `Account #${r.target_user_id}` : null,
      amount: money(r.amount_cents, r.currency),
      kind: 'Refund',
      state: r.status,
      note: r.reason,
    })) : []),
    ...(open ? open.map((d) => ({
      key: `d:${d.id}`,
      who: null,
      amount: money(d.amount, d.currency),
      kind: 'Dispute',
      // D634 — each dispute opens its own page, read live from Stripe.
      disputeId: d.id,
      state: d.status,
      note: evidenceOverdue(d, nowSec)
        ? 'Evidence overdue'
        : (Number(d.due_by) > 0 ? `Evidence due ${new Date(Number(d.due_by) * 1000).toLocaleDateString()}` : null),
    })) : []),
  ];

  return (
    <Zone title="Billing exceptions" sub="refund is step-up · dispute is a Stripe state">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="hq-revenue-exceptions-tiles">
        <Stat label={`Refunds (${refundsReady ? refunds.window_days : 30}d)`} value={refundValue} note={refundNote} />
        <Stat
          label="Disputes open"
          value={open ? num(open.length) : null}
          note={open
            ? `Stripe state${overdue ? ` · ${overdue} past evidence deadline` : ''}`
            : (disputes === UNAVAILABLE ? 'Stripe could not be read' : 'loading…')}
          tone={open && open.length ? 'text-red-700 dark:text-red-300' : 'text-axal-ink'}
        />
        <Stat label="LTV" value={null} note={NOT_RECORDED_H21.ltv} />
        <Stat label="Token margin / branch" value={null} note={NOT_RECORDED_H21.tokenMargin} />
      </div>

      {refunds === UNAVAILABLE && (
        <div className="mt-2" data-testid="hq-revenue-refunds-unreadable">
          <Unreadable what="The refunds HQ issued" claim="This is not a claim that none were issued." onRetry={onRetryRefunds} />
        </div>
      )}
      {refunds && refunds !== UNAVAILABLE && !refunds.available && (
        <div className="mt-2"><Absent reason={refunds.reason} /></div>
      )}
      {disputes === UNAVAILABLE && (
        <div className="mt-2" data-testid="hq-revenue-disputes-unreadable">
          <Unreadable what="Open disputes" claim="This is not a claim that there are none." onRetry={onRetryDisputes} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                <th className="py-1.5 pr-3">Account</th>
                <th className="py-1.5 pr-3">Branch</th>
                <th className="py-1.5 pr-3">Amount</th>
                <th className="py-1.5 pr-3">Kind</th>
                <th className="py-1.5 pr-3">State</th>
                <th className="py-1.5">Reason or deadline</th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-exceptions">
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-axal-hairline/60">
                  <td className="py-2 pr-3">{r.who ?? <Unrecorded />}</td>
                  {/* U1 — no charge names the licence it was earned under. */}
                  <td className="py-2 pr-3"><Unrecorded /></td>
                  <td className="py-2 pr-3 tabular-nums">{r.amount ?? <Unrecorded />}</td>
                  <td className="py-2 pr-3">
                    {r.disputeId
                      ? <Link to={`/admin/revenue/disputes/${encodeURIComponent(r.disputeId)}`} className="font-semibold underline" data-testid="hq-revenue-dispute-link">{r.kind}</Link>
                      : r.kind}
                  </td>
                  <td className="py-2 pr-3">{r.state ?? <Unrecorded />}</td>
                  <td className="py-2 text-[11.5px] text-axal-muted">{r.note ?? <Unrecorded />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {refundsReady && open && rows.length === 0 && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-exceptions-empty">
          No refund was issued through HQ in the last {refunds.window_days} days and no dispute is open in Stripe.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
        {refundsReady ? refunds.source : 'Refunds are read from their audit rows; one made in the Stripe dashboard is not listed.'}
        {' '}The branch column is Not recorded because no charge names the licence it was earned under (U1).
        Dispute evidence is filed on the <Link to="/admin/revenue/billing" className="underline">Billing tab</Link>.
      </p>

      {refundForm}
    </Zone>
  );
}

/**
 * The refund, as HQ's governed action (D224), reviewed before money moves (D5037): `RefundReviewFlow` looks the
 * payment up, shows it, and confirms. The worker is the gate — TOTP session, fresh step-up, the elevation, a written
 * reason, the review's token — and the request helper runs the step-up challenge.
 */
export { refundAmountShape } from '../../components/RefundReviewFlow.jsx';

/**
 * D228 — what the ceiling editor sends, or why it will not. Pure, so a test
 * can put a form through it. Money leaves as integer minor units; a blank or
 * unreadable amount is refused rather than sent as 0, because the worker
 * would (since D228) refuse it too and a 0 ceiling is a real instruction.
 */
/** Quarter period the statement routes accept (YYYY-Qn). */
export const STATEMENT_PERIOD_RE = /^\d{4}-Q[1-4]$/;

export function statementDrawPayload({ licenceUid, period }) {
  if (!licenceUid) return { error: 'Choose the licence to draw a statement for.' };
  const p = String(period || '').trim();
  if (!STATEMENT_PERIOD_RE.test(p)) return { error: 'The period is a quarter, written YYYY-Qn.' };
  return { licenceUid, period: p };
}

/**
 * Paid and disputed amounts leave as integer minor units. A blank payment is
 * refused; zero is allowed when nothing was received.
 */
export function statementPaidPayload({ amountText, note, owedCents, currency }) {
  const text = String(amountText ?? '').trim();
  if (text === '') return { error: 'Enter what was received, in the licence currency. 0 is valid when nothing arrived.' };
  if (!currencyCode(currency)) return { error: 'This statement has no recorded currency, so what was received cannot be read as an amount.' };
  const parsed = parseMinor(text, currency);
  if (!parsed.ok) return { error: `The paid amount: ${parsed.message}` };
  const paid_cents = parsed.minor;
  const owed = Number(owedCents);
  if (Number.isFinite(owed) && paid_cents > owed) {
    return { error: `That is more than the ${money(owed, currency)} this statement claims.` };
  }
  return { body: { paid_cents, paid_note: String(note ?? '').trim() || null } };
}

export function statementVoidPayload({ note }) {
  const void_note = String(note ?? '').trim();
  if (void_note.length < 10) {
    return { error: 'Voiding must say why — at least ten characters, read by whoever audits it.' };
  }
  return { body: { status: 'void', void_note } };
}

/** Paid-in-full is refused server-side when the owed figure is still a floor. */
export function statementAllowsPaidInFull(statement) {
  if (!statement) return false;
  if (statement.complete === false) return false;
  if (statement.unreported_streams > 0 || statement.estimated_streams > 0) return false;
  return true;
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

/**
 * D514 — DRAWING IS HELD. As built, a draw records a statement, and whether a
 * statement counts as "revenue per subsidiary" (brief item 7) is the owner's
 * call, so the draw form is gone until the owner decides. The active-licence
 * refusal in the worker (D458) stays as a guard; it is not this hold. The
 * paid and disputed entry on statements already drawn stays.
 */
export const STATEMENT_DRAW_HELD =
  "Drawing is held for the owner's decision on whether a statement counts as revenue per subsidiary (brief item 7).";

export function StatementDrawHeld() {
  return (
    <div className="mb-3 border-b border-axal-hairline pb-3" data-testid="hq-revenue-statement-draw-held">
      <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Draw a statement</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{STATEMENT_DRAW_HELD}</p>
    </div>
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
    <div className="mt-0.5 text-[10.5px] tabular-nums text-axal-faint" data-testid={`hq-statement-facts-${s.uid}`}>
      {Number.isFinite(Number(s.outstanding_cents)) ? `outstanding ${money(s.outstanding_cents, s.currency)}` : 'outstanding not recorded'}
      {' · '}{s.paid_at ? `paid total entered ${when(s.paid_at)}` : 'no payment entered'}
      {' · '}{s.reports_as_of ? `reports as of ${when(s.reports_as_of)}` : 'reports as of: Not recorded'}
      {s.disputed_cents > 0 && ' · who entered the dispute, and when, is not recorded'}
    </div>
  );
}

/**
 * HQ-entered half of a statement: issue, record paid or disputed, void.
 */
export function StatementActions({ statement, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [paid, setPaid] = useState({ amount: '', note: '' });
  const [dispute, setDispute] = useState({ amount: '', note: '' });
  const [voidNote, setVoidNote] = useState('');
  const canPayInFull = statementAllowsPaidInFull(statement);
  const canIssue = statementAllowsIssue(statement);
  if (!statement?.uid) return null;
  const rowLabel = `${statement.brand_name || statement.licence_ref || statement.licence_uid || statement.uid} ${statement.period || ''}`.trim();

  const patch = async (body) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await onUpdate(statement.uid, body);
      setMsg({ err: false, text: 'Saved.' });
      setPaid({ amount: '', note: '' });
      setDispute({ amount: '', note: '' });
    } catch (err) {
      setMsg({ err: true, text: err?.data?.message || err?.message || 'The update was not saved.' });
    } finally {
      setBusy(false);
    }
  };

  const submitPaid = (e) => {
    e.preventDefault();
    const p = statementPaidPayload({ amountText: paid.amount, note: paid.note, owedCents: statement.owed_cents, currency: statement.currency });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    patch(p.body);
  };

  const submitDispute = (e) => {
    e.preventDefault();
    const p = statementDisputePayload({ amountText: dispute.amount, note: dispute.note, currency: statement.currency });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    patch(p.body);
  };

  const submitVoid = (e) => {
    e.preventDefault();
    const p = statementVoidPayload({ note: voidNote });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    patch(p.body);
  };

  const input = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-2 py-1 text-[11.5px]';
  const btn = 'rounded-md border border-axal-hairline px-2 py-1 text-[11px] font-bold disabled:opacity-50';
  const isDraft = statement.status === 'draft';
  const isVoid = statement.status === 'void';

  // D514 — A VOID ROW OFFERS NOTHING FURTHER, and says so: a period holds one
  // statement, and a void one cannot be drawn again.
  if (isVoid) {
    return (
      <p className="mt-2 border-t border-axal-hairline/60 pt-2 text-[10.5px] text-axal-faint" data-testid={`hq-statement-void-${statement.uid}`}>
        Void. Nothing further can be entered, and this period cannot be drawn again.
      </p>
    );
  }

  return (
    <div className="mt-2 border-t border-axal-hairline/60 pt-2" data-testid={`hq-statement-actions-${statement.uid}`}>
      <div className="flex flex-wrap gap-2">
        {isDraft && (canIssue ? (
          <button type="button" disabled={busy} className={`${btn} bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200`}
            onClick={() => patch({ status: 'issued' })} aria-label={`Mark ${rowLabel} as issued`}>
            Mark as issued
          </button>
        ) : (
          <span className="text-[10.5px] text-amber-800 dark:text-amber-200" data-testid="hq-statement-no-issue">
            Mark as issued is unavailable while the owed figure is a floor.
          </span>
        ))}
        {!isVoid && (
          <>
            {statement.status === 'paid' ? null : (
              canPayInFull ? (
                <button type="button" disabled={busy} className={btn}
                  onClick={() => patch({ status: 'paid', paid_cents: statement.owed_cents, paid_note: paid.note || 'Marked paid in full' })}>
                  Mark paid in full
                </button>
              ) : (
                <span className="text-[10.5px] text-amber-800 dark:text-amber-200" data-testid="hq-statement-no-paid-in-full">
                  Paid in full is unavailable while the owed figure is a floor.
                </span>
              )
            )}
          </>
        )}
      </div>
      {!isVoid && (
        <form onSubmit={submitVoid} className="mt-2 space-y-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Void statement</div>
          <p className="text-[10px] text-axal-faint">A void period cannot be drawn again.</p>
          <input className={input} required minLength={10} placeholder="Why this claim is withdrawn — required" value={voidNote} onChange={(e) => setVoidNote(e.target.value)} aria-label={`Void reason for ${rowLabel}`} />
          <button type="submit" disabled={busy} className={`${btn} border-red-300 text-red-800 dark:border-red-500/40 dark:text-red-300`}>Void</button>
        </form>
      )}
      {!isVoid && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <form onSubmit={submitPaid} className="space-y-1">
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Set total paid</div>
            <p className="text-[10px] text-axal-faint">Replaces the total received so far; it does not add a receipt.</p>
            <input className={input} type="text" inputMode="decimal" autoComplete="off" placeholder="Total received to date" value={paid.amount} onChange={(e) => setPaid((x) => ({ ...x, amount: e.target.value }))} aria-label={`Total paid for ${rowLabel}`} />
            <input className={input} placeholder="Reference or note" value={paid.note} onChange={(e) => setPaid((x) => ({ ...x, note: e.target.value }))} aria-label={`Payment note for ${rowLabel}`} />
            <button type="submit" disabled={busy} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800 dark:hover:bg-emerald-600`}>Save total paid</button>
          </form>
          <form onSubmit={submitDispute} className="space-y-1">
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Record dispute</div>
            <p className="text-[10px] text-axal-faint">0 clears the dispute.</p>
            <input className={input} type="text" inputMode="decimal" autoComplete="off" placeholder="Disputed amount" value={dispute.amount} onChange={(e) => setDispute((x) => ({ ...x, amount: e.target.value }))} aria-label={`Disputed amount for ${rowLabel}`} />
            <input className={input} placeholder="Why — required above 0" value={dispute.note} onChange={(e) => setDispute((x) => ({ ...x, note: e.target.value }))} aria-label={`Dispute reason for ${rowLabel}`} />
            <button type="submit" disabled={busy} className={`${btn} border-red-300 text-red-800 dark:border-red-500/40 dark:text-red-300`}>Save dispute</button>
          </form>
        </div>
      )}
      {msg && (
        <p role={msg.err ? 'alert' : 'status'} className={`mt-1 text-[11px] ${msg.err ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{msg.text}</p>
      )}
    </div>
  );
}

export function ceilingPayload({ licenceUid, period, amount, currency }) {
  if (!licenceUid) return { error: 'Choose the licence this ceiling is for.' };
  if (!STATEMENT_PERIOD_RE.test(String(period || ''))) return { error: 'The period is a quarter, written YYYY-Qn.' };
  const text = String(amount ?? '').trim();
  if (text === '') return { error: 'Enter the ceiling. 0 is a ceiling: no promotions this period.' };
  const cur = currencyCode(String(currency || '').trim().toUpperCase());
  if (!cur) return { error: 'The currency is a three-letter ISO 4217 code that StudioOS can price in, such as EUR.' };
  const parsed = parseMinor(text, cur);
  if (!parsed.ok) return { error: `The ceiling: ${parsed.message}` };
  return { licenceUid, body: { period: String(period), ceiling_cents: parsed.minor, currency: cur } };
}

/**
 * What the editor and the list say about enforcement, as D4855 built it (owner decision of 2026-11-07, option B).
 * One sentence each, so a test can hold every one to the contract: a regression that tells the operator checkout does
 * not enforce a configured ceiling fails it.
 */
export const CEILING_ENFORCEMENT = Object.freeze([
  'A ceiling that HQ has set and the branch holds is enforced at checkout, atomically: the branch refuses a discount above what is left of it, and two checkouts cannot both take the last of it.',
  'If the branch holds no ceiling for the current quarter, discounts are allowed until HQ sets one. That is the owner\'s decision, not a fault, and "no ceiling" is neither 0 nor unlimited.',
  'If the branch holds a ceiling it cannot read, the discount is refused.',
  'Saving a ceiling stores it at HQ and pushes it to the branch; those are two facts, and the push can fail on its own. A ceiling the branch has not received is not enforced.',
  'The branch counts what it gives. HQ does not receive that figure automatically: Issued and Remaining here are what the branch has reported to HQ, and they are Not recorded until it does.',
]);

/** A date as the day it is, from an ISO timestamp; null when there is none. */
const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * The five facts about one ceiling row, kept apart (D5028). Never derived from each other:
 *   saved     the row exists at HQ (it is listed, so it is);
 *   pushed    the branch confirmed the LATEST saved figure (`pushed_at` not older than the last save);
 *   enforced  what the branch does with it at checkout: only a ceiling for the CURRENT quarter that the branch has
 *             received is enforced; an older one says nothing about this quarter; an earlier figure is what a branch
 *             enforces when the latest save did not reach it;
 *   issued    what the branch reported to HQ, or Not reported. HQ's copy is only what a branch reports;
 *   remaining known only when an issued figure was reported: no issued figure, no remaining, never the whole ceiling.
 */
export function ceilingFacts(row, currentPeriod) {
  const r = row || {};
  const current = Boolean(currentPeriod) && r.period === currentPeriod;
  const everPushed = typeof r.pushed_at === 'string' && r.pushed_at !== '';
  const latestPushed = everPushed && (!r.updated_at || String(r.pushed_at) >= String(r.updated_at));
  const issuedKnown = r.issued_available === true && r.issued_cents !== null && r.issued_cents !== undefined && Number.isFinite(Number(r.issued_cents));
  const remainingKnown = issuedKnown && r.remaining_cents !== null && r.remaining_cents !== undefined && Number.isFinite(Number(r.remaining_cents));
  let enforced;
  if (!current) enforced = { state: 'other_period', label: 'Not this quarter: it governs no checkout now' };
  else if (latestPushed) enforced = { state: 'enforced', label: 'Enforced by the branch at checkout' };
  else if (everPushed) enforced = { state: 'earlier_figure', label: 'The branch enforces the figure it last received, not this one' };
  else enforced = { state: 'not_received', label: 'Not enforced yet: the branch has not received it, so it allows discounts' };
  return {
    saved: { yes: true, label: 'Saved at HQ' },
    pushed: latestPushed
      ? { yes: true, label: `Pushed to the branch${dayOf(r.pushed_at) ? ` ${dayOf(r.pushed_at)}` : ''}` }
      : { yes: false, label: everPushed ? 'The latest figure was not pushed' : 'Not pushed to the branch' },
    enforced,
    issued: issuedKnown
      ? { known: true, label: `Reported${dayOf(r.issued_reported_at) ? ` ${dayOf(r.issued_reported_at)}` : ''}` }
      : { known: false, label: 'Not reported to HQ' },
    remaining: remainingKnown ? { known: true } : { known: false, label: 'Not known: no issued figure was reported' },
  };
}

/**
 * D228 — the promo-ceiling editor. `licences` is null (loading), UNAVAILABLE
 * (the read failed) or the licence list; `onSave(licenceUid, body)` is the
 * worker call. The route's own gate and audit apply: super admin, and a
 * branch-action mirror row for the push.
 */
export function CeilingEditor({ licences, currentPeriod, onSave }) {
  const [f, setF] = useState({ licenceUid: '', period: currentPeriod || '', amount: '', currency: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const list = licences && licences !== UNAVAILABLE ? licences : null;
  const period = f.period || currentPeriod || '';
  const picked = list ? list.find((l) => l.uid === f.licenceUid) : null;
  const currency = f.currency || picked?.currency || '';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const p = ceilingPayload({ licenceUid: f.licenceUid, period, amount: f.amount, currency });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await onSave(p.licenceUid, p.body);
      // Saved and pushed are two facts, and the second can fail alone.
      setMsg(r?.pushed?.ok
        ? { err: false, text: `Ceiling saved for ${r.period} and pushed to the branch.` }
        : { err: false, warn: true, text: `Ceiling saved for ${r?.period || period} at HQ. Not pushed: ${r?.pushed?.reason || 'the branch did not confirm.'}` });
      setF((x) => ({ ...x, amount: '' }));
    } catch (err) {
      setMsg({ err: true, text: err?.data?.message || err?.message || 'The ceiling was not saved.' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px]';
  return (
    <div className="mt-4 border-t border-axal-hairline pt-3" data-testid="hq-revenue-ceiling-editor">
      <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Set a ceiling</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-ceiling-enforcement">
        {CEILING_ENFORCEMENT.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {licences === UNAVAILABLE && (
        <div className="mt-2">
          <Unreadable what="The licence list" claim="No ceiling can be set until it is read; this is not a claim that there are no licences." />
        </div>
      )}
      {licences === null && <p className="mt-2 text-[11.5px] text-axal-faint">Loading the licences…</p>}
      {list && list.length === 0 && (
        <p className="mt-2 text-[12px] text-axal-muted" data-testid="hq-revenue-ceiling-no-licences">
          No territory licence exists yet, so there is nothing to set a ceiling for.
        </p>
      )}
      {list && list.length > 0 && (
        <form onSubmit={submit} className="mt-2 grid gap-2 sm:grid-cols-4">
          <select className={`${input} sm:col-span-2`} value={f.licenceUid} onChange={(e) => set('licenceUid', e.target.value)} aria-label="Licence">
            <option value="">Licence…</option>
            {list.map((l) => (
              <option key={l.uid} value={l.uid}>{l.brand_name || l.licence_ref || l.uid}{l.status && l.status !== 'active' ? ` · ${l.status}` : ''}</option>
            ))}
          </select>
          <input className={input} value={period} onChange={(e) => set('period', e.target.value)} placeholder="YYYY-Qn" aria-label="Period" />
          <input className={input} value={currency} onChange={(e) => set('currency', e.target.value)} placeholder="EUR" maxLength={3} aria-label="Currency" />
          <input className={`${input} sm:col-span-2`} type="text" inputMode="decimal" autoComplete="off" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Ceiling for the period" aria-label="Ceiling" />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg bg-axal-violet px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save ceiling'}
            </button>
          </div>
          {msg && (
            <p role="status" className={`sm:col-span-4 text-[11.5px] ${msg.err ? 'text-red-700 dark:text-red-300' : (msg.warn ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}`}>
              {msg.text}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * D5027 — the token P&L the Worker computes (D762, `routes/admin_revenue.ts`), as the display strings of this page.
 * Pure over the `token_cost` payload so every state is drawn in a test. Two failure domains, never one:
 *   - the COST (`available`, `cost_usd`) is the usage log;
 *   - the MARGIN and its parts (`billed_available`) are the charge ledger. A margin that cannot be read leaves the cost
 *     on screen, and a cost that cannot be read leaves nothing to show.
 * A figure is `null` (the page draws Not recorded) when it is not known, and a real zero or negative figure is drawn as
 * itself. When every member run this quarter predates migration 493 (`margin_microusd` null) there is no charge to
 * total, so the top-up spend and cost, which come from that join, are Not recorded rather than $0.00; what is
 * counted without it (tokens given, included in plans) stays. Included-plan usage is its own figure and is never
 * added to the spend: the plan's price already paid for it.
 */
export function tokenMarginView(token) {
  if (!token || token.available !== true) {
    return { state: 'unreadable', reason: token?.reason || 'The AI usage log could not be read.', cost: null, margin: null };
  }
  const micro = (v) => (v === null || v === undefined ? null : formatMicro(Number(v), 'USD'));
  const cost = Number.isFinite(Number(token.cost_usd)) && token.cost_usd !== null && token.cost_usd !== undefined ? usd(token.cost_usd) : null;
  if (token.billed_available !== true) {
    return {
      state: 'margin_unreadable',
      reason: token.billed_reason || 'The AI holds and token ledger could not be read, so the margin is not shown.',
      cost, margin: null,
    };
  }
  const marginKnown = token.margin_microusd !== null && token.margin_microusd !== undefined;
  const runs = Number(token.member_runs);
  const notRecorded = Number(token.runs_not_recorded);
  const sign = marginKnown ? Math.sign(Number(token.margin_microusd)) : null;
  return {
    state: marginKnown ? 'ok' : 'predates',
    reason: marginKnown ? null : 'Every member run this quarter was settled before the charge ledger (migration 493), so there is no charge to total. This is not a margin of zero.',
    cost,
    topupSpend: marginKnown ? micro(token.topup_spend_microusd) : null,
    topupCost: marginKnown ? micro(token.topup_cost_microusd) : null,
    given: micro(token.tokens_given_microusd),
    included: micro(token.included_in_plans_microusd),
    margin: marginKnown ? micro(token.margin_microusd) : null,
    tone: sign === null ? null : (sign < 0 ? 'negative' : (sign > 0 ? 'positive' : 'zero')),
    coverage: Number.isFinite(runs) && Number.isFinite(notRecorded)
      ? `${runs.toLocaleString()} member run${runs === 1 ? '' : 's'} settled; ${notRecorded.toLocaleString()} before the charge ledger (migration 493) and outside the margin`
      : null,
  };
}

/** The token P&L tiles. Pure over `token_cost`, so a test draws every state. */
export function TokenPnl({ token }) {
  const v = tokenMarginView(token);
  const toneClass = v.tone === 'negative' ? 'text-red-700 dark:text-red-300' : 'text-axal-ink';
  return (
    <div data-testid="hq-revenue-token-pnl">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat
          label="Token cost, platform-wide"
          value={v.cost}
          note={v.state === 'unreadable' ? v.reason : `${num(token.calls)} calls in the quarter · USD`}
        />
        <Stat label="Top-up spend" value={v.topupSpend ?? null} note={v.state === 'ok' ? 'paid from tokens, by members' : (v.reason || 'not recorded')} />
        <Stat label="Top-up cost" value={v.topupCost ?? null} note={v.state === 'ok' ? 'the share of the cost that spend caused' : (v.reason || 'not recorded')} />
        <Stat label="Tokens given" value={v.given ?? null} note={v.given ? 'bonus and adjustment credits HQ gave' : (v.reason || 'not recorded')} />
        <Stat label="Included in plans" value={v.included ?? null} note={v.included ? 'allowance draws; a plan\'s price pays for these, so they are not token revenue' : (v.reason || 'not recorded')} />
        <Stat
          label="Token margin"
          value={v.margin}
          tone={toneClass}
          note={v.state === 'ok' ? 'top-up spend, less its cost, less tokens given' : (v.reason || 'not recorded')}
        />
      </div>
      {v.coverage && <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-revenue-token-coverage">{v.coverage}. Admin-licence runs are left out.</p>}
    </div>
  );
}

/**
 * D5036 — the quarters the page offers: the current one and the `count - 1` before it, newest first, as YYYY-Qn.
 * Never a future quarter: the Worker refuses one, because nothing has been invoiced in it.
 */
export function recentQuarters(now, count = 8) {
  const out = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-Q${q}`);
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}

/** The reason a billable licence cannot be invoiced, as the page says it. */
export const CANNOT_INVOICE = Object.freeze({
  no_annual_fee: 'records no annual fee',
  no_start_date: 'records no start date, so its licence year cannot be told',
});

/**
 * D5036 — licence fees as the invoice ledger records them. Pure over `licence_invoices` (null while loading), so a
 * test draws every state. Four concepts, never one: the run-rate is in "By stream"; here are invoiced, collected and
 * outstanding for the invoices issued in the period, the receivable as at today with its overdue part listed, void
 * invoices apart, and the billable years nobody invoiced. One row per currency, never summed across them.
 */
export function LicenceInvoices({ invoices, onRetry }) {
  if (!invoices) return <p className="text-[12px] text-axal-faint">Loading the invoice ledger…</p>;
  if (invoices.available !== true) {
    return (
      <div data-testid="hq-revenue-invoices-unreadable">
        <Unreadable what="The licence-fee invoice ledger" claim="This is not a claim that nothing was invoiced or that nothing is owed." onRetry={onRetry} />
      </div>
    );
  }
  const th = 'py-1.5 pr-3';
  const head = 'border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint';
  const gaps = invoices.expected_not_invoiced || [];
  const cannot = invoices.cannot_invoice || [];
  const overdue = invoices.overdue || [];
  return (
    <div data-testid="hq-revenue-invoices">
      {invoices.by_currency.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-invoices-none">
          No licence-fee invoice was issued in {invoices.period?.label}. That is a fact of the ledger, not a reading of zero revenue: the run-rate above is what the terms would bring in.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className={head}>
                <th className={th}>Currency</th>
                <th className={th}>Invoiced</th>
                <th className={th}>Collected</th>
                <th className={th}>Outstanding</th>
                <th className={th}>Overdue</th>
                <th className="py-1.5">Void</th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-invoices-period">
              {invoices.by_currency.map((b) => (
                <tr key={b.currency} className="border-b border-axal-hairline/60">
                  <td className="py-2 pr-3 font-medium">{b.currency}</td>
                  <td className="py-2 pr-3 tabular-nums">{money(b.invoiced_cents, b.currency)}<div className="text-[10.5px] text-axal-faint">{b.invoices} {b.invoices === 1 ? 'invoice' : 'invoices'}</div></td>
                  <td className="py-2 pr-3 tabular-nums">{money(b.collected_cents, b.currency)}</td>
                  <td className="py-2 pr-3 tabular-nums">{money(b.outstanding_cents, b.currency)}</td>
                  <td className={`py-2 pr-3 tabular-nums ${b.overdue_invoices ? 'text-red-700 dark:text-red-300' : ''}`}>
                    {b.overdue_invoices ? `${money(b.overdue_cents, b.currency)} · ${b.overdue_invoices}` : 'None'}
                  </td>
                  <td className="py-2 tabular-nums text-axal-faint">{b.void_invoices ? `${b.void_invoices} · ${money(b.void_cents, b.currency)}, in no other figure` : 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="hq-revenue-receivable">
        {invoices.receivable_by_currency.length === 0
          ? <Stat label="Receivable today" value="None" note="no open licence-fee invoice, in any period" />
          : invoices.receivable_by_currency.map((b) => (
            <Stat
              key={b.currency}
              label={`Receivable today · ${b.currency}`}
              value={money(b.outstanding_cents, b.currency)}
              tone={b.overdue_invoices ? 'text-red-700 dark:text-red-300' : 'text-axal-ink'}
              note={`${b.open_invoices} open${b.overdue_invoices ? ` · ${money(b.overdue_cents, b.currency)} overdue on ${b.overdue_invoices}` : ' · none overdue'}`}
            />
          ))}
      </div>

      {overdue.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-red-700 dark:text-red-300">Overdue · {invoices.overdue_total}</div>
          <table className="mt-1 w-full text-left text-[12px]">
            <thead>
              <tr className={head}>
                <th className={th}>Licence</th>
                <th className={th}>Invoice</th>
                <th className={th}>Due</th>
                <th className="py-1.5">Outstanding</th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-invoices-overdue">
              {overdue.map((o) => (
                <tr key={o.uid} className="border-b border-axal-hairline/60">
                  <td className="py-2 pr-3 font-medium">{o.brand_name || o.licence_ref || o.licence_uid}</td>
                  <td className="py-2 pr-3 text-axal-muted">{o.reference} · {o.period_label}</td>
                  <td className="py-2 pr-3 tabular-nums">{o.due_at} · {o.days_overdue} {o.days_overdue === 1 ? 'day' : 'days'} late</td>
                  <td className="py-2 tabular-nums">{money(o.outstanding_cents, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.overdue_total > overdue.length && (
            <p className="mt-1 text-[10.5px] text-axal-faint">The {overdue.length} longest overdue are listed; the totals above count all {invoices.overdue_total}.</p>
          )}
        </div>
      )}

      {(gaps.length > 0 || cannot.length > 0) && (
        <div className="mt-3 rounded-xl border border-amber-300 p-2.5 dark:border-amber-500/40" data-testid="hq-revenue-invoice-gaps">
          <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-amber-800 dark:text-amber-300">Expected, not invoiced</div>
          <ul className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed text-axal-muted">
            {gaps.map((g) => (
              <li key={`${g.licence_uid}:${g.period_start}`}>
                {g.brand_name || g.licence_ref} · {g.period_label} · {money(g.amount_cents, g.currency)}
                {g.gap === 'void_not_reissued' ? ' — its only invoice for this year is void, and a year is invoiced once' : ' — the licence year has started and no invoice is issued'}
                {g.status === 'suspended' ? ' (suspended, still billable)' : ''}
              </li>
            ))}
            {cannot.map((x) => (
              <li key={`cannot:${x.licence_uid}`}>{x.brand_name || x.licence_ref} — cannot be invoiced: it {CANNOT_INVOICE[x.reason] || x.reason}.</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10.5px] leading-relaxed text-axal-faint">
        <li>{invoices.basis?.invoiced}</li>
        <li>{invoices.basis?.collected}</li>
        <li>{invoices.basis?.receivable}</li>
        <li>{invoices.basis?.void}</li>
        <li>One row per currency; nothing is added across currencies.</li>
      </ul>
    </div>
  );
}

export default function RevenuePage() {
  // D5036: the quarter the summary reads; '' is the current one.
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);            // null = loading, UNAVAILABLE = failed
  // Disputes load separately on purpose: they are the one figure that comes
  // from Stripe, and folding them into the summary would mean an outage
  // there blanked four zones that read D1 perfectly well.
  const [disputes, setDisputes] = useState(null);
  // Statements and ceilings load separately for the same reason, and not
  // because they are slow: they are the two zones with WRITES behind them,
  // so they re-read after an edit without re-fetching the summary.
  const [statements, setStatements] = useState(null);
  const [ceilings, setCeilings] = useState(null);
  // H21 (D224) — the refunds HQ issued, from their audit rows. Its own read.
  const [refunds, setRefunds] = useState(null);
  // D228 — the licences the ceiling editor offers. Its own read.
  const [licences, setLicences] = useState(null);

  const load = useCallback(() => {
    setData(null);
    api.hqRevenue(period || undefined).then(setData, (e) => { reportError('hq-revenue', e); setData(UNAVAILABLE); });
  }, [period]);
  const loadDisputes = useCallback(() => {
    setDisputes(null);
    api.adminBillingListDisputes(100).then(setDisputes, (e) => {
      reportError('hq-revenue-disputes', e);
      setDisputes(UNAVAILABLE);
    });
  }, []);
  const loadStatements = useCallback(() => {
    setStatements(null);
    api.statements().then(setStatements, (e) => {
      reportError('hq-revenue-statements', e);
      setStatements(UNAVAILABLE);
    });
  }, []);
  const loadCeilings = useCallback(() => {
    setCeilings(null);
    api.promoCeilings().then(setCeilings, (e) => {
      reportError('hq-revenue-ceilings', e);
      setCeilings(UNAVAILABLE);
    });
  }, []);
  const loadRefunds = useCallback(() => {
    setRefunds(null);
    api.adminBillingRefunds().then(setRefunds, (e) => {
      reportError('hq-revenue-refunds', e);
      setRefunds(UNAVAILABLE);
    });
  }, []);
  const loadLicences = useCallback(() => {
    setLicences(null);
    // #4700 — the ledger is paged now; the ceiling and statement pickers need
    // every licence, so this follows the pages, and a run that stops short of
    // the end is unreadable rather than a shorter list.
    licenceLedgerApi.all().then((r) => setLicences(r?.complete ? r.items : UNAVAILABLE), (e) => {
      reportError('hq-revenue-licences', e);
      setLicences(UNAVAILABLE);
    });
  }, []);
  const saveCeiling = useCallback(async (uid, body) => {
    const r = await api.promoCeilingSet(uid, body);
    loadCeilings();
    return r;
  }, [loadCeilings]);
  const updateStatement = useCallback(async (uid, body) => {
    const r = await api.statementUpdate(uid, body);
    loadStatements();
    return r;
  }, [loadStatements]);
  useEffect(() => {
    load(); loadDisputes(); loadStatements(); loadCeilings(); loadRefunds(); loadLicences();
  }, [load, loadDisputes, loadStatements, loadCeilings, loadRefunds, loadLicences]);

  const ready = data && data !== UNAVAILABLE;
  const fees = ready ? data.licence_fees : null;
  const token = ready ? data.token_cost : null;
  const tokenView = tokenMarginView(token);
  const promos = ready ? data.promos : null;
  const usageCoverage = ready ? data.usage_coverage : null;
  const openDisputes = disputes && disputes !== UNAVAILABLE
    ? (disputes.disputes || []).filter((d) => d.status !== 'won' && d.status !== 'lost').length
    : null;
  const ledger = statements && statements !== UNAVAILABLE && statements.available ? statements : null;
  const ceilingRows = ceilings && ceilings !== UNAVAILABLE && ceilings.available ? ceilings.items : null;

  // One line per read that answered (D126). This page runs FOUR independent
  // reads and each can fail alone, which is exactly why `coverage` is assembled
  // per source rather than gated on `ready`: a Stripe outage must not empty the
  // rail over three zones that read D1 perfectly well. `canRun =
  // coverage.length > 0` in WorkerRail, so passing none disabled the button and
  // printed "Not recorded" on a page with four live figures.
  const coverage = [
    fees?.available && num(fees.by_currency.length) !== null
      ? `Licence fees in ${fees.by_currency.length} ${fees.by_currency.length === 1 ? 'currency' : 'currencies'}` : null,
    token?.available && num(token.calls) !== null
      ? `${num(token.calls)} AI calls in the quarter, at cost` : null,
    ledger ? `${ledger.items.length} branch ${ledger.items.length === 1 ? 'statement' : 'statements'} · period ${ledger.current_period}` : null,
    ceilingRows ? `${ceilingRows.length} promo ${ceilingRows.length === 1 ? 'ceiling' : 'ceilings'} set` : null,
    openDisputes === null ? null : `${openDisputes} open ${openDisputes === 1 ? 'dispute' : 'disputes'}`,
    refunds && refunds !== UNAVAILABLE && refunds.available
      ? `${refunds.count} ${refunds.count === 1 ? 'refund' : 'refunds'} issued through HQ in ${refunds.window_days} days` : null,
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Revenue"
      role="super_admin"
      stance="Read-only summary"
      note="This rail summarises licence fees, AI cost, branch statements, promo ceilings, refunds and open disputes. It moves no money: the paid and disputed totals on a branch statement are figures an HQ operator types in, and the page's one money movement is a refund, which HQ's super admin issues after a step-up with a written reason."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === UNAVAILABLE ? 'The revenue summary could not be read, so there is nothing to read back — this is not a claim that no revenue was booked.'
          : 'Loading the revenue summary…')}
      unavailable={[
        ['Subscription revenue', 'No local charge ledger; Stripe is read per customer.'],
        ['LTV', NOT_RECORDED_H21.ltv],
        ['Revenue per subsidiary', 'Branches report quarters to HQ; every stream today arrives unmeasured (D266), so no amount is totalled.'],
        ['Token P&L per subsidiary', 'Spend is not tied to a licence (U1) and almost no model call carries branch metadata (D261).'],
        // Statements and ceilings came OFF this list in D111, because they
        // acquired a store. What is left absent is the issued figure, and
        // D266 found the old reason promised a report nothing sends.
        ['Promotional spend per code', 'A code names no subsidiary, and no branch reports an issued figure to HQ, so spend against a ceiling is not recorded.'],
      ]}
      data-testid="hq-revenue-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="hq-revenue-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#14532d] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          {/* The canvas puts a single platform-revenue figure here. Two
              currencies and a USD cost cannot be added into one, so the
              quarter is stated and the money is left in its own rows. */}
          <span className="flex items-center gap-2 text-[11px] tabular-nums">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold text-white"
              aria-label="Period"
              data-testid="hq-revenue-period"
            >
              {recentQuarters(new Date()).map((q, i) => (
                <option key={q} value={i === 0 ? '' : q} className="text-axal-ink">{i === 0 ? `${q} (current)` : q}</option>
              ))}
            </select>
            <span className="opacity-80">{ready ? `${data.quarter.label} · streams shown separately, not summed` : '…'}</span>
          </span>
        </div>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Coins size={13} /> HQ · Revenue
          </div>
          {/* `text-axal-ink` is #18181b with no dark-mode value in the @theme
              block, so on the dark ground the heading is near-black on
              near-black. Every HQ page has this and it is not this page's to
              fix across the tier — but this page is not shipping with an
              unreadable title either. */}
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Revenue</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Three streams and the one line that is a margin rather than a fee. Licence fees, open disputes,
            the statement ledger and the promo ceilings are read from their stores; subscriptions, the token
            margin and the per-subsidiary split are not recorded anywhere, and each says so where its figure
            would be.
          </p>
          </div>
          <HeaderAsk />
        </header>

        {data === UNAVAILABLE && (
          <div className="mt-4">
            <Unreadable
              what="The revenue summary"
              claim="This is not a claim that nothing was earned."
              onRetry={load}
            />
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Zone title="By stream" sub="gross, cost, and what is actually known">
            {fees?.available ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      <th className="py-1.5 pr-3">Stream</th>
                      <th className="py-1.5 pr-3">Quarter figure</th>
                      <th className="py-1.5 pr-3">Cost</th>
                      <th className="py-1.5">Read</th>
                    </tr>
                  </thead>
                  <tbody data-testid="hq-revenue-streams">
                    {fees.by_currency.map((row) => (
                      <tr key={row.currency} className="border-b border-axal-hairline/60">
                        <td className="py-2 pr-3 font-medium">
                          Licence fees · {row.currency}
                          <div className="text-[10.5px] font-normal text-axal-faint" data-testid="hq-revenue-run-rate-label">{fees.label || 'Contracted quarterly run-rate'}, not invoiced or collected</div>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{money(row.quarter_cents, row.currency)}</td>
                        <td className="py-2 pr-3 text-axal-faint">No cost of goods</td>
                        <td className="py-2 text-[11.5px] text-axal-muted">
                          {row.licences} active licence{row.licences === 1 ? '' : 's'}. {fees.basis}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-axal-hairline/60">
                      <td className="py-2 pr-3 font-medium">Subscriptions</td>
                      <td className="py-2 pr-3"><Unrecorded /></td>
                      <td className="py-2 pr-3 text-axal-faint">Not applicable</td>
                      <td className="py-2 text-[11.5px] text-axal-muted">{ready ? data.subscriptions_reason : null}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium">Token margin</td>
                      <td className="py-2 pr-3 tabular-nums">{tokenView.margin ?? <Unrecorded />}</td>
                      <td className="py-2 pr-3 tabular-nums">{tokenView.cost ?? <Unrecorded />}</td>
                      <td className="py-2 text-[11.5px] text-axal-muted">
                        {tokenView.state === 'ok' ? 'Top-up spend less its share of the cost, less tokens given. USD. Included-plan usage is not revenue here.' : tokenView.reason}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {fees.active_without_fee > 0 && (
                  <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300" data-testid="hq-revenue-fee-gap">
                    {fees.active_without_fee === 1
                      ? '1 active licence records no annual fee, so it is'
                      : `${fees.active_without_fee} active licences record no annual fee, so they are`} not in
                    the figures above.
                  </p>
                )}
                {/* Never one number. Said on the page, not only in the code. */}
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
                  Rows are not added together: licence fees are denominated per licence and the token cost is
                  USD, so a single total would be wrong by the exchange rate and stated to the cent.
                </p>
              </div>
            ) : (
              <Absent reason={fees?.reason || 'The licence ledger could not be read.'} />
            )}
          </Zone>

          <Zone title="Licence fees · invoiced and collected" sub={ready ? `${data.quarter.label} · from the invoice ledger, per currency` : 'from the invoice ledger'}>
            {data === UNAVAILABLE
              ? <Absent reason="The revenue summary could not be read." />
              : <LicenceInvoices invoices={ready ? data.licence_invoices : null} onRetry={load} />}
          </Zone>

          <Zone
            title="Revenue per subsidiary"
            sub={usageCoverage?.available ? `${usageCoverage.period} · report status, not totals` : 'what HQ recorded from branch reports'}
          >
            {!usageCoverage ? (
              <p className="text-[12px] text-axal-faint">Loading usage coverage…</p>
            ) : !usageCoverage.available ? (
              <Unreadable what="Subsidiary usage reports" claim="This is not a claim that no branch reported." onRetry={load} />
            ) : (
              <>
                <p className="mb-3 text-[11.5px] leading-relaxed text-axal-muted">
                  {usageCoverage.revenue_reason}
                </p>
                <div className="overflow-x-auto" data-testid="hq-revenue-usage-coverage">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                        <th className="py-1.5 pr-3">Licence</th>
                        <th className="py-1.5 pr-3">Report</th>
                        <th className="py-1.5">Figure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageCoverage.by_licence.map((row) => (
                        <tr key={row.licence_uid} className="border-b border-axal-hairline/60">
                          <td className="py-2 pr-3 font-medium">{row.brand_name || row.licence_ref}</td>
                          <td className="py-2 pr-3 text-axal-muted">{usageCoverageLabel(row, usageCoverage.period)}</td>
                          <td className="py-2 text-axal-muted">
                            <Unrecorded reason={revenueAbsenceForLicence(usageCoverage, row.licence_uid)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Token P&L by subsidiary" sub="what it cost against what it billed">
              <Absent reason={ready ? data.token_pl_per_subsidiary_reason : 'The revenue summary could not be read.'} />
              <div className="mt-3"><TokenPnl token={token} /></div>
            </Zone>

            <Zone title="Statements and Stripe" sub="what is owed, and what is stuck">
              <StatementDrawHeld />
              {ledger && ledger.items.length > 0 && (
                <div className="space-y-2" data-testid="hq-revenue-statements">
                  {ledger.items.map((s) => (
                    <div
                      key={s.uid}
                      className="rounded-xl border border-axal-hairline bg-axal-ground p-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-bold">
                          {s.brand_name || s.licence_ref || s.licence_uid}
                        </div>
                        {/* THE RATE THE OWED FIGURE WAS COMPUTED FROM, beside
                            it (H10, D149). `owed` is `gross × revenue_share`
                            drawn server-side by `drawStatement`, and it read as
                            a bare number with no way to check it — an operator
                            disputing a statement had to go and look the licence
                            up. `revenue_share_bps` is already ON the row
                            (`admin_statements.ts` writes it beside the owed
                            cents precisely so the statement records the rate it
                            was drawn at), so this renders a fact the payload
                            carried and nothing showed.

                            A LICENCE WHOSE RATE IS ABSENT PRINTS NO RATE rather
                            than "0%" — `bpsPercent` returns null and the clause
                            drops, the same rule `zoneFilterBuilder`'s counts
                            follow. A zero here would say HQ is owed nothing. */}
                        <div className="mt-0.5 text-[10.5px] tabular-nums text-axal-faint">
                          {s.period} · owed {money(s.owed_cents, s.currency)}
                          {bpsPercent(s.revenue_share_bps) && ` (× ${bpsPercent(s.revenue_share_bps)})`}
                          {' · paid '}{money(s.paid_cents, s.currency)}
                          {s.disputed_cents > 0 && ` · ${money(s.disputed_cents, s.currency)} disputed`}
                        </div>
                        {/* A FLOOR IS NOT A TOTAL, and it is said on the row
                            rather than in a legend under the table, because
                            the figure it qualifies is on this line. */}
                        {!s.complete && (
                          <div className="mt-0.5 text-[10.5px] text-amber-700 dark:text-amber-300">
                            {s.unreported_streams > 0
                              ? `${s.unreported_streams} stream${s.unreported_streams === 1 ? '' : 's'} unreported — this owed figure is a floor, not a total.`
                              : 'Drawn over an estimated stream — not an invoiced figure.'}
                          </div>
                        )}
                        <StatementFacts statement={s} />
                      </div>
                      <span className={STATEMENT_PILL[s.status] || STATEMENT_PILL.draft}>{s.status}</span>
                      </div>
                      <StatementActions statement={s} onUpdate={updateStatement} />
                    </div>
                  ))}
                </div>
              )}
              {ledger && ledger.items.length === 0 && (
                <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-statements-empty">
                  No statement has been drawn for {ledger.current_period}. The store exists and is empty,
                  which is not the same as a figure nobody can produce. Drawing is held for the owner&apos;s
                  decision (above). Every stream a branch reports today still arrives unmeasured until
                  gross exists locally.
                </p>
              )}
              {ledger && Object.keys(ledger.totals_by_currency).length > 0 && (
                <div className="mt-3 space-y-1" data-testid="hq-revenue-owed">
                  {Object.entries(ledger.totals_by_currency).map(([cur, t]) => {
                    const floors = floorsInCurrency(ledger.items, cur);
                    return (
                      <div key={cur} className="text-[11.5px]">
                        <div className="flex items-baseline justify-between">
                          <span className="text-axal-faint">Owed in {cur}</span>
                          <span className="font-bold tabular-nums">
                            {money(t.owed, cur)} · {money(t.paid, cur)} paid
                          </span>
                        </div>
                        {/* D514 — a statement drawn over nothing measured
                            stores gross 0, so a line summing floors is a
                            floor too, and says so. */}
                        {floors > 0 && (
                          <p className="text-[10.5px] text-amber-700 dark:text-amber-300" data-testid={`hq-revenue-owed-floor-${cur}`}>
                            Includes {floors} {floors === 1 ? 'statement' : 'statements'} drawn over unreported or estimated streams, so this is a floor, not a total.
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {/* Same rule as the stream table above: per currency, never
                      one figure. */}
                  <p className="text-[10.5px] text-axal-faint">One line per currency — statements are not summed across them.</p>
                </div>
              )}
              {statements !== UNAVAILABLE && statements && !statements.available && (
                <Absent reason={statements.reason} />
              )}
              {statements === UNAVAILABLE && (
                <div className="mb-2">
                  <Unreadable
                    what="The statement ledger"
                    claim="This is not a claim that nothing is owed."
                    onRetry={loadStatements}
                  />
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label="Open disputes"
                  value={openDisputes === null ? null : num(openDisputes)}
                  note={disputes === UNAVAILABLE ? 'Stripe could not be read' : 'from Stripe, not the local ledger'}
                  tone={openDisputes ? 'text-red-700 dark:text-red-300' : 'text-axal-ink'}
                />
                <Stat
                  label="Statements drawn"
                  value={ledger ? num(ledger.items.length) : null}
                  note={ledger ? `newest first · current period ${ledger.current_period}` : 'the ledger could not be read'}
                />
              </div>
              {disputes === UNAVAILABLE && (
                <div className="mt-2">
                  <Unreadable
                    what="Open disputes"
                    claim="This is not a claim that there are none."
                    onRetry={loadDisputes}
                  />
                </div>
              )}
            </Zone>
          </div>

          <BillingExceptions
            refunds={refunds}
            disputes={disputes}
            nowSec={Math.floor(Date.now() / 1000)}
            onRetryRefunds={loadRefunds}
            onRetryDisputes={loadDisputes}
            refundForm={<RefundReviewFlow onDone={loadRefunds} />}
          />

          <Zone title="Promotions" sub="the ceiling HQ sets, and the codes it cannot attribute">
            {promos?.available ? (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Stat label="Active codes" value={num(promos.active_codes)} note="switched on, unexpired, under their recorded cap" />
                <Stat label="Redemptions" value={num(promos.redemptions)} note="recorded here, across active codes" />
                <Stat
                  label="Ceilings set"
                  value={ceilingRows ? num(ceilingRows.length) : null}
                  note={ceilingRows ? 'one per licence per period' : 'the ceilings could not be read'}
                />
              </div>
            ) : (
              <Absent reason={promos?.reason || 'The promotion codes could not be read.'} />
            )}

            {ceilingRows && ceilingRows.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      <th className="py-1.5 pr-3">Licence</th>
                      <th className="py-1.5 pr-3">Period</th>
                      <th className="py-1.5 pr-3">Ceiling</th>
                      <th className="py-1.5 pr-3">At the branch</th>
                      <th className="py-1.5 pr-3">Issued</th>
                      <th className="py-1.5">Remaining</th>
                    </tr>
                  </thead>
                  <tbody data-testid="hq-revenue-ceilings">
                    {ceilingRows.map((x) => {
                      const facts = ceilingFacts(x, ceilings?.current_period);
                      return (
                        <tr key={`${x.licence_uid}:${x.period}`} className="border-b border-axal-hairline/60 align-top">
                          <td className="py-2 pr-3 font-medium">{x.brand_name || x.licence_ref || x.licence_uid}</td>
                          <td className="py-2 pr-3 tabular-nums">{x.period}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {money(x.ceiling_cents, x.currency)}
                            <div className="text-[10.5px] font-normal text-axal-faint">{facts.saved.label}</div>
                          </td>
                          <td className="py-2 pr-3 text-[11.5px]" data-testid={`hq-revenue-ceiling-state-${x.licence_uid}-${x.period}`}>
                            <div>{facts.pushed.label}</div>
                            <div className="text-axal-faint">{facts.enforced.label}</div>
                          </td>
                          {/* NULL ISSUED IS NOT ZERO ISSUED, AND GIVES NO REMAINING. HQ's copy is only what a branch
                              reports to it; with none, a zero here would say the whole ceiling is still available, and a
                              remaining worked out from nothing would say the same. */}
                          <td className="py-2 pr-3 tabular-nums">
                            {facts.issued.known ? (
                              <>{money(x.issued_cents, x.currency)}<div className="text-[10.5px] text-axal-faint">{facts.issued.label}</div></>
                            ) : <Unrecorded />}
                          </td>
                          <td className="py-2 tabular-nums">
                            {facts.remaining.known ? money(x.remaining_cents, x.currency) : <Unrecorded />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-revenue-issued-note">
                  Issued and Remaining are what the branch has reported to HQ, and the branch does not report them
                  automatically: the branch counts what it gives and enforces the ceiling itself, but HQ's copy stays
                  Not recorded until a report arrives. An absent figure is not the same as having issued nothing, and
                  no Remaining is worked out from one.
                </p>
              </div>
            )}
            {ceilingRows && ceilingRows.length === 0 && (
              <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-ceilings-empty">
                No ceiling has been set. Setting one stores it at HQ and pushes it to the branch if a
                deployment is bound to that licence; whether the push landed is reported separately from
                whether the ceiling was saved.
              </p>
            )}
            {ceilings !== UNAVAILABLE && ceilings && !ceilings.available && (
              <div className="mt-3"><Absent reason={ceilings.reason} /></div>
            )}
            {ceilings === UNAVAILABLE && (
              <div className="mt-3">
                <Unreadable
                  what="The promo ceilings"
                  claim="This is not a claim that none are set."
                  onRetry={loadCeilings}
                />
              </div>
            )}
            {promos?.available && (
              <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted">{promos.budget_reason}</p>
            )}
            <CeilingEditor
              licences={licences}
              currentPeriod={ceilings && ceilings !== UNAVAILABLE ? ceilings.current_period : ''}
              onSave={saveCeiling}
            />
          </Zone>
        </div>
      </div>

    </RailFrame>
  );
}
