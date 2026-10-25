import React, { useState } from 'react';
import { adminLabApi, labOperationsApi } from '../../../lib/api';
import { actionGhost } from '../../../ui';
import { CARD, H2, SUB, INPUT, TH, TD, Select, Pager, useRead } from './labParts';
import { ReadState } from './labOperationsParts';
import { ACTIVITY_TYPES, BY, SORT, byWord, eventWord, pageOf, stamp, supportRows, requireActivity, requireSupport } from './labOperationsModel';

function LogPage({ query, page, setPage, tick, retry }) {
  const read = useRead('lab-activity', tick, () => labOperationsApi.activity({ ...query, limit: 25, offset: (page - 1) * 25 }).then(requireActivity));
  const data = read.data;
  const shown = data ? { page, pages: Math.max(1, Math.ceil(data.total / 25)), size: 25, total: data.total, from: data.items.length ? (page - 1) * 25 + 1 : 0, to: Math.min(page * 25, data.total) } : null;
  return <>
    <ReadState read={read} what="Lab activity" claim="The event log could not be read." onRetry={retry} testId="lab-activity-log" />
    {data && <><div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse"><thead><tr>{['When', 'Event', 'Cohort', 'About', 'By', 'Detail'].map((t) => <th className={TH} key={t}>{t}</th>)}</tr></thead>
      <tbody>{data.items.map((row) => <tr key={row.id} className="border-t border-axal-hairline dark:border-gray-700"><td className={TD}>{stamp(row.at)}</td><td className={TD}>{row.label || eventWord(row.event)}</td><td className={TD}>{row.cohort || 'Not recorded'}</td><td className={TD}>{row.about || 'Not recorded'}</td><td className={TD}>{byWord(row.by)}</td><td className={TD}>{row.scheduled_at ? `Scheduled ${stamp(row.scheduled_at)} · ${row.detail}` : row.detail || 'Not recorded'}</td></tr>)}</tbody></table></div>
      {!data.items.length && <p className={SUB}>{query.type === 'formation' ? 'No recorded formation actions match these filters.' : 'No recorded events match these filters.'}</p>}
      <Pager shown={shown} onPage={setPage} testId="lab-activity-pages" /><p className={SUB}>{data.coverage}</p>
      <p className={SUB}>Not recorded means this row has no recorded cohort, subject or actor; no association is inferred.</p>
    </>}
  </>;
}
function SupportSessions() {
  const [tick, setTick] = useState(0), [q, setQ] = useState(''), [sort, setSort] = useState('newest'), [page, setPage] = useState(1);
  const read = useRead('lab-support-sessions', tick, () => adminLabApi.supportSessions().then(requireSupport));
  const items = read.data?.sessions;
  const shown = pageOf(supportRows(Array.isArray(items) ? items : [], q, sort), page);
  return <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="lab-support-sessions"><h2 className={H2}>Support sessions · Super Admin · read only</h2>
    <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="lab-support-search">Search admin or founder</label><input id="lab-support-search" aria-label="Search admin or founder" className={INPUT} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="lab-support-search" placeholder="Search admin or founder" />
      <Select label="Support session sort" value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={SORT} testId="lab-support-sort" /></div>
    <ReadState read={read} what="Support sessions" claim="Support sessions could not be read." onRetry={() => setTick((t) => t + 1)} testId="lab-support" />
    {read.data && <><p className={SUB}>The newest 100 support sessions across all admins. Search and pages cover these records.</p>
      {shown.items.map((s) => <article key={s.id} className="border-t border-axal-hairline py-3 dark:border-gray-700"><p className="m-0 text-[13px] font-bold">{s.admin_name || 'Not recorded'} · {s.target_name || 'Not recorded'}</p>
        <p className={SUB}>Reason: {s.reason || 'Not recorded — this session has no reason on record.'}</p><p className={SUB}>Started {stamp(s.started_at)} · {s.ended_at ? `ended ${stamp(s.ended_at)}` : 'end not recorded'}</p></article>)}
      {!shown.items.length && <p className={SUB}>No recorded support sessions match this search.</p>}<Pager shown={shown} onPage={setPage} testId="lab-support-pages" />
    </>}
  </section>;
}
export default function LabActivity({ superAdmin = false }) {
  const [query, setQuery] = useState({ type: '', cohort: '', by: '', q: '', sort: 'newest' });
  const [page, setPage] = useState(1), [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const change = (key, value) => { setQuery((q) => ({ ...q, [key]: value })); setPage(1); };
  return <div className="flex min-w-0 flex-col gap-4" data-testid="lab-activity">
    <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`}><h2 className={H2}>Activity</h2>
      <div className="flex flex-wrap items-center gap-2"><form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); change('q', search.trim()); }} data-testid="lab-activity-search-form"><label className="sr-only" htmlFor="lab-activity-search">Search events</label><input id="lab-activity-search" className={INPUT} value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} placeholder="Search events" data-testid="lab-activity-search" />
        <button type="submit" className={actionGhost}>Search</button></form>
        <Select label="Activity type" value={query.type} onChange={(v) => change('type', v)} options={ACTIVITY_TYPES} testId="lab-activity-type" />
        <label className={SUB}>Cohort <input type="month" className={INPUT} value={query.cohort} onChange={(e) => change('cohort', e.target.value)} data-testid="lab-activity-cohort" /></label>
        <Select label="Activity by" value={query.by} onChange={(v) => change('by', v)} options={BY} testId="lab-activity-by" />
        <Select label="Activity sort" value={query.sort} onChange={(v) => change('sort', v)} options={SORT} testId="lab-activity-sort" />
        <button className={actionGhost} onClick={() => setTick((t) => t + 1)}>Refresh log</button>
      </div>
      <LogPage key={JSON.stringify([query, page])} query={query} page={page} setPage={setPage} tick={tick} retry={() => setTick((t) => t + 1)} />
    </section>
    {superAdmin ? <SupportSessions /> : <section className={`${CARD} p-4`}><h2 className={H2}>Support sessions</h2><p className={SUB}>A Super Admin reads every admin’s support sessions.</p></section>}
  </div>;
}
