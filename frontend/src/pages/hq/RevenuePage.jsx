/**
 * HQ · Revenue — canvas H5, "the money rails, and the token P&L".
 *
 * FIVE ZONES, AND NOW THREE OF THEM HAVE A STORE. That is the fact this page
 * is built around, and it has moved once: D111 gave statements and promo
 * ceilings a real ledger, so two zones that used to carry a stated refusal
 * now carry figures. What has NOT moved is the token line, and the page says
 * which is which.
 *
 *   By stream          licence fees are real; subscriptions cannot be
 *                      totalled; the token line is a cost with no price.
 *   Token P&L by sub.  U1 — nothing ties spend to a licence.
 *   Statements         REAL (migration 260) — one row per subsidiary per
 *                      period, owed computed from the branch's reported
 *                      gross, paid and disputed entered by HQ. Read from its
 *                      OWN endpoint, so a slow ledger costs this zone only.
 *   Open disputes      real, and read from its OWN endpoint so that Stripe
 *                      being slow or down costs this zone and not the page.
 *   Promo ceilings     REAL — HQ sets a ceiling per licence per period, here
 *                      since D228 (the editor under the list), and pushes it
 *                      to the branch. Nothing at checkout enforces it yet, and
 *                      the editor says so. What is still absent is the
 *                      ISSUED figure when a branch has not reported one, and
 *                      a null there is not a zero.
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
import { bpsPercent } from '../../lib/bps';
import { reportError } from '../../lib/log';
import { REFUND_REASON_MIN, refundReasonOk } from '../../lib/refundReason';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

export const UNAVAILABLE = Symbol('unavailable');

/** A number, or null when there is not one. Never a default. */
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());

/** Minor units to a readable amount, in the currency the row is denominated in. */
function money(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0,
    }).format(Number(cents) / 100);
  } catch {
    // An unknown ISO code must not blank the figure — show the number and
    // name the currency beside it rather than dropping a real amount.
    return `${(Number(cents) / 100).toLocaleString()} ${currency || ''}`.trim();
  }
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
  tokenMargin: 'Gateway cost is an estimate, not a ledger, and no price is recorded beside it.',
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
                  <td className="py-2 pr-3">{r.kind}</td>
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
        Dispute evidence is filed on the <Link to="/admin?tab=billing" className="underline">Billing tab</Link>.
      </p>

      {refundForm}
    </Zone>
  );
}

/**
 * The refund, as HQ's governed action (D224). The worker is the gate — TOTP
 * session, fresh step-up, the elevation, a written reason — and the request
 * helper runs the step-up challenge; this form only refuses early what the
 * worker would refuse anyway.
 */
