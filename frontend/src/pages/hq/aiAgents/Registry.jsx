import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Card, DataState, PhoneSheet, StateChip, usePhoneWidth } from '../../../ui';
import { HeaderTab } from '../../../ui/AdminPageHeader';
import { aiAgentsRegistryApi } from '../../../lib/api/aiAgentsRegistry';
import {
  KINDS, NO_STAGE, STAGES, STATUSES, capabilitySummary, copiesText, countsLine, driftHandoff, driftMark, filterAgents,
  filtersFrom, filtersSearch, manifestPath, orNotRecorded, readState, registryCsv, registryHref, shortCommit, shortDigest,
  stageGroups, stageLabel, utcStamp,
} from './registryModel';

/**
 * D8080 part 2 (#8080) — HQ › AI agents › Roster › Registry, built to the landed canvas
 * `design/incoming/HQ AI Agents Registry Page.dc.html` (boards SA20 to SA24, D4137-p4; owner Q1 drawn as A, a
 * Roster tab). Super Admin only: the page is `hqOnly`, and `GET /api/admin/ai-agents/registry` re-checks with
 * `requireSuperAdmin`. Read-only: manifests change by pull request, so nothing here edits an agent.
 *
 *   /hq/ai-agents/roster/registry[?stage=&status=&q=]   SA20: the catalogue by stage (SA23 cards on a phone)
 *   /hq/ai-agents/roster/registry/:name                 SA21: one entry, its drift and how to change it
 *
 * States (SA22): Loading is the table's shape; Not recorded (no sync yet) says so and is never an empty
 * catalogue; a failed read is Unavailable with Try again and leaves the Personas tab working; a 403 is Refused.
 * What the build does not draw from the canvas, and why, is D8080-p2's departures table.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const EYEBROW = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const H2 = 'text-[14px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const SELECT = 'h-9 rounded-lg border border-axal-hairline bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';
const STATUS_TONE = {
  live: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  paused: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  retired: 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-400',
};

/** Roster's Personas | Registry switch (owner Q1 = A, drawn on SA20 and SA23). */
export function RosterSwitch() {
  return (
    <nav aria-label="Roster" className="flex gap-5 border-b border-axal-hairline dark:border-gray-800" data-testid="ai-agents-roster-switch">
      <HeaderTab to="/hq/ai-agents/roster" end data-testid="roster-switch-personas">Personas</HeaderTab>
      <HeaderTab to="/hq/ai-agents/roster/registry" data-testid="roster-switch-registry">Registry</HeaderTab>
    </nav>
  );
}

function StatusPill({ status }) {
  return <span className={`inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full border px-2 text-[11.5px] font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.retired}`}>{STATUSES[status] ?? orNotRecorded(status)}</span>;
}

function KindTag({ kind }) {
  return (
    <span className="inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border border-axal-hairline px-2 text-[11.5px] text-axal-ink dark:border-gray-700 dark:text-gray-200">
      <span aria-hidden="true" className={kind === 'platform' ? 'block h-[7px] w-[7px] rounded-[2px] bg-axal-violet dark:bg-violet-400' : 'block h-[7px] w-[7px] rounded-full border-[1.5px] border-axal-muted dark:border-gray-400'} />
      {KINDS[kind] ?? orNotRecorded(kind)}
    </span>
  );
}

/** SA22E: the five drift marks, each a glyph and a word; the amber of Drift is never the only signal. */
export function DriftMark({ agent }) {
  const m = driftMark(agent);
  if (m.kind === 'drift') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 py-px pl-1.5 pr-2 text-[11.5px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300" data-drift="drift">
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12"><path d="M6 1l5 9.5H1z" fill="currentColor" /></svg>{m.label}
      </span>
    );
  }
  if (m.kind === 'agrees') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 py-px pl-1.5 pr-2 text-[11.5px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" data-drift="agrees">
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>{m.label}
      </span>
    );
  }
  return <StateChip kind={m.kind} data-drift={m.kind} title={m.kind === 'not_recorded' ? 'A platform agent has no team copy, so the sync does not compare it.' : 'No live copy to compare.'} />;
}

