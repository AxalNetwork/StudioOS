import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Card, DataState, Sheet, StateChip, usePhoneWidth } from '../../../ui';
import { HeaderTab } from '../../../ui/AdminPageHeader';
import { aiAgentsPolicyApi } from '../../../lib/api/aiAgentsPolicy';
import { adminAiAgentsApi } from '../../../lib/api/adminAiAgents';
import {
  CELL_WORDS, DEFAULT_EXPANDED, REASON_MAX, REASON_MIN, RESERVED, agentName, ceilingDomainCount, ceilingState, cellLabel,
  cellOf, cellState, domainCount, domainsOf, effectLine, filterAgents, filtersFrom, filtersSearch, grantCount, holds, isLocked,
  lastChangeLine, lastRefusalFrom, nowLine, shortDay, orderCatalogue, readFailure, readState, reasonLength, reasonOk, revokeReview,
  roleChoices, roleLabel, roleMates, runHref, statusWord, summary, utcStamp, workerRefusal,
} from './capabilityModel';

/**
 * D8070 part 2 (#8070) — HQ › AI agents › Operations › Policies › Capabilities, built to the landed canvas
 * `design/incoming/HQ AI Agents Capability Policies Page.dc.html` (boards SA10 to SA14, D4137-p2; owner questions
 * drawn and built as option A). Super Admin only: the page is `hqOnly`, and every route re-checks with
 * `requireSuperAdmin`.
 *
 *   /hq/ai-agents/operations/policies                 Platform settings (SA6, unchanged)
 *   /hq/ai-agents/operations/policies/capabilities    SA10: the matrix (SA13 cards on a phone)
 *
 * Reads `GET /api/admin/ai-agents/policy/capabilities` and, per agent, its newest refused run from the run log.
 * Writes only `POST …/capabilities/grant` and `POST …/capabilities/revoke`, each with a reason. Nothing here turns
 * enforcement on or changes the ceiling: both are read and shown, never switched.
 * What the build does not draw from the canvas, and why, is D8070-p2's departures table.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const EYEBROW = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3.5 text-[13px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 sm:min-h-[38px]';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-axal-violet px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-600 dark:text-white sm:min-h-[38px]';
const DANGER = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 text-[13px] font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 sm:min-h-[38px]';
const SELECT = 'h-11 rounded-lg border border-axal-hairline bg-white px-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:h-9';
const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';
const CODE = 'rounded bg-violet-50 px-1 font-mono text-[12px] text-violet-800 dark:bg-violet-900/30 dark:text-violet-200';

const Code = ({ children }) => <code className={CODE}>{children}</code>;

/** Policies' Platform settings | Capabilities switch (SA10's segmented control). */
export function PolicySwitch() {
  return (
    <nav aria-label="Policies" className="flex gap-5 border-b border-axal-hairline dark:border-gray-800" data-testid="ai-agents-policy-switch">
      <HeaderTab to="/hq/ai-agents/operations/policies" end data-testid="policy-switch-settings">Platform settings</HeaderTab>
      <HeaderTab to="/hq/ai-agents/operations/policies/capabilities" data-testid="policy-switch-capabilities">Capabilities</HeaderTab>
    </nav>
  );
}

// ─── cells ───────────────────────────────────────────────────────────────────

const BOX = 'inline-grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] border';
const CHECK = <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><path d="M2.5 7.5l3 3L11.5 4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
const LOCK = <svg aria-hidden="true" width="13" height="13" viewBox="0 0 14 14"><rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="currentColor" /><path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;

/** One mark per state, each with a glyph or a word, never colour alone (the legend names them). */
export function CellMark({ state }) {
  if (state === 'granted') return <span aria-hidden="true" className={`${BOX} border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`}>{CHECK}</span>;
  if (state === 'locked') return <span aria-hidden="true" className={`${BOX} border-gray-300 bg-gray-100 text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400`}>{LOCK}</span>;
  if (state === 'not_offered') return <span aria-hidden="true" className={`${BOX} border-dashed border-gray-300 bg-transparent text-[13px] text-gray-500 dark:border-gray-600 dark:text-gray-400`}>–</span>;
  if (state === 'offered') return <span aria-hidden="true" className="inline-flex h-[24px] items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{CHECK}On</span>;
  if (state === 'off') return <span aria-hidden="true" className="inline-flex h-[24px] items-center rounded-md border border-dashed border-gray-300 px-1.5 text-[11px] font-bold text-gray-600 dark:border-gray-600 dark:text-gray-400">Off</span>;
  return <span aria-hidden="true" className={`${BOX} border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900`} />;
}

