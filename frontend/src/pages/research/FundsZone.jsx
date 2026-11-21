import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, Pill, Skeleton } from '../../ui';
import { api } from '../../lib/api';
import { researchOverviewApi } from '../../lib/api/researchOverview.js';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import {
  Field, NothingYet, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import FundDirectory, { UnreadableBadge } from './FundDirectory';
import { directoryTabLabel } from './fundDirectoryRead';
import { updatedAgo } from './fundDossierRead';
import { Money } from './ResearchOverviewPanel';
import { researchMyFundsApi } from '../../lib/api/researchMyFunds.js';
import { MY_FUNDS_PAGE, countScopeLine, dossierMap, identityChip, offsetOf, pageLine } from './myFundsRead';
import SheetsSyncCard from './SheetsSyncCard';

export { dossierMap };

/**
 * Research · Funds — the funds you have researched, and what the research said.
 *
 * FIT AND ACCESS ARE TWO QUESTIONS, and the canvas asks both at once. Its pills
 * read "Warm path", "Right stage", "Wrong stage", "Passed", which look like one
 * column and are not: a fund can write at your stage AND be someone you have a
 * route to, and those are the ones worth the meeting. Migration 216 keeps them
 * apart — `stage_fit`, `path` and `status` — so a founder never has to pick
 * which true thing to record.
 *
 * NOT ASSESSED IS NOT WRONG. `stage_fit` is null until you decide, and a null
 * renders as "Not assessed" rather than as a wrong-stage pill. Rendering the
 * two the same way is how a fund you have not looked at yet ends up filtered
 * out of your own shortlist.
 *
 * A PASS IS WORTH RECORDING ONLY WITH ITS REASON. The canvas row is explicit —
 * "One thesis mismatch, one 'too early — return at $30k MRR'. Both worth
 * revisiting." A pass with no reason is indistinguishable from a fund nobody
 * reached, and three months later you research it again. The zone counts the
 * passes missing one rather than letting them blend in.
 *
 * THE CHEQUE-OVERLAP FIGURE CAN BE ABSENT, and that is not the same as zero.
 * It compares a fund's range against the round you are raising, which lives on
 * the project as `raise_target_usd`. With no target recorded there is no ask to
 * compare against, and the worker returns the count as null with its reason
 * rather than as 0 — which would say no fund writes cheques your size.
 *
 * GOOGLE SHEETS IS A COPY, NOT THE STORE, AND ONLY THE SUPER ADMIN MAY MAKE
 * ONE. The Worker writes to a tab the Super Admin chose and reads it back
 * into that same owner's rows. Founders keep a shortlist on Axal; they never
 * see the card. Sheets never talks to D1, and Import from Sheets never
 * deletes a fund — a pass is a state, and a row that left the sheet is not a
 * delete. The card (`SheetsSyncCard.jsx`, D7170) lives in this body rather
 * than as a fourth canvas op, because the zone-action row is three slots.
 *
 * THE DIRECTORY IS THE SERVER'S (D535 steps 4–5). It filtered a bundled
 * `fundDirectory.json` in the browser, 48 rows at a time; `FundDirectory` now
 * reads `GET /api/research/fund-directory`, paged, to the Funds canvas.
 *
 * TWO TABS (D593, canvas F0/F1). "My funds" is the default and carries no
 * param: the shortlist below, unchanged, with its zone toolbar. "Directory"
 * is `?view=directory`: the directory with "Where the money is" above its
 * list. Both panels stay mounted, so the directory's read answers the tab's
 * "Directory (N)" from either tab — N is the API's `coverage.total`, never a
 * figure from the canvas — and its search survives a switch. The band reads
 * `GET /api/research/overview` only once the Directory tab has been opened.
 * "Add to my funds" writes here, to the shortlist, and keeps the row the
 * POST returns, so the drawer can open its dossier at once.
 *
 * PAST 500, BY UID (D7168, canvas FND-S01). My funds reads one page of 50 from
 * `GET /api/research/funds`, searched (`?mq=`) and paged (`?mpage=`) on the
 * Worker, and every count in the strip is over ALL saved funds, which the strip
 * says. It used to be the newest 500 with every count over those alone, and an
 * older fund was neither listed nor counted. Each row names its identity — a
 * catalogue record, your own record, or a legacy entry that needs a choice —
 * and its uid; stage fit, route in and status are three columns. The
 * Directory's "Open your dossier" and "on My funds" are keyed by catalogue uid
 * (`catalogue_links`), never by a normalised name. The search keys are `mq`
 * and `mpage` because the Directory tab already owns `q` in the same URL.
 */

const STAGE_LABEL = { right: 'Right stage', wrong: 'Wrong stage' };
const PATH_LABEL = { warm: 'Warm path', cold: 'No route in' };

// The compact inline enum editor `CompetitorAnalysis` already uses for the same
// job. Tailwind's own greys, kept after the sweep: `axal-ink-2` and its family
// were declared in no `@theme` block and emitted no CSS at all, and have since
// been consolidated onto the declared neutrals. Both vocabularies are skinned
// for dark mode now, so these greys stay rather than churn.
const READ_SELECT =
  'rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';
const usd = (cents) => (cents === null || cents === undefined
  ? null
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(cents) / 100));

