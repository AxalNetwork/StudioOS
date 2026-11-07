import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { teamsApi } from '../../../lib/api/teams';
import { companyLogoApi } from '../../../lib/api/companyLogo';
import { safeReadJSON } from '../../../lib/storage';
import { useUpdateCompanyDetails } from '../../../contexts/ActiveCompanyContext';
import {
  CURRENCY_CODES, DESCRIPTION_MAX, LABELS, LEAVE_PROMPT, LOGO_HINT, SECTIONS, STAGES, canEditCompany, changes, formOf, logoProblem, problemOf, readOnlyLine, regionsOf, regionsText, shownLogo, unsavedLine,
} from './generalFormModel';
import { CompanyMark, Failed, INK, MUTED, NotYours, PCard, Reading } from './portfolioUi.jsx';
import * as portfolio from './portfolioAdapter.js';

/**
 * D4152 (#4152 §5, ST2–ST6) — Company settings › General: one form, one
 * "Save changes". It reads `GET /api/company/:uid` and saves only what
 * changed through `PATCH /api/company/:uid`, for any company this member may
 * edit (not only the one active on this device). #4201: the logo tile (ST2)
 * holds a picked or removed logo until the same Save (ST2b, ST2c), and the
 * preview shows it. No URL box, no internal path, no explanation of the app.
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
  } else if (f === 'default_currency') {
    // An unrecorded currency is "Not recorded", never a guessed default; a stored code off the list is still shown.
    const codes = v && !CURRENCY_CODES.includes(v) ? [v, ...CURRENCY_CODES] : CURRENCY_CODES;
    input = (
      <select id={id} className={INPUT} value={v} disabled={disabled} onChange={(e) => set(f, e.target.value)} data-testid="general-default-currency">
        <option value="" data-testid="general-default-currency-none">Not recorded</option>
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
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

/**
 * #4201 (ST2): the logo tile. Replace picks a file (or one is dropped on the
 * tile), Remove clears it; either is held as `pending` until the form's Save.
 */
export function LogoTile({ name, row, pending, onPick, onRemove, onUndo, disabled, problem }) {
  const input = useRef(null);
  const shown = shownLogo(row, pending);
  const has = Boolean(shown);
  const pick = (file) => { if (file && !disabled) onPick(file); };
  return (
    <PCard title="Logo" testId="general-section-logo">
      <div className="flex flex-wrap items-center gap-4">
        <div role="group" aria-label="Company logo" data-testid="company-logo-tile"
          className={`rounded-xl border border-dashed border-axal-hairline p-2 dark:border-gray-700 ${disabled ? '' : 'cursor-pointer'}`}
          onDragOver={(e) => { if (!disabled) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer?.files?.[0]); }}>
          <CompanyMark name={name} size={64} logoUrl={shown} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className={`m-0 ${MUTED}`}>{LOGO_HINT}</p>
          <span className="flex flex-wrap gap-2">
            <button type="button" className={GHOST} disabled={disabled} onClick={() => input.current?.click()} data-testid="company-logo-replace">{has ? 'Replace' : 'Upload'}</button>
            {has && <button type="button" className={GHOST} disabled={disabled} onClick={onRemove} data-testid="company-logo-remove">Remove</button>}
            {pending && <button type="button" className={GHOST} disabled={disabled} onClick={onUndo} data-testid="company-logo-undo">Undo</button>}
          </span>
          {pending && !problem && <p className={`m-0 ${MUTED}`} data-testid="company-logo-pending">{pending.remove ? 'The logo will be removed when you save.' : 'The new logo is saved with the form.'}</p>}
          {problem && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="company-logo-problem">{problem}</p>}
          <input ref={input} type="file" accept="image/png,image/svg+xml,.png,.svg" className="hidden" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="company-logo-input" />
        </div>
      </div>
    </PCard>
  );
}

