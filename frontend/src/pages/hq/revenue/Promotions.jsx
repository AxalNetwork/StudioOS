import React, { useState } from 'react';
import { Unreadable } from '../../../ui';
import { currencyCode, parseMinor } from '../../../lib/money.js';
import { StateMark, Section, When, Why, TABLE, TD, TH, NUM } from './RevenueStates.jsx';
import { STATEMENT_PERIOD_RE } from './StatementActions.jsx';
import {
  UNAVAILABLE, ceilingFacts, isReady, licencesWithoutCeiling, money, pendingState, periodLabel, promoReporting,
} from './revenueModel.js';

/**
 * D5039 (canvas RV10) — Promotions as badge columns: what HQ saved, whether
 * the branch holds the latest figure, whether it is enforced, what the branch
 * reported it issued, what remains, and how fresh that report is. A licence
 * with no ceiling for the period gets the compact state, never a paragraph.
 *
 * REMAINING IS NEVER WORKED OUT FROM AN UNREPORTED ISSUED FIGURE: it is the
 * Worker's, and drawn only when `ceilingFacts` says an issued figure exists
 * (D5028). "Enforced" is read from an accepted push; the branch reports no
 * enforcement back, which the coverage drawer says once.
 *
 * The ceiling editor (D228) is today's write, moved here unchanged.
 */

