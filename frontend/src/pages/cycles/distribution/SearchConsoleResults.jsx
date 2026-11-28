/** #5841: one venture's property and organic web-search report, using the existing Distribution cards/tables. */
import './distribution.css';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { connectorPilotReturn } from '../../account/connectorPilotReturn';
import { searchConsoleApi } from '../../../lib/api/searchConsole';
import Lightbox from '../../../ui/Lightbox';
import { Card, StatusNote, Table } from './DistributionParts';
import { searchCtr, searchFreshness, searchNumber, searchReadFailure, searchConsoleHref } from './searchConsoleModel';
import { organicHref, pinnableWeeks } from '../evidence/organicEvidenceModel';

const BUTTON = 'inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-axal-hairline px-3 py-2 text-sm hover:border-axal-violet focus-visible:outline focus-visible:outline-2 disabled:cursor-default dark:border-gray-700';
export function SearchConsoleReport({ data, projectId = null }) {
  const weeks = Array.isArray(data?.weeks) ? data.weeks : [];
  const [week, setWeek] = useState('');
  const [limit, setLimit] = useState(20);
  const chosen = weeks.find(w => w.week_start === week) || weeks.at(-1);
  if (!data?.property) return <p>{data?.reason || 'Not recorded: choose a Search Console property.'}</p>;
  return <div className="min-w-0 space-y-3 [&_table]:min-w-[680px]" data-testid="organic-search-report">
    <p className="break-all font-semibold">{data.property.site_url} · {data.property.property_kind === 'domain' ? 'Domain property' : 'URL-prefix property'}</p>
    <p>Organic web search · finalized data · Pacific Time (America/Los_Angeles). These are not paid campaigns, leads, customers or revenue.</p>
    <p role="status">{searchFreshness(data)} · Last successful sync: {data.last_success_at || 'Not recorded'} · Data through: {data.fetched_through || 'Not recorded'}</p>
    {data.property.access_state !== 'ok' && <StatusNote tone="warn">Property access: {data.property.access_state}. Reconnect or check access before syncing.</StatusNote>}
    {data.last_error_detail && <StatusNote tone="warn">{data.last_error_detail}</StatusNote>}
    {!weeks.length ? <p>{data.reason || 'Not recorded: no sync yet'}</p> : <>
      <h3 className="font-bold">Weekly property totals</h3>
      <Table label="Organic web search property totals" columns={['Week (Pacific Time)', 'Clicks', 'Impressions', 'Weighted CTR', 'Coverage'].map((label, key) => ({ label, key }))}>
        {weeks.map(w => <tr key={w.week_start}><th scope="row" className="whitespace-nowrap">{w.week_start} to {w.week_end}</th><td>{searchNumber(w.clicks, w.clicks_reason)}</td><td>{searchNumber(w.impressions, w.clicks_reason)}</td><td>{searchCtr(w.ctr, w.ctr_reason)}</td><td className="min-w-[260px]">{w.complete ? 'Complete week' : `Partial week: ${w.incomplete_reason || 'Not recorded'}`} · {w.days_reported} reported, {w.days_not_returned} not returned, {w.days_not_fetched} not fetched</td></tr>)}
      </Table>
      <h3 className="font-bold">Top landing pages · detail only</h3>
      <p>{data.top_rows_note || 'Google’s top rows are not a complete page list and are never summed into property totals.'}</p>
      <label className="flex flex-col gap-1">Landing-page week<select className="min-h-[44px] rounded border bg-white p-2 dark:bg-gray-900" value={chosen?.week_start || ''} onChange={e => { setWeek(e.target.value); setLimit(20); }}>{weeks.map(w => <option key={w.week_start} value={w.week_start}>{w.week_start} to {w.week_end}</option>)}</select></label>
      <p>{chosen?.top_pages?.complete ? 'Page detail fetched for the week' : 'Partial or missing page detail'}{chosen?.top_pages?.truncated ? ' · Truncated by provider row limit' : ''}</p>
      <Table label="Organic search top landing pages" columns={['Landing page', 'Clicks', 'Impressions', 'CTR'].map((label, key) => ({ label, key }))}>
        {(chosen?.top_pages?.rows || []).slice(0, limit).map(p => <tr key={p.page}><th scope="row" className="break-all">{p.page}</th><td>{searchNumber(p.clicks)}</td><td>{searchNumber(p.impressions)}</td><td>{searchCtr(p.ctr)}</td></tr>)}
      </Table>
      {!chosen?.top_pages?.rows?.length && <p>{chosen?.top_pages?.reason || 'Not recorded: Google returned no top-page rows for this week.'}</p>}
      {chosen?.top_pages?.rows?.length > limit && <button type="button" className={BUTTON} onClick={() => setLimit(n => n + 20)}>Show more landing pages</button>}
      <RaiseHandoff data={data} projectId={projectId} />
    </>}
  </div>;
}

/**
 * D5841 part 2: the way to Raise is a link, never a write. A founder opens Raise › Evidence › Organic search with the
 * newest whole week pre-chosen, previews it, picks a claim and confirms; the figure starts Private.
 */
