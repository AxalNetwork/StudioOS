import React, { useEffect, useMemo, useState } from 'react';
import { Lightbox } from '../../../ui';
import { api } from '../../../lib/api';
import { investorCohortsApi } from '../../../lib/api/investorCohorts';
import { reportError } from '../../../lib/log';
import {
  BlockFailed, Card, DIALOG_BODY, DIALOG_LINES, DialogButtons, FIELD_LABEL, Field, INPUT, Pill, SUB, Skeleton, TD, TH, Tile,
} from './parts';
import { useRead } from './useProgramReads';
import { countLine } from './programPagesModel';
import { cohortName, isFailed, isLoading, isReady } from './programsModel';
import {
  ACCESS_WORD, ENDED_DONE, FOUNDER_COUNT_WAITS, GIVEN_DONE, INVESTORS_EMPTY, NDA_TEMPLATE_LABEL, NDA_TEMPLATE_LINE, NDA_WORD,
  PAGE, SCOPES, SCOPES_CLOSED, cohortChoices, giveBody, grantCohort, grantParams, investorRefusal, investorTiles, toldLine,
} from './investorCohortsModel';

/**
 * D963 (#2796) — Investor cohort access (PG11) and Give an investor access
 * (PG11d), on part 6's admin reads (D959). Overview draws the NDA template's
 * state, four tiles, How it runs (from part 1's playbook store, through
 * `PlaybookEditor`, which the page passes in as `how`) and the Investors
 * table; Activity is part 1's activity read. Give access and End access are
 * dialogs; part 6's refusals sit in them, keyed on `code`.
 *
 * NOT DRAWN: Send the cohort NDA, which part 6 refuses until HQ publishes the
 * template (409 `nda_template_missing`); Pause (OD-PAUSE); the cohort's
 * founder count (O-FND); and the member pages behind part 6's investor and
 * founder routes, which are their own task.
 */

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SELECT = `${INPUT} min-h-[36px]`;

export function useInvestorReads(tick) {
  const summary = useRead('investors:summary', 'summary', tick, true, () => investorCohortsApi.summary());
  const timeline = useRead('timeline', 'timeline', tick, true, () => api.adminCohortTimeline().then((r) => {
    if (!Array.isArray(r?.cycles)) throw new Error('The cohort cycles did not come back as a list.');
    return r;
  }));
  return { summary, timeline };
}

