import React from 'react';
import { Link } from 'react-router-dom';
import { card, button, Missing } from './parts';
import {
  DRILLS, dayLabel, drillRecords, groupCounts, groupSentence, issueLine, nextLine, recordAction, recordState, recordVersion, statusLabel,
} from './governanceModel';

/**
 * D4811 (#4811) part 2 — Corporate Governance's attention view (boards CT-03
 * to CT-06, phone CT-14b): the group header with its drillable counts and the
 * ownership chart, the entities table, one entity's facts and expected records,
 * and a drill-down's record list. The Worker computes every state
 * (`services/governanceAttention.ts`); this file draws it. No score: each count
 * links to the records behind it. Below `md` each table is a list of
 * structured rows, never a sideways scroll.
 */

const BASE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const TONE = Object.freeze({
  current: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
  review: 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200',
  missing: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200',
  plain: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
  restricted: 'border-[#18181b] bg-white text-[#18181b] dark:border-gray-200 dark:bg-gray-900 dark:text-gray-100',
  incomplete: 'border-dashed border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200',
});

/** One expected-record state (CT-91 RecordStateBadge): a glyph (hidden from screen readers) and words. */
export function RecordStateBadge({ state, count }) {
  const s = recordState(state);
  if (!s) return <span className="text-[11px] text-axal-muted">Unreadable</span>;
  return <span data-testid={`record-state-${state}`} className={`${BASE} ${TONE[s.tone]}`}>
    <span aria-hidden="true">{s.glyph}</span>{count != null ? `${count} ${s.label.toLowerCase()}` : s.label}
  </span>;
}

const governanceHref = (q) => `/admin/contracts/governance${q ? `?${q}` : ''}`;

/** The group header: drillable counts, the restricted-ownership control and the chart. */
export function GroupHeader({ data, onOwnership }) {
  const totals = groupCounts(data.entities);
  const sentence = groupSentence(data.entities, data.group?.links || []);
  const cells = [{ key: 'entities', label: 'Legal entities', value: totals.entities, unit: '', href: '#governance-entities' },
    ...DRILLS.filter((d) => d.key !== 'incomplete' || totals.incomplete > 0).map((d) => ({ ...d, value: totals[d.key], href: governanceHref(`records=${d.key}`) }))];
  return <section aria-labelledby="governance-group-h" className={`${card} grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center`} data-testid="governance-group">
    <div className="space-y-3">
      <div><p className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">Group structure</p>
        <h3 id="governance-group-h" className="text-[17px] font-bold">Axal VC group</h3></div>
      <nav aria-label="Governance summary" className="grid grid-cols-2 overflow-hidden rounded-lg border border-axal-hairline">
        {cells.map((m) => {
          const inner = <><span className="block text-[10px] font-bold uppercase tracking-widest text-axal-faint">{m.label}</span>
            <span className="block font-mono text-xl font-bold">{m.value}</span>
            {m.unit && <span className="block text-[11px] text-axal-muted">{m.unit}</span>}</>;
          const cls = 'block min-h-[44px] border-b border-r border-axal-hairline p-3 hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:hover:bg-gray-800';
          return m.href.startsWith('#') ? <a key={m.key} href={m.href} className={cls} data-testid={`governance-drill-${m.key}`}>{inner}</a>
            : <Link key={m.key} to={m.href} className={cls} data-testid={`governance-drill-${m.key}`}>{inner}</Link>;
        })}
      </nav>
      <p className="text-[11.5px] text-axal-muted">Beneficial-owner details are not shown in this view.{' '}
        {data.super_admin ? <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={onOwnership}><span aria-hidden="true">🔒 </span>View restricted ownership details</button>
          : 'The Super Admin keeps them.'}</p>
    </div>
    <OwnershipChart entities={data.entities} links={data.group?.links || []} sentence={sentence} />
  </section>;
}

/** CT-91 OwnershipChart: the intercompany links the ownership rows record, or why there is none. */
function OwnershipChart({ entities, links, sentence }) {
  if (!links.length) return <div className="rounded-lg border border-dashed border-axal-hairline p-3 text-[12px]" data-testid="governance-group-unrecorded">
    <Missing reason="The group structure comes from the Super Admin's ownership records: a holder named as another Axal entity. None is recorded yet." /></div>;
  const name = (k) => entities.find((e) => e.key === k)?.name || k;
  const parents = [...new Set(links.map((l) => l.parent))];
  return <div role="img" aria-label={sentence} data-testid="governance-group-chart" className="space-y-2 text-[12px]">
    {parents.map((p) => <div key={p} className="flex flex-col items-center gap-2">
      <div className="rounded-lg border border-axal-hairline px-3 py-2 text-center"><b>{name(p)}</b><small className="block text-axal-muted">parent</small></div>
      <div className="grid w-full gap-2 sm:grid-cols-2">{links.filter((l) => l.parent === p).map((l) => <div key={l.child} className="flex flex-col items-center gap-1">
        <span className="font-mono text-[11px] font-bold">{l.percent == null ? 'percent not recorded' : `${l.percent}%`}</span>
        <div className="w-full rounded-lg border border-axal-hairline px-3 py-2 text-center"><b>{name(l.child)}</b></div></div>)}</div>
    </div>)}
  </div>;
}

