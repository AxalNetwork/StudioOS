import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';
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
import { Money } from './ResearchOverviewPanel';

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
 * ONE. The Worker writes to a spreadsheet the Super Admin names and reads it
 * back into POST/PATCH of that same owner's rows. Founders keep a shortlist
 * on Axal; they do not get Connect / Pull / Push. Sheets never talks to D1,
 * pull overwrites the sheet's data rows, and push never deletes a fund — a
 * pass is a state, and a row that left the sheet is not a delete. The card
 * lives in this body rather than as a fourth canvas op, because the
 * zone-action row is three slots.
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

const normalizeFundName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The founder's own row for each directory fund, by normalized name → uid.
 * No column links the two, so the name is the match, as on the catalog
 * profile: the list as read first, then any row an Add created (`created`,
 * from the POST's own answer) that the list has not caught up with.
 */
export function dossierMap(items, created = {}) {
  const byName = new Map();
  for (const fund of items || []) {
    const key = normalizeFundName(fund.name);
    if (!byName.has(key)) byName.set(key, fund.uid);
  }
  for (const [key, uid] of Object.entries(created)) if (!byName.has(key)) byName.set(key, uid);
  return byName;
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

export default function FundsZone({ zoneActions, zoneFilters, role = 'founder' }) {
  const { user } = useAuth() || {};
  const canSyncSheets = isSuperAdminUser(user);
  const [params, setParams] = useSearchParams();
  const tab = fundsTabOf(params);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ name: '', thesis: '', note: '' });
  const [busy, setBusy] = useState(false);
  // Each note is `{ ok, text }`, the shape `SaveNote` reads: it was given a
  // bare string as children, so "Added." and every failed save drew nothing.
  // A row's edit says so above the list; the Add form's under its button.
  const [saved, setSaved] = useState(null);
  const [rowNote, setRowNote] = useState(null);
  const [directoryBusy, setDirectoryBusy] = useState(null);
  const [directoryNote, setDirectoryNote] = useState(null);
  const [directoryTotal, setDirectoryTotal] = useState(null);
  // Rows an Add created, by normalized name → uid: the POST's own answer, so
  // the drawer's link to the dossier does not wait on the list's reload.
  const [created, setCreated] = useState({});
  // The band reads the overview the first time the Directory tab is open, and
  // stays mounted after, so switching back does not read it again.
  const [directorySeen, setDirectorySeen] = useState(tab === 'directory');
  useEffect(() => { if (tab === 'directory') setDirectorySeen(true); }, [tab]);

  // Switching tabs rewrites the URL in place, adding no history entry.
  const pick = (key) => setParams(fundsSearchFor(params, key), { replace: true });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.research.funds();
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e?.detail || e?.message || 'The fund list did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // One PATCH per change, then a reload — the row the worker returns is the row
  // that is stored, and the counts in the strip above are computed there too.
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
  const dossiers = useMemo(() => dossierMap(items, created), [items, created]);
  const researchedNames = useMemo(() => new Set(dossiers.keys()), [dossiers]);
  const dossierOf = useCallback((fund) => dossiers.get(normalizeFundName(fund?.name)) || null, [dossiers]);
  // Until the list has answered, or once it has failed, a directory fund
  // cannot be told apart from one already on it — so no add is offered.
  const listState = state.error ? 'unreadable' : !data ? 'loading' : 'ok';

  // "Add to my funds" from the directory: a row on the founder's own shortlist,
  // named as the directory names it. The directory's facts stay in the directory.
  // The row the POST returns is kept: it is the dossier the drawer now opens.
  const addDirectoryFund = async (fund) => {
    if (!fund || listState !== 'ok' || researchedNames.has(normalizeFundName(fund.name)) || directoryBusy) return;
    setDirectoryBusy(fund.uid);
    setDirectoryNote(null);
    try {
      const row = await api.research.fundCreate({ name: fund.name, source_url: fund.website || null });
      if (row?.uid) setCreated((rows) => ({ ...rows, [normalizeFundName(fund.name)]: row.uid }));
      setDirectoryNote({ uid: fund.uid, ok: true, text: `${fund.name} added to My funds.` });
      await load();
    } catch (e) {
      setDirectoryNote({ uid: fund.uid, ok: false, text: e?.detail || e?.message || 'That did not save.' });
    } finally {
      setDirectoryBusy(null);
    }
  };
  // The canvas has no `All` of its own — its first slot reads `Best fit`, which
  // the table renders as the unfiltered view because no fit score is stored. So
  // the chip that is on is also the way back off it.
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));
  const visible = items.filter((f) => {
    if (filter === 'right') return f.stage_fit === 'right';
    if (filter === 'warm') return f.path === 'warm';
    if (filter === 'passed') return f.status === 'passed';
    return true;
  });

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
          title={<span className="flex flex-wrap items-center gap-3">Fund research <Link to="/research/gtm" className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-[11px] font-bold text-white"><BrainCircuit size={13} /> GTM intelligence</Link></span>}
          blurb="Thesis in their words, stage and path as separate facts — every fund you have looked into, and why it is on or off the list."
          action={data ? <Pill tone={data.warm_path_count ? 'ok' : 'neutral'}>{`${data.warm_path_count} with a route in`}</Pill> : null}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FundStat label="Researched" value={data?.researched_count} note="funds on file" phase={listState} />
          <FundStat label="Right stage" value={data?.right_stage_count} note="they write where you are" phase={listState} />
          <FundStat
            label="Cheque overlap"
            value={data?.cheque_overlap_count}
            note={data?.cheque_overlap_note || 'your ask fits their range'}
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
          loading={state.loading}
          error={state.error}
          isEmpty={!items.length}
          onRetry={load}
          empty={(
            <NothingYet
              title="No fund is on your list yet"
              body="Add the funds you are researching. What goes in is your own reading — their thesis in their words, whether they write at your stage, and whether you have a route in."
            />
          )}
        >
          <Card padding="lg">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-extrabold tracking-tight">Fund profiles</h3>
              <span className="text-[11px] text-gray-600 dark:text-gray-300">
                Thesis in their own words · what the research says
              </span>
            </div>
            <SaveNote note={rowNote} />
            {!visible.length ? (
              <p className="text-[12.5px] text-gray-600 dark:text-gray-300">No fund matches this filter.</p>
            ) : (
              /* THE CANVAS'S FOUR COLUMNS — `Fund · Cheque · State · What the
                 research says` — over exactly the fields this zone already read as
                 a list. Nothing new is fetched and no value is derived that was
                 not derived before; what changed is the shape.

                 `State` HOLDS THREE PILLS AND NOT ONE, which is the one place this
                 table deliberately departs from the artboard, for the reason the
                 docblock at the top of this file gives: the canvas draws `Warm
                 path`, `Right stage`, `Wrong stage` and `Passed` as if they were
                 one column, and migration 216 keeps them apart precisely because
                 they are not. A fund can write at your stage AND be someone you
                 have a route to, and those are the ones worth the meeting.
                 Collapsing them to fit a single-pill column would throw away the
                 distinction the store was shaped to keep.

                 The three editors live in that cell for the same reason: they set
                 those three states, and a column that shows a state is where a
                 reader looks to change it.

                 Its own scroller, so a narrow viewport scrolls the table and never
                 the page — the idiom `LibraryZone` established. */
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      {['Fund', 'Cheque', 'State', 'What the research says'].map((head) => (
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
                    {visible.map((f) => (
                      <tr key={f.uid} className="border-b border-gray-100 align-top dark:border-gray-800">
                        <td className="py-3 pr-3">
                          <Link
                            to={`/research/funds/${encodeURIComponent(f.uid)}`}
                            className="text-[13px] font-extrabold text-axal-ink underline-offset-2 hover:underline"
                          >
                            {f.name}
                          </Link>
                        </td>
                        {/* A range with one end missing renders as the end it has,
                            and no range at all renders as unrecorded — never as a
                            zero, which would say no fund writes cheques your
                            size. */}
                        <td className="py-3 pr-3 text-[11.5px] tabular-nums text-gray-600 dark:text-gray-300">
                          {cheque(f) || <Unrecorded>Not recorded</Unrecorded>}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {f.status === 'passed' && <Pill tone="danger">Passed</Pill>}
                            {f.path && <Pill tone={f.path === 'warm' ? 'ok' : 'neutral'}>{PATH_LABEL[f.path]}</Pill>}
                            {/* A null `stage_fit` is "not assessed" and NOT "wrong
                                stage". Rendering the two alike is how a fund you
                                have not looked at yet drops out of your own
                                shortlist. */}
                            <Pill tone={f.stage_fit === 'right' ? 'ok' : f.stage_fit === 'wrong' ? 'warn' : 'neutral'}>
                              {STAGE_LABEL[f.stage_fit] || 'Stage not assessed'}
                            </Pill>
                          </div>
                          {/* THE WRITERS THESE THREE COLUMNS NEVER HAD.
                              `stage_fit`, `path` and `status` have been in the
                              schema, validated by the worker and accepted by
                              `PATCH /research/funds/:uid` since this zone shipped
                              — and no surface ever set one. The add-a-fund form
                              sends a name, a thesis and a note, and
                              `api.research.fundUpdate` had no callers at all, so
                              every row carried a NULL fit, a NULL path and
                              `researching`. Three filters read those columns,
                              which meant three chips that could only ever match
                              nothing.
                              Blank is a real option on the first two: "not
                              assessed" is a different fact from "wrong", and the
                              route stores the difference. */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">
                              Your read
                            </span>
                            <select
                              aria-label={`Stage fit for ${f.name}`}
                              className={READ_SELECT}
                              value={f.stage_fit || ''}
                              onChange={(e) => setRead(f.uid, { stage_fit: e.target.value })}
                            >
                              <option value="">Stage not assessed</option>
                              <option value="right">Right stage</option>
                              <option value="wrong">Wrong stage</option>
                            </select>
                            <select
                              aria-label={`Route in for ${f.name}`}
                              className={READ_SELECT}
                              value={f.path || ''}
                              onChange={(e) => setRead(f.uid, { path: e.target.value })}
                            >
                              <option value="">Route not recorded</option>
                              <option value="warm">Warm path</option>
                              <option value="cold">No route in</option>
                            </select>
                            <select
                              aria-label={`Status for ${f.name}`}
                              className={READ_SELECT}
                              value={f.status || 'researching'}
                              onChange={(e) => setRead(f.uid, { status: e.target.value })}
                            >
                              <option value="researching">Researching</option>
                              <option value="passed">Passed</option>
                            </select>
                          </div>
                        </td>
                        {/* The thesis is QUOTED and the note is not: one is the
                            fund's own words and the other is yours, and a reader
                            deciding whether to take a meeting needs to know which
                            is which. */}
                        <td className="py-3 text-[12px] leading-relaxed">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </ZoneBody>

        {canSyncSheets ? <SheetsSyncCard /> : null}

        <Card padding="lg">
          <h3 className="text-sm font-extrabold tracking-tight">Add a fund</h3>
          <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={add}>
            <Field label="Fund">
              <input className={inputClass} value={form.name} maxLength={200} required
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
        <FundDirectory researchedNames={researchedNames} onAdd={addDirectoryFund} busy={directoryBusy}
          dossierOf={dossierOf} listState={listState} notice={directoryNote} onTotal={setDirectoryTotal}
          band={directorySeen ? <MoneyBand /> : null} />
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

/**
 * Connect / Pull / Push for Google Sheets. Super-admin only — the zone
 * mounts this card behind `isSuperAdminUser`, and every worker route behind
 * `requireSuperAdmin`. Lives in the zone body rather than as a fourth canvas
 * op — the toolbar is three slots and adding one here would fail the
 * profile_zone_actions canvas check.
 *
 * HONEST EMPTY. If the Worker has no Sheets OAuth client, this card says so
 * instead of offering Connect. Pull needs a connected Google account AND a
 * spreadsheet URL; Push never deletes a fund in Axal.
 */
function SheetsSyncCard() {
  const [status, setStatus] = useState({ loading: true, error: null, data: null });
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.research.fundSheetStatus();
      setStatus({ loading: false, error: null, data });
      setUrl((current) => {
        if (current) return current;
        if (!data?.spreadsheet_id) return current;
        const gid = data.sheet_gid == null ? '' : `#gid=${data.sheet_gid}`;
        return `https://docs.google.com/spreadsheets/d/${data.spreadsheet_id}/edit${gid}`;
      });
    } catch (e) {
      setStatus({
        loading: false,
        error: e?.detail || e?.message || 'Sheets status did not load.',
        data: null,
      });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const flash = params.get('sheets');
    if (!flash) return;
    if (flash === 'connected') setNote({ ok: true, text: 'Google Sheets connected.' });
    else {
      const reason = params.get('reason') || 'callback_failed';
      setNote({ ok: false, text: `Google Sheets did not connect (${reason}).` });
    }
    params.delete('sheets');
    params.delete('reason');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
    load();
  }, [load]);

  const data = status.data;
  const run = async (key, fn, okText) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: okText });
      await load();
    } catch (e) {
      const code = e?.data?.code;
      if (code === 'oauth_config_missing') {
        setNote({ ok: false, text: 'Google Sheets is not configured on this server yet.' });
      } else {
        setNote({ ok: false, text: e?.detail || e?.message || 'That did not work.' });
      }
    } finally { setBusy(null); }
  };

  const connect = () => run('connect', async () => {
    const r = await api.research.fundSheetConnect();
    const href = r?.redirect_url || r?.auth_url;
    if (!href) throw new Error('Google did not return a consent URL.');
    window.location.assign(href);
  }, 'Opening Google…');

  const saveLink = () => run('link', () => api.research.fundSheetLink(url), 'Spreadsheet saved.');
  const pull = () => run('pull', () => api.research.fundSheetPull(), 'Wrote your funds onto the sheet.');
  const push = () => run('push', () => api.research.fundSheetPush(), 'Updated Axal from the sheet. Nothing was deleted.');
  const disconnect = () => run('disconnect', () => api.research.fundSheetDisconnect(), 'Google Sheets disconnected.');

  return (
    <Card padding="lg">
      <h3 className="text-sm font-extrabold tracking-tight">Google Sheets</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
        A copy of this list on a spreadsheet you name. Pull writes Axal onto the
        sheet. Push creates or updates funds from the sheet — it never deletes one.
        Cheque amounts on the sheet are US dollars; blank is not zero.
      </p>

      {status.loading ? (
        <p className="mt-3 text-[12px] text-gray-600 dark:text-gray-300">Checking connection…</p>
      ) : status.error ? (
        <p className="mt-3 text-[12px] text-red-700 dark:text-red-300">{status.error}</p>
      ) : data && data.configured === false ? (
        <p className="mt-3 text-[12.5px] text-gray-600 dark:text-gray-300">
          Google Sheets is not configured on this server yet. You can still add
          funds here, or export a CSV from the toolbar.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {data?.connected ? (
              <>
                <Pill tone="ok">{data.google_email ? `Connected as ${data.google_email}` : 'Connected'}</Pill>
                <button type="button" className={ghostButtonClass} disabled={!!busy} onClick={disconnect}>
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass} disabled={!!busy} onClick={connect}>
                {busy === 'connect' ? 'Opening Google…' : 'Connect Google Sheets'}
              </button>
            )}
            {data?.last_pulled_at && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                Last pull {data.last_pulled_at.slice(0, 10)}
              </span>
            )}
            {data?.last_pushed_at && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                Last push {data.last_pushed_at.slice(0, 10)}
              </span>
            )}
          </div>
          {data?.last_error && (
            <p className="text-[12px] text-red-700 dark:text-red-300">{data.last_error}</p>
          )}
          <Field label="Spreadsheet URL" hint="The tab is the gid in the URL. Pull overwrites that tab's data rows.">
            <input
              className={inputClass}
              value={url}
              placeholder={data?.suggested_url || ''}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghostButtonClass} disabled={!!busy || !url.trim()} onClick={saveLink}>
              {busy === 'link' ? 'Saving…' : 'Save spreadsheet'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!!busy || !data?.connected || !data?.spreadsheet_id}
              onClick={pull}
            >
              {busy === 'pull' ? 'Writing…' : 'Pull from Axal'}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={!!busy || !data?.connected || !data?.spreadsheet_id}
              onClick={push}
            >
              {busy === 'push' ? 'Reading…' : 'Push to Axal'}
            </button>
          </div>
        </div>
      )}
      <SaveNote note={note} />
    </Card>
  );
}