/** The Investors table: search by investor or fund, the three filters, newest grant first, the exact total. */
function InvestorsTable({ reads, tick, open }) {
  const [q, setQ] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [nda, setNda] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(0);
  const needle = useDebounced(q);
  useEffect(() => { setPage(0); }, [needle, cycleId, nda, state]);
  const params = grantParams({ q: needle, cycleId, nda, state, page });
  const list = useRead('investors:grants', JSON.stringify(params), tick, true, () => investorCohortsApi.grants(params).then((r) => {
    if (!Array.isArray(r?.items) || !Number.isFinite(Number(r?.total))) throw new Error('The grants did not come back with a total.');
    return r;
  }));
  const rows = isReady(list) ? list.data.items : [];
  const total = isReady(list) ? Number(list.data.total) : 0;
  const cycles = isReady(reads.timeline) ? reads.timeline.data.cycles : [];
  const filtered = Boolean(params.q || cycleId || nda || state);
  return (
    <Card title="Investors" meta={isReady(list) ? total.toLocaleString('en-US') : null} testId="programs-investor-table">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${INPUT} min-h-[36px] w-full sm:w-64`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search investor or fund" aria-label="Search investor or fund" data-testid="programs-investor-search" />
        <select className={SELECT} value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label="Cohort" data-testid="programs-investor-filter-cohort">
          <option value="">Cohort: all</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{cohortName(c)}</option>)}
        </select>
        <select className={SELECT} value={nda} onChange={(e) => setNda(e.target.value)} aria-label="NDA" data-testid="programs-investor-filter-nda">
          <option value="">NDA: all</option>
          {Object.entries(NDA_WORD).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
        <select className={SELECT} value={state} onChange={(e) => setState(e.target.value)} aria-label="Access" data-testid="programs-investor-filter-access">
          <option value="">Access: all</option>
          {Object.entries(ACCESS_WORD).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
        <span className={SUB}>Sort: Granted, newest first</span>
      </div>
      {q.trim().length === 1 ? <span className={SUB}>Search starts at two characters.</span> : null}
      {isLoading(list) ? <Skeleton lines={4} /> : null}
      {isFailed(list) ? <BlockFailed what="The investors with access" onRetry={open.reload} testId="programs-investor-table-unreadable" /> : null}
      {isReady(list) && !rows.length ? <p className={`m-0 ${SUB}`} data-testid="programs-investor-table-empty">{filtered ? 'No grant matches these filters.' : INVESTORS_EMPTY}</p> : null}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left" data-testid="programs-investor-rows">
            <thead><tr>{['Investor', 'Cohort', 'NDA', 'Access', 'Intro requests', ''].map((h) => <th key={h || 'menu'} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.uid} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`programs-investor-row-${g.uid}`}>
                  <td className={TD}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-axal-ink dark:text-gray-100">{`${g.investor?.name || 'Name not recorded'}${g.investor?.firm ? ` · ${g.investor.firm}` : ''}`}</span>
                      <Pill tone={g.verified_now ? 'violet' : 'amber'} testId={`programs-investor-row-${g.uid}-verified`}>{g.verified_now ? 'Verified' : 'Not verified'}</Pill>
                    </span>
                  </td>
                  <td className={TD}>{grantCohort(g)}</td>
                  <td className={TD}>{NDA_WORD[g.nda_state] || g.nda_state}</td>
                  <td className={TD} data-testid={`programs-investor-row-${g.uid}-access`}>{ACCESS_WORD[g.state] || g.state}</td>
                  <td className={`${TD} font-mono`}>{`${Number(g.intro_requests).toLocaleString('en-US')} · ${Number(g.intros_accepted).toLocaleString('en-US')} accepted`}</td>
                  <td className={TD}>
                    {g.state === 'ended' ? null : (
                      <button type="button" onClick={() => open.dialog({ kind: 'end', grant: g })} className="min-h-[36px] rounded-[9px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`programs-investor-row-${g.uid}-end`}>End access</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {isReady(list) && total ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="programs-investor-count">{countLine(page * PAGE, rows.length, total)}</span>
          <span className="flex gap-2">
            <button type="button" className="text-[12.5px] font-bold text-axal-violet disabled:opacity-40 dark:text-violet-300" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="text-[12.5px] font-bold text-axal-violet disabled:opacity-40 dark:text-violet-300" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Overview. The banner stands until part 1's registry says the program runs
 * (`running`); the NDA template's line comes from the summary.
 */
export function InvestorOverview({ reads, running, how, tick, open }) {
  const tiles = investorTiles(reads.summary);
  const template = isReady(reads.summary) ? reads.summary.data.nda_template : null;
  return (
    <div className="flex flex-col gap-4" data-testid="programs-investor-overview">
      {running ? null : open.banner}
      {template && NDA_TEMPLATE_LINE[template] ? <p className={`m-0 ${SUB}`} data-testid="programs-investor-nda-template">{NDA_TEMPLATE_LINE[template]}</p> : null}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={open.reload} />)}
      </div>
      {how}
      <InvestorsTable reads={reads} tick={tick} open={open} />
    </div>
  );
}

/** PG11d: verified investors only, a pair with an open grant marked and never sent. */
export function GiveAccessDialog({ reads, onClose, onGiven }) {
  const [q, setQ] = useState('');
  const needle = useDebounced(q);
  const [cohortId, setCohortId] = useState('');
  const [picked, setPicked] = useState(null);
  const [endsOn, setEndsOn] = useState('');
  const [scope, setScope] = useState({ summary: true, weekly_progress: true });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const cohorts = cohortChoices(reads.timeline);
  const cohort = cohorts.find((c) => String(c.id) === String(cohortId)) || null;
  const query = { ...(needle.trim().length >= 2 ? { q: needle.trim() } : {}), ...(cohort ? { cycle_id: cohort.id } : {}), limit: 8 };
  const [found, setFound] = useState({ status: 'loading', items: [] });
  useEffect(() => {
    let live = true;
    setFound((f) => ({ ...f, status: 'loading' }));
    investorCohortsApi.assignable(query).then(
      (r) => { if (live) setFound(Array.isArray(r?.items) ? { status: 'ready', items: r.items } : { status: 'error', items: [] }); },
      (e) => { reportError('admin-programs:investor-assignable', e); if (live) setFound({ status: 'error', items: [] }); },
    );
    return () => { live = false; };
    // One request per search or cohort change; a stale reply is dropped by `live`.
  }, [JSON.stringify(query)]);
  const investor = useMemo(() => (picked ? found.items.find((x) => Number(x.id) === Number(picked.id)) || picked : null), [picked, found.items]);
  const today = new Date().toISOString().slice(0, 10);
  const built = giveBody({ investor, cohort, endsOn, scope, note, today });
  const template = isReady(reads.summary) ? reads.summary.data.nda_template : null;
  const go = async () => {
    if (!built.body) return;
    setBusy(true); setRefusal('');
    try {
      await investorCohortsApi.give(built.body);
      setDone(GIVEN_DONE);
      onGiven?.();
    } catch (e) {
      setRefusal(investorRefusal(e, 'Access was not given. Nothing changed.'));
    } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Give an investor access" title="Give an investor access" onClose={onClose} width={560} testId="programs-give-dialog"
      footer={<DialogButtons onClose={onClose} action="Give access" busy={busy} disabled={!built.body} onAction={go} refusal={refusal} done={done} testId="programs-give-go" />}>
      <div className={DIALOG_BODY}>
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Investor · verified only</span>
          <input className={`${INPUT} w-full`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search investor or fund" aria-label="Search verified investors" data-testid="programs-give-search" />
          {found.status === 'loading' ? <span className={SUB}>Reading the verified investors…</span> : null}
          {found.status === 'error' ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="programs-give-unreadable">The verified investors could not be read. That is not the same as none.</p> : null}
          {found.status === 'ready' && !found.items.length ? <span className={SUB} data-testid="programs-give-none">No verified investor matches. Verified means an active investor account with approved KYC.</span> : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {found.items.map((x) => (
              <li key={x.id}>
                <button type="button" aria-pressed={Number(picked?.id) === Number(x.id)} disabled={x.has_open_grant} onClick={() => setPicked(x)} data-testid={`programs-give-investor-${x.id}`}
                  className={`flex min-h-[44px] w-full flex-wrap items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold text-axal-ink disabled:opacity-60 dark:text-gray-100 ${Number(picked?.id) === Number(x.id) ? 'bg-axal-ground dark:bg-gray-800' : 'hover:bg-axal-ground dark:hover:bg-gray-800'}`}>
                  <span>{`${x.name || 'Name not recorded'}${x.firm ? ` · ${x.firm}` : ''}`}</span>
                  {x.has_open_grant ? <Pill tone="amber" testId={`programs-give-investor-${x.id}-open`}><span aria-hidden="true">!</span>Already has open access to this cohort</Pill> : null}
                  {Number(picked?.id) === Number(x.id) ? <span className={SUB}>Selected</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Cohort</span>
          <select className={`${INPUT} w-full`} value={cohortId} onChange={(e) => setCohortId(e.target.value)} data-testid="programs-give-cohort">
            <option value="">Choose a cohort…</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.dates ? `${c.label} · ${c.dates}` : c.label}</option>)}
          </select>
          {isFailed(reads.timeline) ? <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">The cohorts could not be read. That is not the same as none.</span> : null}
          {isReady(reads.timeline) && !cohorts.length ? <span className={SUB}>No cohort is scheduled or running.</span> : null}
          {cohort ? <span className={SUB}>{FOUNDER_COUNT_WAITS}</span> : null}
        </label>
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>NDA template</span>
          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{NDA_TEMPLATE_LABEL}</span>
          {template ? <span className={SUB} data-testid="programs-give-nda-state">{NDA_TEMPLATE_LINE[template]}</span> : null}
        </div>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>End date · the last day of access</span>
          <input type="date" className={`${INPUT} w-full`} min={today} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="programs-give-ends" />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className={FIELD_LABEL}>What they see</legend>
          {SCOPES.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
              <input type="checkbox" checked={Boolean(scope[s.key])} onChange={(e) => setScope((v) => ({ ...v, [s.key]: e.target.checked }))} data-testid={`programs-give-scope-${s.key}`} />{s.label}
            </label>
          ))}
          <span className={SUB} data-testid="programs-give-scope-closed">{SCOPES_CLOSED}</span>
        </fieldset>
        <Field label="Note · optional" value={note} onChange={setNote} max={1000} rows={2} testId="programs-give-note" />
        <ul className={DIALOG_LINES} data-testid="programs-give-told">
          <li>{toldLine(cohort?.label, investor?.name)}</li>
          <li>They see no founder’s email address.</li>
        </ul>
        {!done && built.error && (investor || cohort) ? <p className={`m-0 ${SUB}`} data-testid="programs-give-fix">{built.error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** End access: what ending does, said before it is done. */
export function EndAccessDialog({ grant, onClose, onEnded }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const name = grant.investor?.name || 'this investor';
  const cohort = grantCohort(grant);
  const go = async () => {
    setBusy(true); setRefusal('');
    try {
      await investorCohortsApi.end(grant.uid);
      setDone(ENDED_DONE);
      onEnded?.();
    } catch (e) {
      setRefusal(investorRefusal(e, 'That access was not ended. Try again.'));
    } finally { setBusy(false); }
  };
  const label = `End ${name}’s access?`;
  return (
    <Lightbox label={label} title={label} sub={cohort} onClose={onClose} testId="programs-investor-end-dialog"
      footer={<DialogButtons onClose={onClose} action="End access" tone="danger" busy={busy} onAction={go} refusal={refusal} done={done} testId="programs-investor-end-go" />}>
      <div className={DIALOG_BODY}>
        <ul className={DIALOG_LINES} data-testid="programs-investor-end-lines">
          <li>{`${name} can no longer read ${cohort}’s ventures.`}</li>
          <li>The cohort’s founders are told.</li>
          <li>The grant stays on record, with its dates and introductions.</li>
        </ul>
      </div>
    </Lightbox>
  );
}
