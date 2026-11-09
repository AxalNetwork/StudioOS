/**
 * D5019 (#5019) — Exclusivity, on the licence's Territory tab, under the
 * operating territory. Three blocks: the operating licence (its fee, royalty
 * and territory, which exclusivity does not change), the exclusivity (scope,
 * territory, state, editable as a new version), and the development
 * commitments (each year's target, measured progress or Not recorded, next
 * review, status). A missed target opens an HQ review; its actions each show
 * their consequence and need a reason. No internal id is shown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { licenceExclusivityApi } from '../../../lib/api/licenceExclusivity.js';
import { bpsPercent } from '../../../lib/bps';
import { reportError } from '../../../lib/log';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { describeOutcome, outcomeFromError } from '../../../lib/mutationOutcome';
import { ACTION_LABELS, NOT_RECORDED, SCOPE_LABELS, STATE_LABELS, buildSave, yearLine } from './exclusivityModel';

const input = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const btn = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';
const EYE = 'text-[11px] uppercase tracking-wide text-gray-500';
const money = (c, cur) => (c === null || c === undefined ? NOT_RECORDED : `${cur || ''} ${(Number(c) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim());

function formFrom(x) {
  const t = x?.targets || [];
  const year = (n) => {
    const y = t.find((v) => v.year === n) || {};
    return {
      year: n, period_start: y.period_start || '', period_end: y.period_end || '',
      min_revenue: y.min_revenue_cents == null ? '' : String(y.min_revenue_cents / 100),
      min_cohorts: y.min_cohorts == null ? '' : String(y.min_cohorts), min_active_members: y.min_active_members == null ? '' : String(y.min_active_members),
    };
  };
  return {
    scope_type: x?.scope_type || 'non_exclusive', countries: (x?.territory?.countries || []).join(', '), regions: (x?.territory?.regions || []).join(', '),
    parent_licence_uid: x?.parent_licence_uid || '', children: (x?.child_licence_uids || []).join(', '),
    starts_on: x?.starts_on || '', ends_on: x?.ends_on || '', review_on: x?.review_on || '', cure_period_days: x?.cure_period_days ?? '',
    targets: [year(1), year(2)], contractual: x ? x.contractual : true, reason: '', acknowledge: false,
  };
}

function Editor({ api, view, onDone, setNotice }) {
  const [form, setForm] = useState(() => formFrom(view.exclusivity));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setT = (i, k) => (e) => setForm((f) => ({ ...f, targets: f.targets.map((t, j) => (j === i ? { ...t, [k]: e.target.value } : t)) }));
  const hasAgreement = view.agreement?.state === 'matches' || view.agreement?.state === 'mismatch';
  async function save() {
    const built = buildSave({ form, revision: view.exclusivity?.revision ?? 0 });
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({}); setBusy(true); setNotice(null);
    try {
      await api.save(view.licence_uid, built.body);
      setNotice(describeOutcome('committed', { fallback: 'Exclusivity saved as a new version. The operating licence and its fee did not change.' }));
      onDone();
    } catch (e) {
      reportError('licence_exclusivity_save_failed', e);
      setNotice(outcomeFromError(e, 'The exclusivity was not saved.'));
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-indigo-200 p-3 sm:grid-cols-2 dark:border-indigo-900" data-testid="exclusivity-editor">
      <label className="text-sm">Exclusivity
        <select className={input} value={form.scope_type} onChange={set('scope_type')} data-testid="exclusivity-scope">
          {Object.entries(SCOPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm">Countries (ISO codes)
        <input className={input} value={form.countries} onChange={set('countries')} placeholder="FR, BE" />
        {errors.countries && <span className="text-[11px] text-red-600" role="alert">{errors.countries}</span>}
      </label>
      <label className="text-sm">Regions (region ids)
        <input className={input} value={form.regions} onChange={set('regions')} placeholder="US-CA" />
        {errors.regions && <span className="text-[11px] text-red-600" role="alert">{errors.regions}</span>}
      </label>
      {form.scope_type === 'master_franchise'
        ? <label className="text-sm">Child licences it contains (licence ids)<input className={input} value={form.children} onChange={set('children')} /></label>
        : <label className="text-sm">Inside a master franchise (its licence id, optional)<input className={input} value={form.parent_licence_uid} onChange={set('parent_licence_uid')} /></label>}
      <label className="text-sm">Starts<input type="date" className={input} value={form.starts_on} onChange={set('starts_on')} /></label>
      <label className="text-sm">Ends<input type="date" className={input} value={form.ends_on} onChange={set('ends_on')} /></label>
      <label className="text-sm">Next review<input type="date" className={input} value={form.review_on} onChange={set('review_on')} /></label>
      <label className="text-sm">Cure period (days)<input className={input} inputMode="numeric" value={form.cure_period_days} onChange={set('cure_period_days')} /></label>
      {form.targets.map((t, i) => (
        <fieldset key={t.year} className="rounded-md border border-gray-200 p-2 sm:col-span-2 dark:border-gray-800">
          <legend className={`${EYE} px-1`}>Year {t.year} target</legend>
          <div className="grid gap-2 sm:grid-cols-5">
            <label className="text-[12px]">From<input type="date" className={input} value={t.period_start} onChange={setT(i, 'period_start')} /></label>
            <label className="text-[12px]">To<input type="date" className={input} value={t.period_end} onChange={setT(i, 'period_end')} /></label>
            <label className="text-[12px]">Min. revenue<input className={input} inputMode="decimal" value={t.min_revenue} onChange={setT(i, 'min_revenue')} /></label>
            <label className="text-[12px]">Min. cohorts<input className={input} inputMode="numeric" value={t.min_cohorts} onChange={setT(i, 'min_cohorts')} /></label>
            <label className="text-[12px]">Min. members<input className={input} inputMode="numeric" value={t.min_active_members} onChange={setT(i, 'min_active_members')} /></label>
          </div>
        </fieldset>
      ))}
      {errors.targets && <p className="text-[11px] text-red-600 sm:col-span-2" role="alert">{errors.targets}</p>}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={form.contractual} onChange={set('contractual')} /> The agreement states this exclusivity
      </label>
      {hasAgreement && view.exclusivity && form.contractual && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900 sm:col-span-2 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <input type="checkbox" checked={form.acknowledge} onChange={set('acknowledge')} data-testid="exclusivity-ack" />
          The licence has an agreement that states its exclusivity. It will not be edited; it may no longer match until a replacement is instantiated on the Contract tab.
        </label>
      )}
      <label className="text-sm sm:col-span-2">Why?
        <input className={input} maxLength={500} value={form.reason} onChange={set('reason')} />
        {errors.reason && <span className="text-[11px] text-red-600" role="alert">{errors.reason}</span>}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={save}
          disabled={busy || (hasAgreement && view.exclusivity && form.contractual && !form.acknowledge)} data-testid="exclusivity-save">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save as a new version'}
        </button>
        <button type="button" className={btn} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

const METRIC_OPTIONS = [['qualifying_revenue_cents', 'Qualifying revenue'], ['cohorts', 'Cohorts'], ['active_members', 'Active members'], ['network', 'Network']];

function ObservationForm({ api, view, onDone, setNotice }) {
  const [f, setF] = useState({ metric: 'qualifying_revenue_cents', period_start: '', period_end: '', value: '', source: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const revenue = f.metric === 'qualifying_revenue_cents';
  const value = String(f.value).trim() === '' ? null : revenue ? Math.round(Number(f.value) * 100) : Number(f.value);
  const ok = value !== null && Number.isSafeInteger(value) && value >= 0 && f.period_start && f.period_end && f.source.trim().length >= 2 && f.reason.trim().length >= 3;
  async function save() {
    setBusy(true); setNotice(null);
    try {
      const out = await api.observe(view.licence_uid, { metric: f.metric, period_start: f.period_start, period_end: f.period_end, value, source: f.source, reason: f.reason });
      setNotice(describeOutcome('committed', { fallback: out.review_opened ? 'Recorded. A development target was missed, so an HQ review is open; the exclusivity is unchanged until you decide.' : 'Recorded. The exclusivity did not change.' }));
      onDone();
    } catch (e) { reportError('licence_exclusivity_observe_failed', e); setNotice(outcomeFromError(e, 'The figure was not recorded.')); }
    finally { setBusy(false); }
  }
  return (
    <details className="mt-2 text-sm" data-testid="exclusivity-observe">
      <summary className="cursor-pointer text-[12px] text-indigo-700 dark:text-indigo-300">Record a measured figure</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-[12px]">Measure<select className={input} value={f.metric} onChange={set('metric')}>{METRIC_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-[12px]">From<input type="date" className={input} value={f.period_start} onChange={set('period_start')} /></label>
        <label className="text-[12px]">To<input type="date" className={input} value={f.period_end} onChange={set('period_end')} /></label>
        <label className="text-[12px]">{revenue ? `Amount (${view.operating.currency || 'currency'})` : 'Count'}<input className={input} inputMode="decimal" value={f.value} onChange={set('value')} /></label>
        <label className="text-[12px]">Source<input className={input} maxLength={200} value={f.source} onChange={set('source')} /></label>
        <label className="text-[12px]">Why<input className={input} maxLength={500} value={f.reason} onChange={set('reason')} /></label>
      </div>
      <button type="button" className={`${btn} mt-2`} onClick={save} disabled={busy || !ok}>Record</button>
    </details>
  );
}

function ReviewBlock({ api, view, review, onDone, setNotice }) {
  const [action, setAction] = useState('continue');
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [extra, setExtra] = useState({ countries: '', regions: '', cure_period_days: '' });
  const [busy, setBusy] = useState(false);
  const params = () => ({
    action,
    ...(action === 'reduce_territory' ? { territory: { countries: extra.countries.split(/[\s,]+/).filter(Boolean), regions: extra.regions.split(/[\s,]+/).filter(Boolean) } } : {}),
    ...(action === 'cure_period' && extra.cure_period_days ? { cure_period_days: Number(extra.cure_period_days) } : {}),
  });
  async function show() {
    setBusy(true); setPreview(null); setAck(false); setNotice(null);
    try { setPreview(await api.preview(view.licence_uid, review.uid, params())); }
    catch (e) { reportError('licence_exclusivity_preview_failed', e); setNotice(outcomeFromError(e, 'No consequence could be shown.')); }
    finally { setBusy(false); }
  }
  async function take() {
    setBusy(true); setNotice(null);
    try {
      await api.resolve(view.licence_uid, review.uid, { ...params(), reason, acknowledge_consequence: true, expected_revision: view.exclusivity.revision });
      setNotice(describeOutcome('committed', { fallback: `${ACTION_LABELS[action]}: done. ${preview?.consequence || ''}` }));
      onDone();
    } catch (e) { reportError('licence_exclusivity_resolve_failed', e); setNotice(outcomeFromError(e, 'Nothing was changed.')); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20" data-testid="exclusivity-review">
      <p className="text-sm font-medium">HQ review open since {review.opened_at.slice(0, 10)}{review.trigger === 'target_missed' ? ' — a development target was missed' : ''}.</p>
      <p className="text-[12px] text-gray-600 dark:text-gray-400">Nothing changes until you choose. Each action shows its consequence first.</p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {Object.entries(ACTION_LABELS).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5"><input type="radio" name="exclusivity-action" checked={action === k} onChange={() => { setAction(k); setPreview(null); }} /> {l}</label>
        ))}
      </div>
      {action === 'reduce_territory' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-sm">Keep countries<input className={input} value={extra.countries} onChange={(e) => setExtra((x) => ({ ...x, countries: e.target.value }))} /></label>
          <label className="text-sm">Keep regions<input className={input} value={extra.regions} onChange={(e) => setExtra((x) => ({ ...x, regions: e.target.value }))} /></label>
        </div>
      )}
      {action === 'cure_period' && (
        <label className="mt-2 block text-sm">Cure period (days; blank for the recorded one)<input className={input} inputMode="numeric" value={extra.cure_period_days} onChange={(e) => setExtra((x) => ({ ...x, cure_period_days: e.target.value }))} /></label>
      )}
      <button type="button" className={`${btn} mt-2`} onClick={show} disabled={busy} data-testid="exclusivity-preview">Show the consequence</button>
      {preview && (
        <div className="mt-2">
          <p className="rounded-md border border-amber-200 bg-white p-2 text-sm dark:border-amber-900 dark:bg-gray-900" role="status" data-testid="exclusivity-consequence">{preview.consequence}</p>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="exclusivity-consequence-ack" /> I have read the consequence</label>
          <label className="mt-2 block text-sm">Why?<input className={input} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className={`${btn} mt-2`} onClick={take} disabled={busy || !ack || reason.trim().length < 3} data-testid="exclusivity-resolve">{ACTION_LABELS[action]}</button>
        </div>
      )}
    </div>
  );
}

export function Exclusivity({ licence, api = licenceExclusivityApi }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try { setView(await api.get(licence.uid)); setError(null); }
    catch (e) { reportError('licence_exclusivity_read_failed', e); setError('Exclusivity could not be read just now. It is Unreadable, not empty.'); }
  }, [api, licence.uid]);
  useEffect(() => { load(); }, [load]);
  if (error) return <p className="mt-6 text-sm text-red-700" role="alert">{error}</p>;
  if (!view) return <p className="mt-6 text-sm text-gray-500"><Loader2 size={14} className="inline animate-spin" /> Loading exclusivity…</p>;
  const x = view.exclusivity;
  const cur = view.operating.currency;
  const open = view.reviews.find((r) => r.state === 'open');
  const done = () => { setEditing(false); load(); };
  return (
    <section className="mt-8 border-t border-gray-200 pt-4 dark:border-gray-800" data-testid="licence-exclusivity" aria-labelledby="exclusivity-h">
      <h3 id="exclusivity-h" className="text-sm font-semibold">Pricing &amp; market · territory</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800" data-testid="exclusivity-operating">
          <p className={EYE}>Operating licence</p>
          <p className="mt-1 text-sm">Annual fee {money(view.operating.annual_fee_cents, cur)} · royalty {bpsPercent(view.operating.revenue_share_bps) ?? NOT_RECORDED}</p>
          <p className="text-[12px] text-gray-600 dark:text-gray-400">Operates in {view.operating.territory.join(', ') || NOT_RECORDED}. Paying this fee grants no exclusivity.</p>
        </div>
        <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800" data-testid="exclusivity-scope-card">
          <p className={EYE}>Exclusivity</p>
          {x ? (
            <>
              <p className="mt-1 text-sm">{SCOPE_LABELS[x.scope_type]} · {STATE_LABELS[x.state]} · version {x.revision}</p>
              <p className="text-[12px] text-gray-600 dark:text-gray-400">
                {[...x.territory.countries, ...x.territory.regions].join(', ') || 'No named territory'}
                {view.master ? ` · inside master franchise ${view.master.licence_ref}` : ''}
                {view.children.length ? ` · contains ${view.children.map((c) => c.licence_ref).join(', ')}` : ''}
                {x.cure_until ? ` · cure period until ${x.cure_until}` : ''}
              </p>
            </>
          ) : <p className="mt-1 text-sm">{view.exclusivity_reason}</p>}
        </div>
      </div>
      {view.schedule?.reason && <p className="mt-2 text-[12px] text-amber-800 dark:text-amber-300" role="status">{view.schedule.reason}</p>}
      {view.agreement?.state === 'mismatch' && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="exclusivity-agreement-mismatch">{view.agreement.reason}</p>}

      <div className="mt-4" data-testid="exclusivity-commitments">
        <p className={EYE}>Development commitments</p>
        {view.progress.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {view.progress.map((p) => {
              const l = yearLine(p, cur);
              return (
                <li key={l.year} className={l.missed ? 'text-amber-900 dark:text-amber-300' : ''}>
                  <span className="font-medium">{l.label}</span> ({l.period}) · {l.metrics.map((m) => m.text).join(' · ') || 'no figure set'} · <span className="font-medium">{l.status}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{NOT_RECORDED}: no development targets are set.</p>}
        <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">Next review: {view.next_review_on || NOT_RECORDED}</p>
        {x && <ObservationForm api={api} view={view} onDone={load} setNotice={setNotice} />}
      </div>

      {open && x && <ReviewBlock api={api} view={view} review={open} onDone={done} setNotice={setNotice} />}
      <div className="mt-3 flex gap-2">
        {!editing && <button type="button" className={btn} onClick={() => setEditing(true)} data-testid="exclusivity-edit">{x ? 'Change exclusivity' : 'Set exclusivity'}</button>}
      </div>
      {editing && <Editor key={x?.revision ?? 0} api={api} view={view} onDone={done} setNotice={setNotice} />}
      {view.history.length > 1 && (
        <details className="mt-3 text-[12px] text-gray-600 dark:text-gray-400">
          <summary>Earlier versions ({view.history.length - 1})</summary>
          <ul className="mt-1 space-y-0.5">{view.history.slice(1).map((h) => <li key={h.revision}>v{h.revision} · {SCOPE_LABELS[h.scope_type]} · {STATE_LABELS[h.state]} · {h.created_at.slice(0, 10)} — {h.reason}</li>)}</ul>
        </details>
      )}
      <div className="mt-2"><OutcomeNotice notice={notice} testId="exclusivity-outcome" /></div>
    </section>
  );
}

export default Exclusivity;
