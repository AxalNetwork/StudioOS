import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Card } from '../../ui';
import { api } from '../../lib/api';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import { researchMyFundsApi } from '../../lib/api/researchMyFunds.js';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { NotRecorded, SourceCard, UnreadableBadge } from './FundDirectory';
import { ProposedFields, SourceChip, SourceDatesCard, StateChip, VehicleHistory } from './FundProvenance.jsx';
import ResearchActions from './ResearchActions.jsx';
import { canAddToResearch } from './researchComparisons.js';
import { ACTIONS, UNAVAILABLE, day, managedLine, reportedSize, rereadBeforeAction, shortlistMatch } from './fundProfileRead.js';

/**
 * `/research/funds/catalog/:id` — one fund from the public directory (D535,
 * #1081 steps 4–5), the Funds canvas's drawer as a page of its own.
 *
 * IT USED TO SWALLOW ITS ERRORS. It read the bundled `fundDirectory.json`
 * first, then asked the Worker and dropped any failure on the floor
 * (`catch (_) {}`), so a failed read showed the stale bundled row as if it
 * were the directory's answer, and a failed read of the founder's own list
 * hid the "Add" button's state. Now the Worker is the only source: a failed
 * read says "Unreadable", a missing fund says so, and the list's own read
 * failing says "Unreadable" beside the button rather than offering an add
 * that may duplicate a row.
 *
 * THE TWO ETF ROWS ARE GONE WITH THE BUNDLE. `fundDirectory.json` carried two
 * public-market ETFs (SPY, QQQ) with tearsheet figures; the D1 directory never
 * held them, and a VC fund directory is the wrong home for them.
 *
 * A REMOVED LIST SAYS SO (D597, #1232). A fund whose list was taken down for
 * its terms answers 410 with the list and why; the page prints that, links
 * the list, and shows none of the fund.
 *
 * D7167 (#7167, FND-P02 to FND-P07) — the vehicle profile. It starts with the
 * vehicle, its manager and vintage, and the dated reported size in its own
 * currency with its source chip; then how the vehicle invests (the proposed
 * fields), the source card with its three dates, the manager's vehicles by
 * label and the size of this vehicle alone. The three actions are Save to
 * shortlist, Add to research project and Compare in project; the shortlist is
 * matched on `catalogue_uid`, never the name, so one manager's other vehicle
 * never reads as saved. Save, Add and Compare re-read the fund first, and a
 * 410 then clears the page. Back to results returns to the directory address
 * the Sheet was opened from (D7166: and names the row, so the directory can
 * focus it); a direct visit links to the Fund directory. A failed read reads
 * "Unavailable".
 *
 * YOUR ENTRY IS FOUND BY CATALOGUE UID (D7168), never by name. "Atlas A-I"
 * and "Atlas AI" normalise to the same letters, and the name match opened one
 * dossier for both vehicles. The page asks the Worker for the one entry linked
 * to this vehicle (`?catalogue_uid=`), whatever page of My funds holds it.
 */

/** The page's state after a failed read. A 410 keeps the removed list and why (D597). */
export function failedRead(e) {
  return {
    loading: false, error: e?.message || 'Unreadable.', status: e?.status ?? null, data: null,
    ...(e?.status === 410 ? { removed: e?.data?.removed || null, reason: e?.data?.reason || null } : {}),
  };
}
const GHOST = 'inline-flex items-center gap-1 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const DT = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:text-gray-400';
const FAINT = 'text-[11.5px] text-axal-faint dark:text-gray-400';
const safeHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** Save to shortlist, or Open dossier → once the founder's row for this vehicle exists. */
function SaveAction({ list, onAdd, adding }) {
  if (list.loading) return <span className="text-[12px] text-axal-muted">Checking your shortlist…</span>;
  if (list.error) {
    return <span className="flex items-center gap-2 text-[12px] text-axal-muted"><UnreadableBadge /> Your shortlist could not be read, so this cannot tell whether the fund is on it.</span>;
  }
  if (list.existing) {
    return <Link to={`/research/funds/${encodeURIComponent(list.existing.uid)}`} className="rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white dark:bg-violet-600">{ACTIONS.open}</Link>;
  }
  return (
    <button type="button" onClick={onAdd || undefined} disabled={!onAdd || adding} aria-busy={adding || undefined} data-testid="fund-catalog-add"
      className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-violet-600">
      <Plus size={14} aria-hidden="true" /> {adding ? ACTIONS.saving : ACTIONS.save}
    </button>
  );
}

