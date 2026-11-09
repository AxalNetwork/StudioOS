import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { parseMinor } from '../../../lib/money.js';
import { REFUND_REASON_MIN, refundReasonOk } from '../../../lib/refundReason';
import { Unreadable } from '../../../ui';
import { Figure, StateMark, Section, When, Why, TABLE, TD, TH, NUM } from './RevenueStates.jsx';
import {
  UNAVAILABLE, dayOf, evidenceDueSoon, evidenceOverdue, isReady, money, openDisputes,
} from './revenueModel.js';

/**
 * D5039 (canvas RV08) — Billing exceptions: actionable anomalies only. Open
 * Stripe disputes (Live) and the refunds HQ issued (Last 30 days), each block
 * with its own loading, unreadable and empty state, so one failed read leaves
 * the other. LTV and the per-branch token margin moved out (the canvas: they
 * are analytics, not exceptions).
 *
 * THE REFUND IS TODAY'S CONTROL, UNCHANGED (D224): HQ's super admin, after a
 * step-up, with a written reason; the request helper runs the challenge and
 * the Worker is the gate. The five-step Lookup → Review → Confirm → Step-up →
 * Result flow (RV09) waits on #5037's read-only payment lookup and is the next
 * slice of #5039.
 *
 * Pure over its props so every state renders in a test: `refunds` and
 * `disputes` are each null (loading), UNAVAILABLE (the read failed) or the
 * endpoint's payload.
 */
/** A Stripe or refund status as itself: glyph and word, not one of the value states. */
function Status({ glyph, children }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[12px] font-semibold leading-none text-axal-muted dark:border-gray-700 dark:text-gray-300">
      <span aria-hidden="true">{glyph}</span>{children}
    </span>
  );
}