/** The registry read, with its four outcomes. */
function useRegistry() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setState({ status: 'loading', data: null });
    aiAgentsRegistryApi.registry()
      .then((data) => {
        const s = readState(data);
        setState({ status: s === 'unreadable' ? 'unreadable' : s, data: s === 'unreadable' ? null : data });
      })
      .catch((e) => setState({ status: Number(e?.status) === 403 ? 'refused' : 'unreadable', data: null }));
  }, []);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

/** SA22 · Loading: the stage table's shape, not a spinner. */
export function LoadingRegistry() {
  return (
    <div className="space-y-3" data-testid="registry-loading">
      <p role="status" className={MUTED}>Reading the registry…</p>
      {[0, 1].map((g) => (
        <Card key={g} className="space-y-2 px-4 py-4">
          <DataState state="loading" size="tile" />
          <DataState state="loading" size="block" />
        </Card>
      ))}
    </div>
  );
}

/** SA22B · Not recorded: the registry has never synced. Not zero agents. */
export function NotSynced() {
  return (
    <Card className="space-y-2 px-4 py-4" data-testid="registry-not-recorded">
      <StateChip kind="not_recorded" />
      <p className="text-[14px] font-bold text-axal-ink dark:text-gray-100">The registry has not synced yet</p>
      <p className={MUTED}>No manifest has been recorded, so there are no entries, versions, copies or drift to show. This is not zero agents: the personas are on the Personas tab as before.</p>
      <p className="text-[12.5px] text-axal-ink dark:text-gray-200">
        The registry fills when <span className="font-mono">scripts/deploy/sync-agent-registry.mjs</span> runs after a deploy. The deploy workflow does not run it yet, so until it does an operator runs it by hand.
      </p>
    </Card>
  );
}

/** SA22D · Refused: not a super admin. Nothing is hidden behind a blur and no counts are shown. */
export function RefusedRegistry() {
  return (
    <DataState
      state="refused" size="block" as="div" data-testid="registry-refused"
      reason="The registry is for super admins. Your account does not have super-admin rights, so the registry was not sent. A super admin can grant the role in Security."
    />
  );
}

/** SA22C · Unavailable: the read failed. No entries are drawn, and none as zero; Personas still works. */
export function UnreadableRegistry({ onRetry }) {
  return (
    <div className="space-y-2" data-testid="registry-unreadable">
      <DataState state="unavailable" size="block" as="div" what="The registry" claim="No entries are shown, and none are drawn as zero." reason="The Personas tab reads from its own route and still works." onRetry={onRetry} retryLabel="Try again" announce="always" />
      <Link to="/hq/ai-agents/roster" className={`${LINK} text-[12.5px]`}>Open Personas</Link>
    </div>
  );
}

function download(name, text) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const HEADS = ['Agent · kind · identity', 'Version', 'Capabilities', 'Models', 'Cost · security', 'Status', 'Copies', 'Drift'];