/**
 * D228 — what the ceiling editor sends, or why it will not. Pure, so a test
 * can put a form through it. Money leaves as integer minor units; a blank or
 * unreadable amount is refused rather than sent as 0, because the worker
 * would (since D228) refuse it too and a 0 ceiling is a real instruction.
 */
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
      <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Set a ceiling</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-revenue-ceiling-enforcement">
        {CEILING_ENFORCEMENT.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {licences === UNAVAILABLE && (
        <div className="mt-2">
          <Unreadable what="The licence list" claim="No ceiling can be set until it is read; this is not a claim that there are no licences." />
        </div>
      )}
      {licences === null && <p className="mt-2 text-[12px] text-axal-faint">Loading the licences…</p>}
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
            <p role="status" className={`sm:col-span-4 text-[12px] ${msg.err ? 'text-red-700 dark:text-red-300' : (msg.warn ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}`}>
              {msg.text}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

const BADGE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold leading-none';
const OK = `${BADGE} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200`;
const WARN = `${BADGE} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200`;
const PLAIN = `${BADGE} border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300`;
const HQ = `${BADGE} border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200`;

/** The Branch and Enforcement badges: glyph and word, the long sentence as their title. */
function branchBadge(facts) {
  return facts.pushed.yes
    ? <span className={OK} title={facts.pushed.label}><span aria-hidden="true">✓</span> Branch synced</span>
    : <span className={WARN} title={facts.pushed.label}><span aria-hidden="true">▲</span> Not synced</span>;
}
function enforcementBadge(facts) {
  const s = facts.enforced.state;
  if (s === 'enforced') return <span className={OK} title={facts.enforced.label}><span aria-hidden="true">✓</span> Enforced</span>;
  if (s === 'other_period') return <span className={PLAIN} title={facts.enforced.label}><span aria-hidden="true">–</span> Not this quarter</span>;
  if (s === 'earlier_figure') return <span className={WARN} title={facts.enforced.label}><span aria-hidden="true">◐</span> Earlier figure enforced</span>;
  return <span className={PLAIN} title={facts.enforced.label}><span aria-hidden="true">○</span> Not enforced</span>;
}

export function PromotionsSection({ summary, ceilings, coverage, period, licenceUid, licences, onSave, onRetry, onWhy }) {
  const promos = isReady(summary) ? summary.promos : null;
  const ready = isReady(ceilings) && ceilings.available;
  const currentPeriod = ready ? ceilings.current_period : null;
  const rows = ready ? (ceilings.items || []).filter((x) => x.period === period && (!licenceUid || x.licence_uid === licenceUid)) : null;
  const none = licencesWithoutCeiling({ coverage, ceilings, period, licenceUid });
  const nowMs = Date.now();
  return (
    <Section
      id="revenue-promotions"
      title="Promotions"
      when={<When kind="period" period={period} />}
      sub="Ceilings per licence; branches enforce them at checkout"
      testId="hq-revenue-promotions"
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-promo-codes">
        <When kind="now" />
        {promos?.available
          ? <span>{promos.active_codes.toLocaleString()} active {promos.active_codes === 1 ? 'code' : 'codes'} (switched on, unexpired, under their recorded cap) · {promos.redemptions.toLocaleString()} redemptions recorded across them</span>
          : (isReady(summary) ? <StateMark state="unavailable" label="Promotion codes unavailable" /> : <StateMark state={pendingState(summary)} />)}
        <Why source="promotions" onOpen={onWhy} />
      </p>

      {!ready && (
        isReady(ceilings)
          ? <StateMark state="unavailable" label="Ceilings unavailable" />
          : (ceilings === UNAVAILABLE
            ? <Unreadable what="The promo ceilings" claim="This is not a claim that none are set." onRetry={onRetry} />
            : <StateMark state="loading" />)
      )}

      {ready && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Promotion ceilings for {periodLabel(period)}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Licence</th>
                <th scope="col" className={TH}>Period</th>
                <th scope="col" className={`${TH} ${NUM}`}>Ceiling</th>
                <th scope="col" className={TH}>HQ</th>
                <th scope="col" className={TH}>Branch</th>
                <th scope="col" className={TH}>Enforcement</th>
                <th scope="col" className={`${TH} ${NUM}`}>Issued</th>
                <th scope="col" className={`${TH} ${NUM}`}>Remaining</th>
                <th scope="col" className={TH}>Reporting</th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-ceilings">
              {rows.map((x) => {
                const facts = ceilingFacts(x, ceilings?.current_period);
                const reporting = promoReporting(x, currentPeriod, nowMs);
                return (
                  <tr key={`${x.licence_uid}:${x.period}`} data-testid={`hq-revenue-ceiling-state-${x.licence_uid}-${x.period}`}>
                    <td className={TD}><b>{x.brand_name || x.licence_ref || x.licence_uid}</b></td>
                    <td className={`${TD} whitespace-nowrap`}>{periodLabel(x.period) || x.period}</td>
                    <td className={`${TD} ${NUM} font-mono`}>{money(x.ceiling_cents, x.currency)}</td>
                    <td className={TD}><span className={HQ} title={facts.saved.label}>HQ saved</span></td>
                    <td className={TD}>{branchBadge(facts)}</td>
                    <td className={TD}>{enforcementBadge(facts)}</td>
                    {/* NULL ISSUED IS NOT ZERO ISSUED, AND GIVES NO REMAINING. HQ's copy is only what a branch reports. */}
                    <td className={`${TD} ${NUM} font-mono`}>
                      {facts.issued.known ? money(x.issued_cents, x.currency) : <StateMark state="not_reported" />}
                    </td>
                    <td className={`${TD} ${NUM} font-mono`}>
                      {facts.remaining.known ? money(x.remaining_cents, x.currency) : <StateMark state="not_recorded" />}
                    </td>
                    <td className={TD}><StateMark state={reporting.state} label={reporting.text} /></td>
                  </tr>
                );
              })}
              {(none || []).map((l) => (
                <tr key={`none:${l.licence_uid}`} data-testid={`hq-revenue-no-ceiling-${l.licence_uid}`}>
                  <td className={TD}><b>{l.name}</b></td>
                  <td className={`${TD} whitespace-nowrap`}>{periodLabel(period)}</td>
                  <td className={TD} colSpan={7}>
                    <span className={PLAIN}><span aria-hidden="true">○</span> No ceiling configured</span>
                    {period === currentPeriod && <span className="ml-1.5 text-[13px] text-axal-muted dark:text-gray-400">· Discounts currently allowed</span>}
                  </td>
                </tr>
              ))}
              {!rows.length && none && !none.length && (
                <tr><td className={`${TD} text-axal-muted dark:text-gray-400`} colSpan={9}>No licence to set a ceiling for.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-issued-note">
        Remaining is shown only beside a reported Issued figure: an absent figure is not the same as having issued nothing. <Why source="promotions" onOpen={onWhy} />
      </p>
      <details className="mt-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
        <summary className="cursor-pointer text-[13px] font-bold text-axal-ink dark:text-gray-100">Set a ceiling…</summary>
        <CeilingEditor licences={licences} currentPeriod={currentPeriod || ''} onSave={onSave} />
      </details>
    </Section>
  );
}