function RaiseHandoff({ data, projectId }) {
  const newest = pinnableWeeks(data)[0];
  return <div className="space-y-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="organic-raise-handoff">
    <p className="font-semibold">Use a week in Raise</p>
    <p>Viewing this report creates and shares nothing. A founder can pin one whole week’s clicks, impressions or weighted CTR to an organic-search claim in Raise › Evidence; it starts Private and is shared only from there. Landing pages and queries are never part of it.</p>
    {projectId && newest ? <Link className={BUTTON} to={organicHref(projectId, newest.week_start)}>Choose a week for Raise evidence</Link>
      : <p>{projectId ? 'No whole week is stored in full yet, so there is nothing to choose.' : 'Choose a venture first.'}</p>}
  </div>;
}

export default function SearchConsoleResults(props) {
  // A changed venture destroys all prior drafts, reads and pending action state synchronously.
  return <VentureSearchConsole key={props.projectId} {...props} />;
}
function VentureSearchConsole({ projectId, api = searchConsoleApi }) {
  const [returnParams] = useSearchParams();
  const returnNote = connectorPilotReturn(returnParams, 'google_search_console');
  const [read, setRead] = useState(null), [data, setData] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [round, setRound] = useState(0), [dialog, setDialog] = useState(null), [pick, setPick] = useState('');
  const alive = useRef(true), action = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    if (!projectId) { setLoading(false); return undefined; }
    setLoading(true); setError('');
    Promise.allSettled([api.properties(projectId), api.results(projectId)]).then(([p, r]) => {
      if (!live) return;
      setRead(p.status === 'fulfilled' ? p.value : null);
      if (r.status === 'fulfilled') setData(r.value);
      else setError(searchReadFailure(r.reason));
      if (p.status === 'rejected' && r.status === 'fulfilled') setError(searchReadFailure(p.reason));
      setLoading(false);
    });
    return () => { live = false; };
  }, [api, projectId, round]);
  const run = async (kind) => {
    if (action.current) return;
    action.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = kind === 'sync' ? await api.sync(projectId) : kind === 'check' ? await api.check(projectId) : await api.select(projectId, kind === 'unlink' ? null : pick);
      if (!alive.current) return;
      setDialog(null);
      if (result.sync?.detail) setNotice(result.sync.detail);
      setRound(n => n + 1);
    } catch (e) { if (alive.current) setError(searchReadFailure(e)); }
    finally { action.current = false; if (alive.current) setBusy(false); }
  };
  const canBind = !!read?.capability?.can_bind;
  const canSync = canBind && read?.binding?.own && read.binding.access_state === 'ok';
  return <Card className="distribution-shell min-w-0 dark:border-gray-700 dark:bg-gray-900" data-testid="search-console-results">
    <h2 className="text-base font-bold">Google Search Console</h2>
    {returnNote && <p role="status">{returnNote}</p>}
    <p className="mt-1 text-sm">Read-only organic web search, for this venture’s selected property.</p>
    <div className="my-3 flex flex-wrap gap-2">
      <Link className={BUTTON} to={searchConsoleHref(projectId)}>Connect or reconnect Search Console</Link>
      <button type="button" className={BUTTON} disabled={loading || busy} onClick={() => setRound(n => n + 1)}>Read search results again</button>
      {canBind && <button type="button" className={BUTTON} disabled={busy} onClick={() => { setPick(read.binding?.site_url || ''); setDialog('choose'); }}>Choose property</button>}
      {read?.binding?.own && canBind && <><button type="button" className={BUTTON} disabled={busy} onClick={() => run('check')}>Check property access</button><button type="button" className={BUTTON} disabled={busy} onClick={() => setDialog('unlink')}>Unlink property</button></>}
      {canSync && <button type="button" className={BUTTON} disabled={busy || loading} onClick={() => run('sync')}>{busy ? 'Syncing…' : 'Sync search results'}</button>}
    </div>
    {!projectId && <p>Choose a venture first.</p>}
    {loading && <p role="status">Reading search results…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}{data && ' Dated last-good results below may be stale.'}</p>}
    {read?.served_by && <p>Read only: a teammate’s connection serves this venture. Only that member can sync or change the property.</p>}
    {data && <SearchConsoleReport data={data} projectId={projectId} />}
    {dialog && <Lightbox label={dialog === 'choose' ? 'Choose a Search Console property' : 'Unlink Search Console property'} title={dialog === 'choose' ? 'Choose property' : 'Unlink property'} width={560} onClose={() => !busy && setDialog(null)} footer={<div className="flex justify-end gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button type="button" className={BUTTON} disabled={busy || (dialog === 'choose' && !pick)} onClick={() => run(dialog === 'unlink' ? 'unlink' : 'select')}>{dialog === 'unlink' ? 'Unlink property' : 'Use this property'}</button></div>}>
      {dialog === 'unlink' ? <p>Stop reading this property for this venture. This does not disconnect Google or create, publish or withdraw a Raise claim.</p> : <fieldset><legend>Properties allowed by your connection</legend>{read?.choices_error ? <p role="alert">{read.choices_error.detail || 'Unreadable: property choices could not be read.'}</p> : !Array.isArray(read?.choices) ? <p>Property choices are unavailable.</p> : !read.choices.length ? <p>Your Google connection lists no usable Search Console properties.</p> : read.choices.map(p => <label key={p.site_url} className="flex min-h-[44px] items-center gap-2 break-all"><input type="radio" name="search-property" value={p.site_url} disabled={!p.usable} checked={pick === p.site_url} onChange={() => setPick(p.site_url)} />{p.site_url} · {p.property_kind} · {p.permission_level}</label>)}</fieldset>}
      {error && <p role="alert">{error}</p>}
    </Lightbox>}
  </Card>;
}
