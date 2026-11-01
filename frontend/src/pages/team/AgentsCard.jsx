import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Skeleton, Unrecorded } from '../../ui';
import { AgentIdentity, AgentTile } from './AgentMark.jsx';
import { BTN_PRIMARY, BTN_TEXT, HeadRow, HonestBlock, MONO, MUTED, PendingOwner, TeamCard } from './teamUi.jsx';
import { AGENTS_FOOT, agentGroups, agentsFootLine, refusalWords } from './teamModel.js';

/**
 * D1497 (#3727, TM1a/TM1b agents card, TM1c, TM1e, TM9b1, TM9c1, TM9c4) —
 * the AI agents card, drawn only from what `agentsAdapter.listAgents` answers.
 *
 *   loading                       three skeleton rows, "Reading…" (TM1d)
 *   { available: false, reason }  the honest block: why, and that it is not
 *                                 the same as having none (this base)
 *   { locked: 'plan' }            "AI agents come with a paid Founder plan." (TM9c4)
 *   `planLocked`                  the same line under the table or the empty
 *                                 state, for an editor whose list says
 *                                 `plan_ok: false` (#3840), with no Add button
 *   { unreadable: true }          "could not be read" with Try again (TM9c1)
 *   { available: true, [] }       TM1c's empty state, the only "No agent works here yet."
 *   { available: true, agents }   the table; a company editor's read with
 *                                 `include=projects` groups each project's
 *                                 agents under its name, with the scope filter (TM1e)
 *
 * Every agent is drawn with its tile and the "AI agent" pill; spend and last
 * activity the Worker did not answer read "Not recorded", never "$0". A paused
 * pill is amber with brown text, never red, with its reason and its one fix.
 *
 * Below `md` a row keeps what the canvas's phone row keeps (TM9d1): the name
 * and pill, then one line with the role and this month's spend (or that it is
 * not recorded) and the status pill.
 */

/** TM9c4: the plan lock, from a 403 `plan_required` or the list's `plan_ok: false` (#3840). */
function PlanLine({ reason = refusalWords('plan_required') }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-axal-md border border-axal-hairline px-4 py-3 text-left dark:border-gray-700" data-testid="team-agents-plan">
      <AgentTile size={28} />
      <span className="text-[13px] text-axal-ink dark:text-gray-100">{reason}</span>
      <PendingOwner />
      <Link to="/pricing" className={`ml-auto ${BTN_TEXT}`}>See plans</Link>
    </div>
  );
}

function StatusPill({ row }) {
  return row.pause
    ? <span className="inline-flex items-center rounded-axal-pill bg-axal-amber px-2 py-0.5 text-[11px] font-semibold text-axal-amber-deep" data-testid="agent-paused">Paused</span>
    : <Pill tone="ok">Active</Pill>;
}

const GRID = 'md:grid-cols-[minmax(0,1.75fr)_minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1.3fr)_150px_108px_40px]';
const COLS = ['Agent', 'Source', 'Sponsor', 'Status', 'This month', 'Last activity'];

