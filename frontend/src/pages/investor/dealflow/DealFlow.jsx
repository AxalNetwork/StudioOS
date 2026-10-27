/**
 * D1236 (#2423), D1240 (#3253) — Deal flow at /deals for an Investor and
 * Compare at /deals/compare (DLS8). D1240 completes the board and the table:
 * the firm's own stages (DLS1) with drag, Move to and Undo; the table's scope
 * columns, Fit, sticky columns and sort (DLS2); the popovers, the Filters
 * drawer and saved views (DLS3–DLS5); the states (DLS13–DLS16) and the phone
 * (DLS18). Its reads are `flowModel.js`'s; New for you and Compare stay as
 * D1236 drew them until part 5 (#3254).
 *
 * D1257 (#3280): the table's Scorecard column (`FlowTable`) draws each
 * venture's scope strip from `POST /api/venture-scores/batch` (SC6): a locked
 * scorecard is an outline with no bar. `DealsTableView` keeps the same strip
 * for a row list that is already read.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { dealViewsApi } from '../../../lib/api/dealViews.js';
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Unreadable, Unrecorded, usePhoneWidth } from '../../../ui';
import { DealStrip, StripKey } from '../../../components/scoring/scorecard/Scorecard';
import WeightingControl from '../../../components/scoring/scorecard/Weighting';
import {
  MAX_COMPARE, NOT_YET, SCOPES, SCOPE_SWITCH, WAITS,
  compareHref, dealRow, inviteRow, opensDeal, viewHref,
} from './dealFlowModel';
import {
  DEFAULT_COLUMNS, STAGE_WORD, emptyFilters, filterCount, fitOf, flowRows, namesSettings, passes, pickToggle, scoresOf, settingsHref, settingsOf,
  settingsOfSpec, sortRows, viewChanged,
} from './flowModel';
import { FlowBoard, FlowBoardLoading, PhoneBoard } from './FlowBoard';
import { FlowTable, PhoneCards } from './FlowTable';
import {
  AddToFlowDialog, CardScopesPopover, ColumnsPopover, DeleteViewDialog, FilterChips, FiltersDrawer, SaveViewDialog, SortPopover, TOOL, ViewsMenu,
} from './FlowControls';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const pill = (on) => `rounded-full px-3 py-1 text-[13px] font-semibold ${on ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`;

export function DealFlowWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`dealflow-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

const money = (n, currency) => {
  if (n == null) return <Unrecorded reason="No ask is recorded on this round." />;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n); } catch { return String(n); }
};

/** DLS1's toolbar: the scope switch and the view switch, each an address. */
export function DealFlowToolbar({ view, scope, hrefFor = viewHref }) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="dealflow-toolbar">
      <nav aria-label="Which deals" className="flex gap-1">
        {SCOPE_SWITCH.map((s) => (
          <Link key={s.key} to={hrefFor({ view, scope: s.key })} aria-current={scope === s.key ? 'page' : undefined} className={pill(scope === s.key)} data-testid={`dealflow-scope-${s.key}`}>{s.label}</Link>
        ))}
      </nav>
      {scope !== 'new' && (
        <nav aria-label="View" className="flex gap-1">
          <Link to={hrefFor({ view: 'board', scope })} aria-current={view === 'board' ? 'page' : undefined} className={pill(view === 'board')} data-testid="dealflow-view-board">Board</Link>
          <Link to={hrefFor({ view: 'table', scope })} aria-current={view === 'table' ? 'page' : undefined} className={pill(view === 'table')} data-testid="dealflow-view-table">Table</Link>
        </nav>
      )}
      {/* D1258 (#3281): SC7, the caller's weighting for the scorecard sort. */}
      {scope !== 'new' && <WeightingControl />}
    </div>
  );
}

