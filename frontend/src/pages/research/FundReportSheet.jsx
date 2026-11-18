/**
 * D7169 (#7169) — Add quarter and Edit report, in the shared Sheet (FND-Q2,
 * FND-Q3, FND-Q4, FND-Q7, FND-Q8 "closing an edit", FND-Q9, FND-Q10 phone).
 *
 *   · Add: period, then source, money (US$), rates (%) and the multiple (×).
 *     Picking a quarter that already has a report offers to open it
 *     prefilled; what was typed is offered back there (owner's option A).
 *   · Edit: every saved value prefilled and marked Kept, New value, Replaced
 *     or Will be cleared. Emptying a saved field keeps it until Clear value is
 *     chosen. The change summary names each change and what is kept; the one
 *     primary action counts them. Only changed fields are sent, with the
 *     row's revision.
 *   · Errors keep what was typed: an error summary that links to each field,
 *     the Worker's own field errors, a per-field conflict review, save failed
 *     with Retry, offline, and an expired session (the edit is held in this
 *     tab only, owner's option A).
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Sheet from '../../ui/Sheet.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { researchFundReportsApi } from '../../lib/api/researchFundReports.js';
import {
  FIELD, FIELDS, carriedValues, changeSet, changeTitle, conflictRows, draftFrom, fieldState, fmtValue, lastClosedQuarter,
  parsePeriod, periodLabel, periodOf, periodRange, rebaseDraft, resolvedBody, saveLabel, serverFieldErrors,
} from './fundReportsModel.js';

export const HELD_KEY = (fundUid) => `fund-report-draft:${fundUid}`;
/** Hold an edit in this tab only (sessionStorage), so an expired session can offer it back. */
export function holdDraft(fundUid, held) {
  try { if (held) sessionStorage.setItem(HELD_KEY(fundUid), JSON.stringify(held)); else sessionStorage.removeItem(HELD_KEY(fundUid)); } catch { /* storage off: nothing is held */ }
}
export function readHeld(fundUid) {
  try { const raw = sessionStorage.getItem(HELD_KEY(fundUid)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-[13px] font-bold text-white hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const INPUT = 'min-h-[44px] w-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-axal-ink outline-none placeholder:text-gray-500 dark:text-gray-100 dark:placeholder:text-gray-400';
const CHIPS = {
  kept: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300',
  new: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-200',
  replaced: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-200',
  clear: 'border-dashed border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200',
  invalid: 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200',
};
const CHIP_WORD = { kept: 'Kept', new: 'New value', replaced: 'Replaced', clear: 'Will be cleared', invalid: 'Invalid entry' };
export function EditChip({ state }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-px text-[11px] font-bold ${CHIPS[state] || CHIPS.kept}`} data-edit-state={state}>{CHIP_WORD[state] || state}</span>;
}

const GROUPS = [
  ['source', 'Source', 'required for every report'],
  ['money', 'Money', 'US dollars only today'],
  ['rates', 'Rates', 'percent'],
  ['multiple', 'Multiple', 'times paid-in'],
];
const AFFIX = { usd: ['US$', null], pct: [null, '%'], mult: [null, '×'] };
const shown = (key, v) => fmtValue(key, v) || 'Not recorded';

function Field({ f, id, entry, saved, editing, showError, serverError, onText, onClear, onKeep, menuOpen, setMenu }) {
  const s = fieldState(f.key, entry, saved);
  const error = showError && s.state === 'invalid' ? s.error : (serverError || null);
  const [pre, suf] = AFFIX[f.kind] || [];
  const canClear = editing && !f.required && s.before !== null;
  const menuBtn = useRef(null);
  const chipState = error ? 'invalid' : s.state;
  const changed = s.state === 'new' || s.state === 'replaced' || s.state === 'clear' || s.state === 'invalid';
  const describedBy = [f.hint ? `${id}-h` : null, error ? `${id}-e` : null].filter(Boolean).join(' ') || undefined;
  const accessible = f.unitName ? `${f.label}, ${f.unitName}` : undefined;
  const input = f.kind === 'text'
    ? <textarea id={id} className={`${INPUT} min-h-[64px] py-2`} value={entry.text} onChange={(e) => onText(e.target.value)} aria-describedby={describedBy} aria-invalid={error ? true : undefined} placeholder="Optional" maxLength={2000} />
    : (
      <input
        id={id}
        className={`${INPUT} ${f.kind === 'url' ? '' : 'font-mono'}`}
        type={f.kind === 'date' ? 'date' : f.kind === 'url' ? 'url' : 'text'}
        inputMode={f.kind === 'usd' ? 'numeric' : f.kind === 'pct' || f.kind === 'mult' ? 'decimal' : undefined}
        value={s.state === 'clear' ? '' : entry.text}
        placeholder={s.state === 'clear' ? 'Not recorded after save' : f.kind === 'url' ? 'https://' : 'Not recorded'}
        onChange={(e) => onText(e.target.value)}
        aria-label={accessible}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
    );
  return (
    <div className={`flex flex-col gap-1 ${changed ? 'rounded-lg bg-violet-50/60 p-2 dark:bg-violet-500/5' : ''}`} data-field={f.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{f.label}{f.required ? <span className="sr-only"> (required)</span> : null}</label>
        {editing && <EditChip state={chipState} />}
      </div>
      {f.hint && <span id={`${id}-h`} className="text-[11.5px] text-axal-muted dark:text-gray-400">{f.hint}</span>}
      {error && <span id={`${id}-e`} className="text-[12px] font-semibold text-red-700 dark:text-red-300">{error}</span>}
      <div className={`flex items-center rounded-lg border bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-violet-600 dark:bg-gray-950 ${error ? 'border-red-500 dark:border-red-400' : 'border-axal-hairline dark:border-gray-700'}`}>
        {pre && <span className="pl-2.5 text-[12px] font-bold text-axal-muted dark:text-gray-400" aria-hidden="true">{pre}</span>}
        {input}
        {suf && <span className="pr-2.5 text-[12px] font-bold text-axal-muted dark:text-gray-400" aria-hidden="true">{suf}</span>}
        {canClear && (
          <button
            ref={menuBtn}
            type="button"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r-lg border-l border-axal-hairline text-axal-muted hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            aria-label={`${f.label} value options: keep, replace or clear`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenu(menuOpen ? null : f.key)}
          >⋯</button>
        )}
      </div>
      {menuOpen && canClear && (
        <div
          role="menu"
          aria-label={`${f.label} value options`}
          className="flex flex-col rounded-lg border border-axal-hairline bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          onKeyDown={(e) => {
            const items = Array.from(e.currentTarget.querySelectorAll('[role="menuitem"]'));
            const at = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); menuBtn.current?.focus(); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
          }}
        >
          <button type="button" role="menuitem" autoFocus className="min-h-[44px] rounded-md px-3 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { onKeep(); setMenu(null); menuBtn.current?.focus(); }}>Keep saved value ({shown(f.key, s.before)})</button>
          <button type="button" role="menuitem" className="min-h-[44px] rounded-md px-3 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { onClear(); setMenu(null); menuBtn.current?.focus(); }}>Clear value · save as Not recorded</button>
          <button type="button" role="menuitem" className="min-h-[44px] rounded-md px-3 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { setMenu(null); document.getElementById(id)?.focus(); }}>Type a new value</button>
        </div>
      )}
      {editing && s.state === 'kept' && s.blank && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400" role="group" aria-label={`${f.label} is empty`}>
          <span>Empty keeps the saved {shown(f.key, s.before)}.</span>
          <button type="button" className="min-h-[44px] font-bold text-violet-700 underline dark:text-violet-300" onClick={onKeep}>Keep saved value</button>
          <button type="button" className="min-h-[44px] font-bold text-violet-700 underline dark:text-violet-300" onClick={onClear}>Clear value</button>
        </div>
      )}
      {editing && (s.state === 'new' || s.state === 'replaced') && <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Was: {s.state === 'new' ? 'Not recorded' : <s>{shown(f.key, s.before)}</s>}</span>}
      {editing && s.state === 'clear' && <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Was: {shown(f.key, s.before)} · <button type="button" className="min-h-[44px] font-bold text-violet-700 underline dark:text-violet-300" onClick={onKeep}>Undo clear</button></span>}
      {editing && s.state === 'invalid' && s.before !== null && <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Saved value {shown(f.key, s.before)} is unchanged</span>}
    </div>
  );
}

function PeriodPicker({ id, period, onChange }) {
  const p = parsePeriod(period) || parsePeriod(lastClosedQuarter());
  const thisYear = new Date().getUTCFullYear();
  const years = [];
  for (let y = thisYear; y >= thisYear - 25; y -= 1) years.push(y);
  const sel = 'min-h-[44px] rounded-lg border border-axal-hairline bg-white px-2.5 text-[13px] font-semibold text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-bold text-axal-ink dark:text-gray-100">Reporting period</label>
      <span id={`${id}-h`} className="text-[11.5px] text-axal-muted dark:text-gray-400">The quarter the figures describe, not the date you enter them</span>
      <div className="flex flex-wrap gap-2">
        <select id={id} className={sel} value={p.year} aria-describedby={`${id}-h`} onChange={(e) => onChange(periodOf(Number(e.target.value), p.q))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className={sel} aria-label="Quarter" value={p.q} onChange={(e) => onChange(periodOf(p.year, Number(e.target.value)))}>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q} · {periodRange(periodOf(p.year, q), { withYear: false })}</option>)}
        </select>
      </div>
    </div>
  );
}

function Notice({ tone = 'info', role = 'status', title, children, action, focusRef }) {
  const tones = {
    info: 'border-axal-hairline bg-gray-50 dark:border-gray-700 dark:bg-gray-900',
    warn: 'border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10',
    error: 'border-red-300 bg-red-50 dark:border-red-500/50 dark:bg-red-500/10',
  };
  return (
    <div ref={focusRef} tabIndex={focusRef ? -1 : undefined} role={role} className={`flex flex-col gap-2 rounded-xl border p-3 text-[12.5px] text-axal-ink outline-none dark:text-gray-100 ${tones[tone]}`}>
      <b>{title}</b>
      {children && <div className="text-axal-muted dark:text-gray-300">{children}</div>}
      {action}
    </div>
  );
}

export default function FundReportSheet({ fundUid, reports, initial, onClose, onSaved }) {
  const uid = useId();
  const phone = usePhoneWidth();
  const [saved, setSaved] = useState(initial.saved || null);
  const [period, setPeriod] = useState(initial.saved?.period || initial.period || lastClosedQuarter());
  const [draft, setDraft] = useState(() => initial.draft || draftFrom(initial.saved || null));
  const [carried, setCarried] = useState(initial.carried || []);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [status, setStatus] = useState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'idle');
  const [conflict, setConflict] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [menu, setMenu] = useState(null);
  const [announce, setAnnounce] = useState(initial.saved ? `Edit ${periodLabel(initial.saved.period)} report. ${FIELDS.filter((f) => initial.saved[f.key] != null).length} values prefilled from the saved report.` : '');
  const summaryRef = useRef(null);
  const headingRef = useRef(null);
  const alertRef = useRef(null);
  const keepEditingRef = useRef(null);
  const lastEdited = useRef(null);

  const editing = !!saved;
  const existing = !editing ? (reports || []).find((r) => r.period === period) || null : null;
  const cs = useMemo(() => changeSet(draft, saved, { period }), [draft, saved, period]);
  const dirty = editing ? cs.changes.length > 0 || cs.errors.length > 0 : FIELDS.some((f) => (draft.fields[f.key]?.text || '').trim());
  const errorList = attempted ? [
    ...cs.errors.map((e) => ({ key: e.key, text: `${FIELD[e.key].short || FIELD[e.key].label}: ${e.error}` })),
    ...Object.entries(serverErrors).filter(([k]) => !cs.errors.some((e) => e.key === k)).map(([k, t]) => ({ key: k, text: `${FIELD[k]?.label || k}: ${t}` })),
  ] : [];

  useEffect(() => {
    const on = () => setStatus((s) => (s === 'offline' ? 'idle' : s));
    const off = () => setStatus('offline');
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => { if (confirmClose) keepEditingRef.current?.focus(); }, [confirmClose]);

  const edit = (key, next) => {
    lastEdited.current = key;
    setDraft((d) => ({ fields: { ...d.fields, [key]: { ...d.fields[key], ...next } } }));
    setServerErrors((e) => { if (!e[key]) return e; const { [key]: _drop, ...rest } = e; return rest; });
  };

  const openExisting = (report) => {
    const offer = carriedValues(draft, report);
    setSaved(report); setPeriod(report.period); setDraft(draftFrom(report)); setCarried(offer);
    setAttempted(false); setServerErrors({});
    setAnnounce(`Edit ${periodLabel(report.period)} report. ${FIELDS.filter((f) => report[f.key] != null).length} values prefilled from the saved report.`);
    setTimeout(() => headingRef.current?.focus(), 0);
  };

  const send = async (body, base) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return; }
    setStatus('saving'); setServerErrors({});
    holdDraft(fundUid, { period, reportUid: base?.uid || null, fields: draft.fields });
    try {
      const report = base
        ? await researchFundReportsApi.update(fundUid, base.uid, body, base.updated_at)
        : await researchFundReportsApi.create(fundUid, body);
      holdDraft(fundUid, null);
      const changes = base ? Object.entries(body).map(([key, to]) => ({ key, to, from: base[key] ?? null, state: to === null ? 'clear' : base[key] == null ? 'new' : 'replaced' })) : [];
      onSaved({ report, period, changes, added: !base });
    } catch (e) {
      const expired = e?.status === 401 || /session expired/i.test(e?.message || '');
      if (!expired) holdDraft(fundUid, null);
      const data = e?.data || {};
      if (e?.status === 409 && e?.code === 'period_exists' && data.report) { setStatus('idle'); openExisting(data.report); return; }
      if (e?.status === 409 && e?.code === 'report_changed' && data.report) {
        setStatus('idle');
        setConflict({ base, theirs: data.report, rows: conflictRows(base, body, data.report), picks: {} });
        return;
      }
      if (e?.status === 400) {
        setStatus('idle'); setAttempted(true); setServerErrors(serverFieldErrors(data));
        setTimeout(() => summaryRef.current?.focus(), 0);
        return;
      }
      setStatus(expired ? 'expired' : 'failed');
      setTimeout(() => alertRef.current?.focus(), 0);
    }
  };

  const save = () => {
    if (status === 'saving' || status === 'offline') return;
    if (!editing && existing) return;
    if (cs.errors.length) {
      setAttempted(true);
      setAnnounce(`${cs.errors.length} field${cs.errors.length === 1 ? ' needs' : 's need'} a fix. Nothing was saved.`);
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    if (editing && !cs.changes.length) return;
    send(cs.body, saved);
  };

  const saveConflict = () => {
    const body = resolvedBody(conflict.rows, conflict.picks);
    const theirs = conflict.theirs;
    setSaved(theirs); setDraft(rebaseDraft(theirs, body)); setConflict(null);
    if (!Object.keys(body).length) { onSaved({ report: theirs, period, changes: [], added: false }); return; }
    send(body, theirs);
  };
  const backToEditing = () => {
    const theirs = conflict.theirs; const body = cs.body;
    setSaved(theirs); setDraft(rebaseDraft(theirs, body)); setConflict(null);
  };

  const requestClose = () => { if (dirty && !confirmClose) setConfirmClose(true); else onClose(); };
  const keepEditing = () => {
    setConfirmClose(false);
    setTimeout(() => (lastEdited.current ? document.getElementById(`${uid}-${lastEdited.current}`) : headingRef.current)?.focus(), 0);
  };

  const title = conflict ? `${periodLabel(period)} changed while you were editing` : editing ? `Edit ${periodLabel(saved.period)} report` : 'Add quarter';
  const sub = conflict ? 'Saved in another session. Nothing of yours was saved or lost.' : editing ? 'Only fields you change are saved. Everything else keeps its saved value.' : 'A new quarterly report. Leave a metric blank if the source does not give it: it saves as Not recorded.';

  const keptWords = cs.kept.map((k) => `${FIELD[k.key].short || FIELD[k.key].label} ${shown(k.key, k.value)}`).join(' · ');
  const count = cs.changes.length;

  const footer = conflict ? (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={`${BTN} mr-auto`} onClick={backToEditing}>Back to editing</button>
      <button type="button" className={PRIMARY} onClick={saveConflict} disabled={status === 'saving'}>Save with these choices</button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {editing
        ? <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-400" data-testid="fund-report-count">{attempted && cs.errors.length ? 'Errors listed at the top' : `${count} change${count === 1 ? '' : 's'} · ${cs.kept.length} kept`}</span>
        : <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-400">Source URL and period are required</span>}
      {!phone && <button type="button" className={BTN} onClick={requestClose}>Cancel</button>}
      <button
        type="button"
        className={PRIMARY}
        onClick={save}
        aria-disabled={status === 'offline' || status === 'saving' || (editing && !count) || (!editing && !!existing) ? 'true' : undefined}
        data-testid="fund-report-save"
      >
        {status === 'saving' ? 'Saving…' : editing ? saveLabel(count) : 'Save quarter'}
      </button>
    </div>
  );

  return (
    <Sheet
      title={title}
      eyebrow="Quarterly reports"
      sub={sub}
      width={560}
      onClose={requestClose}
      onEscape={requestClose}
      footer={footer}
      testId="fund-report-sheet"
      focusKey={conflict ? 'conflict' : editing ? `edit-${saved.uid}` : 'add'}
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        {editing && <h3 ref={headingRef} tabIndex={-1} className="sr-only">{title}</h3>}

        {confirmClose && (
          <div role="alertdialog" aria-labelledby={`${uid}-dc`} aria-describedby={`${uid}-dcd`} className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] dark:border-amber-500/50 dark:bg-amber-500/10">
            <b id={`${uid}-dc`}>{editing ? `Discard ${count || 'your'} unsaved change${count === 1 ? '' : 's'} to ${periodLabel(period)}?` : 'Discard this new quarter?'}</b>
            <span id={`${uid}-dcd`} className="text-axal-muted dark:text-gray-300">{editing && count ? cs.changes.map((c) => `${FIELD[c.key].short || FIELD[c.key].label} ${c.to === null ? 'cleared' : fmtValue(c.key, c.to)}`).join(' · ') + ' has not been saved.' : 'What you typed has not been saved.'}</span>
            <div className="flex flex-wrap gap-2">
              <button ref={keepEditingRef} type="button" className={BTN} onClick={keepEditing}>Keep editing</button>
              <button type="button" className={BTN} onClick={() => { holdDraft(fundUid, null); onClose(); }}>Discard</button>
            </div>
          </div>
        )}

        {status === 'failed' && (
          <Notice tone="error" role="alert" focusRef={alertRef} title={`${periodLabel(period)} was not saved.`} action={<button type="button" className={`${PRIMARY} self-start`} onClick={save}>Retry save</button>}>
            The server did not answer. Your entries are still in the form.
          </Notice>
        )}
        {status === 'offline' && <Notice tone="warn" title="You are offline.">Save is paused until the connection returns. The form stays open.</Notice>}
        {status === 'expired' && (
          <Notice tone="warn" role="alert" focusRef={alertRef} title="Sign in again to save." action={<a className={`${PRIMARY} self-start`} href="/login">Sign in</a>}>
            Your edit to {periodLabel(period)} is held in this tab and offered back after sign-in.
          </Notice>
        )}

        {errorList.length > 0 && !conflict && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-[12.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 dark:border-red-500/50 dark:bg-red-500/10" data-testid="fund-report-errors">
            <b className="text-red-800 dark:text-red-200">{errorList.length} field{errorList.length === 1 ? ' needs' : 's need'} a fix. Nothing was saved; your entries are kept.</b>
            <ul className="mt-1 list-disc pl-5">
              {errorList.map((e) => (
                <li key={e.key}><a href={`#${uid}-${e.key}`} className="text-red-800 underline dark:text-red-200" onClick={(ev) => { ev.preventDefault(); const el = document.getElementById(`${uid}-${e.key}`); el?.scrollIntoView?.({ block: 'center' }); el?.focus(); }}>{e.text}</a></li>
              ))}
            </ul>
          </div>
        )}

        {conflict ? (
          <ConflictReview conflict={conflict} setConflict={setConflict} />
        ) : (
          <>
            {editing ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold text-axal-ink dark:text-gray-100">Reporting period</div>
                  <div className="font-mono text-[14px] font-bold">{periodLabel(saved.period)} <span className="font-sans text-[12px] font-normal text-axal-muted dark:text-gray-400">{periodRange(saved.period)}</span></div>
                </div>
                <span className="inline-flex items-center rounded-full border border-gray-300 px-2 py-px text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">Saved report</span>
              </div>
            ) : (
              <PeriodPicker id={`${uid}-period`} period={period} onChange={setPeriod} />
            )}

            {!editing && existing && (
              <Notice title={`${periodLabel(period)} already has a report.`} action={(
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className={BTN} onClick={() => document.getElementById(`${uid}-period`)?.focus()}>Choose another quarter</button>
                  <button type="button" className={PRIMARY} onClick={() => openExisting(existing)}>Open {periodLabel(period)} report</button>
                </div>
              )}>
                Opening it keeps every saved value; you change only what you edit.
              </Notice>
            )}

            {editing && carried.length > 0 && (
              <Notice title="You typed values before opening this report." action={(
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={BTN} onClick={() => { carried.forEach((c) => edit(c.key, { text: c.text, clear: false })); setCarried([]); }}>Use {carried.length === 1 ? 'it' : 'them'}</button>
                  <button type="button" className={BTN} onClick={() => setCarried([])}>Keep the saved values</button>
                </div>
              )}>
                {carried.map((c) => `You typed ${c.text} for ${FIELD[c.key].short || FIELD[c.key].label}.`).join(' ')} Use {carried.length === 1 ? 'it' : 'them'}?
              </Notice>
            )}

            {(phone && editing ? orderForPhone(cs) : GROUPS).map(([group, label, note]) => {
              const fields = FIELDS.filter((f) => (Array.isArray(group) ? group.includes(f.key) : f.group === group));
              if (!fields.length) return null;
              return (
                <fieldset key={Array.isArray(group) ? label : group} className="flex flex-col gap-3 rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
                  <legend className="px-1 text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{label}{note && !editing ? <span className="ml-1 font-semibold normal-case tracking-normal">{note}</span> : null}</legend>
                  {fields.map((f) => (
                    <Field
                      key={f.key}
                      f={f}
                      id={`${uid}-${f.key}`}
                      entry={draft.fields[f.key]}
                      saved={saved}
                      editing={editing}
                      showError={attempted}
                      serverError={serverErrors[f.key]}
                      onText={(text) => edit(f.key, { text, clear: false })}
                      onClear={() => edit(f.key, { text: '', clear: true })}
                      onKeep={() => edit(f.key, { text: draftFrom(saved).fields[f.key].text, clear: false })}
                      menuOpen={menu === f.key}
                      setMenu={setMenu}
                    />
                  ))}
                  {group === 'money' && <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Other currencies need a currency field per report. Until then the unit is fixed and shown.</p>}
                </fieldset>
              );
            })}
            {(!phone || !editing) && (
              <Field
                f={FIELD.notes}
                id={`${uid}-notes`}
                entry={draft.fields.notes}
                saved={saved}
                editing={editing}
                showError={attempted}
                serverError={serverErrors.notes}
                onText={(text) => edit('notes', { text, clear: false })}
                onClear={() => edit('notes', { text: '', clear: true })}
                onKeep={() => edit('notes', { text: draftFrom(saved).fields.notes.text, clear: false })}
                menuOpen={menu === 'notes'}
                setMenu={setMenu}
              />
            )}

            {editing && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[12.5px] dark:border-violet-500/40 dark:bg-violet-500/10" aria-live="polite" data-testid="fund-report-summary">
                <b>{changeTitle(cs.changes)}</b>
                {count > 0 && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {cs.changes.map((c) => (
                      <li key={c.key} className="flex flex-wrap items-center gap-1.5">
                        <EditChip state={c.state} /> {FIELD[c.key].short || FIELD[c.key].label}: {shown(c.key, c.from)} → <b className="font-mono">{shown(c.key, c.to)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {keptWords && <div className="mt-1 text-axal-muted dark:text-gray-300">Kept as saved: {keptWords}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Phone order (FND-Q9): period, then the fields being changed, then the kept metrics, then source and note. */
function orderForPhone(cs) {
  const changed = cs.changes.map((c) => c.key).concat(cs.errors.map((e) => e.key));
  const metrics = ['nav_cents', 'fund_size_cents', 'quarterly_return_bps', 'net_irr_bps', 'tvpi_bps'];
  const groups = [];
  const c = metrics.filter((k) => changed.includes(k));
  if (c.length) groups.push([c, 'Changing', '']);
  groups.push([metrics.filter((k) => !changed.includes(k)), 'Kept', '']);
  groups.push([['source_url', 'report_date', 'report_url', 'notes'], 'Source and note', '']);
  return groups;
}

function ConflictReview({ conflict, setConflict }) {
  const rows = conflict.rows;
  const asked = rows.filter((r) => r.kind === 'conflict');
  const same = rows.filter((r) => r.kind === 'same').map((r) => FIELD[r.key].short || FIELD[r.key].label);
  const body = resolvedBody(rows, conflict.picks);
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warn" role="alert" title="Review the two versions before saving.">Fields only one side changed are already merged.</Notice>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">
              <th scope="col" className="py-1.5 pr-2">Field</th><th scope="col" className="py-1.5 pr-2">Yours (not saved)</th><th scope="col" className="py-1.5 pr-2">Saved since</th><th scope="col" className="py-1.5">Keep</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
            {rows.filter((r) => r.kind !== 'same').map((r) => (
              <tr key={r.key}>
                <th scope="row" className="py-2 pr-2 font-semibold">{FIELD[r.key].short || FIELD[r.key].label}</th>
                <td className="py-2 pr-2 font-mono">{shown(r.key, r.mine)}</td>
                <td className="py-2 pr-2 font-mono">{shown(r.key, r.theirs)}</td>
                <td className="py-2">
                  {r.kind === 'conflict' ? (
                    <div role="radiogroup" aria-label={`Keep for ${FIELD[r.key].label}`} className="inline-flex rounded-lg border border-axal-hairline dark:border-gray-700">
                      {['mine', 'theirs'].map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={(conflict.picks[r.key] || 'mine') === k}
                          onClick={() => setConflict({ ...conflict, picks: { ...conflict.picks, [r.key]: k } })}
                          className={`min-h-[44px] px-3 text-[12px] font-bold ${(conflict.picks[r.key] || 'mine') === k ? 'bg-violet-700 text-white dark:bg-violet-600' : 'text-axal-ink dark:text-gray-100'}`}
                        >{k === 'mine' ? 'Mine' : 'Theirs'}</button>
                      ))}
                    </div>
                  ) : <span className="text-axal-muted dark:text-gray-400">{r.kind === 'mine' ? 'Yours (they did not change it)' : 'Theirs (you did not change it)'}</span>}
                </td>
              </tr>
            ))}
            {same.length > 0 && <tr><th scope="row" className="py-2 pr-2 font-semibold">{same.join(' · ')}</th><td colSpan={3} className="py-2 text-axal-muted dark:text-gray-400">Same on both sides</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[12.5px] dark:border-violet-500/40 dark:bg-violet-500/10" aria-live="polite">
        <b>Saving will write</b>
        <ul className="mt-1 flex flex-col gap-1">
          {Object.keys(body).length === 0 && <li>Nothing: the saved version already has every value you keep.</li>}
          {Object.entries(body).map(([k, v]) => <li key={k}>{FIELD[k].short || FIELD[k].label}: {shown(k, conflict.theirs[k])} → <b className="font-mono">{shown(k, v)}</b></li>)}
        </ul>
        <div className="mt-1 text-axal-muted dark:text-gray-300">Against the version saved since you opened it{asked.length ? `; ${asked.length} field${asked.length === 1 ? '' : 's'} chosen by you` : ''}.</div>
      </div>
    </div>
  );
}
