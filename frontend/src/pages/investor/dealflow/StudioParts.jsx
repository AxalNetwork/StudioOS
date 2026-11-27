/**
 * D1242 (#3255) — the Studio lens's dialogs and panels, moved from the retired
 * `pages/DealsPage.jsx` as they were: the pass dialog (a reason is required,
 * task #127), the terms editor and the draft (D463), Why we passed, the stage
 * funnel over recorded moves and the Stage SLA preference. The lens
 * (`StudioLens.jsx`) opens them; nothing here reads on its own but the draft's
 * pickers.
 */
import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import {
  PASS_TAXONOMY, PASS_REASON_UNRECORDED, passReasonLabel, passReasonRevisit,
  SLA_PRESETS, slaPreset, fmtPct, fmtDays,
} from '../../../lib/dealFlow';

const PIPELINE = ['applied', 'scored', 'active', 'funded'];

export function DealTermsEditor({ deal, onDone, onCancel }) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const [form, setForm] = useState({
    target_raise: deal.target_raise ?? '', minimum_check: deal.minimum_check ?? '',
    valuation_cap: deal.valuation_cap ?? '', carry_pct: deal.carry_pct ?? '',
    management_fee_pct: deal.management_fee_pct ?? '', instrument: deal.instrument || '',
    spv_jurisdiction: deal.spv_jurisdiction || '', closing_deadline: deal.closing_deadline || '',
    website: deal.website || '', source: deal.source || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const input = 'w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';
  const label = 'block text-[11px] font-medium text-gray-500 mb-0.5 dark:text-gray-400';

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      const updated = await api.updateDeal(deal.id, {
        target_raise: num(form.target_raise),
        minimum_check: num(form.minimum_check),
        valuation_cap: num(form.valuation_cap),
        carry_pct: num(form.carry_pct),
        management_fee_pct: num(form.management_fee_pct),
        instrument: form.instrument || null,
        spv_jurisdiction: form.spv_jurisdiction || null,
        closing_deadline: form.closing_deadline || null,
        website: form.website || null,
        source: form.source.trim() || null,
      });
      onDone(updated);
    } catch (e) {
      setErr(e?.message || 'The terms could not be saved.');
      reportError('StudioLens:editTerms', e);
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3 dark:border-gray-700" data-testid="panel-edit-terms">
      <div className="grid grid-cols-2 gap-2">
        <div><label className={label}>Target Raise ($)</label><input type="number" value={form.target_raise} onChange={(e) => set('target_raise', e.target.value)} className={input} /></div>
        <div><label className={label}>Minimum Check ($)</label><input type="number" value={form.minimum_check} onChange={(e) => set('minimum_check', e.target.value)} className={input} /></div>
        <div><label className={label}>Valuation Cap ($)</label><input type="number" value={form.valuation_cap} onChange={(e) => set('valuation_cap', e.target.value)} className={input} /></div>
        <div><label className={label}>Instrument</label>
          <select value={form.instrument} onChange={(e) => set('instrument', e.target.value)} className={input}>
            {['SAFE', 'Convertible Note', 'Equity', 'SPV'].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div><label className={label}>SPV Jurisdiction</label><input value={form.spv_jurisdiction} onChange={(e) => set('spv_jurisdiction', e.target.value)} className={input} /></div>
        <div><label className={label}>Closing Deadline</label><input type="date" value={form.closing_deadline} onChange={(e) => set('closing_deadline', e.target.value)} className={input} /></div>
        <div><label className={label}>Carry (%)</label><input type="number" value={form.carry_pct} onChange={(e) => set('carry_pct', e.target.value)} className={input} /></div>
        <div><label className={label}>Management Fee (%)</label><input type="number" value={form.management_fee_pct} onChange={(e) => set('management_fee_pct', e.target.value)} className={input} /></div>
        <div className="col-span-2"><label className={label}>Website</label><input value={form.website} onChange={(e) => set('website', e.target.value)} className={input} placeholder="https://" /></div>
        <div className="col-span-2"><label className={label}>Source</label><input value={form.source} onChange={(e) => set('source', e.target.value)} className={input} placeholder="Where this deal came from" data-testid="input-edit-source" /></div>
      </div>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
        <button onClick={submit} disabled={saving} data-testid="button-save-terms"
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
          {saving && <Loader2 size={13} className="animate-spin" />} Save terms
        </button>
      </div>
    </div>
  );
}

export function PassModal({ deal, onClose, onConfirm, closes }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    // Belt and braces: the button is disabled without a reason, but a disabled
    // button is a suggestion. The worker 400s a missing reason regardless.
    if (!reason || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ reason, note: note.trim() });
    } catch (e) {
      reportError('StudioLens:pass', e);
      setError(e?.message || 'The pass was not recorded.');
      setSaving(false);
    }
  };

  const revisit = passReasonRevisit(reason);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Record a pass"
        className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-xl dark:bg-gray-900">
        <div className="flex items-start justify-between border-b border-gray-100 p-5 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Pass on {deal.project_name || `Deal #${deal.id}`}
            </h2>
            <div className="text-sm text-gray-500 capitalize">
              {deal.status}
              {typeof deal.days_in_stage === 'number' ? ` · ${deal.days_in_stage} days in stage` : ''}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            A reason is required. Passes are queryable later — this is how the fund remembers why it said no.
          </p>

          {/* D1242: a studio pass is not an investor's pass. */}
          {closes && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200" data-testid="pass-closes">
              {closes}
            </p>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Reason · required
            </legend>
            <div className="space-y-1.5">
              {PASS_TAXONOMY.map((r) => (
                <label key={r.key}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-2.5 text-sm ${
                    reason === r.key
                      ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60'}`}>
                  <input type="radio" name="pass-reason" value={r.key} className="mt-0.5"
                    checked={reason === r.key} onChange={() => setReason(r.key)} />
                  <span>
                    <span className="block font-medium text-gray-900 dark:text-gray-100">{r.label}</span>
                    <span className="block text-xs text-gray-500">{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="pass-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Note · optional
            </label>
            <textarea id="pass-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="The specifics. The reason above is what aggregates; this is what a partner reads back."
              className="w-full rounded-lg border border-gray-300 p-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
          </div>

          {revisit && (
            <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
              {revisit}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button onClick={submit} disabled={!reason || saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black dark:hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">
              {saving && <Loader2 size={15} className="animate-spin" />}
              {reason ? `Record pass · ${passReasonLabel(reason)}` : 'Select a reason to continue'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function PassAnalyticsPanel({ stats, active, onQuery }) {
  const buckets = Array.isArray(stats?.buckets) ? stats.buckets : [];
  const total = Number(stats?.total || 0);

  return (
    <section className="my-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Why we passed</h2>
        <span className="text-xs text-gray-500">
          {total === 0 ? 'No passes recorded yet' : `${total} pass${total === 1 ? '' : 'es'} recorded`}
        </span>
      </div>

      {total === 0 ? (
        <p className="text-sm text-gray-500">
          Once the fund records a pass, its reason is queryable here — revisiting a valuation pass
          a year later is the point of writing it down.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {buckets.map((b) => {
              const on = active === b.reason;
              return (
                <button key={b.reason} onClick={() => onQuery(b.reason)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
                    on ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}>
                  <span className="flex-1 text-gray-900 dark:text-gray-100">
                    {b.label}
                    {b.reason === PASS_REASON_UNRECORDED && (
                      <span className="ml-1.5 text-xs text-gray-500">· not backfilled</span>
                    )}
                  </span>
                  <span className="w-10 text-right font-medium text-gray-900 tabular-nums dark:text-gray-100">{b.count}</span>
                  {/* A null share means no passes at all — "0%" would assert a
                      measurement nobody made. */}
                  <span className="w-14 text-right text-xs text-gray-500 tabular-nums">{fmtPct(b.pct)}</span>
                </button>
              );
            })}
          </div>

          {stats?.unrecorded_note && (
            <p className="mt-2 text-xs text-gray-500">{stats.unrecorded_note}</p>
          )}

          {/* D1242: rounds intake scoring set to Not raising are not passes. */}
          {Number(stats?.intake_not_raising) > 0 && (
            <p className="mt-2 text-xs text-gray-500" data-testid="pass-intake-apart">
              {stats.intake_not_raising} {Number(stats.intake_not_raising) === 1 ? 'round' : 'rounds'} set to Not raising by intake scoring {Number(stats.intake_not_raising) === 1 ? 'is' : 'are'} not counted here: intake is not a pass.
            </p>
          )}

          {active && (
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {passReasonLabel(active)}
                </span>
                <button onClick={() => onQuery(active)} className="text-xs text-violet-600 hover:underline">
                  Clear filter
                </button>
              </div>
              {(stats.deals || []).length === 0 ? (
                <p className="text-sm text-gray-500">No deals passed for this reason yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {stats.deals.map((d) => (
                    <li key={d.id} className="text-sm">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {d.project_name || `Deal #${d.id}`}
                      </span>
                      {d.passed_at && <span className="ml-2 text-xs text-gray-500">{String(d.passed_at).slice(0, 10)}</span>}
                      {d.passed_by_name && <span className="ml-2 text-xs text-gray-500">· {d.passed_by_name}</span>}
                      {d.pass_note && <div className="text-xs text-gray-600 dark:text-gray-400">{d.pass_note}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!active && (
            <p className="mt-2 text-xs text-gray-500">
              Select a reason to query it — pass data is the fund&apos;s memory, and revisiting a
              valuation pass a year later is the point of recording it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function DraftDealModal({ onClose, onCreated }) {
  const [projects, setProjects] = useState([]);
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState({
    project_id: '', lead_partner_id: '', status: 'applied', description: '', website: '',
    target_raise: '', minimum_check: '', valuation_cap: '', carry_pct: '', management_fee_pct: '',
    instrument: 'SAFE', spv_jurisdiction: '', closing_deadline: '', source: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.listProjects?.().then(p => setProjects(Array.isArray(p) ? p : [])).catch(() => {});
    api.dealLeadPartners().then(l => setLeads(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const num = (v) => (v === '' || v == null ? null : Number(v));

  const submit = async () => {
    if (!form.project_id) { setErr('Select a company/project.'); return; }
    setSaving(true); setErr('');
    try {
      await api.draftDeal({
        project_id: Number(form.project_id),
        lead_partner_id: form.lead_partner_id ? Number(form.lead_partner_id) : null,
        status: form.status,
        description: form.description || null,
        website: form.website || null,
        target_raise: num(form.target_raise),
        minimum_check: num(form.minimum_check),
        valuation_cap: num(form.valuation_cap),
        carry_pct: num(form.carry_pct),
        management_fee_pct: num(form.management_fee_pct),
        instrument: form.instrument || null,
        spv_jurisdiction: form.spv_jurisdiction || null,
        closing_deadline: form.closing_deadline || null,
        source: form.source.trim() || null,
      });
      onCreated();
    } catch (e) {
      setErr(e.message || 'Could not create deal');
      reportError('DraftDealModal:submit', e);
    } finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';
  const label = 'block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 dark:bg-gray-900">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Draft Deal</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className={label}>Company / Project *</label>
              <select value={form.project_id} onChange={e => set('project_id', e.target.value)} className={input}>
                <option value="">Select…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Lead Partner</label>
                <select value={form.lead_partner_id} onChange={e => set('lead_partner_id', e.target.value)} className={input}>
                  <option value="">Unassigned</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Stage</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className={input}>
                  {PIPELINE.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={label}>Description</label>
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Website</label><input value={form.website} onChange={e => set('website', e.target.value)} className={input} placeholder="https://" /></div>
              <div><label className={label}>Instrument</label>
                <select value={form.instrument} onChange={e => set('instrument', e.target.value)} className={input}>
                  {['SAFE', 'Convertible Note', 'Equity', 'SPV'].map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div><label className={label}>Target Raise ($)</label><input type="number" value={form.target_raise} onChange={e => set('target_raise', e.target.value)} className={input} /></div>
              <div><label className={label}>Minimum Check ($)</label><input type="number" value={form.minimum_check} onChange={e => set('minimum_check', e.target.value)} className={input} /></div>
              <div><label className={label}>Valuation Cap ($)</label><input type="number" value={form.valuation_cap} onChange={e => set('valuation_cap', e.target.value)} className={input} /></div>
              <div><label className={label}>SPV Jurisdiction</label><input value={form.spv_jurisdiction} onChange={e => set('spv_jurisdiction', e.target.value)} className={input} placeholder="Delaware" /></div>
              <div><label className={label}>Carry (%)</label><input type="number" value={form.carry_pct} onChange={e => set('carry_pct', e.target.value)} className={input} /></div>
              <div><label className={label}>Management Fee (%)</label><input type="number" value={form.management_fee_pct} onChange={e => set('management_fee_pct', e.target.value)} className={input} /></div>
              <div className="col-span-2"><label className={label}>Closing Deadline</label><input type="date" value={form.closing_deadline} onChange={e => set('closing_deadline', e.target.value)} className={input} /></div>
              {/* D463 — where the deal came from. Free text on purpose: the
                  source taxonomy is the owner's call, and a select written
                  before it would enshrine a guess. */}
              <div className="col-span-2"><label className={label}>Source</label><input value={form.source} onChange={e => set('source', e.target.value)} className={input} placeholder="Where this deal came from — e.g. a referral, the Lab, inbound" data-testid="input-deal-source" /></div>
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>
          <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />} Create Deal
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Task #127 — Stage SLA. A VIEWER preference: it changes which cards look
 * urgent, never what is true about them, so the lens keeps it in the browser
 * (`safeWriteJSON('dealFlowSla')`) and never sends it to the server.
 */
export function SlaPicker({ sla, chooseSla }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-gray-500">Stage SLA</span>
      <div className="flex gap-1" role="group" aria-label="Stage SLA">
        {SLA_PRESETS.map((p) => (
          <button key={p.key} onClick={() => chooseSla(p.key)} aria-pressed={sla === p.key}
            className={`rounded-full border px-2.5 py-1 font-medium ${
              sla === p.key
                ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <span className="text-gray-500">
        Amber past {slaPreset(sla).amber}d · red past {slaPreset(sla).red}d in stage
      </span>
    </div>
  );
}

/**
 * D463 — the stage funnel over the recorded stage events: conversion is
 * measured on deals that ENTERED a stage inside the window, never on who is
 * standing in it now, and the panel says when recording began.
 */
export function StageFunnelPanel({ stageAnalytics }) {
  if (!stageAnalytics || !Array.isArray(stageAnalytics.stages)) return null;
  return (
    <section className="mb-5 bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800" data-testid="stage-analytics">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Stage funnel</h2>
        <span className="text-[11px] text-gray-500">
          {stageAnalytics.events_counted} recorded moves
          {stageAnalytics.recording_started_at ? ` · recording since ${String(stageAnalytics.recording_started_at).slice(0, 10)}` : ''}
        </span>
      </div>
      {stageAnalytics.unavailable ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{stageAnalytics.unavailable}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100 dark:border-gray-800">
                <th className="text-left py-1.5 pr-3">Stage</th>
                <th className="text-right py-1.5 px-3">Entered</th>
                <th className="text-right py-1.5 px-3">Advanced</th>
                <th className="text-right py-1.5 px-3">Conversion</th>
                <th className="text-right py-1.5 pl-3">Avg days in stage</th>
              </tr>
            </thead>
            <tbody>
              {stageAnalytics.stages.map((s) => (
                <tr key={s.stage} className="border-b border-gray-50 dark:border-gray-800/60">
                  <td className="py-2 pr-3 font-medium text-gray-900 capitalize dark:text-gray-100">{s.stage}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{s.entered}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{s.advanced}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtPct(s.conversion)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtDays(s.avg_days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!stageAnalytics.covers_full_window && stageAnalytics.recording_started_at && (
            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
              The window reaches back further than the record does — an empty early period is not a quiet quarter.
            </p>
          )}
        </div>
      )}
      {/* The source-quality table the canvas draws next to this: the source
          column exists now (migration 336), but the taxonomy and the
          term-sheet definition are the owner's call, so the route's own
          sentence renders rather than a table ranked by neither. */}
      {stageAnalytics.source_quality_unavailable && (
        <p className="mt-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400" data-testid="source-quality-note">
          {stageAnalytics.source_quality_unavailable}
        </p>
      )}
    </section>
  );
}
