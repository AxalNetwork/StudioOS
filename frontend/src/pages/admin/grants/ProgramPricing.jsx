/**
 * D5018 (#5018) — program pricing on the Program grants pages.
 *
 *   StudioPricing   one studio: each program's base → country-adjusted → accepted price, an override marked, its period;
 *   ReferencePrices the defaults view: each program's global reference price, and publishing the next version;
 *   PriceBlock      the grant and change-terms sheet: keep the fee in the terms, accept the recommendation, or override.
 *
 * A program with no reference price reads "Not recorded", never free. No internal id is shown.
 */
import React, { useState } from 'react';
import { programPricingApi } from '../../../lib/api/programPricing.js';
import { reportError } from '../../../lib/log';
import { actionGhost } from '../../../ui';
import { NOT_RECORDED, PRICE_MODES, centsOf, indexWord, money, pricingLine } from './programPricingModel';

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-[8px] border border-axal-hairline px-2.5 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900';
const ERR = 'text-[12.5px] text-axal-destructive dark:text-red-400';

export function StudioPricing({ uid, read, onRetry }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (read.status === 'error' || read.status === 'missing') {
    return (
      <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="studio-pricing">
        <h2 className={H2}>Program pricing</h2>
        <p role="alert" className={ERR}>Program pricing could not be read. That is not the same as none.</p>
        <button type="button" className={`${actionGhost} self-start`} onClick={onRetry}>Try again</button>
      </section>
    );
  }
  const d = read.data;
  if (!d) return null;
  const lines = (Array.isArray(d.programs) ? d.programs : []).map(pricingLine);
  async function csv() {
    setBusy(true); setErr('');
    try { await programPricingApi.decisionsCsv({ licence: uid }); } catch (e) { reportError('program-pricing:csv', e); setErr('The pricing history could not be downloaded.'); } finally { setBusy(false); }
  }
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2.5 px-[18px] py-4`} data-testid="studio-pricing">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>Program pricing</h2>
        <button type="button" className={actionGhost} onClick={csv} disabled={busy} data-testid="studio-pricing-csv">Download pricing history</button>
      </div>
      <p className={`m-0 ${SUB}`}>
        Country index {indexWord(d.country_index_ppm)}{d.model_version ? ` · model ${d.model_version}` : ''}
        {d.snapshot ? ` · recommendation of ${String(d.snapshot.created_at).slice(0, 10)}` : ''}{d.index_reason ? ` · ${d.index_reason}` : ''}.
        An accepted price stays as accepted until HQ changes the grant; new market data never reprices it.
      </p>
      {err ? <p role="alert" className={`m-0 ${ERR}`}>{err}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
          <thead><tr className={EYE}>{['Program', 'Global base', 'Country-adjusted', 'Accepted', 'Period'].map((h) => <th key={h} scope="col" className="py-1.5 pr-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`pricing-row-${l.key}`}>
                <th scope="row" className="py-2 pr-3 font-bold text-axal-ink dark:text-gray-100">{l.name}</th>
                <td className="py-2 pr-3"><span className="block font-mono">{l.base}</span><span className={SUB}>{l.baseWhy}</span></td>
                <td className="py-2 pr-3"><span className="block font-mono">{l.adjusted}</span>{l.adjustedWhy ? <span className={SUB}>{l.adjustedWhy}</span> : null}</td>
                <td className="py-2 pr-3">
                  <span className="block font-mono">{l.accepted}</span>
                  {l.overridden ? <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title={l.overrideWhy || undefined} data-testid={`pricing-override-${l.key}`}>Override</span> : null}
                </td>
                <td className="py-2 pr-3 font-mono">{l.period}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReferencePrices({ read, reload }) {
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (read.status === 'error') return <p role="alert" className={ERR} data-testid="reference-prices-unreadable">Reference prices could not be read. That is not the same as none.</p>;
  const programs = Array.isArray(read.data?.programs) ? read.data.programs : [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function publish(p) {
    const base = centsOf(form.base);
    if (base === null || Number.isNaN(base) || base <= 0) { setErr('Give the base price, like 20000. A program is never free by default.'); return; }
    const initial = centsOf(form.initial);
    if (Number.isNaN(initial)) { setErr('The initial fee is an amount like 5000, or blank.'); return; }
    setBusy(true); setErr('');
    try {
      await programPricingApi.publish(p.program_key, {
        currency: (form.currency || 'EUR').toUpperCase(), base_annual_fee_cents: base, base_initial_fee_cents: initial,
        effective_from: form.effective_from, reason: form.reason || '', expected_version: p.active?.version ?? 0,
      });
      setOpen(null); setForm({}); reload();
    } catch (e) { reportError('program-pricing:publish', e); setErr(e?.message || 'The reference price was not published.'); } finally { setBusy(false); }
  }
  return (
    <section className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4`} data-testid="reference-prices">
      <h2 className={H2}>Reference prices</h2>
      <p className={`m-0 ${SUB}`}>The global price each program is adjusted from, by the studio’s country index. Publishing a new version never changes a grant already priced.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {programs.map((p) => (
          <li key={p.program_key} className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid={`reference-price-${p.program_key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-bold text-axal-ink dark:text-gray-100">{p.name}</span>
              <span className="font-mono text-[13px]">{p.active ? `${money(p.active.base_annual_fee_cents, p.active.currency)} a year · v${p.active.version}` : NOT_RECORDED}</span>
            </div>
            {p.locked_reason ? <span className={SUB}>{p.locked_reason}</span> : null}
            {open === p.program_key ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[12.5px]">Base, a year<input className={FIELD} inputMode="decimal" value={form.base || ''} onChange={set('base')} /></label>
                <label className="text-[12.5px]">Currency<input className={FIELD} maxLength={3} value={form.currency || 'EUR'} onChange={set('currency')} /></label>
                <label className="text-[12.5px]">Initial fee (optional)<input className={FIELD} inputMode="decimal" value={form.initial || ''} onChange={set('initial')} /></label>
                <label className="text-[12.5px]">Effective from<input type="date" className={FIELD} value={form.effective_from || ''} onChange={set('effective_from')} /></label>
                <label className="text-[12.5px] sm:col-span-2">Why<input className={FIELD} maxLength={500} value={form.reason || ''} onChange={set('reason')} /></label>
                {err ? <p role="alert" className={`m-0 sm:col-span-2 ${ERR}`}>{err}</p> : null}
                <span className="flex gap-2 sm:col-span-2">
                  <button type="button" className={actionGhost} disabled={busy || (form.reason || '').trim().length < 3 || !form.effective_from} onClick={() => publish(p)} data-testid={`reference-publish-${p.program_key}`}>Publish</button>
                  <button type="button" className={actionGhost} onClick={() => { setOpen(null); setErr(''); }}>Cancel</button>
                </span>
              </div>
            ) : (
              <button type="button" className={`${actionGhost} self-start`} onClick={() => { setOpen(p.program_key); setForm({ currency: p.active?.currency || 'EUR' }); setErr(''); }}>
                {p.active ? 'Publish a new version' : 'Set a reference price'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The price part of the grant sheet. `price` is the program's row of the studio's pricing read, or null. */
export function PriceBlock({ price, mode, setMode, form, setForm, error }) {
  const rec = price?.recommendation;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <fieldset className="m-0 flex flex-col gap-2 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid="grant-price">
      <legend className={`${EYE} px-1`}>Price</legend>
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">
        Global base {price?.base ? money(price.base.annual_fee_cents, price.base.currency) : NOT_RECORDED}
        {' · '}country index {indexWord(rec?.country_index_ppm)}
        {' · '}recommended {rec?.available ? money(rec.recommended_annual_fee_cents, rec.currency) : NOT_RECORDED}
        {price?.accepted ? ` · accepted now ${money(price.accepted.annual_fee_cents, price.accepted.currency)}` : ''}
      </p>
      {rec && !rec.available && rec.unavailable_reason ? <span className={SUB}>{rec.unavailable_reason}</span> : null}
      <div className="flex flex-col gap-1">
        {Object.entries(PRICE_MODES).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-[13px]">
            <input type="radio" name="grant-price-mode" value={k} checked={mode === k} disabled={k === 'recommended' && !rec?.available}
              onChange={() => setMode(k)} data-testid={`grant-price-${k}`} /> {label}
          </label>
        ))}
      </div>
      {mode === 'override' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px]">Price, a year<input className={FIELD} inputMode="decimal" value={form.fee || ''} onChange={set('fee')} data-testid="grant-price-fee" /></label>
          <label className="text-[12.5px] sm:col-span-2">Why it differs from the recommendation<input className={FIELD} maxLength={1000} value={form.override_reason || ''} onChange={set('override_reason')} data-testid="grant-price-why" /></label>
        </div>
      ) : null}
      {mode !== 'terms' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px]">Price from (optional)<input type="date" className={FIELD} value={form.effective_from || ''} onChange={set('effective_from')} /></label>
          <label className="text-[12.5px]">Price until (optional)<input type="date" className={FIELD} value={form.effective_to || ''} onChange={set('effective_to')} /></label>
        </div>
      ) : <span className={SUB}>The fee stays as the terms say. A changed fee is recorded as HQ’s own price, with this write’s reason.</span>}
      {error ? <p role="alert" className={`m-0 ${ERR}`} data-testid="grant-price-error">{error}</p> : null}
    </fieldset>
  );
}