/** DLS2 from rows already read, with each row's strip from the batch (`strips`); a row opens its deal only under Mine. */
export function DealsTableView({ rows, scope, picked = [], onPick, strips = null }) {
  if (!rows.length) {
    return <section className={box} data-testid="dealflow-empty"><p className="m-0 text-sm">{scope === 'mine' ? 'Nothing in your deal flow yet. Deals you are invited to or commit on appear here.' : 'No round is listed.'}</p></section>;
  }
  return (
    <section className={box} data-testid="dealflow-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500">
              <th className="py-1"><span className="sr-only">Compare</span></th>
              <th>Venture</th><th>Round</th><th>Ask</th><th>Scorecard</th><th>Days in stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800" data-testid={`dealflow-row-${r.id}`}>
                <td className="py-1.5"><input type="checkbox" aria-label={`Compare ${r.name}`} checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= MAX_COMPARE} onChange={() => onPick?.(r.id)} /></td>
                <td>
                  {opensDeal(scope) ? <Link to={`/deals/${r.id}`} className="font-semibold underline">{r.name}</Link> : <span className="font-semibold">{r.name}</span>}
                  {r.sector && <span className="block text-[12px] text-axal-muted">{r.sector}</span>}
                </td>
                <td><span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[12px]">{r.round}</span></td>
                <td>{money(r.ask, r.currency)}</td>
                <td><DealStrip read={strips} dealId={r.id} /></td>
                <td>{r.daysInStage == null ? <Unrecorded reason="The stage's start is not recorded." /> : r.daysInStage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Scopes, in the scoring order: {SCOPES.join(' · ')}.</p>
      <StripKey />
      {strips?.status === 'error' && strips.error?.status !== 403 && <Unreadable what="The scorecards" claim="That is not a score of zero." onRetry={strips.retry} />}
      {picked.length > 0 && (
        <div className="flex items-center gap-3" data-testid="dealflow-compare-bar">
          <span className="text-[13px]">{picked.length} selected</span>
          {picked.length >= 2 ? <Link to={compareHref(picked)} className="font-semibold underline" data-testid="dealflow-compare">Compare</Link> : <span className="text-[13px] text-axal-muted">Pick at least two to compare.</span>}
          <button type="button" className="text-[13px] underline" onClick={() => picked.forEach((id) => onPick?.(id))}>Clear</button>
        </div>
      )}
    </section>
  );
}

/** DLS6 from invitations already read; the other ways in wait. */
export function InvitesView({ rows }) {
  return (
    <section className={box} data-testid="dealflow-new">
      <h2 className="m-0 text-[15px] font-bold">Invited by the studio</h2>
      {rows.length === 0
        ? <p className="m-0 text-sm">No invitation is waiting for you.</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => (
              <li key={`${r.id}-${r.at}`} className="flex flex-col" data-testid={`dealflow-invite-${r.id}`}>
                <Link to={`/deals/${r.id}`} className="font-semibold underline">{r.name}</Link>
                {r.message && <span className="text-[12.5px] text-axal-muted">“{r.message}”</span>}
              </li>
            ))}
          </ul>
        )}
      <DealFlowWait id="entered" />
    </section>
  );
}