function cheque(row) {
  const lo = usd(row.cheque_min_cents);
  const hi = usd(row.cheque_max_cents);
  if (lo && hi) return lo === hi ? lo : `${lo}–${hi}`;
  return lo || hi || null;
}

/** The two views of `/research/funds` (D593). My funds carries no param; the directory is `?view=directory`. */
export const FUNDS_TABS = [
  { key: 'mine', label: 'My funds' },
  { key: 'directory', label: 'Directory' },
];

/** The tab a URL names: the directory for `?view=directory` alone, My funds for anything else. */
export const fundsTabOf = (params) => (params?.get('view') === 'directory' ? 'directory' : 'mine');

/** The query string a tab writes: `view=directory`, or no `view` at all for My funds. Other params stay. */
export function fundsSearchFor(params, key) {
  const next = new URLSearchParams(params);
  if (key === 'directory') next.set('view', 'directory');
  else next.delete('view');
  return next;
}

/**
 * The tablist, drawn as the Companies page draws its own. Tab reaches the
 * selected tab; the arrow keys, Home and End move between the two. The
 * directory's tab names its count only once the directory has answered.
 */
export function FundsTabs({ tab, directoryTotal = null, onPick = () => {} }) {
  const refs = useRef({});
  const last = FUNDS_TABS.length - 1;
  const keyDown = (event, index) => {
    let to = null;
    if (event.key === 'ArrowRight') to = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') to = index === 0 ? last : index - 1;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = last;
    if (to === null) return;
    event.preventDefault();
    const next = FUNDS_TABS[to];
    onPick(next.key);
    refs.current[next.key]?.focus();
  };
  return (
    <div role="tablist" aria-label="Funds" className="flex gap-1 border-b border-axal-hairline dark:border-gray-800">
      {FUNDS_TABS.map((t, index) => {
        const on = tab === t.key;
        return (
          <button
            key={t.key}
            id={`funds-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`funds-panel-${t.key}`}
            tabIndex={on ? 0 : -1}
            ref={(el) => { refs.current[t.key] = el; }}
            onClick={() => onPick(t.key)}
            onKeyDown={(e) => keyDown(e, index)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold ${on
              ? 'border-violet-700 text-violet-800 dark:border-violet-400 dark:text-violet-200'
              : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
          >
            {t.key === 'directory' ? directoryTabLabel(directoryTotal) : t.label}
          </button>
        );
      })}
    </div>
  );
}

const BAND_GHOST = 'mt-3 inline-flex items-center rounded-lg border border-axal-hairline px-3 py-2 text-[12px] font-semibold '
  + 'text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

/**
 * "Where the money is" on the Directory tab (D593, canvas F1): the overview's
 * own `Money` section, fed by the read the /research overview makes,
 * `GET /api/research/overview`. No state draws a figure it was not given:
 * loading draws no number; a failed read — the request, or a money section
 * the route could not read — says Unreadable; a section with nothing recorded
 * says Not recorded with the route's reason, through `Money` itself.
 * `state` is `{ phase: 'loading' | 'error' | 'ready', data }`.
 */
export function MoneyBandView({ state, onRetry = () => {} }) {
  const phase = state?.phase || 'loading';
  const money = state?.data?.money;
  if (phase === 'ready' && money && money.status !== 'unreadable') {
    return <div data-testid="funds-money-band" data-state="ready"><Money m={money} className="" /></div>;
  }
  const loading = phase === 'loading';
  return (
    <section data-testid="funds-money-band" data-state={loading ? 'loading' : 'unreadable'} aria-labelledby="funds-money-title">
      <h3 id="funds-money-title" className="text-[15px] font-semibold tracking-tight text-axal-ink dark:text-gray-100">
        Where the money is
      </h3>
      {loading ? (
        <Card padding="md" className="mt-3" aria-busy="true">
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">Reading where the money is…</p>
          <div className="mt-3 space-y-2" aria-hidden="true">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-3" />)}</div>
          <p className="mt-3 text-[11.5px] text-axal-faint dark:text-gray-500">No figure is shown until the read answers.</p>
        </Card>
      ) : (
        <Card padding="md" className="mt-3 border-red-200 dark:border-red-900">
          <div className="flex items-center gap-2">
            <UnreadableBadge />
            <span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:text-gray-500">Read failed</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100">The fund directory’s money figures could not be read.</p>
          <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">
            No figure is shown, because a failed read is not a directory with no funds. The list below is read separately.
          </p>
          <button type="button" className={BAND_GHOST} onClick={onRetry}>Try again</button>
        </Card>
      )}
    </section>
  );
}

/** The band, live: one read of the overview, and another on "Try again". */
export function MoneyBand({ load = researchOverviewApi.get }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    Promise.resolve().then(() => load()).then(
      (data) => { if (alive) setState({ phase: 'ready', data }); },
      () => { if (alive) setState({ phase: 'error' }); },
    );
    return () => { alive = false; };
  }, [load, attempt]);
  return <MoneyBandView state={state} onRetry={() => setAttempt((n) => n + 1)} />;
}

/** The search box's own control: typed text is applied on submit, kept in the URL as `mq`. */
function MyFundsSearch({ value, saved, onSearch }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  const placeholder = saved == null ? 'Search your saved funds' : `Search all ${Number(saved).toLocaleString('en-US')} saved funds`;
  return (
    <form
      role="search"
      className="flex min-w-[240px] flex-1 items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); onSearch(text.trim()); }}
    >
      <label className="sr-only" htmlFor="my-funds-search">Search your saved funds</label>
      <input
        id="my-funds-search"
        type="search"
        className={inputClass}
        value={text}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className={ghostButtonClass}>Search</button>
    </form>
  );
}

export default function FundsZone({ zoneActions, zoneFilters, role = 'founder' }) {
  const { user } = useAuth() || {};
  const canSyncSheets = isSuperAdminUser(user);
  const [params, setParams] = useSearchParams();
  const tab = fundsTabOf(params);
  // D7168: the search and the page live in the URL, under keys the Directory does not use.
  const search = params.get('mq') || '';
  const pageNo = Math.max(1, Number.parseInt(params.get('mpage') || '1', 10) || 1);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [filter, setFilter] = useState('all');
  const [identity, setIdentity] = useState('all');
  const [form, setForm] = useState({ name: '', thesis: '', note: '' });
  const [busy, setBusy] = useState(false);
  // Each note is `{ ok, text }`, the shape `SaveNote` reads: it was given a
  // bare string as children, so "Added." and every failed save drew nothing.
  // A row's edit says so above the list; the Add form's under its button.
  const [saved, setSaved] = useState(null);
  const [rowNote, setRowNote] = useState(null);
  const [directoryBusy, setDirectoryBusy] = useState(null);
  // D4613: the in-flight latch, as a ref so a second click in the same frame
  // (before `directoryBusy` re-renders) is refused too.
  const directoryInFlight = useRef(false);
  const [directoryNote, setDirectoryNote] = useState(null);
  const [directoryTotal, setDirectoryTotal] = useState(null);
  // Rows an Add created, by catalogue uid → uid: the POST's own answer, so
  // the drawer's link to the dossier does not wait on the list's reload.
  const [created, setCreated] = useState({});
  // The band reads the overview the first time the Directory tab is open, and
  // stays mounted after, so switching back does not read it again.
  const [directorySeen, setDirectorySeen] = useState(tab === 'directory');
  useEffect(() => { if (tab === 'directory') setDirectorySeen(true); }, [tab]);

  // Switching tabs rewrites the URL in place, adding no history entry.
  const pick = (key) => setParams(fundsSearchFor(params, key), { replace: true });
  const setListParams = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined || v === '' || (k === 'mpage' && Number(v) <= 1)) p.delete(k);
      else p.set(k, String(v));
    }
    setParams(p, { replace: true });
  };
  // D7166 (RFD-01): the empty list's two ways forward. Browse opens the Directory with its search focused.
  const browse = () => { pick('directory'); setTimeout(() => document.getElementById('fd-q')?.focus(), 0); };
  const addByHand = () => document.getElementById('fz-add-name')?.focus();

  // One read per page: the newest 500 by created_at was the whole list, and
  // every count was over those 500. Now the Worker pages and counts.
  const reads = useRef(0);
  const load = useCallback(async () => {
    const mine = ++reads.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await researchMyFundsApi.list({
        q: search || undefined,
        limit: MY_FUNDS_PAGE,
        offset: (pageNo - 1) * MY_FUNDS_PAGE,
        filter: filter === 'all' ? undefined : filter,
        identity: identity === 'all' ? undefined : identity,
      });
      if (mine !== reads.current) return;
      setState({ loading: false, error: null, data });
    } catch (e) {
      if (mine !== reads.current) return;
      setState({ loading: false, error: e?.detail || e?.message || 'The fund list did not load.', data: null });
    }
  }, [search, pageNo, filter, identity]);
  useEffect(() => { load(); }, [load]);

  // One PATCH per change, then a reload — the row the worker returns is the row
  // that is stored, and the counts in the strip above are computed there too.
  // Each select sends its own field and nothing else.
  const setRead = async (uid, patch) => {
    setRowNote(null);
    try {
      await api.research.fundUpdate(uid, patch);
      await load();
    } catch (e) {
      setRowNote({ ok: false, text: e?.detail || e?.message || 'That did not save.' });
    }
  };

  const add = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      await api.research.fundCreate({ name: form.name, thesis: form.thesis, note: form.note });
      setForm({ name: '', thesis: '', note: '' });
      setSaved({ ok: true, text: 'Added.' });
      await load();
    } catch (e) {
      setSaved({ ok: false, text: e?.detail || e?.message || 'That did not save.' });
    } finally { setBusy(false); }
  };

  const data = state.data;
  const items = data?.items || [];
  const links = data?.catalogue_links;
  // D7168: keyed by catalogue uid. "Atlas A-I" and "Atlas AI" are two vehicles
  // and open two dossiers; a legacy entry is never matched by name.
  const dossiers = useMemo(() => dossierMap(links, created), [links, created]);
  const dossierOf = useCallback((fund) => (fund?.uid ? dossiers.get(fund.uid) || null : null), [dossiers]);
  const isAdded = useCallback((fund) => Boolean(fund?.uid && dossiers.has(fund.uid)), [dossiers]);
  // Until the list has answered, or once it has failed, a directory fund
  // cannot be told apart from one already on it — so no add is offered.
  const listState = state.error ? 'unreadable' : !data ? 'loading' : 'ok';

  // "Add to my funds" from the directory: a row on the founder's own shortlist,
  // named as the directory names it. The directory's facts stay in the directory.
  // The row the POST returns is kept: it is the dossier the drawer now opens.
  const addDirectoryFund = async (fund) => {
    if (!fund || listState !== 'ok' || isAdded(fund) || directoryBusy || directoryInFlight.current) return;
    directoryInFlight.current = true;
    setDirectoryBusy(fund.uid);
    setDirectoryNote(null);
    try {
      // D4613: the directory uid makes a repeat of this add idempotent on the Worker.
      const row = await api.research.fundCreate({ name: fund.name, source_url: fund.website || null, catalogue_uid: fund.uid });
      if (row?.uid) setCreated((rows) => ({ ...rows, [fund.uid]: row.uid }));
      setDirectoryNote({ uid: fund.uid, ok: true, text: row?.existing ? `${fund.name} is already on your shortlist.` : `${fund.name} saved to your shortlist.` });
      await load();
    } catch (e) {
      setDirectoryNote({ uid: fund.uid, ok: false, text: e?.detail || e?.message || 'That did not save.' });
    } finally {
      directoryInFlight.current = false;
      setDirectoryBusy(null);
    }
  };
  // The canvas has no `All` of its own — its first slot reads `Best fit`, which
  // the table renders as the unfiltered view because no fit score is stored. So
  // the chip that is on is also the way back off it. The filter runs on the
  // Worker now, over every saved fund, and a change goes back to page 1.
  const choose = (key) => {
    setFilter((current) => (current === key ? 'all' : key));
    setListParams({ mpage: null });
  };
  const chooseIdentity = (key) => {
    setIdentity((current) => (current === key ? 'all' : key));
    setListParams({ mpage: null });
  };
  const visible = items;
  const paging = data ? pageLine(data.total, data.limit || MY_FUNDS_PAGE, data.offset || 0) : null;
  const goTo = (page) => setListParams({ mpage: offsetOf(page, data?.total, MY_FUNDS_PAGE) / MY_FUNDS_PAGE + 1 });
  const narrowed = Boolean(search) || filter !== 'all' || identity !== 'all';

  return (
    <div className="space-y-6">
      <FundsTabs tab={tab} directoryTotal={directoryTotal} onPick={pick} />

      {/* Both panels stay mounted; `hidden` takes the other out of view and
          out of the accessibility tree. */}
      <div role="tabpanel" id="funds-panel-mine" aria-labelledby="funds-tab-mine" hidden={tab !== 'mine'} className="space-y-6">
        {zoneActions && (
          <ZoneToolbar
            role={role}
            className="mb-3"
            filters={zoneFilters ? zoneFilters({ value: filter, onChange: choose }) : []}
            actions={zoneActions(visible)}
          />
        )}
        <ZoneHeading
          title="Fund research"
          blurb="Your private shortlist. Stage fit, route in and status are three separate reads; public catalogue facts stay in the catalogue."
          action={data ? <Pill tone={data.warm_path_count ? 'ok' : 'neutral'}>{`${data.warm_path_count} with a route in`}</Pill> : null}
        />

        <div className="flex flex-wrap items-center gap-2">
          <MyFundsSearch value={search} saved={data?.saved_count} onSearch={(q) => setListParams({ mq: q, mpage: null })} />
          <button
            type="button"
            aria-pressed={identity === 'legacy'}
            data-testid="my-funds-legacy-filter"
            className={identity === 'legacy' ? buttonClass : ghostButtonClass}
            onClick={() => chooseIdentity('legacy')}
          >
            {`Needs a choice · ${data?.legacy_count ?? '…'}`}
          </button>
        </div>

        <p data-testid="my-funds-count-scope" className="text-[11.5px] text-axal-muted dark:text-gray-400">
          {countScopeLine(data) || 'No figure is shown until the read answers.'}
        </p>
        {/* D7166 (RFD-01): an empty list shows no counters, never a row of zeros. */}
        <div className={listState === 'ok' && !narrowed && !items.length ? 'hidden' : 'grid grid-cols-2 gap-3 lg:grid-cols-5'}>
          <FundStat label="Researched" value={data?.saved_count ?? data?.researched_count} note="every fund you saved" phase={listState} />
          <FundStat label="Right stage" value={data?.right_stage_count} note="your read · they write where you are" phase={listState} />
          <FundStat
            label="Whole-round test"
            value={data?.cheque_overlap_count}
            note={data?.cheque_overlap_note || 'cheque range includes your whole round'}
            phase={listState}
          />
          <FundStat
            label="Allocation test"
            value={data?.allocation_count}
            note={data && data.allocation_set_count != null
              ? `range includes the allocation you set · ${data.allocation_set_count} have one`
              : 'range includes the allocation you set'}
            phase={listState}
          />
          <FundStat
            label="Passed"
            value={data?.passed_count}
            phase={listState}
            note={data?.passed_without_reason
              ? `${data.passed_without_reason} with no reason recorded`
              : 'reasons recorded'}
          />
        </div>


        <ZoneBody
          loading={state.loading && !data}
          error={state.error}
          isEmpty={!items.length && !narrowed}
          onRetry={load}
          empty={(
            <NothingYet
              title="No fund is on your list yet"
              body="Start from the Directory and choose a vehicle, or add a fund by hand. What you record stays private to you."
              action={(
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass} onClick={browse} data-testid="funds-browse-directory">Browse fund directory</button>
                  <button type="button" className={ghostButtonClass} onClick={addByHand}>Add a fund by hand</button>
                </div>
              )}
            />
          )}
        >
          <Card padding="lg">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-extrabold tracking-tight">Your saved funds</h3>
              <span className="text-[11px] text-gray-600 dark:text-gray-300" aria-live="polite" data-testid="my-funds-results">
                {search && data
                  ? `${Number(data.total).toLocaleString('en-US')} of ${Number(data.saved_count).toLocaleString('en-US')} saved funds match “${search}”.`
                  : paging ? `${paging.text} · sorted by last updated` : null}
              </span>
            </div>
            <SaveNote note={rowNote} />
            {!visible.length ? (
              <div className="text-[12.5px] text-gray-600 dark:text-gray-300">
                <p>{search ? `No saved fund matches “${search}”.` : 'No fund matches this filter.'}</p>
                <button
                  type="button"
                  className={`${ghostButtonClass} mt-2`}
                  onClick={() => { setFilter('all'); setIdentity('all'); setListParams({ mq: null, mpage: null }); }}
                >
                  Show all funds
                </button>
              </div>
            ) : (
              /* D7168 (FND-S01): the canvas's seven columns — `Fund · vehicle ·
                 identity`, `Their cheque`, `Stage fit`, `Route in`, `Status`,
                 `Your note`, `Updated`. Stage fit, route in and status are
                 three columns now, as migration 216 keeps them three columns:
                 a fund can write at your stage AND be someone you have a
                 route to, and those are the ones worth the meeting. Each
                 column holds its own editor, which sends that field alone.

                 Its own scroller, so a narrow viewport scrolls the table and never
                 the page — the idiom `LibraryZone` established. */
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      {['Fund · vehicle · identity', 'Their cheque', 'Stage fit', 'Route in', 'Status', 'Your note', 'Updated'].map((head) => (
                        <th
                          key={head}
                          scope="col"
                          className="pb-2 pr-3 text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400"
                        >
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((f) => {
                      const chip = identityChip(f);
                      return (
                        <tr key={f.uid} className="border-b border-gray-100 align-top dark:border-gray-800">
                          <td className="py-3 pr-3">
                            <Link
                              to={`/research/funds/${encodeURIComponent(f.uid)}`}
                              className="text-[13px] font-extrabold text-axal-ink underline-offset-2 hover:underline"
                            >
                              {f.name}
                            </Link>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Pill tone={chip.kind === 'linked' ? 'ok' : chip.kind === 'legacy' ? 'warn' : 'neutral'}>
                                <span aria-hidden="true">{chip.kind === 'linked' ? '⛓ ' : chip.kind === 'own' ? '✎ ' : '? '}</span>
                                {chip.label}
                              </Pill>
                              <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{f.uid}</span>
                            </div>
                          </td>
                          {/* A range with one end missing renders as the end it has,
                              and no range at all renders as unrecorded — never as a
                              zero, which would say no fund writes cheques your
                              size. */}
                          <td className="py-3 pr-3 text-[11.5px] tabular-nums text-gray-600 dark:text-gray-300">
                            {cheque(f) || <Unrecorded>Not recorded</Unrecorded>}
                            {cheque(f) ? <span className="block text-[10px] text-gray-500 dark:text-gray-400">USD · your record</span> : null}
                          </td>
                          <td className="py-3 pr-3">
                            {/* A null `stage_fit` is "not assessed" and NOT "wrong
                                stage". Rendering the two alike is how a fund you
                                have not looked at yet drops out of your own
                                shortlist. */}
                            <Pill tone={f.stage_fit === 'right' ? 'ok' : f.stage_fit === 'wrong' ? 'warn' : 'neutral'}>
                              {STAGE_LABEL[f.stage_fit] || 'Stage not assessed'}
                            </Pill>
                            {/* Blank is a real option: "not assessed" is a
                                different fact from "wrong", and the route stores
                                the difference. */}
                            <select
                              aria-label={`Stage fit for ${f.name}`}
                              className={`${READ_SELECT} mt-1.5 block`}
                              value={f.stage_fit || ''}
                              onChange={(e) => setRead(f.uid, { stage_fit: e.target.value })}
                            >
                              <option value="">Stage not assessed</option>
                              <option value="right">Right stage</option>
                              <option value="wrong">Wrong stage</option>
                            </select>
                          </td>
                          <td className="py-3 pr-3">
                            {f.path ? <Pill tone={f.path === 'warm' ? 'ok' : 'neutral'}>{PATH_LABEL[f.path]}</Pill> : <Unrecorded>Not recorded</Unrecorded>}
                            <select
                              aria-label={`Route in for ${f.name}`}
                              className={`${READ_SELECT} mt-1.5 block`}
                              value={f.path || ''}
                              onChange={(e) => setRead(f.uid, { path: e.target.value })}
                            >
                              <option value="">Route not recorded</option>
                              <option value="warm">Warm path</option>
                              <option value="cold">No route in</option>
                            </select>
                          </td>
                          <td className="py-3 pr-3">
                            {f.status === 'passed' ? <Pill tone="danger">Passed</Pill> : <Pill tone="neutral">Researching</Pill>}
                            <select
                              aria-label={`Status for ${f.name}`}
                              className={`${READ_SELECT} mt-1.5 block`}
                              value={f.status || 'researching'}
                              onChange={(e) => setRead(f.uid, { status: e.target.value })}
                            >
                              <option value="researching">Researching</option>
                              <option value="passed">Passed</option>
                            </select>
                            {f.status === 'passed' && !f.pass_reason ? (
                              <span className="mt-1 block text-[10.5px] font-semibold text-red-700 dark:text-red-300">No reason recorded</span>
                            ) : null}
                          </td>
                          {/* The thesis is QUOTED and the note is not: one is the
                              fund's own words and the other is yours, and a reader
                              deciding whether to take a meeting needs to know which
                              is which. */}
                          <td className="py-3 pr-3 text-[12px] leading-relaxed">
                            {f.thesis && (
                              <p className="italic text-gray-600 dark:text-gray-300">“{f.thesis}”</p>
                            )}
                            {f.note && (
                              <p className="mt-1 text-gray-700 dark:text-gray-300">{f.note}</p>
                            )}
                            {f.status === 'passed' && (
                              <p className="mt-1 text-gray-600 dark:text-gray-300">
                                {f.pass_reason
                                  ? `Passed: ${f.pass_reason}`
                                  : <Unrecorded>Passed with no reason recorded — worth adding one before you rediscover them.</Unrecorded>}
                              </p>
                            )}
                            {!f.thesis && !f.note && f.status !== 'passed' && (
                              <Unrecorded>Nothing recorded yet</Unrecorded>
                            )}
                          </td>
                          <td className="py-3 text-[11px] text-gray-600 dark:text-gray-300">
                            {updatedAgo(f.updated_at) || <Unrecorded>Not recorded</Unrecorded>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {paging && paging.pages > 1 ? (
              <nav aria-label="Pages of your saved funds" className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-gray-600 dark:text-gray-300">{paging.text}</span>
                <button type="button" className={ghostButtonClass} disabled={paging.page <= 1 || state.loading} onClick={() => goTo(paging.page - 1)}>
                  ‹ Previous
                </button>
                <span aria-current="page" className="font-semibold">{paging.pageText}</span>
                <button type="button" className={ghostButtonClass} disabled={paging.page >= paging.pages || state.loading} onClick={() => goTo(paging.page + 1)}>
                  Next ›
                </button>
              </nav>
            ) : null}
          </Card>
        </ZoneBody>

        {canSyncSheets ? <SheetsSyncCard /> : null}

        <Card padding="lg">
          <h3 className="text-sm font-extrabold tracking-tight">Add a fund</h3>
          <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={add}>
            <Field label="Fund">
              <input id="fz-add-name" className={inputClass} value={form.name} maxLength={200} required
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Their thesis, in their words">
              <input className={inputClass} value={form.thesis} maxLength={2000}
                onChange={(e) => setForm({ ...form, thesis: e.target.value })} />
            </Field>
            <Field label="What the research says">
              <input className={inputClass} value={form.note} maxLength={2000}
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <div className="md:col-span-3">
              <button type="submit" className={buttonClass} disabled={busy || !form.name.trim()}>
                {busy ? 'Adding…' : 'Add fund'}
              </button>
              <SaveNote note={saved} />
            </div>
          </form>
        </Card>

        <StatedLimit title="What this page will not do">
          Nothing here scores a fund for you, ranks your list, or drafts an approach. A fit
          score assembled from a thesis paragraph would be a number with no method behind it,
          and the reading that matters — why their last two leads had a design partner in the
          deck — is yours to write.
        </StatedLimit>
      </div>

      <div role="tabpanel" id="funds-panel-directory" aria-labelledby="funds-tab-directory" hidden={tab !== 'directory'}>
        <FundDirectory isAdded={isAdded} onAdd={addDirectoryFund} busy={directoryBusy}
          dossierOf={dossierOf} listState={listState} notice={directoryNote} onTotal={setDirectoryTotal}
          band={directorySeen ? <MoneyBand /> : null} role={role} />
      </div>
    </div>
  );
}

/**
 * A figure the store actually returned, or the reason it is absent. While the
 * list is still loading it draws no figure, and a failed read is Unreadable:
 * neither is the list saying a value is not recorded.
 */
export function FundStat({ label, value, note, phase = 'ok' }) {
  const absent = value === null || value === undefined;
  let figure = value;
  if (phase === 'loading') figure = <span className="text-axal-faint dark:text-gray-500" aria-label="Loading">…</span>;
  else if (phase === 'unreadable') figure = <UnreadableBadge />;
  else if (absent) figure = <Unrecorded>Not recorded</Unrecorded>;
  return (
    <Card padding="md">
      <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">{label}</div>
      <div className="mt-1 text-[18px] font-extrabold tracking-tight tabular-nums">
        {figure}
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-gray-600 dark:text-gray-300">{note}</div>
    </Card>
  );
}