export function BillingExceptions({ refunds, disputes, nowSec, onRetryRefunds, onRetryDisputes, onWhy, refundForm = null }) {
  const refundsReady = isReady(refunds) && refunds.available;
  const open = openDisputes(disputes);

  const rows = [
    ...(open ? open.map((d) => {
      const overdue = evidenceOverdue(d, nowSec);
      const soon = evidenceDueSoon(d, nowSec);
      const due = Number(d.due_by) > 0 ? new Date(Number(d.due_by) * 1000).toISOString().slice(0, 10) : null;
      return {
        key: `d:${d.id}`,
        kind: 'dispute',
        title: overdue ? 'Dispute · evidence overdue' : (d.has_evidence ? 'Dispute · evidence submitted' : 'Dispute · evidence needed'),
        sub: d.reason ? `Reason: ${String(d.reason).replace(/_/g, ' ')}` : null,
        who: d.payment_intent || d.charge || null,
        amount: money(d.amount, String(d.currency || '').toUpperCase()),
        when: <><When kind="live" />{due && <span className="ml-1.5 font-mono text-[12.5px]">{overdue ? `was due ${due}` : `due ${due}`}</span>}</>,
        status: overdue ? <StateMark state="unavailable" label="Evidence overdue" /> : (soon ? <StateMark state="incomplete" label="Evidence due soon" /> : <Status glyph="◷">{String(d.status || 'open').replace(/_/g, ' ')}</Status>),
        disputeId: d.id,
      };
    }) : []),
    ...(refundsReady ? refunds.items.map((r) => ({
      key: `r:${r.audit_id}`,
      kind: 'refund',
      title: `Refund · ${money(r.amount_cents, r.currency) || 'amount not recorded'}`,
      sub: r.reason,
      who: r.target_user_id ? `Account #${r.target_user_id}` : null,
      amount: money(r.amount_cents, r.currency),
      when: <><When kind="d30" />{dayOf(r.issued_at) && <span className="ml-1.5 font-mono text-[12.5px]">{dayOf(r.issued_at)}</span>}</>,
      status: r.status === 'succeeded' ? <Status glyph="✓">Refunded</Status>
        : (r.status ? <Status glyph="◷">{r.status}</Status> : <StateMark state="not_recorded" label="Status not recorded" />),
    })) : []),
  ];

  return (
    <Section
      id="revenue-exceptions"
      title="Billing exceptions"
      sub="Actionable anomalies only"
      testId="hq-revenue-exceptions-section"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-exceptions-tiles">
        <span className="inline-flex items-center gap-1.5">
          Open disputes <When kind="live" />
          <Figure figure={open ? { state: open.length ? 'recorded' : 'zero', text: open.length.toLocaleString() } : { state: disputes === UNAVAILABLE ? 'unavailable' : 'loading', text: null }} />
          {open && open.filter((d) => evidenceOverdue(d, nowSec)).length > 0 && <span>· {open.filter((d) => evidenceOverdue(d, nowSec)).length} past evidence deadline</span>}
        </span>
        <span className="inline-flex items-center gap-1.5">
          Refunds through HQ <When kind="d30" />
          <Figure figure={refundsReady
            ? { state: refunds.count ? 'recorded' : 'zero', text: refunds.count.toLocaleString() }
            : { state: refunds && refunds !== UNAVAILABLE && !refunds.available ? 'unavailable' : (refunds === UNAVAILABLE ? 'unavailable' : 'loading'), text: null }} />
          {refundsReady && refunds.by_currency.length > 0 && <span>· {refunds.by_currency.map((b) => money(b.amount_cents, b.currency)).join(' · ')}</span>}
        </span>
        <Why source="refunds" onOpen={onWhy} label="Sources" />
      </div>

      {refunds === UNAVAILABLE && (
        <div className="mb-2" data-testid="hq-revenue-refunds-unreadable">
          <Unreadable what="The refunds HQ issued" claim="This is not a claim that none were issued." onRetry={onRetryRefunds} />
        </div>
      )}
      {refunds && refunds !== UNAVAILABLE && !refunds.available && (
        <p className="mb-2 text-[13px] text-axal-muted dark:text-gray-400"><StateMark state="unavailable" /> {refunds.reason}</p>
      )}
      {disputes === UNAVAILABLE && (
        <div className="mb-2" data-testid="hq-revenue-disputes-unreadable">
          <Unreadable what="Open disputes" claim="This is not a claim that there are none." onRetry={onRetryDisputes} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Billing exceptions: open disputes and refunds HQ issued in the last 30 days</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Exception</th>
                <th scope="col" className={TH}>Payment or account</th>
                <th scope="col" className={`${TH} ${NUM}`}>Amount</th>
                <th scope="col" className={TH}>When</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-exceptions">
              {rows.map((r) => (
                <tr key={r.key} data-kind={r.kind}>
                  <td className={TD}><b>{r.title}</b>{r.sub && <small className="block text-[12.5px] text-axal-muted dark:text-gray-400">{r.sub}</small>}</td>
                  <td className={`${TD} font-mono text-[12.5px]`}>{r.who ?? <StateMark state="not_recorded" />}</td>
                  <td className={`${TD} ${NUM} font-mono`}>{r.amount ?? <StateMark state="not_recorded" />}</td>
                  <td className={`${TD} whitespace-nowrap`}>{r.when}</td>
                  <td className={TD}>{r.status}</td>
                  <td className={`${TD} text-right`}>
                    {r.disputeId && (
                      <Link to={`/admin/revenue/disputes/${encodeURIComponent(r.disputeId)}`} className="inline-flex min-h-[32px] items-center rounded-lg border border-axal-hairline px-3 text-[13px] font-bold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800" data-testid="hq-revenue-dispute-link">
                        Review dispute
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {refundsReady && open && rows.length === 0 && (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-exceptions-empty">
          No refund was issued through HQ in the last {refunds.window_days} days and no dispute is open in Stripe.
        </p>
      )}
      <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400">
        Dispute evidence is filed on the <Link to="/admin/revenue/billing" className="font-semibold underline">Billing tab</Link>.
        A refund made in the Stripe dashboard is not listed.
      </p>
      {refundForm && (
        <details className="mt-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
          <summary className="cursor-pointer text-[13px] font-bold text-axal-ink dark:text-gray-100">Refund a payment… · step-up</summary>
          {refundForm}
        </details>
      )}
    </Section>
  );
}

/**
 * The refund, as HQ's governed action (D224). The worker is the gate — TOTP
 * session, fresh step-up, the elevation, a written reason — and the request
 * helper runs the step-up challenge; this form only refuses early what the
 * worker would refuse anyway.
 */
/** The refund amount as typed, checked for shape only (positive, digits and a point); the currency decides the rest. */
export function refundAmountShape(text) {
  const r = parseMinor(text, 'KWD'); // the widest exponent: a shape check, never the conversion
  if (!r.ok && r.reason !== 'decimals') return { ok: false, message: 'Enter the amount as a positive figure, such as 25 or 25.50.' };
  if (r.ok && r.minor <= 0) return { ok: false, message: 'The amount must be a positive figure.' };
  return { ok: true, text: String(text).trim() };
}

export function RefundForm({ onDone }) {
  const [f, setF] = useState({ target: '', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const target = f.target.trim();
    if (!target) { setMsg({ err: true, text: 'Enter a PaymentIntent (pi_…) or Charge (ch_…) id.' }); return; }
    if (!refundReasonOk(f.reason)) { setMsg({ err: true, text: `Write why this money goes back, in at least ${REFUND_REASON_MIN} characters.` }); return; }
    const body = { reason: f.reason.trim() };
    if (target.startsWith('ch_')) body.charge = target; else body.payment_intent = target;
    if (f.amount !== '') {
      // D5029: this form is given a Stripe id, not a currency, so it cannot turn the figure into minor units. It
      // sends what was typed, as major units, and the worker converts it in the charge's own currency (and refuses
      // an amount that currency cannot hold, such as cents of a yen). The shape is checked here so a typo is
      // caught before the round trip; how many decimals are allowed is the currency's, and the worker's to say.
      const shape = refundAmountShape(f.amount);
      if (!shape.ok) { setMsg({ err: true, text: shape.message }); return; }
      body.amount_major = shape.text;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await api.adminBillingRefund(body);
      setMsg({ err: false, text: `Refund ${r.refund?.id || ''} ${r.refund?.status || 'issued'}.`.replace(/\s+/g, ' ') });
      setF({ target: '', amount: '', reason: '' });
      onDone?.();
    } catch (err) {
      const d = err?.data || {};
      setMsg({ err: true, text: d.code === 'refund_policy_blocked'
        ? `Blocked by the product refund policy (${d.reason || d.kind}). An override is on the Billing tab.`
        : (d.error || err.message || 'The refund was not issued.') });
    } finally {
      setBusy(false);
    }
  };
  const input = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px]';
  return (
    <form onSubmit={submit} className="mt-4 grid gap-2 border-t border-axal-hairline pt-3 sm:grid-cols-2" data-testid="hq-revenue-refund-form">
      <div className="sm:col-span-2 text-[12px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Issue a refund · step-up</div>
      <input className={input} placeholder="pi_… or ch_…" value={f.target} onChange={(e) => set('target', e.target.value)} aria-label="PaymentIntent or Charge id" />
      <input className={input} type="text" inputMode="decimal" autoComplete="off" placeholder="Amount (blank refunds the rest)" value={f.amount} onChange={(e) => set('amount', e.target.value)} aria-label="Amount" />
      <textarea className={`${input} sm:col-span-2`} rows={2} required minLength={REFUND_REASON_MIN} placeholder="Why this money goes back — read by whoever audits it" value={f.reason} onChange={(e) => set('reason', e.target.value)} aria-label="Reason" />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
          {busy ? 'Issuing…' : 'Refund'}
        </button>
        <span className="text-[12px] text-axal-faint">Asks for your second factor, then writes one audit row.</span>
        {msg && <span className={`text-[12px] ${msg.err ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}