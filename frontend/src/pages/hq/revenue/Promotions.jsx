import React, { useEffect, useRef, useState } from 'react';
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
 * The ceiling editor (D228) is today's write. Since D5039 part 2 it picks its
 * licence from the scoped picker (`GET /api/admin/licence-picker`: uid, name
 * and territory, searched and paged), asked only once "Set a ceiling…" is
 * opened, instead of reading the whole licence ledger with the page.
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
 * D5039 (#5039 part 2) — the scoped licence picker: a search box and a page of
 * licences (name and territory), with Show more while the Worker has another
 * page. `search({ q, cursor })` is `GET /api/admin/licence-picker`. It asks on
 * mount, which is when "Set a ceiling…" is opened, and again 250ms after the
 * search changes. Loading, unreadable (with Try again), no match and no
 * licence at all are four different sentences.
 */
export function LicencePicker({ search, value, onChange }) {
  const [q, setQ] = useState('');
  const [read, setRead] = useState({ status: 'loading', items: [], next: null, more: false });
  const seq = useRef(0);

  const load = (query, cursor = null) => {
    const n = (seq.current += 1);
    setRead((r) => (cursor ? { ...r, more: true } : { status: 'loading', items: [], next: null, more: false }));
    Promise.resolve(search({ q: query, cursor })).then((res) => {
      if (n !== seq.current) return;
      const items = Array.isArray(res?.items) ? res.items : null;
      if (!items) { setRead({ status: 'unavailable', items: [], next: null, more: false }); return; }
      setRead((r) => ({ status: 'ready', items: cursor ? [...r.items, ...items] : items, next: res.next_cursor || null, more: false }));
    }, () => {
      if (n !== seq.current) return;
      setRead((r) => (cursor ? { ...r, more: false, moreFailed: true } : { status: 'unavailable', items: [], next: null, more: false }));
    });
  };

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LicencePickerView
      q={q}
      onQ={setQ}
      read={read}
      value={value}
      onChange={onChange}
      onMore={() => load(q.trim(), read.next)}
      onRetry={() => load(q.trim())}
    />
  );
}

/** The picker drawn from its read; pure, so each state can be rendered in a test. */
export function LicencePickerView({ q, onQ, read, value, onChange, onMore, onRetry }) {
  return (
    <fieldset className="min-w-0 sm:col-span-4" data-testid="hq-revenue-licence-picker">
      <legend className="mb-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">Licence</legend>
      <input
        type="search"
        className="w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-950"
        placeholder="Search by name, reference or country code"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        aria-label="Search licences"
      />
      <div aria-live="polite" className="mt-1.5">
        {read.status === 'loading' && <p className="text-[13px] text-axal-muted dark:text-gray-400">Loading the licences…</p>}
        {read.status === 'unavailable' && (
          <Unreadable what="The licence list" claim="No ceiling can be set until it is read; this is not a claim that there are no licences." onRetry={onRetry} />
        )}
        {read.status === 'ready' && read.items.length === 0 && (
          <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-ceiling-no-licences">
            {q.trim() ? `No licence matches “${q.trim()}”.` : 'No territory licence exists yet, so there is nothing to set a ceiling for.'}
          </p>
        )}
      </div>
      {read.status === 'ready' && read.items.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-axal-hairline dark:border-gray-700">
          {read.items.map((l) => (
            <li key={l.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800">
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13.5px]">
                <input type="radio" name="hq-ceiling-licence" value={l.uid} checked={value === l.uid} onChange={() => onChange(l.uid)} />
                <span className="min-w-0 flex-1 truncate font-semibold">{l.name || l.uid}</span>
                <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">
                  {Array.isArray(l.territory) && l.territory.length ? l.territory.join(' · ') : 'No territory recorded'}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {read.status === 'ready' && read.next && (
        <button type="button" disabled={read.more} onClick={onMore} className="mt-1.5 min-h-[36px] rounded-lg border border-axal-hairline px-3 text-[13px] font-semibold disabled:opacity-50 dark:border-gray-700">
          {read.more ? 'Loading…' : 'Show more'}
        </button>
      )}
      {read.moreFailed && <p role="alert" className="mt-1 text-[13px] text-red-700 dark:text-red-300">The next page could not be read. Show more to try again.</p>}
    </fieldset>
  );
}

/**
 * D228 — the promo-ceiling editor. `searchLicences` is the scoped picker's
 * read (D5039); `onSave(licenceUid, body)` is the worker call. The route's own
 * gate and audit apply: super admin, and a branch-action mirror row for the
 * push. The picker carries no currency, so the currency is typed: the Worker
 * refuses one that is not a listed ISO 4217 code.
 */
export function CeilingEditor({ searchLicences, currentPeriod, onSave }) {
  const [f, setF] = useState({ licenceUid: '', period: currentPeriod || '', amount: '', currency: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const period = f.period || currentPeriod || '';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const p = ceilingPayload({ licenceUid: f.licenceUid, period, amount: f.amount, currency: f.currency });
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
      <form onSubmit={submit} className="mt-2 grid gap-2 sm:grid-cols-4">
        {searchLicences
          ? <LicencePicker search={searchLicences} value={f.licenceUid} onChange={(uid) => set('licenceUid', uid)} />
          : null}
        <input className={input} value={period} onChange={(e) => set('period', e.target.value)} placeholder="YYYY-Qn" aria-label="Period" />
        <input className={input} value={f.currency} onChange={(e) => set('currency', e.target.value)} placeholder="EUR" maxLength={3} aria-label="Currency" />
        <input className={`${input} sm:col-span-2`} type="text" inputMode="decimal" autoComplete="off" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Ceiling for the period" aria-label="Ceiling" />
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !f.licenceUid} className="rounded-lg bg-axal-violet px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save ceiling'}
          </button>
        </div>
        {msg && (
          <p role="status" className={`sm:col-span-4 text-[12px] ${msg.err ? 'text-red-700 dark:text-red-300' : (msg.warn ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}`}>
            {msg.text}
          </p>
        )}
      </form>
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

export function PromotionsSection({ summary, ceilings, coverage, period, licenceUid, searchLicences, onSave, onRetry, onWhy }) {
  // D5039: the editor, and so the picker's read, mounts only once "Set a ceiling…" is opened.
  const [editing, setEditing] = useState(false);
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
      <details className="mt-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700" onToggle={(e) => setEditing(e.currentTarget.open)}>
        <summary className="cursor-pointer text-[13px] font-bold text-axal-ink dark:text-gray-100">Set a ceiling…</summary>
        {editing && <CeilingEditor searchLicences={searchLicences} currentPeriod={currentPeriod || ''} onSave={onSave} />}
      </details>
    </Section>
  );
}