function RefundForm({ onDone }) {
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
      // Minor units, an integer, as Stripe and the worker take it.
      const cents = Math.round(Number(f.amount) * 100);
      if (!Number.isInteger(cents) || cents <= 0) { setMsg({ err: true, text: 'The amount must be a positive figure.' }); return; }
      body.amount = cents;
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
      <div className="sm:col-span-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Issue a refund · step-up</div>
      <input className={input} placeholder="pi_… or ch_…" value={f.target} onChange={(e) => set('target', e.target.value)} aria-label="PaymentIntent or Charge id" />
      <input className={input} type="number" step="0.01" min="0" placeholder="Amount (blank refunds the rest)" value={f.amount} onChange={(e) => set('amount', e.target.value)} aria-label="Amount" />
      <textarea className={`${input} sm:col-span-2`} rows={2} required minLength={REFUND_REASON_MIN} placeholder="Why this money goes back — read by whoever audits it" value={f.reason} onChange={(e) => set('reason', e.target.value)} aria-label="Reason" />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
          {busy ? 'Issuing…' : 'Refund'}
        </button>
        <span className="text-[11px] text-axal-faint">Asks for your second factor, then writes one audit row.</span>
        {msg && <span className={`text-[11.5px] ${msg.err ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

/**
 * D228 — what the ceiling editor sends, or why it will not. Pure, so a test
 * can put a form through it. Money leaves as integer minor units; a blank or
 * unreadable amount is refused rather than sent as 0, because the worker
 * would (since D228) refuse it too and a 0 ceiling is a real instruction.
 */
export function ceilingPayload({ licenceUid, period, amount, currency }) {
  if (!licenceUid) return { error: 'Choose the licence this ceiling is for.' };
  if (!/^\d{4}-Q[1-4]$/.test(String(period || ''))) return { error: 'The period is a quarter, written YYYY-Qn.' };
  const text = String(amount ?? '').trim();
  if (text === '') return { error: 'Enter the ceiling. 0 is a ceiling: no promotions this period.' };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return { error: 'The ceiling must be a figure of 0 or more.' };
  const cents = Math.round(n * 100);
  const cur = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return { error: 'The currency is a three-letter code, such as EUR.' };
  return { licenceUid, body: { period: String(period), ceiling_cents: cents, currency: cur } };
}

/** Said on the editor, because nothing in checkout reads a ceiling yet. */
export const CEILING_NOT_ENFORCED =
  'Setting a ceiling records it at HQ and pushes it to the branch. Nothing at checkout checks a '
  + 'code against it yet: a branch can issue past its ceiling and no payment is refused because of it.';

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
      <p className="mt-1 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300" data-testid="hq-revenue-ceiling-not-enforced">
        {CEILING_NOT_ENFORCED}
      </p>
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
          <input className={`${input} sm:col-span-2`} type="number" step="0.01" min="0" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Ceiling for the period" aria-label="Ceiling" />
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

export default function RevenuePage() {
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
    api.hqRevenue().then(setData, (e) => { reportError('hq-revenue', e); setData(UNAVAILABLE); });
  }, []);
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
    api.licences().then((r) => setLicences(Array.isArray(r?.items) ? r.items : UNAVAILABLE), (e) => {
      reportError('hq-revenue-licences', e);
      setLicences(UNAVAILABLE);
    });
  }, []);
  const saveCeiling = useCallback(async (uid, body) => {
    const r = await api.promoCeilingSet(uid, body);
    loadCeilings();
    return r;
  }, [loadCeilings]);
  useEffect(() => {
    load(); loadDisputes(); loadStatements(); loadCeilings(); loadRefunds(); loadLicences();
  }, [load, loadDisputes, loadStatements, loadCeilings, loadRefunds, loadLicences]);

  const ready = data && data !== UNAVAILABLE;
  const fees = ready ? data.licence_fees : null;
  const token = ready ? data.token_cost : null;
  const promos = ready ? data.promos : null;
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
      ? `${num(token.calls)} AI calls this quarter, at cost` : null,
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
      note="This rail summarises licence fees, AI cost, branch statements, promo ceilings, refunds and open disputes. It enters no payment and settles no statement; the page's one money action is a refund, which HQ's super admin issues after a step-up with a written reason."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === UNAVAILABLE ? 'The revenue summary could not be read, so there is nothing to read back — this is not a claim that no revenue was booked.'
          : 'Loading the revenue summary…')}
      unavailable={[
        ['Subscription revenue', 'No local charge ledger; Stripe is read per customer.'],
        ['Token margin', 'The cost of a call is recorded, the price charged for it is not.'],
        ['LTV', NOT_RECORDED_H21.ltv],
        ['Token P&L per subsidiary', 'No account names its licence yet (U1).'],
        // Statements and ceilings came OFF this list in D111, because they
        // acquired a store. What is left absent is the issued figure a branch
        // has not reported, which is a per-row state rather than a zone's.
        ['Promotional spend per code', 'A code names no subsidiary, so a branch reports its own issued figure.'],
      ]}
      data-testid="hq-revenue-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-revenue-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#14532d] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          {/* The canvas puts a single platform-revenue figure here. Two
              currencies and a USD cost cannot be added into one, so the
              quarter is stated and the money is left in its own rows. */}
          <span className="text-[11px] opacity-80 tabular-nums">
            {ready ? `${data.quarter.label} · streams shown separately, not summed` : '…'}
          </span>
        </div>

        <header className="mt-4">
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
                      <th className="py-1.5 pr-3">This quarter</th>
                      <th className="py-1.5 pr-3">Cost</th>
                      <th className="py-1.5">Read</th>
                    </tr>
                  </thead>
                  <tbody data-testid="hq-revenue-streams">
                    {fees.by_currency.map((row) => (
                      <tr key={row.currency} className="border-b border-axal-hairline/60">
                        <td className="py-2 pr-3 font-medium">Licence fees · {row.currency}</td>
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
                      <td className="py-2 pr-3"><Unrecorded /></td>
                      <td className="py-2 pr-3 tabular-nums">
                        {token?.available ? usd(token.cost_usd) : <Unrecorded />}
                      </td>
                      <td className="py-2 text-[11.5px] text-axal-muted">
                        {token?.available ? token.billed_reason : (token?.reason || null)}
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

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Token P&L by subsidiary" sub="what it cost against what it billed">
              <Absent reason={ready ? data.derived_metrics_reason : 'The revenue summary could not be read.'} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label="Token cost, platform-wide"
                  value={token?.available ? usd(token.cost_usd) : null}
                  note={token?.available ? `${num(token.calls)} calls this quarter · USD` : (token?.reason || 'unreadable')}
                />
                <Stat label="Margin" value={null} note="no price is recorded to subtract the cost from" />
              </div>
            </Zone>

            <Zone title="Statements and Stripe" sub="what is owed, and what is stuck">
              {ledger && ledger.items.length > 0 && (
                <div className="space-y-2" data-testid="hq-revenue-statements">
                  {ledger.items.map((s) => (
                    <div
                      key={s.uid}
                      className="flex items-center justify-between gap-3 rounded-xl border border-axal-hairline bg-axal-ground p-2.5"
                    >
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
                      </div>
                      <span className={STATEMENT_PILL[s.status] || STATEMENT_PILL.draft}>{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
              {ledger && ledger.items.length === 0 && (
                <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-statements-empty">
                  No statement has been drawn. The store exists and is empty, which is not the same as a
                  figure nobody can produce: draw one for {ledger.current_period} from what the branches
                  have reported.
                </p>
              )}
              {ledger && Object.keys(ledger.totals_by_currency).length > 0 && (
                <div className="mt-3 space-y-1" data-testid="hq-revenue-owed">
                  {Object.entries(ledger.totals_by_currency).map(([cur, t]) => (
                    <div key={cur} className="flex items-baseline justify-between text-[11.5px]">
                      <span className="text-axal-faint">Owed in {cur}</span>
                      <span className="font-bold tabular-nums">
                        {money(t.owed, cur)} · {money(t.paid, cur)} paid
                      </span>
                    </div>
                  ))}
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
            refundForm={<RefundForm onDone={loadRefunds} />}
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
                      <th className="py-1.5 pr-3">Issued</th>
                      <th className="py-1.5">Remaining</th>
                    </tr>
                  </thead>
                  <tbody data-testid="hq-revenue-ceilings">
                    {ceilingRows.map((x) => (
                      <tr key={`${x.licence_uid}:${x.period}`} className="border-b border-axal-hairline/60">
                        <td className="py-2 pr-3 font-medium">{x.brand_name || x.licence_ref || x.licence_uid}</td>
                        <td className="py-2 pr-3 tabular-nums">{x.period}</td>
                        <td className="py-2 pr-3 tabular-nums">{money(x.ceiling_cents, x.currency)}</td>
                        {/* NULL ISSUED IS NOT ZERO ISSUED. A branch that has
                            not reported reads as <Unrecorded/>, because a zero
                            here would say the whole ceiling is still
                            available — the one wrong number this zone can
                            produce. */}
                        <td className="py-2 pr-3 tabular-nums">
                          {x.issued_available ? money(x.issued_cents, x.currency) : <Unrecorded />}
                        </td>
                        <td className="py-2 tabular-nums">
                          {x.issued_available ? money(x.remaining_cents, x.currency) : <Unrecorded />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-revenue-issued-note">
                  An issued figure is reported by the branch. Where one is absent the branch has not said,
                  which is not the same as having issued nothing.
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

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