function CountPills({ counts }) {
  const shown = ['review_required', 'missing', 'restricted', 'incomplete'].filter((k) => Number(counts?.[k]) > 0);
  if (!shown.length) return <span className="text-[11px] text-axal-muted">Nothing outstanding</span>;
  return <span className="flex flex-wrap gap-1">{shown.map((k) => <RecordStateBadge key={k} state={k} count={counts[k]} />)}</span>;
}

const latestLine = (f, withheld) => f?.latest_executed
  ? <>{f.latest_executed.title}<span className="block font-mono text-[11px] text-axal-muted">{f.latest_executed.version ? `v${f.latest_executed.version} · ` : ''}{dayLabel(f.latest_executed.effective_date) ? `effective ${dayLabel(f.latest_executed.effective_date)}` : 'effective date not recorded'}</span></>
  : <span className="text-axal-muted">{withheld > 0 ? 'None you can open' : 'None recorded as executed'}</span>;
const LAST_REVIEW = 'Each record\'s legal review is on its Legal Review tab (D4811 part 16).';

/** The entities table (CT-03), with phone rows. */
export function EntitiesTable({ entities }) {
  return <section aria-label="Entities" id="governance-entities" className={`${card} overflow-hidden`} data-testid="governance-entities">
    <table className="hidden w-full text-left text-[12.5px] md:table">
      <caption className="sr-only">The three Axal entities and what each needs next</caption>
      <thead className="bg-axal-ground text-[10px] uppercase tracking-widest text-axal-faint dark:bg-gray-800"><tr>
        {['Entity', 'Latest executed', 'Last review', 'Outstanding issue', 'Next required action', 'Records'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-axal-hairline">{entities.map((e) => { const f = e.attention?.facts; return <tr key={e.key} className="align-top">
        <td className="px-3 py-2"><Link to={governanceHref(`entity=${e.key}`)} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">{e.name}</Link></td>
        <td className="px-3 py-2">{latestLine(f, e.withheld)}</td>
        <td className="px-3 py-2"><Missing reason={LAST_REVIEW} /></td>
        <td className="px-3 py-2">{issueLine(f?.outstanding_issue) || <span className="text-axal-muted">None</span>}</td>
        <td className="px-3 py-2">{nextLine(f?.next_action) ? <Link to={governanceHref(`entity=${e.key}`)} className="font-semibold">{nextLine(f.next_action)} →</Link> : <span className="text-axal-muted">None</span>}</td>
        <td className="px-3 py-2"><CountPills counts={e.attention?.counts} /></td></tr>; })}</tbody>
    </table>
    <ul className="divide-y divide-axal-hairline md:hidden">{entities.map((e) => { const f = e.attention?.facts; return <li key={e.key} className="space-y-1 p-3 text-[12.5px]">
      <Link to={governanceHref(`entity=${e.key}`)} className="block min-h-[44px] font-semibold text-violet-700 dark:text-violet-300">{e.name} ›</Link>
      <p><span className="text-axal-muted">Next: </span>{nextLine(f?.next_action) || 'None'}</p>
      <CountPills counts={e.attention?.counts} /></li>; })}</ul>
  </section>;
}

function RecordAction({ record, entity, onAdd, onOpen }) {
  const a = recordAction(record, entity.name);
  if (!a) return record.state === 'restricted' ? <span className="text-[11px] text-axal-muted">Super Admin only</span> : <span className="text-axal-muted">—</span>;
  return <button type="button" className={`${button} min-h-[44px] md:min-h-0 md:py-1`} aria-label={a.aria}
    onClick={() => (a.kind === 'add' ? onAdd(record.category) : onOpen(a.uid))}>{a.label}</button>;
}

function StateCell({ record }) {
  const line = recordState(record.state)?.line;
  return <><RecordStateBadge state={record.state} />{record.restricted && record.state !== 'restricted' && <span className="ml-1 text-[11px] text-axal-muted">· confidential</span>}
    {line && <span className="block text-[11px] text-axal-muted">{line}</span>}</>;
}