export function Legend() {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0 text-[12px] text-axal-ink dark:text-gray-200" aria-label="Legend" data-testid="capability-legend">
      {[['granted', 'Granted'], ['not_granted', 'Not granted'], ['locked', 'Locked · a person does it, never an agent'], ['not_offered', 'Not offered now']].map(([k, t]) => (
        <li key={k} className="inline-flex items-center gap-1.5"><CellMark state={k} />{t}</li>
      ))}
      <li className="inline-flex items-center gap-1.5"><span className="font-mono font-bold">1/2</span>Collapsed domain · granted of grantable</li>
    </ul>
  );
}

// ─── reads ───────────────────────────────────────────────────────────────────

/** The matrix read: loading, recorded, refused (403) or unreadable. A write's answer replaces the data. */
export function useCapabilities() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setState({ status: 'loading', data: null });
    aiAgentsPolicyApi.capabilities()
      .then((data) => setState(readState(data) === 'recorded' ? { status: 'recorded', data } : { status: 'unreadable', data: null }))
      .catch((e) => setState({ status: readFailure(e), data: null }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const replace = useCallback((data) => { if (readState(data) === 'recorded') setState({ status: 'recorded', data }); else load(); }, [load]);
  return [state, load, replace];
}

/** Each agent's newest refused run: the run log filtered to the agent and `refused`, then that run's code. */
export function useLastRefusals(uids) {
  const key = (uids ?? []).join(',');
  const [map, setMap] = useState({});
  useEffect(() => {
    let live = true;
    const list = key ? key.split(',') : [];
    setMap({});
    list.forEach((uid) => {
      adminAiAgentsApi.runs({ agent: uid, status: 'refused' })
        .then((runs) => {
          const first = Array.isArray(runs?.runs) ? runs.runs[0] : null;
          if (!first) return lastRefusalFrom(runs, null);
          return adminAiAgentsApi.run(first.uid).then((run) => lastRefusalFrom(runs, run), () => lastRefusalFrom(runs, null));
        })
        .catch(() => ({ state: 'unreadable' }))
        .then((r) => { if (live) setMap((m) => ({ ...m, [uid]: r })); });
    });
    return () => { live = false; };
  }, [key]);
  return map;
}

// ─── states (SA12) ───────────────────────────────────────────────────────────

export function MatrixLoading() {
  return (
    <Card className="space-y-3 px-4 py-4" data-testid="capability-loading">
      <p role="status" className={MUTED}>Reading the agents and their capabilities…</p>
      <DataState state="loading" size="tile" />
      <DataState state="loading" size="block" />
    </Card>
  );
}

export function MatrixUnreadable({ onRetry }) {
  return (
    <DataState
      state="unavailable" size="block" as="div" data-testid="capability-unreadable"
      what="The capability matrix"
      claim="This is not a claim that no capability is granted."
      reason="The agents, their grants and the platform ceiling come in one read, so none of them is drawn. Grants and revokes wait until it is back."
      onRetry={onRetry} retryLabel="Try again" announce="always"
    />
  );
}

export function MatrixRefused() {
  return (
    <DataState
      state="refused" size="block" as="div" data-testid="capability-refused"
      reason="Capability policies are shown to super admins only. Nothing of the matrix is drawn, because the read was refused. That is not a claim that no capability is granted. A super admin can grant the role in Security."
    />
  );
}

// ─── summary ─────────────────────────────────────────────────────────────────

export function SummaryLine({ data }) {
  const s = summary(data);
  const enforced = data?.policy ? data.policy.enforced : null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="capability-summary">
      <b>{s.agents} {s.agents === 1 ? 'agent' : 'agents'}</b><span>live or paused ·</span>
      {s.grants == null
        ? <><span>grants</span><StateChip kind="not_recorded" /><span>no capability has been granted to any agent yet ·</span></>
        : <><b>{s.grants} {s.grants === 1 ? 'grant' : 'grants'}</b><span>held now ·</span></>}
      {s.offered == null
        ? <><span>ceiling</span><StateChip kind="unavailable" /><span>·</span></>
        : <><b>{s.offered} of {s.grantable}</b><span>grantable capabilities offered, as set now ·</span></>}
      <b>{s.locked} locked</b><span>for every agent ·</span>
      <span data-testid="capability-enforcement">Enforcement {enforced === true ? <b>on</b> : enforced === false ? <><b>off</b> (only the reserved names are refused)</> : <StateChip kind="unavailable" />}</span>
    </p>
  );
}

// ─── the matrix (SA10, SA14) ────────────────────────────────────────────────