function useRead(fn, deps) {
  const [state, setState] = useState({ kind: 'loading', data: null });
  const load = useCallback(async () => {
    setState({ kind: 'loading', data: null });
    try { setState({ kind: 'ok', data: await fn() }); } catch (e) { reportError('DealFlow:read', e); setState({ kind: 'unreadable', data: null, error: e }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * SCORING's batch and the fit read for the rows on screen (D1256, D1239).
 * Each answers alone: a failed scores read leaves names, stages and money as
 * they are, and says so.
 */
function useScoresAndFit(ids) {
  const key = ids.join(',');
  const [scores, setScores] = useState(null);
  const [fits, setFits] = useState(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let alive = true;
    setScores(null); setFits(null);
    if (!ids.length) { setScores({ items: [] }); setFits(new Map()); return undefined; }
    Promise.all(chunks(ids, 200).map((c) => ventureScoresApi.batch(c.map(Number))))
      .then((parts) => { if (alive) setScores({ items: parts.flatMap((p) => p?.items || []) }); })
      .catch((e) => { reportError('DealFlow:scores', e); if (alive) setScores('failed'); });
    Promise.all(chunks(ids, 50).map((c) => dealViewsApi.fit(c)))
      .then((parts) => { if (alive) setFits(new Map(parts.flatMap((p) => p?.items || []).map((f) => [String(f.deal_id), f]))); })
      .catch((e) => { reportError('DealFlow:fit', e); if (alive) setFits('failed'); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, again]);
  return { scores, fits, retry: () => setAgain((n) => n + 1) };
}

const CLEAR_BTN = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** DLS13: nothing in the flow yet, with the three ways in. Never "0 deals". */
function EmptyFlow() {
  return (
    <section className={box} data-testid="dealflow-empty">
      <h2 className="m-0 text-[15px] font-bold">Nothing in your deal flow yet.</h2>
      <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">Browse every round on the platform, or set your thesis so matches reach you in New for you.</p>
      <div className="flex flex-wrap gap-2">
        <Link to={viewHref({ view: 'table', scope: 'all' })} className={CLEAR_BTN} data-testid="dealflow-empty-all">Browse all deals</Link>
        <Link to="/account" className={CLEAR_BTN} data-testid="dealflow-empty-thesis">Set your thesis</Link>
        <Link to={viewHref({ scope: 'new' })} className={CLEAR_BTN} data-testid="dealflow-empty-new">See New for you</Link>
      </div>
    </section>
  );
}

/**
 * The /deals root for an Investor (D1236, D1240): the toolbar, the controls,
 * then the Board on the firm's own stages or the Table, every setting in the
 * address. `board` is today's zone board, kept under the Board view.
 */
export default function DealFlow({ view, scope, board }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const phone = usePhoneWidth();
  const settings = useMemo(() => settingsOf(location.search), [location.search]);
  const viewUid = new URLSearchParams(location.search).get('v');
  const [picked, setPicked] = useState([]);
  const [page, setPage] = useState(1);
  const [words, setWords] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = (id) => setPicked((p) => pickToggle(p, id));

  const lists = scope !== 'new';
  const [flow, retryFlow] = useRead(() => (lists ? dealFlowApi.flow() : Promise.resolve(null)), [lists]);
  const [deals, retryDeals] = useRead(() => (lists ? api.listDeals() : Promise.resolve([])), [lists]);
  const [invites, retryInvites] = useRead(() => (scope === 'new' ? api.myDealInvitations() : Promise.resolve([])), [scope]);
  const [views, retryViews] = useRead(() => dealViewsApi.list(), []);
  const [weights] = useRead(() => ventureScoresApi.weights(), []);
  const [entries, setEntries] = useState(null);
  useEffect(() => { setEntries(flow.kind === 'ok' ? flow.data?.items || [] : null); }, [flow]);

  const go = (next, replace = true) => { setPage(1); navigate(settingsHref({ view, scope, settings, viewUid, ...next }), { replace }); };
  const setSettings = (patch) => go({ settings: { ...settings, ...patch } });
  // A saved default applies only when the address names no setting of its own.
  useEffect(() => {
    if (views.kind !== 'ok' || namesSettings(location.search)) return;
    const def = (views.data?.items || []).find((v) => v.uid === views.data?.default_uid);
    if (def) navigate(settingsHref({ ...settingsOfSpec(def.spec), viewUid: def.uid }), { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.kind]);

  const baseRows = useMemo(() => (entries && deals.kind !== 'loading'
    ? flowRows(scope, { flow: { items: entries }, deals: deals.kind === 'ok' ? deals.data : [] }) : []), [entries, deals, scope]);
  const ids = useMemo(() => baseRows.map((r) => r.id), [baseRows]);
  const { scores, fits, retry: retryScores } = useScoresAndFit(lists && entries ? ids : []);
  const rows = useMemo(() => baseRows.map((r) => ({ ...r, scores: scoresOf(scores, r.id), fit: fitOf(fits, r.id) })), [baseRows, scores, fits]);
  const shownFor = (f) => rows.filter((r) => passes(r, f, user?.id ?? null));
  const shown = useMemo(() => sortRows(shownFor(settings.filters), settings.sort, weights.kind === 'ok' ? weights.data?.weights : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, settings, weights]);
  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort(), [rows]);
  const activeView = views.kind === 'ok' ? (views.data?.items || []).find((v) => v.uid === viewUid) || null : null;
  const edited = viewChanged(activeView, { view, scope, settings });

  const replaceEntry = (row) => setEntries((xs) => (xs || []).map((x) => (String(x.deal_id) === String(row.deal_id) ? row : x)));
  /** A move: the stage is the Worker's once it answers; the page says what moved, with Undo. */
  const move = async (row, stage, undo = false) => {
    if (busy) return;
    const from = row.stage;
    setBusy(true);
    try {
      replaceEntry(await dealFlowApi.update(row.id, { stage }));
      setToast({ kind: 'moved', text: `${undo ? 'Moved back' : 'Moved'} ${row.name} to ${STAGE_WORD[stage]}.`, undo: !undo && from !== 'passed' ? () => move({ ...row, stage }, from, true) : null });
    } catch (e) {
      reportError('DealFlow:move', e);
      setToast({ kind: 'refused', text: e?.message || `${row.name} could not be moved. Nothing changed.` });
    } finally { setBusy(false); }
  };

  const controls = lists && (
    <div className="flex flex-col gap-2" data-testid="dealflow-controls">
      <div className="flex flex-wrap items-center gap-2">
        <ViewsMenu views={views.kind === 'unreadable' ? 'failed' : views.data} current={{ view, scope, settings }} activeUid={viewUid} edited={edited}
          onPick={(v) => (v ? navigate(settingsHref({ ...settingsOfSpec(v.spec), viewUid: v.uid })) : navigate(viewHref({ view, scope })))}
          onSave={() => setDialog({ kind: 'save' })} onSaveChanges={(v) => setDialog({ kind: 'save', editing: v })} onDelete={(v) => setDialog({ kind: 'delete', view: v })} />
        <input type="search" value={settings.filters.q} onChange={(e) => setSettings({ filters: { ...settings.filters, q: e.target.value } })} placeholder="Search ventures, sectors" aria-label="Search ventures, sectors"
          className="min-w-[200px] rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="dealflow-search" />
        <button type="button" className={TOOL} onClick={() => setDialog({ kind: 'filters' })} aria-haspopup="dialog" data-testid="dealflow-filters-open">
          Filters{filterCount(settings.filters) ? <span className="rounded-full bg-violet-600 px-1.5 text-[10.5px] text-white dark:bg-violet-500">{filterCount(settings.filters)}</span> : null}
        </button>
        <SortPopover sort={settings.sort} onSort={(sort) => setSettings({ sort })} />
        {view === 'table' ? <ColumnsPopover columns={settings.columns} onColumns={(columns) => setSettings({ columns })} defaults={DEFAULT_COLUMNS} />
          : <CardScopesPopover cards={settings.cards} onCards={(cards) => setSettings({ cards })} />}
      </div>
      <FilterChips filters={settings.filters} onFilters={(filters) => setSettings({ filters })} />
    </div>
  );

  let body;
  if (scope === 'new') {
    body = invites.kind === 'loading' ? null
      : invites.kind === 'unreadable' ? <section className={box}><Unreadable what="Your invitations" claim="That is not the same as having none." onRetry={retryInvites} /></section>
        : <InvitesView rows={(Array.isArray(invites.data) ? invites.data : []).filter((i) => i.status === 'pending').map(inviteRow)} />;
  } else if (flow.kind === 'loading' || deals.kind === 'loading' || (entries == null && flow.kind === 'ok')) {
    body = view === 'board' ? <FlowBoardLoading /> : <section className={box} aria-busy="true" data-testid="dealflow-table-loading"><p className="m-0 text-[13px] text-axal-muted">Reading…</p></section>;
  } else if (flow.kind === 'unreadable' || (scope === 'all' && deals.kind === 'unreadable')) {
    body = (
      <section className={box} data-testid="dealflow-unreadable">
        <Unreadable what={flow.kind === 'unreadable' ? 'Your deal flow' : 'The deal list'} claim="That is not the same as having none." onRetry={() => { retryFlow(); retryDeals(); }} />
      </section>
    );
  } else if (scope === 'mine' && !rows.length) {
    body = <EmptyFlow />;
  } else {
    const nothing = !shown.length && (
      <section className={box} data-testid="dealflow-nomatch">
        <p className="m-0 text-[13px]">No deal matches these filters{settings.filters.q ? ' and this search' : ''}.</p>
        <button type="button" className={CLEAR_BTN} onClick={() => setSettings({ filters: emptyFilters() })} data-testid="dealflow-nomatch-clear">Clear filters</button>
      </section>
    );
    const scoresFailed = scores === 'failed' && (
      <p className="m-0 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" role="status" data-testid="dealflow-scores-failed">
        Scores could not be read. Names, stages and money are current.
        <button type="button" className="font-semibold underline" onClick={retryScores}>Try again</button>
      </p>
    );
    const unshared = scores && scores !== 'failed' && scope === 'all' && rows.some((r) => r.scores.state === 'not_shared');
    body = (
      <>
        {scoresFailed}
        {unshared && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="dealflow-not-shared-line">Scores and fit show on deals you are invited to or have committed on; the other rounds read Not shared.</p>}
        {nothing || (view === 'board'
          ? (phone ? <PhoneBoard rows={shown.filter((r) => r.inFlow)} cards={settings.cards} picked={picked} onPick={pick} onMove={move} busy={busy} />
            : <FlowBoard rows={shown.filter((r) => r.inFlow)} cards={settings.cards} picked={picked} onPick={pick} onMove={move} busy={busy} showPassed={settings.filters.stage.includes('passed')} />)
          : (phone ? <PhoneCards rows={shown} cards={settings.cards} picked={picked} onPick={pick} />
            : <FlowTable rows={shown} columns={settings.columns} sort={settings.sort} onSort={(sort) => setSettings({ sort })} filters={settings.filters}
              onMin={(key, min) => setSettings({ filters: { ...settings.filters, min: { ...settings.filters.min, [key]: min } } })}
              picked={picked} onPick={pick} onAdd={(row) => setDialog({ kind: 'add', row })} page={page} onPage={setPage} words={words} onWords={setWords} />))}
        {view === 'board' && scope === 'all' && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">The board holds the rounds in your deal flow. Rounds not on it are in the Table, each with Add to my deal flow.</p>}
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dealflow">
      <DealFlowToolbar view={view} scope={scope} hrefFor={(v) => settingsHref({ ...v, settings })} />
      {controls}
      {body}
      {toast && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-[13px] ${toast.kind === 'refused' ? 'border border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'}`} role={toast.kind === 'refused' ? 'alert' : 'status'} data-testid="dealflow-toast">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="font-bold underline" onClick={() => { const u = toast.undo; setToast(null); u(); }} data-testid="dealflow-undo">Undo</button>}
          <button type="button" className="ml-auto underline" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
      {picked.length > 0 && (
        <div className="flex items-center gap-3" data-testid="dealflow-compare-bar">
          <span className="text-[13px]">{picked.length} selected</span>
          {picked.length >= 2 ? <Link to={compareHref(picked)} className="font-semibold underline" data-testid="dealflow-compare">Compare</Link> : <span className="text-[13px] text-axal-muted">Pick at least two to compare.</span>}
          <button type="button" className="text-[13px] underline" onClick={() => setPicked([])}>Clear</button>
        </div>
      )}
      {view === 'board' && scope !== 'new' && board && (
        <details className={box} data-testid="dealflow-today-board">
          <summary className="cursor-pointer text-[13px] font-semibold">The studio’s rounds by status, and your deal rooms</summary>
          {board}
        </details>
      )}
      {dialog?.kind === 'filters' && (
        <FiltersDrawer filters={settings.filters} sectors={sectors} count={(f) => rows.filter((r) => (view === 'board' ? r.inFlow : true) && passes(r, f, user?.id ?? null)).length}
          onClose={() => setDialog(null)} onApply={(filters) => { setDialog(null); setSettings({ filters }); }} />
      )}
      {dialog?.kind === 'save' && (
        <SaveViewDialog current={{ view, scope, settings }} canShare={!!views.data?.can_share_with_firm} editing={dialog.editing || null} onClose={() => setDialog(null)}
          onSaved={(saved) => { setDialog(null); retryViews(); const uid = saved?.uid || saved?.view?.uid; if (uid) navigate(settingsHref({ view, scope, settings, viewUid: uid }), { replace: true }); }} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteViewDialog view={dialog.view} onClose={() => setDialog(null)} onDeleted={() => { setDialog(null); retryViews(); if (viewUid === dialog.view.uid) navigate(settingsHref({ view, scope, settings }), { replace: true }); }} />
      )}
      {dialog?.kind === 'add' && (
        <AddToFlowDialog row={dialog.row} onClose={() => setDialog(null)}
          onAdded={(row) => { setDialog(null); setEntries((xs) => [row, ...(xs || [])]); setToast({ kind: 'moved', text: `Added ${dialog.row.name} to your deal flow at ${STAGE_WORD[row.stage] || 'its stage'}.` }); }} />
      )}
    </div>
  );
}

/** DLS8 from the picks already read: each venture, then the chart's wait. */
export function CompareView({ picks, missing = 0 }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dealflow-compare-page">
      <Link to="/deals?view=table" className="w-fit text-[13px] font-semibold text-violet-700 underline dark:text-violet-300">‹ Deal flow</Link>
      <h2 className="m-0 text-[20px] font-extrabold">Compare · {picks.length} ventures</h2>
      {picks.length < 2
        ? <section className={box} data-testid="dealflow-compare-few"><p className="m-0 text-sm">Pick at least two ventures to compare, from the table.</p></section>
        : (
          <section className={box}>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {picks.map((r) => (
                <li key={r.id} className="rounded-lg border border-axal-hairline p-3" data-testid={`dealflow-compare-${r.id}`}>
                  <span className="font-semibold">{r.name}</span>
                  <span className="block text-[12px] text-axal-muted">{r.round} · {money(r.ask, r.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      {missing > 0 && <p className="m-0 text-[13px] text-axal-muted" data-testid="dealflow-compare-missing">{missing} of the picked ventures are not on your list.</p>}
      <section className={box}><DealFlowWait id="compare" /></section>
    </div>
  );
}

/** /deals/compare: reads the list once and keeps the picked ids that are on it. */
export function DealCompare({ ids }) {
  const [deals, retry] = useRead(() => api.listDeals(undefined, 'mine'), []);
  if (deals.kind === 'loading') return null;
  if (deals.kind === 'unreadable') return <section className={box}><Unreadable what="The ventures to compare" claim="That is not the same as having none." onRetry={retry} /></section>;
  const rows = (Array.isArray(deals.data) ? deals.data : []).map(dealRow);
  const picks = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  return <CompareView picks={picks} missing={ids.length - picks.length} />;
}
