import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { companyLogoApi } from '../../../lib/api/companyLogo';
import { useAuth } from '../../../hooks/useAuthSync';
import { useLeaveGuard } from '../../../lib/leaveGuard';
import { useUpdateCompanyDetails } from '../../../contexts/ActiveCompanyContext';
import { useCompanyDetail } from './useCompanyDetail.js';
import {
  CURRENCY_CODES, DESCRIPTION_MAX, LABELS, LEAVE_PROMPT, LOGO_HINT, PROSE_MAX, REGIONS, REVENUE_RANGES, SECTIONS, STAGES, VERSION_CONFLICT, archivedLine, canEditCompany, changes, conflictLine, failedBeforeWriting, formOf, hasIntent, logoProblem, problemOf, readOnlyReasonLine, rebaseOnConflict, reconcile, regionCodesIn, regionsOf, regionsText, saveIntent, saveLine, shownLogo, unsavedLine, versionOf,
} from './generalFormModel';
import { CompanyMark, Failed, INK, MUTED, NotYours, PCard, Reading } from './portfolioUi.jsx';

/**
 * D4152 (#4152 §5, ST2–ST6) — Company settings › General: one form, one
 * "Save changes". It reads `GET /api/company/:uid` and saves only what
 * changed through `PATCH /api/company/:uid`, for any company this member may
 * edit (not only the one active on this device). #4201: the logo tile (ST2)
 * holds a picked or removed logo until the same Save (ST2b, ST2c), and the
 * preview shows it. No URL box, no internal path, no explanation of the app.
 *
 * #4963: every save sends the `profile_version` it loaded (`expected_version`). A stale save is a 409
 * `version_conflict` carrying the current company: the form is rebuilt on it (`rebaseOnConflict`). An archived
 * company is drawn read-only. D4961: the fields and the logo commit in one `saveSettings` request.
 */

const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[13.5px] text-axal-ink disabled:cursor-not-allowed disabled:bg-axal-ground dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:disabled:bg-gray-800';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60';
const GHOST = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[13px] font-semibold text-axal-ink disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';

/**
 * #4964: regions are canonical codes, chosen from the list (they feed matching), as a labelled group of checkboxes.
 * A legacy text entry no code covers is shown, never dropped, for the editor to place.
 */