function LastRefusal({ r, short = false }) {
  if (!r) return <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Last refusal: reading…</span>;
  if (r.state === 'none') return <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Last refusal: None</span>;
  if (r.state === 'unreadable') return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] text-axal-muted dark:text-gray-400">Last refusal <StateChip kind="unavailable" /></span>;
  return (
    <Link to={runHref(r.uid)} className="inline-flex min-h-[24px] flex-wrap items-center gap-x-1 text-[11.5px] dark:text-gray-300" data-testid="capability-last-refusal">
      <span className="font-mono font-semibold text-red-700 dark:text-red-300">{r.code ?? 'code not recorded'}</span>
      <span className="text-axal-violet dark:text-violet-300">›</span>
      {short ? null : <span className="whitespace-nowrap text-axal-muted dark:text-gray-400" title={utcStamp(r.at) ?? undefined}>{shortDay(r.at) ?? 'time not recorded'}</span>}
    </Link>
  );
}

const ARROWS = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };

/** Arrow keys move between the cells that are buttons, skipping locked and not-offered marks. */
function moveFocus(e) {
  const step = ARROWS[e.key];
  const from = e.target?.closest?.('[data-cell]');
  if (!step || !from) return;
  const grid = e.currentTarget;
  let r = Number(from.dataset.r), c = Number(from.dataset.c);
  for (let i = 0; i < 60; i++) {
    r += step[0]; c += step[1];
    const next = grid.querySelector(`[data-cell][data-r="${r}"][data-c="${c}"]`);
    if (next) { e.preventDefault(); next.focus(); return; }
    if (r < 0 || c < 0) return;
  }
}

