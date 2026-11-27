import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, Unrecorded } from '../../ui';
import { AgentArchetypeBadge, AgentAvatar } from './AgentCard.jsx';
import { AgentTile } from './AgentMark.jsx';
import SkillsLink from './SkillsLink.jsx';
import ActionMenu from '../admin/productTesting/ActionMenu.jsx';
import { actionItems, addSkillsLabel, agentReadiness, engineNote, moreActionsLabel, rowOpenLabel, whatItDoes } from './agentChoiceModel.js';
import { BTN_PRIMARY, BTN_TEXT, HeadRow, HonestBlock, MONO, MUTED, TeamCard } from './teamUi.jsx';
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
 * The row shows the agent portrait and Studio archetype; spend and last
 * activity the Worker did not answer read "Not recorded", never "$0". A paused
 * pill is amber with brown text, never red, with its reason and its one fix;
 * D4387: the fix opens the profile on its dialog (`onOpen(row, action)`:
 * Choose a new sponsor, or Edit cap).
 *
 * Below `md` a row keeps what the canvas's phone row keeps (TM9d1): the name
 * and archetype, then one line with the role and this month's spend (or that it is
 * not recorded) and the status pill.
 *
 * #4363: the header carries a Skills link to this scope's Skills tab
 * (`SkillsLink`), in every state, since the library is its own read.
 *
 * D8769 (#8769, TMM01, TMM07, TMM11): the columns lead with what the agent
 * does (its area of work and model) and whether it can run now, then the
 * sponsor and this month. "Can it run now" is one pill per row from
 * `agentReadiness`: the agent's own pause, no skills (the Worker's
 * `skill_count`), a count not read, then Active. The team's engine
 * (`engine`, read by the page from `agentEngineApi.engine`) is one line above
 * the table (`engineNote`), never a row's pill: a person's own run does not
 * need the engine. The
 * name is a button named "{name}, AI agent, {work}: open profile"; ⋯ is
 * "More actions for {name}" and opens a real menu (`ActionMenu`): the
 * profile, and for a manager a paused row's one fix. Neither is named by the
 * persona's motto.
 *
 * D8769 part 3 (TMM07 A and B): a manager's menu is the canvas's whole list
 * (`actionItems`: Add skills, Edit cap, Change sponsor, Pause or Resume, each
 * opening the profile on that action), and a no-skills row carries its one
 * fix, "Add skills for {name}", which opens the profile on Add skills.
 */

/** TM9c4: the plan lock, from a 403 `plan_required` or the list's `plan_ok: false` (#3840). */
function PlanLine({ reason = refusalWords('plan_required') }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-axal-md border border-axal-hairline px-4 py-3 text-left dark:border-gray-700" data-testid="team-agents-plan">
      <AgentTile size={28} />
      <span className="text-[13px] text-axal-ink dark:text-gray-100">{reason}</span>

      <Link to="/pricing" className={`ml-auto ${BTN_TEXT}`}>See plans</Link>
    </div>
  );
}

const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
  amber: 'border-transparent bg-axal-amber text-axal-amber-deep',
  muted: 'border-dotted border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400',
};

/** TMM07: one pill per row, from `agentReadiness`. A paused agent stays amber with brown text, never red. */
function StatusPill({ ready }) {
  return (
    <span className={`inline-flex items-center rounded-axal-pill border px-2 py-0.5 text-[11px] font-semibold ${TONE[ready.tone] || TONE.muted}`}
      data-testid={ready.key === 'paused' ? 'agent-paused' : 'agent-ready'}>{ready.pill}</span>
  );
}

const GRID = 'md:grid-cols-[minmax(0,1.75fr)_minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1fr)_150px_40px]';
const COLS = ['Agent', 'What it does', 'Can it run now', 'Sponsor', 'This month'];

