/**
 * D1240 (#3253) — Deal flow's controls (DLS1, DLS3–DLS5): search, the filter
 * chips, the Filters drawer, the Sort, Columns and Card scopes popovers, and
 * Saved views with its Save view and Delete dialogs. Every change of settings
 * is an address (`settingsHref`), so a link reopens the view; a write (save,
 * delete, add to the flow) opens a dialog in the page that says what it
 * changes, never a browser pop-up.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { reportError } from '../../../lib/log';
import { dealViewsApi } from '../../../lib/api/dealViews.js';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import {
  BOARD_STAGES, COLUMNS, ENTERED_WORD, MAX_CARD_SCOPES, MIN_BANDS, MIN_CONF, OWNERS, ROUND_KEYS, SCOPE_KEYS, SCOPE_LABEL, SORT_FIELDS, SORT_LAST,
  STAGE_WORD, emptyFilters, filterChips, filterCount, keepsLines, sortLabel, specOf, toggleCard, toggleColumn,
} from './flowModel';
import { roundWord } from './dealFlowModel';
import Sheet from '../../../ui/Sheet.jsx';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
export const TOOL = 'inline-flex items-center gap-1.5 rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CHIP = (on) => `rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`;
const REFUSED = 'm-0 text-[12.5px] text-red-700 dark:text-red-300';

/** A button with a panel under it; Escape and a second press close it. */
export function Popover({ label, testId, children, badge = null, wide = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener?.('keydown', key);
    return () => document.removeEventListener?.('keydown', key);
  }, [open]);
  return (
    <div className="relative">
      <button type="button" className={TOOL} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {label}{badge != null && <span className="rounded-full bg-violet-600 px-1.5 text-[10.5px] text-white dark:bg-violet-500">{badge}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={typeof label === 'string' ? label : undefined}
          className={`absolute left-0 z-30 mt-1 ${wide ? 'w-80' : 'w-64'} rounded-xl border border-axal-hairline bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900`} data-testid={`${testId}-panel`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

const Box = ({ checked, onChange, label, disabled = false, testId }) => (
  <label className={`flex items-center gap-2 py-0.5 text-[13px] ${disabled ? 'opacity-50' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} data-testid={testId} />{label}
  </label>
);

/** DLS3 Sort: by a scope (score or confidence), Your weighting, Fit, days, ask or name; unscored last. */
export function SortPopover({ sort, onSort }) {
  return (
    <Popover label={`Sort: ${sortLabel(sort.by)}`} testId="dealflow-sort" wide>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1"><span className={EYE}>Sort by</span>
          <select className={FIELD} value={sort.by} onChange={(e) => onSort({ ...sort, by: e.target.value })} data-testid="dealflow-sort-by">
            {SORT_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <div className="flex gap-1.5">
          {[['desc', 'Highest first'], ['asc', 'Lowest first']].map(([d, w]) => <button key={d} type="button" aria-pressed={sort.dir === d} className={CHIP(sort.dir === d)} onClick={() => onSort({ ...sort, dir: d })} data-testid={`dealflow-sort-${d}`}>{w}</button>)}
        </div>
        {SCOPE_KEYS.includes(sort.by) && (
          <div className="flex gap-1.5">
            {[['score', 'Sort by score'], ['confidence', 'Sort by confidence']].map(([m, w]) => <button key={m} type="button" aria-pressed={sort.mode === m} className={CHIP(sort.mode === m)} onClick={() => onSort({ ...sort, mode: m })}>{w}</button>)}
          </div>
        )}
        {sort.by === 'weighting' && <p className={MUTED}>Your own weight per scope, set in the scoring weighting dialog. It never changes a score.</p>}
        <p className={MUTED}>A score here is its band (Strong, Fair, Weak), then its confidence. {SORT_LAST}</p>
      </div>
    </Popover>
  );
}

/** DLS3 Columns: Venture is always shown; Reset puts the canvas's back. */
export function ColumnsPopover({ columns, onColumns, defaults }) {
  return (
    <Popover label="Columns" testId="dealflow-columns" wide>
      <div className="flex max-h-80 flex-col overflow-y-auto">
        <span className={MUTED}>Venture · always shown</span>
        {COLUMNS.map((c) => <Box key={c.id} checked={columns.includes(c.id)} onChange={() => onColumns(toggleColumn(columns, c.id))} label={c.label} testId={`dealflow-col-${c.id}`} />)}
        <button type="button" className="mt-2 w-fit text-[12.5px] font-semibold underline" onClick={() => onColumns([...defaults])} data-testid="dealflow-columns-reset">Reset to default</button>
      </div>
    </Popover>
  );
}

/** DLS3 Card scopes: up to three scopes on each board card. */
export function CardScopesPopover({ cards, onCards }) {
  return (
    <Popover label="Card scopes" testId="dealflow-cards" wide>
      <p className={MUTED}>Pick up to three scopes for board cards.</p>
      {SCOPE_KEYS.map((k) => <Box key={k} checked={cards.includes(k)} disabled={!cards.includes(k) && cards.length >= MAX_CARD_SCOPES} onChange={() => onCards(toggleCard(cards, k))} label={SCOPE_LABEL[k]} testId={`dealflow-card-${k}`} />)}
      {cards.length >= MAX_CARD_SCOPES && <p className={MUTED} data-testid="dealflow-cards-full">{cards.length} of {MAX_CARD_SCOPES} picked. Untick one to pick another.</p>}
    </Popover>
  );
}

/** The chips under the toolbar (DLS1): each filter on, and Clear all. */
export function FilterChips({ filters, onFilters }) {
  const chips = filterChips(filters);
  if (!chips.length) return null;
  const drop = (id) => {
    const f = { ...filters, min: { ...filters.min } };
    if (id.startsWith('min-')) delete f.min[id.slice(4)];
    else f[id] = id === 'owner' ? '' : [];
    onFilters(f);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="dealflow-chips">
      {chips.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[12px] text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200">
          {c.word}<button type="button" aria-label={`Remove ${c.word}`} className="hover:text-violet-950 dark:hover:text-white" onClick={() => drop(c.id)}>×</button>
        </span>
      ))}
      <button type="button" className="text-[12.5px] font-semibold underline" onClick={() => onFilters({ ...emptyFilters(), q: filters.q })} data-testid="dealflow-chips-clear">Clear all</button>
    </div>
  );
}

/** DLS4 Filters: a drawer of 480 over the view. Show applies; Clear empties. */
export function FiltersDrawer({ filters, sectors, onApply, onClose, count }) {
  const [f, setF] = useState(() => ({ ...filters, min: { ...filters.min } }));
  const flip = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const group = (title, k, entries, testId) => (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className={EYE}>{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([v, w]) => <button key={v} type="button" aria-pressed={f[k].includes(v)} className={CHIP(f[k].includes(v))} onClick={() => flip(k, v)} data-testid={`${testId}-${v}`}>{w}</button>)}
      </div>
    </fieldset>
  );
  return (
    <Sheet label="Filters" title="Filters" sub={`${filterCount(f)} filters on`} onClose={onClose} width={480} testId="dealflow-filters"
      footer={(
        <div className="flex justify-between gap-2">
          <button type="button" className={actionGhost} onClick={() => setF({ ...emptyFilters(), q: f.q })} data-testid="dealflow-filters-clear">Clear</button>
          <button type="button" className={actionPrimary} onClick={() => onApply(f)} data-testid="dealflow-filters-show">Show{count ? ` ${count(f)} deals` : ''}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 text-[13px]">
        {group('My stage', 'stage', [...BOARD_STAGES, 'passed'].map((s) => [s, STAGE_WORD[s]]), 'dealflow-f-stage')}
        {group('Round status', 'round', ROUND_KEYS.map((s) => [s, roundWord(s)]), 'dealflow-f-round')}
        {group('How it entered', 'via', Object.entries(ENTERED_WORD), 'dealflow-f-via')}
        {sectors.length > 0 && group('Sector', 'sector', sectors.map((s) => [s, s]), 'dealflow-f-sector')}
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className={EYE}>Owner</legend>
          <div className="flex flex-wrap gap-1.5">{OWNERS.map((o) => <button key={o.id || 'any'} type="button" aria-pressed={f.owner === o.id} className={CHIP(f.owner === o.id)} onClick={() => setF({ ...f, owner: o.id })}>{o.label}</button>)}</div>
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={EYE}>Scores · minimum band</legend>
          <p className={MUTED}>Scores read as bands (Strong, Fair, Weak) with a confidence; a minimum keeps deals at that band or better.</p>
          {SCOPE_KEYS.map((k) => (
            <label key={k} className="flex items-center justify-between gap-2">
              <span>{SCOPE_LABEL[k]}</span>
              <select className={`${FIELD} w-40`} value={f.min[k] || ''} onChange={(e) => setF({ ...f, min: { ...f.min, [k]: e.target.value } })} data-testid={`dealflow-f-min-${k}`}>
                {MIN_BANDS.map((b) => <option key={b.id || 'any'} value={b.id}>{b.label}</option>)}
              </select>
            </label>
          ))}
          <label className="flex items-center justify-between gap-2"><span>Minimum confidence</span>
            <select className={`${FIELD} w-40`} value={f.conf} onChange={(e) => setF({ ...f, conf: e.target.value })} data-testid="dealflow-f-conf">
              {MIN_CONF.map((c) => <option key={c.id || 'any'} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <Box checked={f.unscored} onChange={() => setF({ ...f, unscored: !f.unscored })} label="Include deals not scored on these scopes" testId="dealflow-f-unscored" />
        </fieldset>
        <p className={MUTED}>Company stage, region, ask range, instrument and flags are not on the deal list’s read yet, so they are not offered here.</p>
      </div>
    </Sheet>
  );
}

/** DLS5 B: Save view, with what it keeps, who sees it and the default. A changed view saves over itself or as new. */
export function SaveViewDialog({ current, canShare, editing = null, onClose, onSaved }) {
  const [name, setName] = useState(editing?.name || '');
  const [shared, setShared] = useState(!!editing?.shared_with_firm);
  const [def, setDef] = useState(!!editing?.is_default);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const ok = name.trim().length > 0 && name.trim().length <= 100;
  const save = async () => {
    if (lock.current || !ok) return;
    lock.current = true; setBusy(true); setError('');
    const body = { name: name.trim(), spec: specOf(current), shared_with_firm: shared, is_default: def };
    try {
      const saved = editing ? await dealViewsApi.update(editing.uid, editing.version, body) : await dealViewsApi.create(body);
      lock.current = false; onSaved(saved);
    } catch (e) { reportError('DealFlow:saveView', e); setError(e?.message || 'The view could not be saved. Try again.'); } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={editing ? 'Save changes' : 'Save view'} title={editing ? `Save changes to ${editing.name}` : 'Save view'} onClose={() => { if (!lock.current) onClose(); }} width={520} testId="dealflow-save-view"
      footer={(
        <div className="flex flex-col gap-2">
          {error && <p className={REFUSED} role="alert" data-testid="dealflow-save-view-refused">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Back</button>
            <button type="button" className={actionPrimary} onClick={save} disabled={!ok || busy} data-testid="dealflow-save-view-go">{busy ? 'Saving…' : editing ? 'Save changes' : 'Save view'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1"><span className={EYE}>Name · required</span>
          <input className={FIELD} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-testid="dealflow-save-view-name" />
        </label>
        <div className="flex flex-col gap-0.5"><span className={EYE}>What it keeps</span>
          <ul className="m-0 list-disc pl-5" data-testid="dealflow-save-view-keeps">{keepsLines(current).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0"><legend className={EYE}>Who sees it</legend>
          <label className="flex items-center gap-2"><input type="radio" name="share" checked={!shared} onChange={() => setShared(false)} /> Only me</label>
          <label className={`flex items-center gap-2 ${canShare ? '' : 'opacity-50'}`}><input type="radio" name="share" checked={shared} disabled={!canShare && !shared} onChange={() => setShared(true)} data-testid="dealflow-save-view-firm" /> My firm</label>
          {!canShare && <p className={MUTED}>Sharing with your firm needs an active Institutional firm account.</p>}
        </fieldset>
        <Box checked={def} onChange={() => setDef((v) => !v)} label="Make it my default" testId="dealflow-save-view-default" />
        <p className={MUTED}>A view keeps settings only. It never opens a deal, and never changes a score.</p>
      </div>
    </Lightbox>
  );
}

/** Delete a view of your own, after saying what goes. */
export function DeleteViewDialog({ view, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await dealViewsApi.remove(view.uid, view.version); onDeleted(); } catch (e) { reportError('DealFlow:deleteView', e); setError(e?.message || 'The view could not be deleted. Try again.'); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Delete view" title={`Delete ${view.name}?`} onClose={onClose} width={480} testId="dealflow-delete-view"
      footer={(
        <div className="flex flex-col gap-2">
          {error && <p className={REFUSED} role="alert">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Back</button><button type="button" className={actionPrimary} onClick={go} disabled={busy} data-testid="dealflow-delete-view-go">{busy ? 'Deleting…' : 'Delete view'}</button></div>
        </div>
      )}>
      <p className="m-0 text-[13px]">The saved settings go{view.shared_with_firm ? ', for your firm too' : ''}. No deal, stage or score changes.</p>
    </Lightbox>
  );
}

/** DLS5 A: the saved views menu: yours, your firm's, and Save view. A view not yours is read-only. */
export function ViewsMenu({ views, current, activeUid, edited, onPick, onSave, onSaveChanges, onDelete }) {
  const mine = (views?.items || []).filter((v) => v.mine);
  const firm = (views?.items || []).filter((v) => !v.mine);
  const active = (views?.items || []).find((v) => v.uid === activeUid) || null;
  return (
    <div className="flex items-center gap-2">
      <Popover label={active ? active.name : 'All my deals'} testId="dealflow-views" wide>
        {(close) => (
          <div className="flex flex-col gap-2 text-[13px]">
            {views === 'failed' && <p className={MUTED} data-testid="dealflow-views-unreadable">Your saved views could not be read. The deals below are current.</p>}
            <span className={EYE}>Mine</span>
            <button type="button" className="text-left hover:underline" onClick={() => { close(); onPick(null); }}>All my deals</button>
            {mine.map((v) => (
              <span key={v.uid} className="flex items-center justify-between gap-2">
                <button type="button" className="text-left hover:underline" onClick={() => { close(); onPick(v); }} data-testid="dealflow-view-item">{v.name}{v.is_default ? ' · Default' : ''}{v.shared_with_firm ? ' · shared' : ''}</button>
                <button type="button" className="text-[12px] text-axal-muted underline" onClick={() => { close(); onDelete(v); }} aria-label={`Delete ${v.name}`}>Delete</button>
              </span>
            ))}
            {firm.length > 0 && <span className={EYE}>My firm</span>}
            {firm.map((v) => <button key={v.uid} type="button" className="text-left hover:underline" onClick={() => { close(); onPick(v); }} data-testid="dealflow-view-item">{v.name}</button>)}
            <button type="button" className={`${TOOL} mt-1 w-fit`} onClick={() => { close(); onSave(); }} data-testid="dealflow-views-save">Save view</button>
          </div>
        )}
      </Popover>
      {active && edited && (
        <span className="flex items-center gap-2 text-[12.5px]" data-testid="dealflow-view-edited">
          <span className="text-axal-muted dark:text-gray-400">• edited</span>
          {active.mine && <button type="button" className="font-semibold underline" onClick={() => onSaveChanges(active)} data-testid="dealflow-view-save-changes">Save changes</button>}
          <button type="button" className="font-semibold underline" onClick={onSave}>Save as new</button>
        </span>
      )}
    </div>
  );
}

/** DLS2's "Add to my deal flow" on a listed round, at the stage chosen. Closing follows a commitment (D1238 §3). */
export function AddToFlowDialog({ row, onClose, onAdded }) {
  const [stage, setStage] = useState('sourcing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { onAdded(await dealFlowApi.add({ deal_id: Number(row.id), stage })); } catch (e) { reportError('DealFlow:add', e); setError(e?.message || 'The deal could not be added. Try again.'); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Add to my deal flow" title={`Add ${row.name} to your deal flow?`} onClose={onClose} width={480} testId="dealflow-add"
      footer={(
        <div className="flex flex-col gap-2">
          {error && <p className={REFUSED} role="alert" data-testid="dealflow-add-refused">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Back</button><button type="button" className={actionPrimary} onClick={go} disabled={busy} data-testid="dealflow-add-go">{busy ? 'Adding…' : 'Add to my deal flow'}</button></div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1"><span className={EYE}>Stage</span>
          <select className={FIELD} value={stage} onChange={(e) => setStage(e.target.value)} data-testid="dealflow-add-stage">
            {BOARD_STAGES.map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}
          </select>
        </label>
        <p className={MUTED}>It joins your firm’s deal flow at this stage. Closing follows a commitment. The round itself does not change, and adding it does not open the deal: that needs an invitation or a commitment.</p>
      </div>
    </Lightbox>
  );
}
