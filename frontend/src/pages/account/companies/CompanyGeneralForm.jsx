import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { teamsApi } from '../../../lib/api/teams';
import { safeReadJSON } from '../../../lib/storage';
import { useUpdateCompanyDetails } from '../../../contexts/ActiveCompanyContext';
import {
  DESCRIPTION_MAX, LABELS, LEAVE_PROMPT, SECTIONS, STAGES, canEditCompany, changes, formOf, problemOf, readOnlyLine, regionsOf, regionsText, unsavedLine,
} from './generalFormModel';
import { CompanyMark, Failed, INK, MUTED, PCard, Reading } from './portfolioUi.jsx';

/**
 * D4152 (#4152 §5, ST2–ST6) — Company settings › General: one form, one
 * "Save changes". It reads `GET /api/company/:uid` and saves only what
 * changed through `PATCH /api/company/:uid`, for any company this member may
 * edit (not only the one active on this device). No logo field until the
 * upload exists (#4201), no internal path, no explanation of the app.
 */

const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[13.5px] text-axal-ink disabled:cursor-not-allowed disabled:bg-axal-ground dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:disabled:bg-gray-800';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60';
const GHOST = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[13px] font-semibold text-axal-ink disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';

function Regions({ value, onChange, disabled }) {
  const [draft, setDraft] = useState('');
  const list = regionsOf(value);
  const add = () => { if (draft.trim()) { onChange(regionsText([...list, draft])); setDraft(''); } };
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="general-regions">
      {list.map((r) => (
        <span key={r} className="inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:text-gray-200">
          {r}
          {!disabled && <button type="button" aria-label={`Remove ${r}`} onClick={() => onChange(regionsText(list.filter((x) => x !== r)))}>×</button>}
        </span>
      ))}
      {!disabled && (
        <input className={`${INPUT} w-40`} value={draft} placeholder="Add a region" aria-label="Add a region"
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
      )}
    </div>
  );
}

function Field({ f, form, set, disabled }) {
  const v = form[f];
  const id = `general-${f}`;
  let input;
  if (f === 'stage') {
    input = (
      <select id={id} className={INPUT} value={v} disabled={disabled} onChange={(e) => set(f, e.target.value)}>
        {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  } else if (f === 'international_presence') {
    input = <Regions value={v} disabled={disabled} onChange={(x) => set(f, x)} />;
  } else if (f === 'description') {
    input = (
      <>
        <textarea id={id} className={`${INPUT} resize-none`} rows={3} maxLength={DESCRIPTION_MAX} value={v} disabled={disabled} onChange={(e) => set(f, e.target.value)} />
        <span className={`${MUTED} text-[11.5px] tabular-nums`}>{v.length} / {DESCRIPTION_MAX}</span>
      </>
    );
  } else {
    input = <input id={id} className={INPUT} value={v} disabled={disabled} inputMode={f === 'employee_count' ? 'numeric' : undefined} onChange={(e) => set(f, e.target.value)} />;
  }
  return (
    <label htmlFor={f === 'international_presence' ? undefined : id} className="flex flex-col gap-1">
      <span className={`text-[12px] font-semibold ${INK}`}>{LABELS[f]}{f === 'company_name' ? ' · required' : ''}</span>
      {input}
    </label>
  );
}

export default function CompanyGeneralForm({ uid }) {
  const updateCompanyDetails = useUpdateCompanyDetails();
  const [state, setState] = useState({ status: 'loading', row: null });
  const [form, setForm] = useState(null);
  const [save, setSave] = useState({ status: 'idle', message: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', row: null });
    teamsApi.getCompany(uid).then(
      (row) => { if (alive) { setState({ status: 'ready', row }); setForm(formOf(row)); } },
      () => { if (alive) setState({ status: 'error', row: null }); },
    );
    return () => { alive = false; };
  }, [uid, tick]);

  const row = state.row;
  const patch = useMemo(() => (form && row ? changes(form, row) : {}), [form, row]);
  const dirty = Object.keys(patch).length > 0;
  const canEdit = canEditCompany(row, safeReadJSON('user', {}));
  const problem = form ? problemOf(form) : null;

  // ST6d: a reload or a closed tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = LEAVE_PROMPT; return LEAVE_PROMPT; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = useCallback((f, v) => { setForm((x) => ({ ...x, [f]: v })); setSave({ status: 'idle', message: '' }); }, []);
  const onSave = async () => {
    setSave({ status: 'saving', message: '' });
    try {
      const updated = await api.updateCompany(uid, patch);
      setState({ status: 'ready', row: updated });
      setForm(formOf(updated));
      updateCompanyDetails(updated);
      setSave({ status: 'saved', message: '' });
    } catch (e) {
      setSave({ status: 'error', message: e?.message || '' });
    }
  };

  if (state.status === 'loading') return <PCard title="General"><Reading lines={4} /></PCard>;
  if (state.status === 'error') return <PCard title="General" testId="company-general"><Failed what="Settings" onRetry={() => setTick((n) => n + 1)} testId="company-general-unread" /></PCard>;

  const name = String(form.company_name || row.company_name || '').trim();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form className="flex flex-col gap-4" data-testid="company-general-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !problem) onSave(); }}>
        {!canEdit && <p className={`m-0 ${MUTED}`} data-testid="company-general-read-only">{readOnlyLine(row.company_name)}</p>}
        {SECTIONS.map((sec) => (
          <PCard key={sec.key} title={sec.title} testId={`general-section-${sec.key}`}>
            {sec.line && <p className={`m-0 mb-3 ${MUTED}`}>{sec.line}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {sec.fields.map((f) => (
                <div key={f} className={f === 'description' || f === 'international_presence' ? 'sm:col-span-2' : ''}>
                  <Field f={f} form={form} set={set} disabled={!canEdit || save.status === 'saving'} />
                </div>
              ))}
            </div>
          </PCard>
        ))}
        {canEdit && (dirty || save.status !== 'idle') && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid="company-general-savebar">
            <span className={`mr-auto ${MUTED}`} role="status">
              {save.status === 'saved' ? 'Saved · just now'
                : save.status === 'error' ? `Your changes were not saved. Try again.${save.message ? ` ${save.message}` : ''}`
                  : problem || unsavedLine(patch)}
            </span>
            {dirty && <button type="button" className={GHOST} onClick={() => { setForm(formOf(row)); setSave({ status: 'idle', message: '' }); }} disabled={save.status === 'saving'}>Discard</button>}
            {dirty && <button type="submit" className={PRIMARY} disabled={!!problem || save.status === 'saving'} data-testid="company-general-save">{save.status === 'saving' ? 'Saving…' : save.status === 'error' ? 'Try again' : 'Save changes'}</button>}
          </div>
        )}
      </form>
      <PCard title="Preview" testId="company-general-preview">
        <p className={`m-0 mb-2 ${MUTED}`}>How {name || 'the company'} appears across the platform.</p>
        <span className="flex items-center gap-2">
          <CompanyMark name={name} size={28} />
          <span className={`text-[13.5px] font-semibold ${INK}`}>{name || 'Untitled company'}</span>
        </span>
        {form.description && <p className={`m-0 mt-2 text-[12.5px] ${INK}`}>{form.description}</p>}
        {regionsOf(form.international_presence).length > 0 && <p className={`m-0 mt-1 ${MUTED}`}>{regionsOf(form.international_presence).join(' · ')}</p>}
      </PCard>
    </div>
  );
}