function AgentRow({ row, agent, canManage, onOpen }) {
  const ready = agentReadiness(agent);
  const pick = (key) => {
    const it = actionItems(row, canManage).find((x) => x.key === key);
    if (it) onOpen?.(row, it.action || null);
  };
  return (
    <div role="row" onClick={() => onOpen?.(row)}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-3 border-b border-axal-hairline py-2.5 last:border-b-0 hover:bg-axal-ground/60 dark:border-gray-800 dark:hover:bg-gray-800/50`}
      data-testid={`agent-${row.uid}`}>
      <span role="cell" className="min-w-0">
        <span className="flex min-w-0 items-center gap-2.5">
          <AgentAvatar persona={{ ...row.persona, name: row.name }} size={32} />
          <span className="min-w-0">
            <button type="button" aria-label={rowOpenLabel(row.name, agent)} onClick={(e) => { e.stopPropagation(); onOpen?.(row); }}
              className="block max-w-full truncate rounded text-left text-[13.5px] font-extrabold text-axal-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50 dark:text-gray-100"
              data-testid={`agent-open-${row.uid}`}>{row.name}</button>
            <AgentArchetypeBadge persona={row.persona} />
            {row.role ? <span className="hidden md:block truncate text-[12px] text-axal-muted dark:text-gray-400">{row.role}</span> : null}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-[42px] md:hidden" data-testid="agent-phone-line">
          <span className="text-[12px] text-axal-ink dark:text-gray-200">{whatItDoes(agent)} · {row.spend ? <span className="font-mono">{row.spend}</span> : <>this month <Unrecorded /></>}</span>
          <StatusPill ready={ready} />
        </span>
      </span>
      <span role="cell" className="hidden min-w-0 md:block" data-testid={`agent-does-${row.uid}`}>
        <span className="block truncate text-[13px] text-axal-ink dark:text-gray-200">{whatItDoes(agent)}</span>
        <span className={`block truncate ${MUTED}`}>{row.outside ? 'Runs on its own assistant' : <>Platform model · {row.model || <Unrecorded />}</>}</span>
        {row.tools ? <span className={`block truncate ${MUTED}`}>{row.tools}</span> : null}
      </span>
      <span role="cell" className="hidden min-w-0 md:block" data-testid={`agent-can-run-${row.uid}`} data-state={ready.key}>
        <StatusPill ready={ready} />
        <span className={`block ${MUTED}`}>{ready.key === 'paused' && row.pause ? row.pause.reason : ready.line}</span>
        {ready.key === 'paused' && row.pause?.hint ? <span className={`block ${MUTED}`}>{row.pause.hint}</span> : null}
        {ready.key === 'paused' && row.pause?.fix ? <button type="button" className={BTN_TEXT} onClick={(e) => { e.stopPropagation(); onOpen?.(row, row.pause.action || null); }} data-testid={`agent-fix-${row.uid}`}>{row.pause.fix}</button> : null}
        {ready.key === 'no_skills' && canManage ? <button type="button" className={BTN_TEXT} onClick={(e) => { e.stopPropagation(); onOpen?.(row, 'skills'); }} data-testid={`agent-add-skills-${row.uid}`}>{addSkillsLabel(row.name)}</button> : null}
      </span>
      <span role="cell" className="hidden truncate text-[13px] text-axal-ink md:block dark:text-gray-200">{row.sponsor || <Unrecorded />}</span>
      <span role="cell" className="hidden md:block">
        <span className="block font-mono text-[12.5px] text-axal-ink dark:text-gray-200">{row.spend || <Unrecorded />}</span>
        <span className={`block ${MUTED}`}>Last activity {row.last || <Unrecorded />}</span>
      </span>
      <span role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <ActionMenu items={actionItems(row, canManage)} label={moreActionsLabel(row.name)} eyebrow={row.name} onPick={pick} testId={`agent-menu-${row.uid}`}
          buttonClass="border-transparent text-axal-muted dark:text-gray-400" />
      </span>
    </div>
  );
}

function AgentTable({ rows, byUid, canManage, onOpen, label }) {
  return (
    <div role="table" aria-label={label}>
      <HeadRow grid={GRID} cols={COLS} />
      {rows.map((r) => <AgentRow key={r.key} row={r} agent={byUid.get(r.uid)} canManage={canManage} onOpen={onOpen} />)}
    </div>
  );
}

export default function AgentsCard({ block, loading, kind, scope = null, companyName, canAdd, addOff = null, planLocked = false, engine = 'unknown', onAdd, onOpen, onRetry, now = new Date() }) {
  // The grouped footer's company reach is said only once it is live (#3697 part 2), as the page's managed note is.
  const [hidden, setHidden] = useState(() => new Set());
  const aside = <SkillsLink scope={scope} testId="team-agents-skills" />;
  if (loading) {
    return (
      <TeamCard title="AI agents" aside={aside} testId="team-agents">
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className={`self-end ${MUTED}`}>Reading…</span>
          {[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}
        </div>
      </TeamCard>
    );
  }
  if (!block || block.available !== true) {
    return (
      <TeamCard title="AI agents" aside={aside} testId="team-agents">
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
      <TeamCard title="AI agents" aside={aside} testId="team-agents">
        <div className="flex flex-col items-center gap-3 rounded-axal-md border border-dashed border-axal-hairline px-6 py-8 text-center dark:border-gray-700" data-testid="team-agents-empty">
          <AgentTile size={40} />
          <p className={`m-0 max-w-md ${MUTED}`}>No agent works here yet. Add one in a role, like a CFO who drafts your runway note. It will only propose; you decide.</p>
          {canAdd ? <button type="button" className={`${BTN_PRIMARY} disabled:opacity-50`} onClick={onAdd} disabled={!!addOff} title={addOff || undefined} data-testid="team-agents-add">Add an AI agent</button> : null}
          {canAdd && addOff ? <p role="status" className={`m-0 ${MUTED}`} data-testid="team-agents-add-off">{addOff}</p> : null}
          {planLocked ? <PlanLine /> : null}
        </div>
      </TeamCard>
    );
  }
  const groups = agentGroups(agents, companyName, now).filter((g) => g.rows.length || g.key === 'company');
  const byUid = new Map(agents.map((a) => [a.uid, a]));
  const canManage = !!block.value?.can_manage;
  const table = { byUid, canManage, onOpen };
  const note = engineNote(engine);
  const grouped = kind === 'company' && groups.length > 1;
  const toggle = (k) => setHidden((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <TeamCard title="AI agents" count={agents.length} aside={aside} testId="team-agents">
      {note ? <p role="status" className="m-0 mb-3 rounded-axal-md bg-axal-amber px-3 py-2 text-[12.5px] text-axal-amber-deep" data-testid="team-agents-engine" data-engine={engine}>{note}</p> : null}
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
              <AgentTable rows={g.rows} {...table} label={g.title} />
            </div>
          ))}
          <p className={`m-0 ${MUTED}`}>{agentsFootLine(companyName)}</p>
        </>
      ) : (
        <>
          <AgentTable rows={groups.flatMap((g) => g.rows)} {...table} label="AI agents" />
          {agents.some((a) => a.status === 'paused') ? <p className={`m-0 mt-3 ${MUTED}`}>A paused agent keeps its history and its open proposals.</p> : null}
          <p className={`m-0 mt-3 ${MUTED}`}>{AGENTS_FOOT}</p>
        </>
      )}
      {planLocked ? <div className="mt-3"><PlanLine /></div> : null}
    </TeamCard>
  );
}