/** One entity (CT-04 to CT-06): breadcrumb, facts and expected records. */
export function EntityAttention({ entity, onAdd, onOpen }) {
  const f = entity.attention?.facts;
  const records = entity.attention?.records || [];
  const facts = [
    // D4811 part 17 (question A, owner 2026-11-09): the entity's formation jurisdiction, from the Worker.
    ['Formation jurisdiction', entity.jurisdiction || <Missing key="j" reason="Not recorded for this entity." />],
    ['Latest executed', latestLine(f, entity.withheld)],
    ['Last review', <Missing key="r" reason={LAST_REVIEW} />],
    ['Outstanding issue', issueLine(f?.outstanding_issue) || <span key="i" className="text-axal-muted">None</span>],
    ['Next required action', nextLine(f?.next_action) || <span key="n" className="text-axal-muted">None</span>],
  ];
  return <section aria-labelledby={`governance-entity-h-${entity.key}`} className="space-y-4" data-testid={`governance-attention-${entity.key}`}>
    <nav aria-label="Breadcrumb" className="text-[11px] font-bold uppercase tracking-widest text-axal-faint">
      <Link to="/admin/contracts">Contracts</Link> › <Link to={governanceHref()}>Corporate Governance</Link> › <span aria-current="page" className="text-axal-ink dark:text-white">{entity.name}</span></nav>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h3 id={`governance-entity-h-${entity.key}`} className="text-xl font-bold">{entity.name}</h3>
      <button type="button" className={`${button} bg-violet-600 text-white`} onClick={() => onAdd(null)}>Add governance record</button></div>
    <dl className="grid overflow-hidden rounded-xl border border-axal-hairline sm:grid-cols-2 xl:grid-cols-5">{facts.map(([k, v], i) =>
      <div key={k} className={`border-b border-r border-axal-hairline p-3 text-[12.5px] ${i === 3 && f?.outstanding_issue ? 'bg-[#fffbeb] dark:bg-amber-950/30' : 'bg-white dark:bg-gray-900'}`}>
        <dt className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl>
    <section aria-labelledby={`governance-expected-h-${entity.key}`} className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-3 py-2">
        <h4 id={`governance-expected-h-${entity.key}`} className="font-bold">Expected records</h4>
        <span className="text-[11px] text-axal-muted">{records.length} record types this entity should hold</span></div>
      <table className="hidden w-full text-left text-[12.5px] md:table">
        <caption className="sr-only">Expected records of {entity.name}</caption>
        <thead className="bg-axal-ground text-[10px] uppercase tracking-widest text-axal-faint dark:bg-gray-800"><tr>
          {['Record', 'State', 'Latest version', 'Effective', 'Last review', 'Next action'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-axal-hairline">{records.map((r) => <tr key={r.category} className="align-top" data-testid={`expected-${entity.key}-${r.category}`}>
          <td className="px-3 py-2 font-semibold">{r.label}</td>
          <td className="px-3 py-2"><StateCell record={r} /></td>
          <td className="px-3 py-2">{recordVersion(r) || <span className="text-axal-muted">—</span>}</td>
          <td className="px-3 py-2 font-mono">{r.current ? (dayLabel(r.current.effective_date) || <Missing />) : <span className="text-axal-muted">—</span>}</td>
          <td className="px-3 py-2"><Missing /></td>
          <td className="px-3 py-2"><RecordAction record={r} entity={entity} onAdd={onAdd} onOpen={onOpen} /></td></tr>)}</tbody>
      </table>
      <ul className="divide-y divide-axal-hairline md:hidden">{records.map((r) => <li key={r.category} className="space-y-1 p-3 text-[12.5px]">
        <p className="font-semibold">{r.label}</p><StateCell record={r} />
        {recordVersion(r) && <p className="text-axal-muted">{recordVersion(r)}</p>}
        <RecordAction record={r} entity={entity} onAdd={onAdd} onOpen={onOpen} /></li>)}</ul>
    </section>
    <p className="text-[11px] text-axal-muted">Last review reads Not recorded until the legal-review record exists. The expected set covers the five governance categories; other record types are not tracked yet.</p>
  </section>;
}

/** A drill-down (CT-92 "Metric drill-down"): the records behind one count. */
export function DrillList({ entities, state, onAdd, onOpen }) {
  const rows = drillRecords(entities, state);
  const label = DRILLS.find((d) => d.key === state)?.label || recordState(state)?.label;
  return <section aria-labelledby="governance-drill-h" className={`${card} overflow-hidden`} data-testid={`governance-drill-list-${state}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-3 py-2">
      <h3 id="governance-drill-h" className="font-bold">{label} <span className="font-mono text-axal-muted">· {rows.length}</span></h3>
      <Link to={governanceHref()} className="text-[12px] font-semibold text-violet-700 dark:text-violet-300">‹ All of Corporate Governance</Link></div>
    {rows.length === 0 ? <p role="status" className="p-3 text-[12.5px] text-axal-muted">No record is in this state.</p>
      : <ul className="divide-y divide-axal-hairline">{rows.map(({ entity, record }) => <li key={`${entity.key}-${record.category}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[12.5px]">
        <span className="min-w-0"><span className="block font-semibold">{record.label}</span>
          <Link to={governanceHref(`entity=${entity.key}`)} className="block text-[11px] text-axal-muted hover:underline">{entity.name}</Link></span>
        <span className="flex flex-wrap items-center gap-2"><RecordStateBadge state={record.state} />
          {record.attention && <span className="text-[11px] text-axal-muted">{record.attention.title} · {statusLabel(record.attention.status)}</span>}
          <RecordAction record={record} entity={entity} onAdd={(c) => onAdd(entity, c)} onOpen={onOpen} /></span></li>)}</ul>}
  </section>;
}