/** SA10: agents as rows, capabilities as columns grouped by domain, the ceiling as the first row. */
export function Matrix({ data, agents, expanded, onToggle, onOpen, refusals = {}, selected = null }) {
  const catalogue = orderCatalogue(data.catalogue);
  const groups = domainsOf(catalogue);
  const policy = data.policy ?? null;
  // SA12B: with no grant ever recorded, a collapsed domain is an empty mark ("nothing granted"), not "0/2".
  const noneRecorded = grantCount(data.agents) == null;
  const cols = [];
  for (const g of groups) {
    if (expanded.includes(g.domain)) g.entries.forEach((e, i) => cols.push({ kind: 'cap', group: g, entry: e, first: i === 0 }));
    else cols.push({ kind: 'domain', group: g, first: true });
  }
  const sep = (c) => (c.first ? 'border-l border-axal-hairline dark:border-gray-800' : '');
  return (
    <div className="overflow-x-auto rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="capability-matrix">
      <table role="grid" aria-label="Capabilities by agent" className="border-collapse text-[12.5px]" onKeyDown={moveFocus}>
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60">
            <th scope="col" rowSpan={2} className={`sticky left-0 z-10 min-w-[240px] bg-gray-50 px-3.5 py-2 text-left align-bottom dark:bg-gray-800 ${EYEBROW}`}>Agent · role · last refusal</th>
            {groups.map((g) => {
              const open = expanded.includes(g.domain);
              return (
                <th key={g.domain} scope="colgroup" colSpan={open ? g.entries.length : 1} className="border-l border-axal-hairline px-1 py-1.5 text-left dark:border-gray-800">
                  <button type="button" aria-expanded={open} onClick={() => onToggle(g.domain)} className="inline-flex min-h-[32px] items-center gap-1 rounded px-1 font-mono text-[11px] font-bold uppercase tracking-[.05em] text-axal-ink dark:text-gray-200" data-testid={`capability-domain-${g.domain}`}>
                    <span aria-hidden="true">{open ? '▾' : '▸'}</span>{g.domain}
                  </button>
                </th>
              );
            })}
          </tr>
          <tr className="bg-gray-50 dark:bg-gray-800/60">
            {cols.map((c) => (
              <th key={c.kind === 'cap' ? c.entry.name : `d-${c.group.domain}`} scope="col" className={`h-[108px] w-[46px] px-0 pb-2 align-bottom ${sep(c)}`}>
                <span className="mx-auto block whitespace-nowrap font-mono text-[11px] font-semibold text-axal-ink [transform:rotate(180deg)] [writing-mode:vertical-rl] dark:text-gray-200">
                  {c.kind === 'cap' ? `${c.entry.action ?? c.entry.name.split('.')[1]}${isLocked(c.entry) ? ' · locked' : ''}` : `${c.group.domain} · ${c.group.entries.length}`}
                </span>
              </th>
            ))}
          </tr>
          <tr className="border-y border-axal-hairline bg-gray-50 dark:border-gray-800 dark:bg-gray-800/60" data-testid="capability-ceiling-row">
            <th scope="row" className="sticky left-0 z-10 bg-gray-50 px-3.5 py-2 text-left font-normal dark:bg-gray-800">
              <span className="block text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Platform offers · as set now</span>
              <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">The ceiling for every agent</span>
            </th>
            {cols.map((c) => {
              if (c.kind === 'domain') {
                const n = ceilingDomainCount(c.group, policy, catalogue);
                return <td key={`d-${c.group.domain}`} className={`px-1 text-center ${sep(c)}`}>{n ? <span className="font-mono font-bold text-axal-ink dark:text-gray-200" aria-label={`${c.group.domain}: ${n.offered} of ${n.of} offered`}>{n.text}</span> : <StateChip kind="unavailable" label="?" title="The ceiling could not be read" />}</td>;
              }
              const s = ceilingState(c.entry, policy);
              return (
                <td key={c.entry.name} className={`px-1 py-2 text-center ${sep(c)}`}>
                  <span role="img" aria-label={`Platform, ${c.entry.name}: ${s === 'offered' ? 'offered' : s === 'not_offered' ? 'not offered' : s === 'locked' ? 'locked' : 'ceiling unreadable'}`} className="inline-flex">
                    {s === 'unreadable' ? <StateChip kind="unavailable" label="?" /> : <CellMark state={s === 'offered' ? 'offered' : s === 'not_offered' ? 'off' : 'locked'} />}
                  </span>
                </td>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {agents.map((a, r) => {
            const name = agentName(a);
            const rowSel = selected?.agent === a.uid;
            return (
              <tr key={a.uid} className={`border-t border-axal-hairline dark:border-gray-800 ${rowSel ? 'bg-violet-50 dark:bg-violet-900/20' : ''}`} data-testid="capability-row">
                <th scope="row" className={`sticky left-0 z-10 px-3.5 py-2 text-left font-normal ${rowSel ? 'bg-violet-50 dark:bg-gray-900' : 'bg-white dark:bg-gray-900'}`}>
                  <span className="flex items-center gap-2">
                    <b className="text-[13px] text-axal-ink dark:text-gray-100">{name}</b>
                    {a.status === 'paused' ? <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Paused</span> : null}
                  </span>
                  <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">{roleLabel(a.role_key)}</span>
                  <LastRefusal r={refusals[a.uid]} />
                </th>
                {cols.map((c, ci) => {
                  if (c.kind === 'domain') {
                    const n = domainCount(a, c.group);
                    if (noneRecorded) return <td key={`d-${c.group.domain}`} className={`px-1 text-center ${sep(c)}`}><span role="img" aria-label={`${name}, ${c.group.domain}: nothing granted`} className="inline-grid h-[36px] w-[36px] place-items-center"><CellMark state="not_granted" /></span></td>;
                    return <td key={`d-${c.group.domain}`} className={`px-1 text-center ${sep(c)}`}><span className="font-mono text-[12px] font-bold text-axal-ink dark:text-gray-200" aria-label={`${name}, ${c.group.domain}: ${n.granted} of ${n.of} granted`}>{n.text}</span></td>;
                  }
                  const st = cellState(a, c.entry, policy);
                  const label = cellLabel(name, c.entry.name, st);
                  const isSel = rowSel && selected?.name === c.entry.name;
                  return (
                    <td key={c.entry.name} className={`px-1 py-1 text-center ${sep(c)}`}>
                      {st === 'granted' || st === 'not_granted' ? (
                        <button
                          type="button" data-cell="" data-r={r} data-c={ci} aria-label={label} title={label} data-state={st}
                          onClick={(e) => onOpen({ agent: a.uid, name: c.entry.name }, e.currentTarget)}
                          className={`inline-grid h-[36px] w-[36px] place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 ${isSel ? 'outline outline-2 outline-offset-2 outline-violet-600 dark:outline-violet-400' : ''}`}
                        >
                          <CellMark state={st} />
                        </button>
                      ) : (
                        <span role="img" aria-label={label} title={label} data-state={st} className="inline-grid h-[36px] w-[36px] place-items-center"><CellMark state={st} /></span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── phone (SA13) ────────────────────────────────────────────────────────────

export function PhoneCard({ agent, refusal, onOpen }) {
  const granted = (agent.cells ?? []).filter((c) => c.granted).map((c) => c.capability);
  return (
    <button type="button" onClick={(e) => onOpen({ agent: agent.uid }, e.currentTarget)} className="flex min-h-[64px] w-full flex-col gap-2 border-t border-axal-hairline px-1 py-3 text-left first:border-t-0 dark:border-gray-800" data-testid="capability-card">
      <span className="flex w-full items-center gap-2">
        <b className="truncate text-[14.5px] text-axal-ink dark:text-gray-100">{agentName(agent)}</b>
        {agent.status === 'paused' ? <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Paused</span> : null}
        <span aria-hidden="true" className="ml-auto text-axal-muted dark:text-gray-400">›</span>
      </span>
      <span className={MUTED}>{roleLabel(agent.role_key)} · {granted.length} granted</span>
      {granted.length ? (
        <span className="flex flex-wrap gap-1.5">
          {granted.map((g) => <span key={g} className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[11.5px] text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">{CHECK}{g}</span>)}
        </span>
      ) : null}
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">
        {!refusal ? 'Last refusal: reading…' : refusal.state === 'none' ? 'Last refusal: None' : refusal.state === 'unreadable' ? 'Last refusal could not be read' : `Last refusal ${refusal.code ?? 'code not recorded'} · ${utcStamp(refusal.at) ?? 'time not recorded'}`}
      </span>
    </button>
  );
}

// ─── the panel (SA11, SA11B, SA11C, SA12E; a bottom sheet on a phone, SA13B) ─

function Row({ k, children }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800">
      <dt className="text-[12.5px] text-axal-muted dark:text-gray-400">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-[12.5px] text-axal-ink dark:text-gray-200">{children}</dd>
    </div>
  );
}

function Note({ tone = 'info', children, ...rest }) {
  const cls = tone === 'neg'
    ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200'
    : 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-100';
  return <div className={`rounded-lg border px-3 py-2.5 text-[12.5px] leading-[1.5] ${cls}`} {...rest}>{children}</div>;
}

/** SA11C / SA12E: a refused write in the Worker's own words (its code and sentence), or a write that got no answer. */
export function PanelFailure({ failure, kind, action }) {
  if (!failure) return null;
  return (
    <Note tone="neg" role="alert" data-testid="capability-failure">
      {failure.answered
        ? <><b>The Worker refused this {kind}.</b> {failure.code ? <Code>{failure.code}</Code> : null} {failure.message ?? ''} Your reason is kept.</>
        : <><b>Could not save.</b> No answer came back from the Worker; your reason is kept. Press {action} to try again.</>}
    </Note>
  );
}

/** What the panel is about: a cell (grant, revoke or locked), an agent's list on a phone, or the header's picker. */
function panelKind(data, target) {
  if (!target?.agent) return 'pick';
  if (!target.name) return 'list';
  const entry = data.catalogue.find((e) => e.name === target.name);
  if (!entry || isLocked(entry)) return 'locked';
  const agent = data.agents.find((a) => a.uid === target.agent);
  return holds(agent, target.name) ? 'revoke' : 'grant';
}

export function CapabilityPanel({ data, target, refusals = {}, onTarget, onClose, onSaved }) {
  const phone = usePhoneWidth();
  const [reason, setReason] = useState('');
  const [toRole, setToRole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const kind = panelKind(data, target);
  const agent = data.agents.find((a) => a.uid === target?.agent) ?? null;
  const entry = data.catalogue.find((e) => e.name === target?.name) ?? null;
  const policy = data.policy ?? null;
  const enforced = policy ? policy.enforced : null;
  const cell = agent && entry ? cellOf(agent, entry.name) : null;
  const mates = agent && entry ? roleMates(data.agents, agent, entry.name) : { toGrant: [], already: [] };
  const offered = entry ? ceilingState(entry, policy) : null;

  useEffect(() => { setFailure(null); setToRole(false); }, [target?.agent, target?.name]);

  const save = async () => {
    if (!agent || !entry || !reasonOk(reason)) return;
    setBusy(true); setFailure(null);
    try {
      const text = reason.trim();
      let latest = kind === 'grant'
        ? await aiAgentsPolicyApi.grantCapabilities(agent.uid, [entry.name], text)
        : await aiAgentsPolicyApi.revokeCapability(agent.uid, entry.name, text);
      const lines = [];
      if (kind === 'grant' && toRole) {
        // Q1 = A: one grant per agent of the role, each done or refused on its own, in the Worker's words.
        for (const m of mates.toGrant) {
          try {
            latest = await aiAgentsPolicyApi.grantCapabilities(m.uid, [entry.name], text);
            lines.push(`${agentName(m)}: granted.`);
          } catch (e) {
            const w = workerRefusal(e);
            lines.push(`${agentName(m)}: ${w.answered ? `refused (${w.code ?? 'no code'}). ${w.message ?? ''}`.trim() : 'no answer from the Worker; not known to be granted.'}`);
          }
        }
      }
      onSaved(latest, `${kind === 'grant' ? 'Granted' : 'Revoked'} ${entry.name} ${kind === 'grant' ? 'to' : 'from'} ${agentName(agent)}. It applies from the agent’s next run.${lines.length ? ` Rest of the role: ${lines.join(' ')}` : ''}`);
    } catch (e) {
      setFailure(workerRefusal(e));
    } finally {
      setBusy(false);
    }
  };

  const action = kind === 'grant' ? `Grant ${entry?.name ?? ''}` : `Revoke ${entry?.name ?? ''}`;
  let title = 'Grant a capability';
  if (kind === 'list') title = agent ? agentName(agent) : 'Agent';
  if (kind === 'locked' || kind === 'grant' || kind === 'revoke') title = kind === 'locked' ? entry?.name ?? 'Locked' : action;

  const head = agent ? (
    <div className="flex items-center gap-3 border-b border-axal-hairline pb-3 dark:border-gray-800">
      <div className="min-w-0">
        <p className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">{agentName(agent)}</p>
        <p className={`m-0 ${MUTED}`}>{roleLabel(agent.role_key)} · {statusWord(agent.status)}</p>
      </div>
    </div>
  ) : null;

  let body;
  let footer = null;
  if (kind === 'pick') {
    const grantable = orderCatalogue(data.catalogue);
    body = (
      <div className="space-y-3 px-5 py-4" data-testid="capability-pick">
        <label className="block space-y-1"><span className={EYEBROW}>Agent</span>
          <select className={`${SELECT} w-full`} value="" onChange={(e) => e.target.value && onTarget({ agent: e.target.value, name: null })} aria-label="Agent">
            <option value="">Choose an agent</option>
            {data.agents.map((a) => <option key={a.uid} value={a.uid}>{agentName(a)} · {roleLabel(a.role_key)}</option>)}
          </select>
        </label>
        <p className={MUTED}>Then choose the capability. The five reserved names are listed as locked: {RESERVED.join(', ')}. A person does them; no agent can be granted one.</p>
        <ul className="m-0 list-none p-0 text-[12px] text-axal-ink dark:text-gray-200">{grantable.filter(isLocked).map((e) => <li key={e.name} className="flex items-center gap-2 py-1"><CellMark state="locked" /><Code>{e.name}</Code> Locked: never grantable</li>)}</ul>
      </div>
    );
  } else if (kind === 'list') {
    body = (
      <div className="space-y-3 px-5 py-4" data-testid="capability-agent-list">
        {head}
        {domainsOf(data.catalogue).map((g) => (
          <section key={g.domain} aria-label={g.domain}>
            <p className={EYEBROW}>{g.domain} · {domainCount(agent, g).text}</p>
            <ul className="m-0 list-none p-0">
              {g.entries.map((e) => {
                const st = cellState(agent, e, policy);
                const inner = <><CellMark state={st} /><Code>{e.name}</Code><span className={`ml-auto ${MUTED}`}>{CELL_WORDS[st]}</span></>;
                return (
                  <li key={e.name}>
                    {st !== 'not_offered'
                      ? <button type="button" onClick={() => onTarget({ agent: agent.uid, name: e.name })} aria-label={cellLabel(agentName(agent), e.name, st)} className="flex min-h-[44px] w-full items-center gap-2 border-t border-axal-hairline text-left dark:border-gray-800">{inner}</button>
                      : <span role="img" aria-label={cellLabel(agentName(agent), e.name, st)} className="flex min-h-[44px] w-full items-center gap-2 border-t border-axal-hairline dark:border-gray-800">{inner}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  } else if (kind === 'locked') {
    body = (
      <div className="space-y-3 px-5 py-4" data-testid="capability-locked">
        {head}
        <dl className="m-0">
          <Row k="Capability"><span className="inline-flex items-center gap-1.5"><Code>{entry?.name ?? target.name}</Code>{LOCK}</span></Row>
          <Row k="Now"><b>Locked</b> · no one can grant it</Row>
          <Row k="Why">A person does it. {RESERVED.join(', ')} exist as names and are never grantable to an agent.</Row>
          <Row k="If asked">The Worker refuses with <Code>capability_ungrantable</Code>, whether enforcement is on or off.</Row>
        </dl>
      </div>
    );
    footer = <div className="flex justify-end"><button type="button" className={BTN} onClick={onClose}>Close</button></div>;
  } else {
    const now = nowLine(cell);
    const last = lastChangeLine(cell);
    const r = refusals[agent.uid];
    const n = reasonLength(reason);
    const blockedByCeiling = kind === 'grant' && offered === 'not_offered';
    body = (
      <div className="space-y-3 px-5 py-4" data-testid={`capability-${kind}`}>
        {head}
        <dl className="m-0">
          <Row k="Capability"><Code>{entry.name}</Code> <span className={MUTED}>{entry.domain} · {entry.action}</span></Row>
          <Row k="What it allows">{entry.sentence || 'Not recorded'}</Row>
          <Row k="Platform offers">{offered === 'offered' ? <span className="inline-flex items-center gap-1.5"><CellMark state="offered" /> Offered, as set now</span> : offered === 'not_offered' ? <span className="inline-flex items-center gap-1.5"><CellMark state="off" /> Not offered: the ceiling leaves it out</span> : <StateChip kind="unavailable" label="Could not be read" />}</Row>
          <Row k="Now">{now.granted ? <><b className="text-emerald-700 dark:text-emerald-300">Granted</b> · {now.text.replace(/^Granted /, '')}{now.reason ? <span className="block text-axal-muted dark:text-gray-400">“{now.reason}”</span> : null}</> : <b>Not granted</b>}</Row>
          <Row k="Last change">{last.recorded ? <>{last.text}{last.reason ? <span className="block text-axal-muted dark:text-gray-400">“{last.reason}”</span> : null}{last.before ? <span className="block text-axal-muted dark:text-gray-400">{last.before}</span> : null}</> : <StateChip kind="not_recorded" label="Not recorded" title={last.text} />}</Row>
          <Row k="Last used"><StateChip kind="not_recorded" /> <span className={MUTED}>The platform does not record each capability’s last use yet.</span></Row>
          <Row k="Last refusal">{!r ? 'Reading…' : r.state === 'none' ? 'None · no refused run for this agent' : r.state === 'unreadable' ? <StateChip kind="unavailable" /> : <><Code>{r.code ?? 'code not recorded'}</Code> <span className={MUTED}>{utcStamp(r.at) ?? 'time not recorded'}</span> <Link to={runHref(r.uid)} className={`${LINK} text-[12.5px]`}>Open run ›</Link></>}</Row>
        </dl>
        {kind === 'grant' && (mates.toGrant.length || mates.already.length) ? (
          <label className="flex min-h-[44px] items-start gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={toRole} onChange={(e) => setToRole(e.target.checked)} disabled={!mates.toGrant.length} data-testid="capability-apply-role" />
            <span>
              Apply to the {roleLabel(agent.role_key)} role: {[agent, ...mates.toGrant].map(agentName).join(', ')}
              {mates.already.length ? ` (${mates.already.map(agentName).join(', ')} already ${mates.already.length === 1 ? 'has' : 'have'} it)` : ''}
              <span className={`block ${MUTED}`}>One grant per agent, each with this reason. Owner question 1, option A: per agent, with apply to role.</span>
            </span>
          </label>
        ) : null}
        <label className="block space-y-1">
          <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">Reason <span className="font-normal text-axal-muted dark:text-gray-400">· required</span></span>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX + 20))} rows={3} maxLength={REASON_MAX + 20}
            placeholder="Why are you making this change?" aria-describedby="capability-reason-hint" data-testid="capability-reason"
            className="block w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <span id="capability-reason-hint" className="flex justify-between gap-2 text-[11.5px] text-axal-muted dark:text-gray-400">
            <span>{REASON_MIN} to {REASON_MAX} characters. Logged in Audit with your name and the time.</span>
            <span className={`font-mono ${n > REASON_MAX ? 'text-red-700 dark:text-red-300' : ''}`} data-testid="capability-reason-count">{n} / {REASON_MAX}</span>
          </span>
        </label>
        <PanelFailure failure={failure} kind={kind} action={action} />
        {blockedByCeiling ? <Note tone="neg" data-testid="capability-not-offered">The platform does not offer {entry.name} to agents now, so a grant would be refused with <Code>capability_not_offered</Code>. The ceiling is changed on its own, not here.</Note> : null}
        <Note data-testid="capability-effect">{effectLine(enforced)} <span className={MUTED}>Owner question 2, option A.</span></Note>
        {kind === 'revoke' ? <Note data-testid="capability-review"><b>Review.</b> {revokeReview(agent, entry.name, enforced)}</Note> : null}
      </div>
    );
    footer = (
      <div className={`flex gap-2 ${phone ? 'flex-col-reverse' : 'justify-end'}`}>
        {phone ? <button type="button" className={BTN} onClick={() => onTarget({ agent: agent.uid, name: null })}>Back to {agentName(agent)}</button> : <button type="button" className={BTN} onClick={onClose} disabled={busy}>Cancel</button>}
        <button
          type="button" onClick={save} disabled={busy || !reasonOk(reason) || blockedByCeiling} data-testid="capability-save"
          className={kind === 'revoke' ? DANGER : PRIMARY}
        >
          {busy ? (kind === 'grant' ? 'Granting…' : 'Revoking…') : action}
        </button>
      </div>
    );
  }

  return (
    <Sheet title={title} eyebrow="Policies › Capabilities" onClose={onClose} footer={footer} width={480} phone="sheet" testId="capability-panel" focusKey={`${target?.agent ?? ''}:${target?.name ?? ''}`}>
      {body}
    </Sheet>
  );
}

// ─── the page ────────────────────────────────────────────────────────────────

function Filters({ filters, roles, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value.slice(0, 80) })} placeholder="Search agents" aria-label="Search agents" className="h-11 min-w-[180px] flex-1 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:h-9 sm:max-w-[240px]" />
      <select value={filters.role} onChange={(e) => onChange({ ...filters, role: e.target.value })} aria-label="Role" className={SELECT}>
        <option value="">Role: all</option>
        {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })} aria-label="Status" className={SELECT}>
        <option value="">Status: Active, Paused</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
      </select>
    </div>
  );
}

export function MatrixView({ data, refusals = {}, onSaved, initialTarget = null }) {
  const { search } = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);
  const [target, setTarget] = useState(initialTarget);
  const [done, setDone] = useState('');
  const filters = filtersFrom(search, data.agents);
  const shown = filterAgents(data.agents, filters);
  const roles = useMemo(() => roleChoices(data.agents), [data.agents]);
  const domains = domainsOf(data.catalogue).map((g) => g.domain);
  const open = (t) => { setDone(''); setTarget(t); };
  const toggle = (d) => setExpanded((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  return (
    <div className="space-y-4" data-testid="ai-agents-capabilities">
      <Card className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <p className={`m-0 max-w-[720px] ${MUTED}`}>What each agent may do, capability by capability. Every grant or revoke takes a reason and lands in Audit. A revoke applies from the agent’s next run.</p>
          <button type="button" className={`${PRIMARY} ml-auto ${phone ? 'w-full' : ''}`} onClick={(e) => open({}, e.currentTarget)} disabled={!data.agents.length} data-testid="capability-grant-open">+ Grant a capability…</button>
        </div>
        <Filters filters={filters} roles={roles} onChange={(f) => navigate({ search: filtersSearch(f) }, { replace: true })} />
        <SummaryLine data={data} />
        {phone ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <Legend />
            <span className="ml-auto flex gap-3">
              <button type="button" className={`${LINK} min-h-[32px] text-[12.5px]`} onClick={() => setExpanded(domains)}>Expand all</button>
              <button type="button" className={`${LINK} min-h-[32px] text-[12.5px]`} onClick={() => setExpanded([])}>Collapse all</button>
            </span>
          </div>
        )}
        {done ? <p role="status" className="m-0 text-[12.5px] text-emerald-800 dark:text-emerald-300" data-testid="capability-done">{done}</p> : null}
      </Card>
      {!data.agents.length ? (
        <DataState state="none" size="block" data-testid="capability-no-agents">No live or paused agent is deployed, so there is no one to grant a capability to.</DataState>
      ) : !shown.length ? (
        <DataState state="none" size="block">No agent matches these filters.</DataState>
      ) : phone ? (
        <Card className="px-3 py-1" data-testid="capability-cards">{shown.map((a) => <PhoneCard key={a.uid} agent={a} refusal={refusals[a.uid]} onOpen={open} />)}</Card>
      ) : (
        <Matrix data={data} agents={shown} expanded={expanded} onToggle={toggle} onOpen={open} refusals={refusals} selected={target} />
      )}
      <p className="text-[12px] text-axal-muted dark:text-gray-400">
        Eadwyn proposes revoking a grant unused for 30 days once the platform records each capability’s last use; it does not yet, so no proposal is drawn. Eadwyn can never grant, revoke or change the ceiling.
      </p>
      {target ? (
        <CapabilityPanel
          data={data} target={target} refusals={refusals}
          onTarget={setTarget}
          onClose={() => setTarget(null)}
          onSaved={(latest, line) => { onSaved(latest); setTarget(null); setDone(line); }}
        />
      ) : null}
    </div>
  );
}

export default function CapabilityMatrix() {
  const [state, load, replace] = useCapabilities();
  const uids = state.status === 'recorded' ? state.data.agents.map((a) => a.uid) : [];
  const refusals = useLastRefusals(uids);
  let inner;
  if (state.status === 'loading') inner = <MatrixLoading />;
  else if (state.status === 'refused') inner = <MatrixRefused />;
  else if (state.status === 'unreadable') inner = <MatrixUnreadable onRetry={load} />;
  else inner = <MatrixView data={state.data} refusals={refusals} onSaved={replace} />;
  return <div className="space-y-4"><PolicySwitch />{inner}</div>;
}