function RegionCodes({ value, onChange, disabled, unmapped }) {
  const chosen = new Set(regionCodesIn(value));
  const toggle = (code) => onChange(regionCodesIn(chosen.has(code) ? [...chosen].filter((c) => c !== code) : [...chosen, code]));
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="general-regions">
      <legend className={`mb-1 p-0 text-[12px] font-semibold ${INK}`}>{LABELS.region_codes}</legend>
      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map(([code, label]) => (
          <label key={code} className={`inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-2.5 py-1 text-[12.5px] ${INK} dark:border-gray-700 ${disabled ? '' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={chosen.has(code)} disabled={disabled} onChange={() => toggle(code)} data-testid={`general-region-${code}`} />
            {label}
          </label>
        ))}
      </div>
      {unmapped?.length ? (
        <p className={`m-0 text-[12px] ${MUTED}`} data-testid="general-regions-unmapped">
          From your earlier list, not yet matched to a region: {unmapped.join(', ')}. Choose the regions they belong to.
        </p>
      ) : null}
    </fieldset>
  );
}

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

function Field({ f, form, set, disabled, row }) {
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
  } else if (f === 'region_codes') {
    return <RegionCodes value={v} disabled={disabled} unmapped={row?.regions?.source === 'derived' ? row.regions.unmapped : []} onChange={(x) => set(f, x)} />;
  } else if (f === 'revenue_range') {
    const legacy = v && !REVENUE_RANGES.some(([k]) => k === v);
    input = (
      <select id={id} className={INPUT} value={v} disabled={disabled} onChange={(e) => set(f, e.target.value)} data-testid="general-revenue-range">
        <option value="">Not recorded</option>
        {legacy ? <option value={v}>{v}</option> : null}
        {REVENUE_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  } else if (f === 'website' || f === 'linkedin_url') {
    input = <input id={id} type="url" inputMode="url" autoComplete="url" className={INPUT} value={v} disabled={disabled}
      placeholder={f === 'website' ? 'https://example.com' : 'https://www.linkedin.com/company/…'} onChange={(e) => set(f, e.target.value)} />;
  } else if (f === 'employee_count') {
    input = <input id={id} type="number" min={0} step={1} inputMode="numeric" className={INPUT} value={v} disabled={disabled} onChange={(e) => set(f, e.target.value)} />;
  } else if (f === 'international_presence') {
    input = <Regions value={v} disabled={disabled} onChange={(x) => set(f, x)} />;
  } else if (f === 'current_products' || f === 'expansion_goals') {
    input = (
      <>
        <textarea id={id} className={`${INPUT} resize-y`} rows={2} maxLength={PROSE_MAX} value={v} disabled={disabled} onChange={(e) => set(f, e.target.value)} />
        <span className={`${MUTED} text-[11.5px] tabular-nums`}>{v.length} / {PROSE_MAX}</span>
      </>
    );
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
    <label htmlFor={id} className="flex flex-col gap-1">
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
        {disabled ? (
          <div data-testid="company-logo-tile" className="rounded-xl border border-dashed border-axal-hairline p-2 dark:border-gray-700">
            <CompanyMark name={name} size={64} logoUrl={shown} />
          </div>
        ) : (
          <button type="button" data-testid="company-logo-tile" aria-label={has ? 'Replace the logo' : 'Upload a logo'}
            className="cursor-pointer rounded-xl border border-dashed border-axal-hairline p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet dark:border-gray-700"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer?.files?.[0]); }}>
            <CompanyMark name={name} size={64} logoUrl={shown} />
          </button>
        )}
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

export default function CompanyGeneralForm({ uid, logoApi = companyLogoApi, reader }) {
  const updateCompanyDetails = useUpdateCompanyDetails();
  const { user: me } = useAuth();
  // #4964: the page's one company read, shared with the header. A write publishes its answer.
  const detail = useCompanyDetail(uid, reader ? { reader } : undefined);
  const state = detail;
  const [form, setForm] = useState(null);
  const [save, setSave] = useState({ status: 'idle', message: '' });
  const builtFrom = useRef(null);
  const setState = useCallback((next) => { builtFrom.current = next.row; detail.setRow(next.row); }, [detail.setRow]);
  // #4201: a picked or removed logo, held until Save: { upload: File, preview } | { remove: true } | null.
  const [logo, setLogo] = useState(null);
  const [logoError, setLogoError] = useState(null);
  const holdLogo = useCallback((next) => {
    setLogo((was) => { if (was?.preview && typeof URL !== 'undefined') URL.revokeObjectURL?.(was.preview); return next; });
    setSave({ status: 'idle', message: '' });
  }, []);
  // A row from the shared read rebuilds the form. A row this form published (builtFrom) does not, and neither does
  // a re-read made while the editor still holds unsaved changes.
  useEffect(() => {
    if (detail.status !== 'ready' || !detail.row || detail.row === builtFrom.current) return;
    if (builtFrom.current) return;
    builtFrom.current = detail.row;
    setForm(formOf(detail.row));
  }, [detail.status, detail.row]);

  const row = state.row;
  const busy = save.status === 'saving' || save.status === 'reconciling';
  const patch = useMemo(() => (form && row ? changes(form, row) : {}), [form, row]);
  const dirty = Object.keys(patch).length > 0 || logo !== null;
  const archived = Boolean(row?.archived_at);
  // D4960's `viewer.can_edit` when the read carries it; #4964's `viewer_can_edit` otherwise. Archived is never editable.
  const serverEdit = row?.viewer && typeof row.viewer.can_edit === 'boolean'
    ? row.viewer.can_edit
    : (typeof row?.viewer_can_edit === 'boolean' ? row.viewer_can_edit : canEditCompany(row, me));
  const canEdit = serverEdit && !archived;
  const problem = form ? problemOf(form, row) : null;

  // ST6d, D4961: a reload, a closed tab, a link to Team, Legal or Projects, any other in-app move and the
  // browser's Back all ask first while there are unsaved changes (lib/leaveGuard.js).
  useLeaveGuard(dirty, LEAVE_PROMPT);

  const set = useCallback((f, v) => { setForm((x) => ({ ...x, [f]: v })); setSave({ status: 'idle', message: '' }); }, []);
  const onPickLogo = (file) => {
    const why = logoProblem(file);
    setLogoError(why);
    if (why) return;
    holdLogo({ upload: file, preview: typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null });
  };
  // The company as the server has it now, or null when it cannot be read. Never throws.
  const readFresh = useCallback(async () => {
    const next = await detail.reload();
    return next?.status === 'ready' ? next.row : null;
  }, [detail]);

  // One authoritative state: the form, the preview, the active company and the switcher all take it (D4961).
  const settle = (updated, kind) => {
    setState({ status: 'ready', row: updated });
    setForm(formOf(updated));
    holdLogo(null);
    setLogoError(null);
    updateCompanyDetails(updated);
    setSave({ status: 'saved', message: saveLine(kind) });
  };

  // A failure that may have written something: look at the server before saying anything about what happened.
  const afterFailure = async (e, intent, before) => {
    if (failedBeforeWriting(e)) {
      // The Worker checks everything before it writes, so a 4xx changed nothing.
      setSave({ status: 'error', check: false, message: saveLine('not_saved', { detail: e?.message || '' }) });
      return;
    }
    setSave({ status: 'reconciling', message: 'Checking what was saved…' });
    const fresh = await readFresh();
    if (!fresh) { setSave({ status: 'unknown', check: true, message: saveLine('unknown') }); return; }
    const result = reconcile(fresh, intent, before, uid);
    if (result.outcome === 'all') { settle(fresh, 'saved_after_check'); return; }
    if (result.outcome === 'none') {
      // A timeout's own sentence says the outcome is unknown; the re-read has now settled it.
      setSave({ status: 'error', check: false, message: saveLine('not_saved', { detail: e?.code === 'timeout' ? '' : (e?.message || '') }) });
      return;
    }
    // Part of it is in: the row is now the baseline, the rest stays pending.
    setState({ status: 'ready', row: fresh });
    updateCompanyDetails(fresh);
    if (result.logoSaved) { holdLogo(null); setLogoError(null); }
    setSave({ status: 'partly', check: true, message: saveLine('partly', { result }) });
  };

  const onSave = async ({ checkFirst = false } = {}) => {
    let intent = saveIntent(patch, logo);
    if (!hasIntent(intent)) return;
    let baseline = row;
    setSave({ status: checkFirst ? 'reconciling' : 'saving', message: checkFirst ? 'Checking what was saved…' : '' });
    if (checkFirst) {
      // A retry never resends what already committed: look first, send only what is missing.
      const fresh = await readFresh();
      if (fresh) {
        const result = reconcile(fresh, intent, row, uid);
        if (result.outcome === 'all') { settle(fresh, 'saved_after_check'); return; }
        if (result.outcome === 'some') {
          baseline = fresh;
          setState({ status: 'ready', row: fresh });
          updateCompanyDetails(fresh);
          if (result.logoSaved) { holdLogo(null); setLogoError(null); }
          intent = saveIntent(changes(form, fresh), result.logoSaved ? null : logo);
        }
      }
      setSave({ status: 'saving', message: '' });
    }
    try {
      settle(await logoApi.saveSettings(uid, { ...intent, expectedVersion: versionOf(baseline) }), 'saved');
    } catch (e) {
      const current = e?.code === VERSION_CONFLICT ? e?.data?.company : null;
      if (current && typeof current === 'object') {
        const { form: next, conflicts } = rebaseOnConflict(form, baseline, current);
        setState({ status: 'ready', row: current });
        setForm(next);
        updateCompanyDetails(current);
        setSave({ status: 'conflict', message: conflictLine(conflicts) });
        return;
      }
      await afterFailure(e, intent, baseline);
    }
  };

  // Discard goes back to what the server holds, for the logo and for every field, not to a copy kept in the page.
  const onDiscard = async () => {
    setSave({ status: 'reconciling', message: 'Reading the saved company…' });
    builtFrom.current = null;
    const fresh = await readFresh();
    const base = fresh || row;
    setState({ status: 'ready', row: base });
    setForm(formOf(base));
    holdLogo(null);
    setLogoError(null);
    if (fresh) updateCompanyDetails(fresh);
    setSave({ status: 'idle', message: '' });
  };

  if (state.status === 'loading' || (state.status === 'ready' && !form)) return <PCard title="General"><Reading lines={4} /></PCard>;
  if (state.status === 'notFound') return <NotYours />;
  if (state.status === 'error') return <PCard title="General" testId="company-general"><Failed what="Settings" onRetry={() => { builtFrom.current = null; detail.reload(); }} testId="company-general-unread" /></PCard>;

  const name = String(form.company_name || row.company_name || '').trim();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form className="flex flex-col gap-4" data-testid="company-general-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !problem && !busy) onSave({ checkFirst: ['error', 'partly', 'unknown'].includes(save.status) && save.check !== false }); }}>
        {archived
          ? <p className={`m-0 ${MUTED}`} data-testid="company-general-archived">{archivedLine(row.company_name)}</p>
          : !canEdit && <p className={`m-0 ${MUTED}`} data-testid="company-general-read-only">{readOnlyReasonLine(row)}</p>}
        <LogoTile name={name} row={row} pending={logo} problem={logoError} disabled={!canEdit || busy}
          onPick={onPickLogo} onRemove={() => { setLogoError(null); holdLogo({ remove: true }); }} onUndo={() => { setLogoError(null); holdLogo(null); }} />
        {SECTIONS.map((sec) => (
          <PCard key={sec.key} title={sec.title} testId={`general-section-${sec.key}`}>
            {sec.line && <p className={`m-0 mb-3 ${MUTED}`}>{sec.line}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {sec.fields.map((f) => (
                <div key={f} className={['description', 'international_presence', 'region_codes', 'current_products', 'expansion_goals'].includes(f) ? 'sm:col-span-2' : ''}>
                  <Field f={f} form={form} set={set} row={row} disabled={!canEdit || busy} />
                </div>
              ))}
            </div>
          </PCard>
        ))}
        {canEdit && (dirty || save.status !== 'idle') && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid="company-general-savebar">
            <span className={`mr-auto ${MUTED}`} role="status" data-testid="company-general-status">
              {busy || ['saved', 'error', 'partly', 'unknown'].includes(save.status) ? (save.message || (save.status === 'saving' ? 'Saving…' : ''))
                : problem || unsavedLine(patch, logo)}
            </span>
            {dirty && <button type="button" className={GHOST} onClick={onDiscard} disabled={busy} data-testid="company-general-discard">Discard</button>}
            {dirty && (
              <button type="submit" className={PRIMARY} disabled={!!problem || busy} data-testid="company-general-save">
                {save.status === 'saving' ? 'Saving…' : save.status === 'reconciling' ? 'Checking…' : ['error', 'partly', 'unknown'].includes(save.status) ? 'Try again' : 'Save changes'}
              </button>
            )}
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