/**
 * The page body from props alone (the tests render it with react-dom/server).
 * `fund` is { loading, error, status, data }; `list` is the founder's own
 * shortlist read, { loading, error, existing }; `back` is where Back to
 * results goes.
 */
export function FundCatalogView({ fund, list = { loading: false, error: null, existing: null }, onAdd = null, adding = false, notice = null, onRetry = () => {}, research = null, backTo = null, back: backHref = null }) {
  // The directory is the Funds page's second tab (D593); `/research/funds`
  // alone opens My funds.
  // D7166 (RFD-04C): opened from a directory row, Back to results returns to
  // that same query and names the row, so the directory can focus it again.
  // D7167: `back` is the same address as a bare string (fundProfileRead.backTo).
  const path = backTo?.path ?? backHref;
  const back = typeof path === 'string' && /^\/research\/funds(\?|$)/.test(path) ? (
    <Link to={path} state={{ selected: backTo?.selected }} data-testid="fund-catalog-back" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300">
      <ArrowLeft size={13} aria-hidden="true" /> Back to results
    </Link>
  ) : (
    <Link to="/research/funds?view=directory" data-testid="fund-catalog-back" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300">
      <ArrowLeft size={13} aria-hidden="true" /> Fund directory
    </Link>
  );
  if (fund.loading) {
    return <div className="space-y-3">{back}<Card variant="dashed" padding="lg" aria-busy="true"><p className="text-[12.5px] text-axal-muted">Loading this fund…</p></Card></div>;
  }
  if (fund.status === 410) {
    const removed = fund.removed || {};
    const href = safeHref(removed.url);
    return (
      <div className="space-y-3">{back}
        <Card variant="dashed" padding="lg" data-testid="fund-catalog-removed" role={fund.during ? 'alert' : undefined}>
          <StateChip kind="rf" />
          <h1 className="mt-2 text-sm font-extrabold">{fund.during ? 'This fund’s source list was withdrawn while you were reading' : 'This fund’s source list was withdrawn'}</h1>
          {fund.during ? <p className="mt-2 text-[12.5px] text-axal-muted">The facts shown a moment ago were removed from this page. Save, Add and Compare are no longer offered. Nothing was saved.</p> : null}
          <p className="mt-2 text-[12.5px] text-axal-muted">{fund.reason || 'Its list was taken down for its terms.'}</p>
          <p className="mt-1 text-[12.5px] text-axal-muted">
            List: {href ? <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-axal-violet underline dark:text-violet-300">{removed.title || removed.name}</a> : (removed.title || removed.name || 'Not recorded')}
            {removed.publisher ? `, published by ${removed.publisher}` : ''}{removed.reviewed_on ? ` · reviewed ${day(removed.reviewed_on)}` : ''}. None of the fund’s own fields are shown.
          </p>
        </Card>
      </div>
    );
  }
  if (fund.status === 404) {
    return (
      <div className="space-y-3">{back}
        <Card variant="dashed" padding="lg" data-testid="fund-catalog-missing">
          <StateChip>Not in the directory</StateChip>
          <h1 className="mt-2 text-sm font-extrabold">Fund not found</h1>
          <p className="mt-2 text-[12.5px] text-axal-muted">No fund in the directory has this id. A link from before vehicles had their own ids may name a row it no longer holds.</p>
        </Card>
      </div>
    );
  }
  if (fund.error) {
    return (
      <div className="space-y-3">{back}
        <Card padding="lg" className="border-red-200 dark:border-red-900" data-testid="fund-catalog-unreadable" role="alert">
          <div className="flex items-center gap-2"><UnreadableBadge /><span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Read failed</span></div>
          <h1 className="mt-2 text-sm font-extrabold">This fund could not be read.</h1>
          <p className="mt-1 text-[12.5px] text-axal-muted">Nothing is shown in its place, because an old copy would pass for the directory’s answer.</p>
          <button type="button" className={`${GHOST} mt-3`} onClick={onRetry}>Retry</button>
        </Card>
      </div>
    );
  }
  const { item, history, source_boundary: boundary } = fund.data;
  const size = reportedSize(item);
  const website = safeHref(item.website);
  return (
    <div data-testid="fund-catalog-profile" className="space-y-4">
      {back}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Fund vehicle · public directory</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h1>
          <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">{managedLine(item)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* D7167: Add to research project and Compare in project, in the founder shell. */}
          {research ? research(item) : null}
          <SaveAction list={list} onAdd={onAdd} adding={adding} />
        </div>
      </div>
      {notice && <p role={notice.ok ? 'status' : 'alert'} data-testid="fund-catalog-notice" className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{notice.text}</p>}
      <Card padding="lg">
        <dl className="grid gap-4 sm:grid-cols-4" data-testid="fund-fact-strip">
          <div>
            <dt className={DT}>Reported size</dt>
            <dd className="m-0 mt-1">{size.text
              ? <><span className="font-mono text-[18px] font-bold">{size.text}</span> <span className="text-[11px] text-axal-muted">{size.currency}</span>
                {item.provenance ? <span className="mt-1 block"><SourceChip provenance={item.provenance} /></span> : null}</>
              : <NotRecorded reason={size.reason === 'Not recorded' ? 'The list records no size for this vehicle.' : size.reason} />}</dd>
          </div>
          <div><dt className={DT}>Vintage</dt><dd className="m-0 mt-1">{item.fund_year != null ? <><span className="font-mono text-[15px] font-semibold">{item.fund_year}</span><span className={`block ${FAINT}`}>As the list records it</span></> : <NotRecorded reason="The list records no vintage for this vehicle." />}</dd></div>
          <div><dt className={DT}>Manager HQ</dt><dd className="m-0 mt-1">{item.hq ? <>{item.hq}<span className={`block ${FAINT}`}>Where the manager is based</span></> : <NotRecorded reason="The list records no HQ for this manager." />}</dd></div>
          <div><dt className={DT}>Stated focus</dt><dd className="m-0 mt-1">{item.sector_focus ? <>{item.sector_focus}<span className={`block ${FAINT}`}>As the list writes it</span></> : <NotRecorded reason="The list states no focus for this vehicle." />}</dd></div>
        </dl>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">How this vehicle invests <span className="font-normal text-axal-faint">sourced fields only</span></h2>
            <div className="mt-3"><ProposedFields proposed={item.proposed} /></div>
            <dl className="mt-4 grid grid-cols-[minmax(120px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 border-t border-axal-hairline pt-3 text-[12.5px] dark:border-gray-800">
              <dt className={DT}>Notable LPs</dt>
              <dd className="m-0">{item.notable_lps ? item.notable_lps : <NotRecorded reason="The list names no LPs for this vehicle." />}</dd>
              <dt className={DT}>EIF / EIFO</dt>
              <dd className="m-0">{item.eif === true || item.eifo === true
                ? [item.eif === true && 'EIF', item.eifo === true && 'EIFO'].filter(Boolean).join(' and ')
                : item.eif === false && item.eifo === false ? 'Neither named among the LPs' : <NotRecorded reason="With no LPs listed, EIF and EIFO backing is unknown, not absent." />}</dd>
              <dt className={DT}>Label in the list</dt>
              <dd className="m-0">{item.fund_number || <NotRecorded />}</dd>
              <dt className={DT}>Website</dt>
              <dd className="m-0">{website ? <a href={website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet dark:text-violet-300">{website.replace(/^https?:\/\//i, '')} <ExternalLink size={12} aria-hidden="true" /></a> : <NotRecorded />}</dd>
            </dl>
          </Card>
          <Card padding="lg"><VehicleHistory history={history} item={item} profileHref={(uid) => `/research/funds/catalog/${encodeURIComponent(uid)}`} /></Card>
        </div>
        <div className="space-y-4">
          {item.provenance ? <SourceDatesCard provenance={item.provenance} reason={item.source?.reason} /> : <SourceCard item={item} />}
          <Card padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">What this record is</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">{boundary}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">Public fund lists go stale. Check the fund’s own site before relying on a size, a vintage or a backer. EUR and USD stay as each list reported them; nothing is converted.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function FundCatalogProfile({ role = 'founder' }) {
  const { id } = useParams();
  const location = useLocation();
  // D7166: where Back to results returns — the directory query this profile was opened from.
  const backTo = typeof location.state?.back === 'string' ? { path: location.state.back, selected: location.state.selected || id } : null;
  const [fund, setFund] = useState({ loading: true, error: null, status: null, data: null });
  const [list, setList] = useState({ loading: true, error: null, existing: null });
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setFund({ loading: true, error: null, status: null, data: null });
    try {
      const data = await researchFundsApi.get(id);
      setFund({ loading: false, error: null, status: 200, data });
    } catch (e) {
      setFund(failedRead(e));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // D7167: the shortlist row for THIS vehicle, matched on its directory uid.
  // D7168: asked of the Worker by `catalogue_uid`, so the row is found
  // whatever page of My funds holds it (the list pages at 50).
  const uid = fund.data?.item?.uid || (fund.data ? id : null);
  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    setList({ loading: true, error: null, existing: null });
    researchMyFundsApi.list({ catalogue_uid: uid, limit: 1 })
      .then((r) => { if (alive) setList({ loading: false, error: null, existing: shortlistMatch(r.items, uid) }); })
      .catch((e) => { if (alive) setList({ loading: false, error: e?.message || UNAVAILABLE, existing: null }); });
    return () => { alive = false; };
  }, [uid]);

  // D7167 (FND-P07 B): re-read before Save, Add and Compare; a 410 clears the page.
  const reread = async () => {
    const r = await rereadBeforeAction(researchFundsApi.get, id);
    if (r.withdrawn) {
      setFund({ loading: false, error: 'Withdrawn', status: 410, data: null, removed: r.removed, reason: r.reason, during: true });
      return false;
    }
    if (!r.ok) { setNotice({ ok: false, text: r.message }); return false; }
    return true;
  };

  // D4613: one save in flight at a time. A ref, not state: two clicks in the
  // same frame both read the state before React re-renders, so a state flag
  // alone lets the second request through. The Worker also answers a repeat
  // of the same catalogue add with the row the first one wrote.
  const inFlight = useRef(false);
  const [adding, setAdding] = useState(false);
  const add = async () => {
    const item = fund.data?.item;
    if (!item || list.existing || list.error || inFlight.current) return;
    inFlight.current = true;
    setAdding(true);
    setNotice(null);
    try {
      if (!(await reread())) return;
      const row = await api.research.fundCreate({ name: item.name, source_url: item.website || null, catalogue_uid: item.uid || id });
      setList({ loading: false, error: null, existing: row });
      setNotice({ ok: true, text: row?.existing ? 'Already on your shortlist.' : `Saved to your shortlist. Your private dossier for ${item.name} is ready.` });
    } catch (e) {
      if (e?.status === 410) {
        setFund({ loading: false, error: 'Withdrawn', status: 410, data: null, removed: e?.data?.removed || null, reason: e?.message || null, during: true });
      } else {
        setNotice({ ok: false, text: 'That fund did not save. Nothing changed.' });
      }
    } finally {
      inFlight.current = false;
      setAdding(false);
    }
  };

  return (
    <WorkspaceShell
      role={role}
      title={fund.data?.item?.name || 'Fund profile'}
      activeSlug="funds"
    >
      <FundCatalogView fund={fund} list={list} onAdd={add} adding={adding} notice={notice} onRetry={load} backTo={backTo}
        research={canAddToResearch(role) ? (item) => (
          <ResearchActions kind="fund" item={{ uid: item.uid || id, name: item.name }} addLabel={ACTIONS.add} compareLabel={ACTIONS.compare} beforeOpen={reread} />
        ) : null} />
    </WorkspaceShell>
  );
}
