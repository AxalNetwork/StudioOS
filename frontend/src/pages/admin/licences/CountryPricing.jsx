/**
 * D5017 (#5017) — Country pricing, on the licence's Terms tab, under the core
 * terms. A recommendation layer: refreshing it changes nothing on the licence;
 * applying or overriding it goes through the revision-safe terms write and says
 * how it ended, the branch push apart from HQ's commit. No internal id is shown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { licencePricingApi } from '../../../lib/api/licencePricing.js';
import { reportError } from '../../../lib/log';
import { bpsPercent } from '../../../lib/bps';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { describeOutcome, outcomeFromError } from '../../../lib/mutationOutcome';
import {
  BASIS_LABELS, NOT_RECORDED, PRICING_FIGURES, REVIEW_KIND_LABELS, REVIEW_STATE_LABELS,
  basketOf, buildApply, changesContract, difference, figure, freshness, indexLabel,
} from './countryPricingModel';

const input = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const btn = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';
const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50';
const today = () => new Date().toISOString().slice(0, 10);

function BasisEditor({ api, view, onSaved, setNotice }) {
  const policy = view.basis?.policy || null;
  const [basis, setBasis] = useState(policy?.basis || 'primary_country');
  const [primaryCountry, setPrimary] = useState(policy?.primary_country || view.territory[0] || '');
  const [weights, setWeights] = useState(() => Object.fromEntries(view.territory.map((c) => [c, String(policy?.weights?.[c] ?? '')])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const basket = basketOf(weights, view.territory);
  async function save() {
    setBusy(true); setNotice(null);
    try {
      await api.setBasis(view.licence_uid, {
        basis, reason, expected_revision: policy?.revision ?? 0,
        ...(basis === 'basket_weighted' ? { weights: basket.weights } : { primary_country: primaryCountry }),
      });
      setReason('');
      setNotice(describeOutcome('committed', { fallback: 'Pricing basis recorded. Refresh the recommendation to price on it.' }));
      onSaved();
    } catch (e) {
      reportError('licence_pricing_basis_failed', e);
      setNotice(outcomeFromError(e, 'The pricing basis was not recorded.'));
    } finally { setBusy(false); }
  }
  return (
    <fieldset className="mt-3 rounded-md border border-gray-200 p-3 dark:border-gray-800" data-testid="pricing-basis">
      <legend className="px-1 text-[11px] uppercase tracking-wide text-gray-500">Pricing basis</legend>
      {view.basis?.reason && <p className="mb-2 text-[12px] text-amber-800 dark:text-amber-300" role="status">{view.basis.reason}</p>}
      <div className="flex flex-wrap gap-3 text-sm">
        {Object.entries(BASIS_LABELS).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="radio" name="pricing-basis" value={k} checked={basis === k} onChange={() => setBasis(k)} /> {label}
          </label>
        ))}
      </div>
      {basis === 'basket_weighted' ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {view.territory.map((c) => (
            <label key={c} className="text-sm">{c} weight (basis points)
              <input className={input} inputMode="numeric" value={weights[c] ?? ''} onChange={(e) => setWeights((w) => ({ ...w, [c]: e.target.value }))} />
            </label>
          ))}
          <p className={`text-[12px] sm:col-span-3 ${basket.ok ? 'text-gray-600' : 'text-red-700'}`} role="status">
            Total {basket.total} of 10000 basis points.
          </p>
        </div>
      ) : (
        <label className="mt-2 block text-sm">{basis === 'hq_override' ? 'Reference country (shown, never applied)' : 'Pricing country'}
          <select className={input} value={primaryCountry} onChange={(e) => setPrimary(e.target.value)}>
            {view.territory.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      <label className="mt-2 block text-sm">Why this basis?
        <input className={input} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" className={`${primary} mt-2`} onClick={save}
        disabled={busy || reason.trim().length < 3 || (basis === 'basket_weighted' && !basket.ok)} data-testid="pricing-basis-save">
        Record basis
      </button>
    </fieldset>
  );
}

function ApplyForm({ api, view, mode, reviewUid, onDone, onCancel, setNotice }) {
  const [form, setForm] = useState({ accepted: {}, reason: '', override_reason: '', effective_from: today(), pricing_review_on: '', acknowledge: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const snap = view.recommendation;
  const needsAck = view.agreement?.state === 'matches' || view.agreement?.state === 'mismatch' ? changesContract(view, form) : false;
  async function submit() {
    const built = buildApply({ view, form, reviewUid });
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({}); setBusy(true); setNotice(null);
    try {
      const out = await api.apply(view.licence_uid, built.body);
      const pushed = out.push_outcome === 'partial'
        ? ' HQ saved it; the studio’s copy has not caught up yet and is retried.'
        : '';
      setNotice(describeOutcome(out.push_outcome === 'partial' ? 'partial' : 'committed', {
        fallback: `${built.override ? 'Override' : 'Recommendation'} applied to the licence terms.${pushed}${out.agreement?.state === 'mismatch' ? ' The agreement no longer matches: instantiate its replacement on the Contract tab.' : ''}`,
      }));
      onDone();
    } catch (e) {
      reportError('licence_pricing_apply_failed', e);
      setNotice(outcomeFromError(e, 'Nothing was applied.'));
      if (e?.code === 'terms_conflict' || e?.code === 'snapshot_stale') onDone();
    } finally { setBusy(false); }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <div className="mt-3 rounded-md border border-indigo-200 p-3 dark:border-indigo-900" data-testid="pricing-apply-form">
      <p className="text-sm font-medium">{mode === 'override' ? 'Override the recommendation' : 'Apply the recommendation'}</p>
      {mode === 'override' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PRICING_FIGURES.map((f) => (
            <label key={f.key} className="text-sm">{f.label} ({f.kind === 'bps' ? 'basis points' : snap.currency})
              <input className={input} inputMode="decimal" placeholder={snap.recommended[f.key] === null ? NOT_RECORDED
                : f.kind === 'bps' ? String(snap.recommended[f.key]) : String(snap.recommended[f.key] / 100)}
                value={form.accepted[f.key] ?? ''} onChange={(e) => setForm((x) => ({ ...x, accepted: { ...x.accepted, [f.key]: e.target.value } }))} />
              {errors[f.key] && <span className="text-[11px] text-red-600" role="alert">{f.label} {errors[f.key]}.</span>}
            </label>
          ))}
          <label className="text-sm sm:col-span-2">Why override?
            <textarea className={input} rows={2} maxLength={1000} value={form.override_reason} onChange={set('override_reason')} />
            {errors.override_reason && <span className="text-[11px] text-red-600" role="alert">{errors.override_reason}</span>}
          </label>
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Effective from
          <input type="date" className={input} value={form.effective_from} onChange={set('effective_from')} />
          {errors.effective_from && <span className="text-[11px] text-red-600" role="alert">{errors.effective_from}</span>}
        </label>
        <label className="text-sm">Next pricing review (optional; a year on by default)
          <input type="date" className={input} value={form.pricing_review_on} onChange={set('pricing_review_on')} />
        </label>
        <label className="text-sm sm:col-span-2">Why now?
          <input className={input} maxLength={500} value={form.reason} onChange={set('reason')} />
          {errors.reason && <span className="text-[11px] text-red-600" role="alert">{errors.reason}</span>}
        </label>
      </div>
      {needsAck && (
        <label className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <input type="checkbox" checked={form.acknowledge} onChange={set('acknowledge')} data-testid="pricing-ack" />
          This changes the annual fee or royalty, and the current agreement was drawn on the old figures. It will not be edited;
          it may no longer match until a replacement is instantiated on the Contract tab. Issued invoices stay as issued.
        </label>
      )}
      {errors.form && <p className="mt-1 text-[12px] text-red-600" role="alert">{errors.form}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" className={primary} onClick={submit} disabled={busy || (needsAck && !form.acknowledge)} data-testid="pricing-apply-submit">
          {busy ? <Loader2 size={14} className="animate-spin" /> : mode === 'override' ? 'Apply override' : 'Apply recommendation'}
        </button>
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Reviews({ api, view, onChanged, onApply, setNotice }) {
  const open = view.reviews.find((r) => r.state === 'open');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn, ok, fail) {
    setBusy(true); setNotice(null);
    try { await fn(); setNotice(describeOutcome('committed', { fallback: ok })); setReason(''); onChanged(); }
    catch (e) { reportError('licence_pricing_review_failed', e); setNotice(outcomeFromError(e, fail)); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-4" data-testid="pricing-reviews">
      <h4 className="text-[11px] uppercase tracking-wide text-gray-500">Annual pricing review</h4>
      <p className="mt-1 text-sm">
        Next review: {view.next_review_on || NOT_RECORDED}{view.review_due ? ' — due now' : ''}
      </p>
      {open ? (
        <div className="mt-2 rounded-md border border-gray-200 p-2 text-sm dark:border-gray-800">
          <p>{REVIEW_KIND_LABELS[open.kind]} · opened {open.opened_at.slice(0, 10)}. The licence is unchanged until you decide.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => onApply('apply', open.uid)}>Apply recommendation</button>
            <button type="button" className={btn} disabled={busy} onClick={() => onApply('override', open.uid)}>Override</button>
          </div>
          <label className="mt-2 block">Reason (to keep or postpone)
            <input className={input} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <button type="button" className={btn} disabled={busy || reason.trim().length < 3}
              onClick={() => run(() => api.resolveReview(view.licence_uid, open.uid, { action: 'keep', reason, expected_revision: open.revision }), 'Current terms kept.', 'The review was not closed.')}>
              Keep current terms
            </button>
            <label className="text-sm">Postpone until
              <input type="date" className={input} value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <button type="button" className={btn} disabled={busy || reason.trim().length < 3 || !until}
              onClick={() => run(() => api.resolveReview(view.licence_uid, open.uid, { action: 'postpone', postponed_until: until, reason, expected_revision: open.revision }), 'Review postponed.', 'The review was not postponed.')}>
              Postpone
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${btn} mt-2`} disabled={busy || !view.model}
          onClick={() => run(() => api.openReview(view.licence_uid, {}), 'Review opened on a fresh recommendation. Nothing on the licence changed.', 'No review was opened.')}
          data-testid="pricing-review-open">
          Open annual review
        </button>
      )}
      {view.reviews.filter((r) => r.state !== 'open').length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px] text-gray-600 dark:text-gray-400">
          {view.reviews.filter((r) => r.state !== 'open').slice(0, 5).map((r) => (
            <li key={r.uid}>{r.opened_at.slice(0, 10)} · {REVIEW_KIND_LABELS[r.kind]} · {REVIEW_STATE_LABELS[r.state]}
              {r.postponed_until ? ` until ${r.postponed_until}` : ''}{r.resolution_reason ? ` — ${r.resolution_reason}` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CountryPricing({ licence, onSaved, api = licencePricingApi }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // { mode, reviewUid }
  const [showCalc, setShowCalc] = useState(false);
  const load = useCallback(async () => {
    try { setView(await api.get(licence.uid)); setError(null); }
    catch (e) { reportError('licence_pricing_read_failed', e); setError('Country pricing could not be read just now.'); }
  }, [api, licence.uid]);
  useEffect(() => { load(); }, [load, licence.terms_revision]);

  if (error) return <p className="mt-6 text-sm text-red-700" role="alert">{error} It is Unreadable, not empty.</p>;
  if (!view) return <p className="mt-6 text-sm text-gray-500"><Loader2 size={14} className="inline animate-spin" /> Loading country pricing…</p>;

  const snap = view.recommendation;
  const cur = snap?.currency || view.terms.currency;
  async function refresh() {
    setBusy(true); setNotice(null);
    try {
      await api.refresh(licence.uid, {});
      setNotice(describeOutcome('committed', { fallback: 'Recommendation refreshed. The licence terms did not change.' }));
      await load();
    } catch (e) { reportError('licence_pricing_refresh_failed', e); setNotice(outcomeFromError(e, 'No recommendation was made.')); }
    finally { setBusy(false); }
  }
  const after = () => { setForm(null); load(); onSaved?.(); };
  const multi = view.territory.length > 1;

  return (
    <section className="mt-8 border-t border-gray-200 pt-4 dark:border-gray-800" data-testid="country-pricing" aria-labelledby="country-pricing-h">
      <h3 id="country-pricing-h" className="text-sm font-semibold">Country pricing</h3>
      <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
        A recommendation from market data. Refreshing it never changes the licence; applying it changes the annual fee and royalty above.
        Regulatory classes are commercial planning metadata.
      </p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-[11px] uppercase text-gray-500">Model</dt><dd>{view.model ? `${view.model.version} (${view.model.currency})` : view.model_reason}</dd></div>
        <div><dt className="text-[11px] uppercase text-gray-500">Basis</dt><dd>{view.basis?.basis ? `${BASIS_LABELS[view.basis.basis]}${view.basis.implied ? ' (single country)' : ''}` : 'Not recorded'}</dd></div>
        <div><dt className="text-[11px] uppercase text-gray-500">Territory</dt><dd>{view.territory.join(', ') || NOT_RECORDED}</dd></div>
      </dl>
      <ul className="mt-2 space-y-1 text-[12px] text-gray-600 dark:text-gray-400" data-testid="pricing-freshness">
        {view.countries.map((c) => {
          const f = freshness(c);
          return (
            <li key={c.country_code}>{c.country_code}: {c.recorded ? f.label : c.reason}
              {f.missing.length ? ` · not recorded: ${f.missing.join(', ')}` : ''}{f.provisional.length ? ` · provisional: ${f.provisional.join(', ')}` : ''}
            </li>
          );
        })}
      </ul>
      {(multi || view.basis?.policy) && <BasisEditor api={api} key={view.basis?.policy?.revision ?? 0} view={view} onSaved={load} setNotice={setNotice} />}

      {snap ? (
        <div className="mt-3 overflow-x-auto">
          <p className="text-[12px] text-gray-600 dark:text-gray-400">
            Recommendation of {snap.created_at.slice(0, 10)}{snap.components?.length === 1 && snap.trace?.components?.[0] ? ` · index ${indexLabel(snap.trace.components[0].country_index)} · tier ${snap.trace.components[0].tier || NOT_RECORDED}` : ' · index and tier per country under “View calculation”'}
            {snap.available ? '' : ` · unavailable: ${snap.unavailable_reason}`}
          </p>
          <table className="mt-1 w-full min-w-[28rem] text-sm" data-testid="pricing-table">
            <thead><tr className="text-left text-[11px] uppercase text-gray-500"><th className="py-1">Figure</th><th>Recommended</th><th>Current licence</th><th>Difference</th></tr></thead>
            <tbody>
              {PRICING_FIGURES.map((f) => {
                const curVal = f.term ? view.terms[f.term] : view.latest_decision?.accepted?.[f.key] ?? null;
                return (
                  <tr key={f.key} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1">{f.label}</td>
                    <td>{figure(snap.recommended[f.key], f.kind, cur)}</td>
                    <td>{figure(curVal, f.kind, view.terms.currency)}{f.term ? '' : curVal === null ? '' : ' (accepted)'}</td>
                    <td>{difference(snap.recommended[f.key], curVal, f.kind, cur) ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400" data-testid="pricing-none">{view.recommendation_reason}</p>
      )}

      {view.agreement?.state === 'mismatch' && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="pricing-agreement-mismatch">
          {view.agreement.reason}
        </p>
      )}
      {view.latest_decision && (
        <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-400">
          Last decision: {view.latest_decision.decision === 'overridden' ? 'overridden' : 'accepted'} on {view.latest_decision.created_at.slice(0, 10)},
          effective {view.latest_decision.effective_from}{view.latest_decision.override_reason ? ` — ${view.latest_decision.override_reason}` : ''}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={refresh} disabled={busy || !view.model || !!view.basis?.required} data-testid="pricing-refresh">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Refresh recommendation'}
        </button>
        <button type="button" className={btn} disabled={!snap?.available || snap?.basis === 'hq_override'} onClick={() => setForm({ mode: 'apply', reviewUid: null })} data-testid="pricing-apply">Apply recommendation</button>
        <button type="button" className={btn} disabled={!snap} onClick={() => setForm({ mode: 'override', reviewUid: null })} data-testid="pricing-override">Override</button>
        <button type="button" className={btn} disabled={!snap} onClick={() => setShowCalc((s) => !s)} aria-expanded={showCalc}>View calculation</button>
      </div>
      {showCalc && snap && (
        <div className="mt-2 rounded-md bg-gray-50 p-2 text-[12px] dark:bg-gray-900" data-testid="pricing-calculation">
          <p>Model {snap.pricing_model_version} · basis {BASIS_LABELS[snap.basis]}</p>
          <ul className="mt-1 space-y-0.5">
            {(snap.trace?.components || []).map((c) => (
              <li key={c.country_code}>{c.country_code} · weight {bpsPercent(c.weight_bps)} · index {indexLabel(c.country_index)} · tier {c.tier || NOT_RECORDED} · annual {figure(c.values?.annual_fee_cents, 'cents', cur)}
                {c.provisional?.length ? ` · provisional: ${c.provisional.join(', ')}` : ''}</li>
            ))}
          </ul>
          {snap.trace?.unrounded_fees && Object.keys(snap.trace.unrounded_fees).length > 0 && (
            <p className="mt-1">Weighted before rounding: {Object.entries(snap.trace.unrounded_fees).map(([k, v]) => `${k.replace(/_cents$/, '').replace(/_/g, ' ')} ${figure(Number(v), 'cents', cur)}`).join(' · ')}, rounded to {figure(snap.trace.fee_rounding_cents, 'cents', cur)}.</p>
          )}
          <p className="mt-1">A missing input is never read as zero: a country without one has no recommendation.</p>
        </div>
      )}
      {form && snap && (
        <ApplyForm api={api} key={`${form.mode}-${snap.uid}`} view={view} mode={form.mode} reviewUid={form.reviewUid} onDone={after} onCancel={() => setForm(null)} setNotice={setNotice} />
      )}
      <Reviews api={api} view={view} onChanged={load} onApply={(mode, reviewUid) => setForm({ mode, reviewUid })} setNotice={setNotice} />
      <div className="mt-2"><OutcomeNotice notice={notice} testId="country-pricing-outcome" /></div>
    </section>
  );
}

export default CountryPricing;
