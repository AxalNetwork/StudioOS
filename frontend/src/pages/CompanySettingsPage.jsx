import React, { useState, useEffect, useCallback } from 'react';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';
import { api } from '../lib/api';

// ---------- Shared helpers ---------------------------------------------------

function Card({ title, description, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-1">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm ' +
  'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500';

const STAGE_OPTIONS = [
  ['', '— select —'],
  ['idea', 'Idea'],
  ['pre_seed', 'Pre-seed'],
  ['seed', 'Seed'],
  ['series_a', 'Series A'],
  ['series_b', 'Series B'],
  ['series_c_plus', 'Series C+'],
  ['growth', 'Growth'],
  ['profitable', 'Profitable'],
  ['public', 'Public'],
];

// ---------- Toast ------------------------------------------------------------

function useFlash() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, (msg, kind = 'success') => setToast({ msg, kind })];
}

// ---------- Page -------------------------------------------------------------

export default function CompanySettingsPage() {
  const { company: activeCompany } = useActiveCompany();
  const [toast, flash] = useFlash();

  if (!activeCompany) {
    return (
      <div className="max-w-3xl p-6 mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Company Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-4 text-sm">
          You are not linked to any company yet. Create or join a company to manage its settings here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl p-6 mx-auto space-y-6" data-testid="company-settings-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Company Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Profile and details for{' '}
          <span className="font-medium">{activeCompany.company_name}</span>.
        </p>
      </div>

      {toast && (
        <div
          className={`rounded-lg px-4 py-2.5 text-sm ${
            toast.kind === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <CompanyProfileCard uid={activeCompany.uid} flash={flash} />
    </div>
  );
}

// ---------- Company profile card ---------------------------------------------

function CompanyProfileCard({ uid, flash }) {
  const { setCompany } = useActiveCompany();
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    api
      .getCompany(uid)
      .then(data => { if (!cancelled) setRow(data); })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Failed to load company profile'); });
    return () => { cancelled = true; };
  }, [uid]);

  const save = useCallback(
    async changes => {
      setBusy(true);
      try {
        const updated = await api.updateCompany(uid, changes);
        setRow(updated);
        // Keep the switcher display name in sync
        setCompany(prev => (prev ? { ...prev, ...changes } : prev));
        flash('Saved');
      } catch (e) {
        flash(e?.message || 'Failed to save', 'error');
      } finally {
        setBusy(false);
      }
    },
    [uid, flash, setCompany],
  );

  if (err) {
    return (
      <Card title="Company profile">
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      </Card>
    );
  }
  if (!row) {
    return (
      <Card title="Company profile">
        <p className="text-sm text-gray-500">Loading…</p>
      </Card>
    );
  }

  const set = (k, v) => setRow(r => ({ ...r, [k]: v }));
  const onBlur = k => {
    const v = row[k] ?? '';
    save({ [k]: v === '' ? null : v });
  };

  return (
    <>
      <Card title="Company profile" description="Basic information shown across Axal VC.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Company name">
            <input
              value={row.company_name || ''}
              onChange={e => set('company_name', e.target.value)}
              onBlur={() => onBlur('company_name')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Stage">
            <select
              value={row.stage || ''}
              onChange={e => { set('stage', e.target.value); save({ stage: e.target.value || null }); }}
              disabled={busy}
              className={inputCls}
            >
              {STAGE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Website">
            <input
              value={row.website || ''}
              onChange={e => set('website', e.target.value)}
              onBlur={() => onBlur('website')}
              disabled={busy}
              placeholder="https://…"
              className={inputCls}
            />
          </Field>
          <Field label="LinkedIn URL">
            <input
              value={row.linkedin_url || ''}
              onChange={e => set('linkedin_url', e.target.value)}
              onBlur={() => onBlur('linkedin_url')}
              disabled={busy}
              placeholder="https://linkedin.com/company/…"
              className={inputCls}
            />
          </Field>
          <Field label="International presence" hint="e.g. US, EU, APAC">
            <input
              value={row.international_presence || ''}
              onChange={e => set('international_presence', e.target.value)}
              onBlur={() => onBlur('international_presence')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Logo URL">
            <input
              value={row.logo_url || ''}
              onChange={e => set('logo_url', e.target.value)}
              onBlur={() => onBlur('logo_url')}
              disabled={busy}
              placeholder="https://…"
              className={inputCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea
                value={row.description || ''}
                onChange={e => set('description', e.target.value)}
                onBlur={() => onBlur('description')}
                disabled={busy}
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card
        title="Growth details"
        description="Business metrics used in investor matching and deal analysis."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Revenue range">
            <input
              value={row.revenue_range || ''}
              onChange={e => set('revenue_range', e.target.value)}
              onBlur={() => onBlur('revenue_range')}
              disabled={busy}
              placeholder="e.g. $1M–$5M ARR"
              className={inputCls}
            />
          </Field>
          <Field label="Employee count">
            <input
              type="number"
              min="0"
              value={row.employee_count ?? ''}
              onChange={e =>
                set('employee_count', e.target.value === '' ? null : Number(e.target.value))
              }
              onBlur={() => save({ employee_count: row.employee_count ?? null })}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Current products">
            <input
              value={row.current_products || ''}
              onChange={e => set('current_products', e.target.value)}
              onBlur={() => onBlur('current_products')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
          <Field label="Expansion goals">
            <input
              value={row.expansion_goals || ''}
              onChange={e => set('expansion_goals', e.target.value)}
              onBlur={() => onBlur('expansion_goals')}
              disabled={busy}
              className={inputCls}
            />
          </Field>
        </div>
      </Card>
    </>
  );
}