/** SA20 · one stage group's table. */
export function StageTable({ group }) {
  return (
    <section aria-label={group.label} className="space-y-2" data-testid={`registry-stage-${group.key}`}>
      <div className="flex items-baseline gap-2.5">
        <h2 className={H2}>{group.label}</h2>
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">
          {group.agents.length} {group.agents.length === 1 ? 'entry' : 'entries'} · {group.copies == null ? 'live copies not recorded' : `${group.copies} live copies`}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[960px] text-[12.5px]" aria-label={`${group.label} agents`}>
          <thead className={EYEBROW}><tr className="text-left">{HEADS.map((h) => <th key={h} scope="col" className={`px-3 py-2 ${h === 'Copies' ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {group.agents.map((a) => {
              const caps = capabilitySummary(a.capabilities);
              return (
                <tr key={a.name} className="border-t border-axal-hairline/60 align-top dark:border-gray-800" data-testid="registry-row">
                  <td className="px-3 py-2">
                    <Link to={registryHref(a.name)} className={`${LINK} text-[13.5px]`}>{a.name}</Link>
                    <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-axal-muted dark:text-gray-400"><KindTag kind={a.kind} /><span className="font-mono">{a.identity}</span></span>
                  </td>
                  <td className="px-3 py-2 font-mono text-axal-ink dark:text-gray-200">{a.version}</td>
                  <td className="px-3 py-2 text-axal-ink dark:text-gray-200">{caps.text}</td>
                  <td className="px-3 py-2 text-axal-ink dark:text-gray-200">{a.models?.length ? a.models.join(' · ') : 'None: it makes no model call'}</td>
                  <td className="px-3 py-2 text-axal-ink dark:text-gray-200">{orNotRecorded(a.cost_profile)} · {orNotRecorded(a.security_profile)}</td>
                  <td className="px-3 py-2"><StatusPill status={a.status} /></td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-axal-ink dark:text-gray-200">{copiesText(a)}</td>
                  <td className="px-3 py-2"><DriftMark agent={a} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** SA23 · one phone card: name, version, kind, status, drift word; 44 px tall at least. */
export function PhoneCard({ agent, onOpen }) {
  return (
    <button type="button" onClick={(e) => onOpen(agent, e.currentTarget)} className="flex min-h-[64px] w-full items-center gap-3 border-t border-axal-hairline px-1 py-2.5 text-left first:border-t-0 dark:border-gray-800" data-testid="registry-card">
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-2"><b className="truncate text-[14.5px] text-axal-ink dark:text-gray-100">{agent.name}</b><span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{agent.version}</span></span>
        <span className="flex flex-wrap items-center gap-1.5"><KindTag kind={agent.kind} /><StatusPill status={agent.status} /><DriftMark agent={agent} /></span>
      </span>
      <span aria-hidden="true" className="text-axal-muted dark:text-gray-400">›</span>
    </button>
  );
}

function Filters({ filters, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value.slice(0, 80) })} placeholder="Search the registry" aria-label="Search the registry" className="h-11 min-w-[200px] flex-1 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:h-9" />
      <select value={filters.stage} onChange={(e) => onChange({ ...filters, stage: e.target.value })} aria-label="Stage" className={`${SELECT} h-11 sm:h-9`}>
        <option value="">Stage: all</option>
        {[...STAGES, NO_STAGE].map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })} aria-label="Status" className={`${SELECT} h-11 sm:h-9`}>
        <option value="">Status: all</option>
        {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
}

/** SA20 / SA23 · the catalogue. */
function RegistryList() {
  const [state, load] = useRegistry();
  const { search } = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const [sheet, setSheet] = useState(null);
  const opener = useRef(null);
  const filters = filtersFrom(search);
  const setFilters = (f) => navigate({ search: filtersSearch(f) }, { replace: true });
  if (state.status === 'loading') return <LoadingRegistry />;
  if (state.status === 'refused') return <RefusedRegistry />;
  if (state.status === 'unreadable') return <UnreadableRegistry onRetry={load} />;
  if (state.status === 'not_recorded') return <NotSynced />;
  const all = state.data.agents;
  const groups = stageGroups(filterAgents(all, filters));
  const synced = (
    <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="registry-synced">
      Synced {utcStamp(state.data.synced_at)} · manifests at commit <span className="font-mono">{shortCommit(state.data.manifest_commit)}</span>
    </p>
  );
  const open = (a, el) => { opener.current = el; setSheet(a); };
  return (
    <div className="space-y-4" data-testid="ai-agents-registry">
      <Card className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {synced}
          <span className="ml-auto font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="registry-counts">{countsLine(all)}</span>
          {phone ? null : <button type="button" className={BTN} onClick={() => download('agent-registry.csv', registryCsv(all))} data-testid="registry-export">Export CSV</button>}
        </div>
        <Filters filters={filters} onChange={setFilters} />
      </Card>
      {groups.length === 0 ? <DataState state="none" size="block">No registry entry matches these filters.</DataState> : phone ? (
        groups.map((g) => (
          <section key={g.key} aria-label={g.label} className="space-y-1" data-testid={`registry-stage-${g.key}`}>
            <p className="flex items-baseline gap-2"><b className={H2}>{g.label}</b><span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{g.agents.length} {g.agents.length === 1 ? 'entry' : 'entries'}</span></p>
            <Card className="px-3 py-1">{g.agents.map((a) => <PhoneCard key={a.name} agent={a} onOpen={open} />)}</Card>
          </section>
        ))
      ) : groups.map((g) => <StageTable key={g.key} group={g} />)}
      <p className="text-[12px] text-axal-muted dark:text-gray-400">
        Copies counts the live team agents bound to each venture entry, today; a platform agent has none, so its copies and drift are not recorded. Drift counts the fields that disagreed at the last sync; Not applicable means no live copy to compare.
      </p>
      {sheet ? (
        <PhoneSheet label={sheet.name} title={sheet.name} onClose={() => setSheet(null)} opener={opener}>
          <AgentBody agent={sheet} compact />
        </PhoneSheet>
      ) : null}
    </div>
  );
}

function Row({ k, children }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-[12.5px] text-axal-muted dark:text-gray-400">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-[12.5px] text-axal-ink dark:text-gray-200">{children}</dd>
    </div>
  );
}

/** SA21 (and SA23B on a phone): the manifest as recorded, its drift and how to change it. */
export function AgentBody({ agent: a, compact = false }) {
  const caps = capabilitySummary(a.capabilities);
  const mark = driftMark(a);
  const manifest = (
    <dl className="m-0" data-testid="registry-manifest">
      {!compact && <Row k="Name">{a.name}</Row>}
      <Row k="Version"><span className="font-mono">{a.version}</span></Row>
      <Row k="Stage">{stageLabel(a.stage)}</Row>
      <Row k="Kind"><KindTag kind={a.kind} /></Row>
      <Row k="Owner"><span className="font-mono">{a.owner}</span></Row>
      <Row k="Identity"><span className="font-mono">{a.identity}</span></Row>
      <Row k="Runner pool"><span className="font-mono">{a.runner_pool}</span></Row>
      <Row k="Status"><StatusPill status={a.status} /></Row>
      <Row k="Capabilities">{caps.text}{caps.byDomain.length ? <span className="text-axal-muted dark:text-gray-400"> · {caps.byDomain.map(([d, n]) => `${d} ${n}`).join(' · ')}</span> : null}</Row>
      <Row k="Models allowed">{a.models?.length ? a.models.join(' · ') : 'None: it makes no model call'}</Row>
      <Row k="Cost profile">{orNotRecorded(a.cost_profile)}</Row>
      <Row k="Security profile">{orNotRecorded(a.security_profile)}</Row>
      <Row k="Live copies">{copiesText(a)}</Row>
      <Row k="Synced at"><span className="font-mono">{utcStamp(a.synced_at)}</span></Row>
      <Row k="Manifest commit"><span className="font-mono">{shortCommit(a.manifest_commit)}</span></Row>
      <Row k="Manifest digest"><span className="font-mono">{shortDigest(a.manifest_sha)}</span></Row>
    </dl>
  );
  const drift = mark.kind === 'drift' ? (
    <ul className="m-0 list-none p-0" data-testid="registry-drift">
      {a.drift.map((d, i) => {
        const h = driftHandoff(d.field);
        return (
          <li key={`${d.field}-${d.agent_uid ?? ''}-${i}`} className="grid gap-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_150px_110px] sm:items-center sm:gap-3">
            <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{d.field}{d.agent_uid ? <span className="font-mono font-normal text-axal-muted dark:text-gray-400"> · {d.agent_uid}</span> : null}</span>
            <span className="text-[12.5px] text-axal-ink dark:text-gray-200"><span className={`${EYEBROW} sm:hidden`}>Manifest </span>{orNotRecorded(d.manifest_value)}</span>
            <span className="text-[12.5px] text-axal-ink dark:text-gray-200"><span className={`${EYEBROW} sm:hidden`}>Runtime </span>{orNotRecorded(d.runtime_value)}</span>
            <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{utcStamp(d.seen_at)}</span>
            <Link to={h.to} className={`${LINK} inline-flex min-h-[44px] items-center text-[12.5px] sm:min-h-0`}>{h.label}</Link>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
      <DriftMark agent={a} />
      {mark.kind === 'agrees' ? 'Every field the sync compares agrees with the running copies.' : mark.kind === 'not_applicable' ? 'No live copy to compare.' : 'A platform agent has no team copy in the database, so the sync does not compare it.'}
    </p>
  );
  return (
    <div className="space-y-3" data-testid="registry-agent">
      <Card className="space-y-2 px-4 py-4">
        <p className="flex items-baseline justify-between gap-2"><span className={H2}>Manifest as recorded</span><span className={MUTED}>from the manifest at the commit below</span></p>
        {manifest}
      </Card>
      <Card className="space-y-2 px-4 py-4">
        <p className="flex items-baseline justify-between gap-2"><span className={H2}>Manifest vs runtime</span>{mark.kind === 'drift' ? <DriftMark agent={a} /> : null}</p>
        {drift}
        {mark.kind === 'drift' ? <p className={MUTED}>{a.drift.length} {a.drift.length === 1 ? 'field disagrees' : 'fields disagree'} at the sync of {utcStamp(a.synced_at)}. The runtime side is the copy’s own record, not a guess.</p> : null}
      </Card>
      <Card className="space-y-2 px-4 py-4">
        <p className={H2}>Last runs</p>
        <DataState state="not_recorded" reason="The registry does not link an entry to its runs yet. A venture copy’s runs are on its team’s agent page." />
      </Card>
      <Card className="space-y-2 px-4 py-4" data-testid="registry-how-to-change">
        <p className={H2}>How to change this</p>
        <p className="text-[12.5px] text-axal-ink dark:text-gray-200">
          This entry is the manifest <span className="font-mono">{manifestPath(a.name)}</span>. Change it in a pull request; the next sync records the new version. Nothing on this page edits the agent.
        </p>
      </Card>
    </div>
  );
}

/** SA21 · one entry at its own address. */
function RegistryAgent({ name }) {
  const [state, load] = useRegistry();
  const back = <Link to="/hq/ai-agents/roster/registry" className={`${LINK} text-[12.5px]`}>‹ Registry</Link>;
  if (state.status === 'loading') return <div className="space-y-3">{back}<LoadingRegistry /></div>;
  if (state.status === 'refused') return <RefusedRegistry />;
  if (state.status === 'unreadable') return <div className="space-y-3">{back}<UnreadableRegistry onRetry={load} /></div>;
  if (state.status === 'not_recorded') return <div className="space-y-3">{back}<NotSynced /></div>;
  const a = state.data.agents.find((x) => x.name === name);
  if (!a) {
    return (
      <div className="space-y-3">
        {back}
        <DataState state="none" size="block" data-testid="registry-agent-missing">No current registry entry is named “{name}”. It may have been removed from the manifests at the last sync.</DataState>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[20px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{a.name}</h2>
        <KindTag kind={a.kind} /><StatusPill status={a.status} /><DriftMark agent={a} />
      </div>
      <p className={MUTED}>Registry entry {a.version} as recorded at the last sync, where the running copies disagree with it, and how to change it. Nothing on this page edits the agent.</p>
      <AgentBody agent={a} />
    </div>
  );
}

export default function Registry({ view }) {
  return view.sub === 'registry-agent' ? <RegistryAgent key={view.agent} name={view.agent} /> : <RegistryList />;
}
