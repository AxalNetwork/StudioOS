import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart, ChartTable, HBars, Legend } from '../../../ui/Charts';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { STAGES, count, overviewBlocks, overviewNeeds, overviewTiles, sessionsChart, stageChart, words } from './apOverviewModel';

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const TEXT = 'text-axal-ink dark:text-gray-100';
const SUB = 'text-xs leading-relaxed text-axal-muted dark:text-gray-400';
const BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-xs font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
function State({ b, retry }) {
  if (b.state === 'ready') return null;
  return <div className="flex flex-col items-start gap-2" data-state={b.state}>
    <strong className={b.state === 'unreadable' ? 'text-axal-destructive dark:text-red-400' : SUB}>{b.state === 'loading' ? 'Reading…' : b.state === 'unreadable' ? 'Unreadable' : 'Not recorded'}</strong>
    {b.state === 'loading' ? <span className="h-2.5 w-2/3 animate-pulse rounded bg-axal-hairline dark:bg-gray-700" /> : <p className={SUB}>{b.reason}</p>}
    {b.state === 'unreadable' ? <button className={BUTTON} type="button" onClick={retry}>Try again</button> : null}
  </div>;
}
function Panel({ id, title, b, retry, children }) {
  return <section className={`${CARD} flex min-w-0 flex-col gap-3`} data-testid={`ap-chart-${id}`} aria-labelledby={`ap-title-${id}`}>
    <h2 id={`ap-title-${id}`} className={`text-[15px] font-extrabold ${TEXT}`}>{title}</h2>
    <State b={b} retry={retry} />
    {b.state === 'ready' ? children : null}
  </section>;
}
function Toggle({ id, table, setTable }) {
  return <div className="flex flex-wrap gap-1" role="group" aria-label={`${id} display`}>
    <button className={BUTTON} type="button" aria-pressed={!table} onClick={() => setTable(false)} data-testid={`ap-${id}-chart`}>Chart</button>
    <button className={BUTTON} type="button" aria-pressed={table} onClick={() => setTable(true)} data-testid={`ap-${id}-table`}>View as table</button>
  </div>;
}
function Network({ b, retry }) {
  const [table, setTable] = useState(false);
  const chart = b.state === 'ready' ? stageChart(b) : null;
  const total = chart?.rows.reduce((n, r) => n + r.parts.reduce((v, p) => v + p.value, 0), 0);
  return <Panel id="c1" title="Who is in the network" b={b} retry={retry}>
    <Toggle id="c1" table={table} setTable={setTable} />
    {total === 0 ? <p className={SUB}>No advisors or partners yet.</p> : table ? <div className="max-w-full overflow-x-auto"><ChartTable chart={chart} caption="Network people by kind and stage" /></div> : <>
      <Legend items={STAGES} />
      <div role="img" aria-label={chart?.rows.map(r => `${r.label}: ${r.parts.map(p => `${p.label} ${p.value}`).join(', ')}`).join('; ')}><Chart chart={chart} /></div>
    </>}
    <p className={SUB}>People without a linked member account have no recorded network stage.</p>
  </Panel>;
}
function Sessions({ b, retry }) {
  const [table, setTable] = useState(false);
  const chart = b.state === 'ready' ? sessionsChart(b) : null;
  return <Panel id="c2" title="Sessions per week" b={b} retry={retry}>
    <Toggle id="c2" table={table} setTable={setTable} />
    {table ? <ChartTable chart={chart} caption="Advisor and partner sessions per ET week" /> : <>
      <Legend items={chart?.series.map(s => ({ ...s, mark: s.dash ? 'dashed' : 'line' })) || []} />
      <div role="img" aria-label="Booked, completed and no-show sessions per week; current week so far"><Chart chart={chart} /></div>
    </>}
    <p className={SUB}>Advisor office hours and partner office hours together. ET weeks; the hollow point is the current week, so far. Cancelled sessions are excluded from this month's tile.</p>
  </Panel>;
}
function Skills({ b, retry }) {
  const [table, setTable] = useState(false);
  const rows = b.state === 'ready' ? [...b.value.supply].sort((a, z) => z.count - a.count || a.skill.localeCompare(z.skill)).map(r => ({ label: r.skill, value: r.count, tone: 'violet' })) : [];
  return <Panel id="c3" title="Skills: who can help, and what founders ask for" b={b} retry={retry}>
    <Toggle id="c3" table={table} setTable={setTable} />
    {rows.length === 0 ? <p className={SUB}>No skills are recorded yet.</p> : table ? <table className={`w-full text-left text-xs ${TEXT}`}><caption className="sr-only">Skills supply and founder demand</caption><thead><tr><th>Skill</th><th>People who can help</th><th>Founder requests</th></tr></thead><tbody>{rows.map(r => <tr key={r.label}><th scope="row">{r.label}</th><td className="font-mono">{r.value}</td><td>Not recorded</td></tr>)}</tbody></table> : <>
      <Legend items={[{ label: 'People who can help', tone: 'violet' }]} />
      <div role="img" aria-label={rows.map(r => `${r.label}: ${r.value} people who can help; founder demand Not recorded`).join('; ')}><HBars rows={rows} truncateLabels axis="people" /></div>
      <div className={`flex items-center gap-2 ${SUB}`}><span className="h-2 w-20 rounded border border-dashed border-axal-muted dark:border-gray-400" aria-hidden="true" />Founder requests: Not recorded</div>
    </>}
    <p className={SUB}>{b.value?.demand?.reason || 'No matching store records founder requests.'} Supply is sorted by recorded people; no demand gap is inferred.</p>
  </Panel>;
}
function Deals({ b, retry }) {
  const [table, setTable] = useState(false);
  const types = b.value?.by_type || [];
  const parts = types.map((r, i) => ({ label: words(r.type), value: r.count, tone: ['violet', 'sky', 'amber', 'emerald', 'muted'][i % 5] }));
  return <Panel id="c4" title="Active partner deals by type" b={b} retry={retry}>
    <Toggle id="c4" table={table} setTable={setTable} />
    {b.value?.total === 0 ? <p className={SUB}>No active partner deals.</p> : table ? <table className={`w-full text-left text-xs ${TEXT}`}><caption className="sr-only">Active deals by type and soonest end</caption><thead><tr><th>Type</th><th>Active deals</th><th>Ends soonest</th></tr></thead><tbody>{types.map(r => <tr key={r.type}><th scope="row">{words(r.type)}</th><td className="font-mono">{r.count}</td><td>{r.soonest_end ? r.soonest_end.slice(0, 10) : 'Not recorded'}</td></tr>)}</tbody></table> : <>
      <div role="img" aria-label={parts.map(r => `${r.label}: ${r.value}`).join('; ')}><Chart chart={{ type: 'donut', parts, center: count(b.value?.total), centerSub: 'active deals' }} /></div>
      <Legend items={parts} />
      <ul className={SUB}>{types.map(r => <li key={r.type}>{words(r.type)} · ends soonest: {r.soonest_end ? r.soonest_end.slice(0, 10) : 'Not recorded'}</li>)}</ul>
    </>}
  </Panel>;
}
function Needs({ read, retry }) {
  const [all, setAll] = useState(false);
  const { rows, notices } = overviewNeeds(read);
  return <section className={`${CARD} flex flex-col gap-3`} data-testid="ap-needs">
    <h2 className={`text-[15px] font-extrabold ${TEXT}`}>Needs you</h2>
    {rows.length === 0 && notices.length === 0 ? <p className={SUB}>Nothing needs you.</p> : null}
    <ul className="flex list-none flex-col gap-2 p-0">{(all ? rows : rows.slice(0, 6)).map((r, i) => <li key={r.key} className={`${!all && i >= 3 ? 'hidden sm:flex' : 'flex'} flex-col gap-2 rounded-lg border border-axal-hairline p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700`} data-testid={`ap-need-${r.key}`}><span className={`text-[13px] ${TEXT}`}><span className={`mr-2 rounded-full border border-axal-hairline px-2 py-0.5 ${SUB} dark:border-gray-700`}>{r.label}</span>{r.text}</span><Link className={`${BUTTON} self-start sm:shrink-0`} to={r.to}>{r.action}</Link></li>)}</ul>
    {rows.length > 0 ? <div className={`flex flex-wrap items-center gap-2 ${SUB}`}><span className="sm:hidden">Showing {all ? rows.length : Math.min(3, rows.length)} of {rows.length}</span><span className="hidden sm:inline">Showing {all ? rows.length : Math.min(6, rows.length)} of {rows.length}</span>{notices.some(n => n.state === 'unreadable' || n.state === 'loading') ? <span title="Some queues could not be read">+ other queues unread</span> : null}{rows.length > 3 ? <button type="button" className={`${BUTTON} ${rows.length <= 6 ? 'sm:hidden' : ''}`} aria-expanded={all} onClick={() => setAll(!all)} data-testid="ap-needs-all">{all ? 'Show fewer' : 'Show all'}</button> : null}</div> : null}
    {notices.map(n => <div key={n.key} data-testid={`ap-need-state-${n.key}`} className="flex flex-col gap-1"><span className={SUB}>{n.label}</span><State b={n} retry={retry} /></div>)}
  </section>;
}
export default function ApOverview({ read, reload }) {
  const user = useAuth()?.user;
  const b = overviewBlocks(read);
  const tiles = overviewTiles(b, read);
  return <div className="flex flex-col gap-3.5" data-testid="ap-overview">
    {read?.status === 'error' ? <p role="alert" className="text-axal-destructive dark:text-red-400" data-testid="ap-unreadable">The network’s figures could not be read. Nothing here is a zero.</p> : null}
    {isSuperAdminUser(user) && read?.data?.scope === 'hq' ? <aside className={`rounded-lg border border-axal-hairline bg-axal-lavender p-3 text-[13px] dark:border-gray-700 dark:bg-violet-950/40 ${TEXT}`} data-testid="ap-scope-hq"><strong>Scope: HQ</strong> · Each subsidiary studio keeps its own advisors and partners. This read is HQ's network.</aside> : null}
    {b.people.state === 'ready' && b.people.value === 0 ? <section className={CARD} data-testid="ap-network-empty"><h2 className={TEXT}>No advisors or partners yet.</h2><p className={SUB}>Invite a partner or add a name to the deck roster.</p><div className="mt-2 flex flex-wrap gap-2"><Link className={BUTTON} to="/admin/partner-invitations">Open Partner invitations</Link><Link className={BUTTON} to="/admin/advisors-partners/deck">Add to deck roster</Link></div></section> : null}
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="ap-tiles">{tiles.map(t => <section key={t.key} className={`${CARD} flex min-w-0 flex-col gap-2`} data-testid={`ap-tile-${t.key}`}><h2 className={`text-[10.5px] font-bold uppercase tracking-wide ${SUB}`}>{t.label}</h2><State b={t} retry={reload} />{t.state === 'ready' ? <><strong className={`font-mono text-xl tabular-nums ${TEXT}`}>{t.text}</strong><span className={SUB}>{t.sub}</span></> : null}</section>)}</div>
    <Needs read={read} retry={reload} />
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2"><Network b={b.stages} retry={reload} /><Sessions b={b.sessions} retry={reload} /><Skills b={b.skills} retry={reload} /><Deals b={b.deals} retry={reload} /></div>
  </div>;
}