export default function CompanyGeneralForm({ uid, logoApi = companyLogoApi }) {
  const updateCompanyDetails = useUpdateCompanyDetails();
  const [state, setState] = useState({ status: 'loading', row: null });
  const [form, setForm] = useState(null);
  const [save, setSave] = useState({ status: 'idle', message: '' });
  const [tick, setTick] = useState(0);
  // #4201: a picked or removed logo, held until Save: { upload: File, preview } | { remove: true } | null.
  const [logo, setLogo] = useState(null);
  const [logoError, setLogoError] = useState(null);
  const holdLogo = useCallback((next) => {
    setLogo((was) => { if (was?.preview && typeof URL !== 'undefined') URL.revokeObjectURL?.(was.preview); return next; });
    setSave({ status: 'idle', message: '' });
  }, []);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', row: null });
    // #4736: a 404 is "not yours to open" (no Try again); any other failure is a real error that retries.
    portfolio.through(() => teamsApi.getCompany(uid)).then((r) => {
      if (!alive) return;
      if (r.available) { setState({ status: 'ready', row: r.value }); setForm(formOf(r.value)); }
      else setState({ status: r.notFound ? 'notFound' : 'error', row: null });
    });
    return () => { alive = false; };
  }, [uid, tick]);

  const row = state.row;
  const patch = useMemo(() => (form && row ? changes(form, row) : {}), [form, row]);
  const dirty = Object.keys(patch).length > 0 || logo !== null;
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
  const onPickLogo = (file) => {
    const why = logoProblem(file);
    setLogoError(why);
    if (why) return;
    holdLogo({ upload: file, preview: typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null });
  };
  const onSave = async () => {
    setSave({ status: 'saving', message: '' });
    try {
      // The logo first: its route answers with the company detail, and the fields' PATCH then applies on top.
      let updated = row;
      if (logo?.upload) updated = await logoApi.upload(uid, logo.upload);
      else if (logo?.remove) updated = await logoApi.remove(uid);
      if (logo) { holdLogo(null); setLogoError(null); }
      if (Object.keys(patch).length) updated = await api.updateCompany(uid, patch);
      setState({ status: 'ready', row: updated });
      setForm(formOf(updated));
      updateCompanyDetails(updated);
      setSave({ status: 'saved', message: '' });
    } catch (e) {
      setSave({ status: 'error', message: e?.message || '' });
    }
  };

  if (state.status === 'loading') return <PCard title="General"><Reading lines={4} /></PCard>;
  if (state.status === 'notFound') return <NotYours />;
  if (state.status === 'error') return <PCard title="General" testId="company-general"><Failed what="Settings" onRetry={() => setTick((n) => n + 1)} testId="company-general-unread" /></PCard>;

  const name = String(form.company_name || row.company_name || '').trim();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form className="flex flex-col gap-4" data-testid="company-general-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !problem) onSave(); }}>
        {!canEdit && <p className={`m-0 ${MUTED}`} data-testid="company-general-read-only">{readOnlyLine(row.company_name)}</p>}
        <LogoTile name={name} row={row} pending={logo} problem={logoError} disabled={!canEdit || save.status === 'saving'}
          onPick={onPickLogo} onRemove={() => { setLogoError(null); holdLogo({ remove: true }); }} onUndo={() => { setLogoError(null); holdLogo(null); }} />
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
                  : problem || unsavedLine(patch, logo)}
            </span>
            {dirty && <button type="button" className={GHOST} onClick={() => { setForm(formOf(row)); holdLogo(null); setLogoError(null); setSave({ status: 'idle', message: '' }); }} disabled={save.status === 'saving'}>Discard</button>}
            {dirty && <button type="submit" className={PRIMARY} disabled={!!problem || save.status === 'saving'} data-testid="company-general-save">{save.status === 'saving' ? 'Saving…' : save.status === 'error' ? 'Try again' : 'Save changes'}</button>}
          </div>
        )}
      </form>
      <PCard title="Preview" testId="company-general-preview">
        <p className={`m-0 mb-2 ${MUTED}`}>How {name || 'the company'} appears across the platform.</p>
        <span className="flex items-center gap-2">
          <CompanyMark name={name} size={28} logoUrl={shownLogo(row, logo)} />
          <span className={`text-[13.5px] font-semibold ${INK}`}>{name || 'Untitled company'}</span>
        </span>
        {form.description && <p className={`m-0 mt-2 text-[12.5px] ${INK}`}>{form.description}</p>}
        {regionsOf(form.international_presence).length > 0 && <p className={`m-0 mt-1 ${MUTED}`}>{regionsOf(form.international_presence).join(' · ')}</p>}
      </PCard>
    </div>
  );
}