function AgentRow({ row, onOpen }) {
  return (
    <div role="row" tabIndex={0} onClick={() => onOpen?.(row)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(row); }}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-3 border-b border-axal-hairline py-2.5 last:border-b-0 hover:bg-axal-ground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50 dark:border-gray-800 dark:hover:bg-gray-800/50`}
      data-testid={`agent-${row.uid}`}>
      <span role="cell" className="min-w-0">
        <AgentIdentity name={row.name} role={row.role} roleClassName="hidden md:block" />
        <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-[42px] md:hidden" data-testid="agent-phone-line">
          <span className="text-[12px] text-axal-ink dark:text-gray-200">{row.role || <Unrecorded />} · {row.spend ? <span className="font-mono">{row.spend}</span> : <>this month <Unrecorded /></>}</span>
          <StatusPill row={row} />
        </span>
      </span>
      <span role="cell" className="hidden min-w-0 md:block">
        <span className="block truncate text-[13px] text-axal-ink dark:text-gray-200">Platform model · {row.model || <Unrecorded />}</span>
        {row.tools ? <span className={`block truncate ${MUTED}`}>{row.tools}</span> : null}
      </span>
      <span role="cell" className="hidden truncate text-[13px] text-axal-ink md:block dark:text-gray-200">{row.sponsor || <Unrecorded />}</span>
      <span role="cell" className="hidden min-w-0 md:block">
        {row.pause ? (
          <>
            <StatusPill row={row} />
            <span className={`block ${MUTED}`}>{row.pause.reason}</span>
            {row.pause.fix ? <button type="button" className={BTN_TEXT} onClick={(e) => { e.stopPropagation(); onOpen?.(row); }}>{row.pause.fix}</button> : null}
          </>
        ) : <Pill tone="ok">Active</Pill>}
      </span>
      <span role="cell" className="hidden font-mono text-[12.5px] text-axal-ink md:block dark:text-gray-200">{row.spend || <Unrecorded />}</span>
      <span role="cell" className="hidden font-mono text-[12.5px] text-axal-ink md:block dark:text-gray-200">{row.last || <Unrecorded />}</span>
      <span role="cell" className="flex justify-end">
        <button type="button" aria-label={`Actions for the ${row.roleOrUnrecorded} agent`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); onOpen?.(row); }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800">⋯</button>
      </span>
    </div>
  );
}

function AgentTable({ rows, onOpen, label }) {
  return (
    <div role="table" aria-label={label}>
      <HeadRow grid={GRID} cols={COLS} />
      {rows.map((r) => <AgentRow key={r.key} row={r} onOpen={onOpen} />)}
    </div>
  );
}

export default function AgentsCard({ block, loading, kind, companyName, canAdd, planLocked = false, onAdd, onOpen, onRetry, now = new Date() }) {
  // The grouped footer's company reach is said only once it is live (#3697 part 2), as the page's managed note is.
  const [hidden, setHidden] = useState(() => new Set());
  if (loading) {
    return (
      <TeamCard title="AI agents" testId="team-agents">
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className={`self-end ${MUTED}`}>Reading…</span>
          {[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}
        </div>
      </TeamCard>
    );
  }
  if (!block || block.available !== true) {
    return (
      <TeamCard title="AI agents" testId="team-agents">
        {block?.locked === 'plan' ? <PlanLine reason={block.reason} /> : block?.unreadable ? (
          <HonestBlock role="alert" testId="team-agents-unreadable" action={onRetry ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={onRetry}>Try again</button> : null}>
            AI agents could not be read. That is not the same as having none.
          </HonestBlock>
        ) : (
          <HonestBlock testId="team-agents-unavailable">
            {block?.reason || 'AI agents could not be read.'} That is not the same as having none.
          </HonestBlock>
        )}
      </TeamCard>
    );
  }
  const agents = Array.isArray(block.value?.agents) ? block.value.agents : [];
  if (!agents.length) {
    return (
      <TeamCard title="AI agents" testId="team-agents">
        <div className="flex flex-col items-center gap-3 rounded-axal-md border border-dashed border-axal-hairline px-6 py-8 text-center dark:border-gray-700" data-testid="team-agents-empty">
          <AgentTile size={40} />
          <p className={`m-0 max-w-md ${MUTED}`}>No agent works here yet. Add one in a role, like a CFO who drafts your runway note. It will only propose; you decide.</p>
          {canAdd ? <button type="button" className={BTN_PRIMARY} onClick={onAdd} data-testid="team-agents-add">Add an AI agent</button> : null}
          {planLocked ? <PlanLine /> : null}
        </div>
      </TeamCard>
    );
  }
  const groups = agentGroups(agents, companyName, now).filter((g) => g.rows.length || g.key === 'company');
  const grouped = kind === 'company' && groups.length > 1;
  const toggle = (k) => setHidden((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <TeamCard title="AI agents" count={agents.length} testId="team-agents">
      {grouped ? (
        <>
          <div role="group" aria-label="Scope" className="mb-3 flex flex-wrap gap-1.5" data-testid="team-agents-scope">
            {groups.map((g) => (
              <button key={g.key} type="button" aria-pressed={!hidden.has(g.key)} onClick={() => toggle(g.key)}
                className={`rounded-axal-pill border px-3 py-1 text-[12px] font-semibold ${hidden.has(g.key) ? 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400' : 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>{g.label}</button>
            ))}
          </div>
          {groups.filter((g) => !hidden.has(g.key)).map((g) => (
            <div key={g.key} className="mb-4" data-testid={`team-agents-group-${g.key}`}>
              <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">{g.title}</p>
              <p className={`m-0 mb-1 ${MONO}`}>{g.line}</p>
              <AgentTable rows={g.rows} onOpen={onOpen} label={g.title} />
            </div>
          ))}
          <p className={`m-0 ${MUTED}`}>{agentsFootLine(companyName)}</p>
        </>
      ) : (
        <>
          <AgentTable rows={groups.flatMap((g) => g.rows)} onOpen={onOpen} label="AI agents" />
          {agents.some((a) => a.status === 'paused') ? <p className={`m-0 mt-3 ${MUTED}`}>A paused agent keeps its history and its open proposals.</p> : null}
          <p className={`m-0 mt-3 ${MUTED}`}>{AGENTS_FOOT}</p>
        </>
      )}
      {planLocked ? <div className="mt-3"><PlanLine /></div> : null}
    </TeamCard>
  );
}
