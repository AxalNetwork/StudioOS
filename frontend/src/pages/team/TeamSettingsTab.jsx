import React from 'react';
import { Lock } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { AgentIdentity } from './AgentMark.jsx';
import { BTN_TEXT, HeadRow, HonestBlock, MUTED, PendingOwner, TeamCard } from './teamUi.jsx';
import { WHO_PAYS, agentName, money, whoMayAddAgents } from './teamModel.js';

/**
 * D1497 (#3727, TM8a, TM9a5) — the Team's Settings tab.
 *
 * Wired now, because they are rules and not data: who pays (owner Q2 = B,
 * still marked "pending owner" as the canvas marks it) and who may add agents
 * (the owner's authority rule for the scope, with the full list of company
 * editors, which the canvas shortens). Per-agent caps and what each role reads
 * come from the agents read through `agentsAdapter` and are unavailable here.
 * Models and tools allowed per company have no store and no filed route
 * (#3727 part 6 note): the card says so and draws no switch. No company AI
 * budget is drawn.
 *
 * "Edit cap" opens the agent's profile with its cap editor open (#3840's
 * `PATCH /api/teams/agents/:uid`); "Open rule book" opens the Roles tab on
 * that agent's role (TM4b), not the agent.
 */
export default function TeamSettingsTab({ scope, agentsBlock, canManage, onEditCap, onOpenRulebook }) {
  const company = scope.company?.name;
  const list = agentsBlock?.available ? (agentsBlock.value?.agents || []) : null;
  const locked = scope.kind === 'company_project' && !canManage;
  return (
    <div className="flex flex-col gap-4" data-testid="team-settings">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TeamCard title="Who pays" testId="team-settings-pays">
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{WHO_PAYS}</p>
          <div className="mt-2"><PendingOwner /></div>
        </TeamCard>
        <TeamCard title="Who may add agents" testId="team-settings-who">
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="team-settings-who-rule">{whoMayAddAgents(scope.kind, company)}</p>
          <p className={`m-0 mt-1 ${MUTED}`}>This follows each person’s role on the team. It is not set here.</p>
        </TeamCard>
      </div>
      <TeamCard title="Per-agent caps" testId="team-settings-caps">
        {list === null ? <HonestBlock>{agentsBlock?.reason || 'The agents could not be read.'} Caps arrive with them. That is not the same as having none.</HonestBlock>
          : !list.length ? <p className={`m-0 ${MUTED}`}>No agent works here yet.</p> : (
            <div role="table" aria-label="Per-agent caps">
              <HeadRow grid="md:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1.4fr)_minmax(0,1fr)_80px]" cols={['Agent', 'Monthly cap', 'This month', 'Sponsor']} />
              {list.map((a) => (
                <div key={a.uid} role="row" className="grid grid-cols-1 items-center gap-3 border-b border-axal-hairline py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1.4fr)_minmax(0,1fr)_80px] dark:border-gray-800">
                  <span role="cell"><AgentIdentity name={agentName(a)} role={a.role_name} size={28} /></span>
                  <span role="cell" className="font-mono text-[12.5px] text-axal-ink dark:text-gray-200">{money(a.monthly_cap_microusd, { whole: true }) || <Unrecorded />}</span>
                  <span role="cell" className="font-mono text-[12.5px] text-axal-ink dark:text-gray-200">
                    {a.month_spend?.available ? `${money(a.month_spend.value_microusd)}${a.status === 'paused' && a.paused_reason === 'cap' ? ' · paused at its cap' : ''}` : <Unrecorded />}
                  </span>
                  <span role="cell" className="text-[13px] text-axal-ink dark:text-gray-200">{a.sponsor?.name || <Unrecorded />}</span>
                  <span role="cell">{canManage ? <button type="button" className={BTN_TEXT} onClick={() => onEditCap?.(a)} data-testid={`team-settings-edit-cap-${a.uid}`}>Edit cap</button> : null}</span>
                </div>
              ))}
            </div>
          )}
      </TeamCard>
      <TeamCard title="Models and tools allowed" testId="team-settings-models">
        <p className={`m-0 ${MUTED}`}>Agents use the models offered on your plan, and read-only tools their sponsor approved. A list kept per {scope.kind === 'project' ? 'project' : 'company'} is not stored yet, so nothing is switched here.</p>
        {locked ? (
          <p className={`m-0 mt-2 flex items-center gap-1.5 ${MUTED}`} data-testid="team-settings-locked"><Lock size={12} aria-hidden="true" />Only {company}’s editors can change this.</p>
        ) : null}
      </TeamCard>
      <TeamCard title="Data sharing per role" testId="team-settings-sharing">
        {list === null ? <HonestBlock>{agentsBlock?.reason || 'The agents could not be read.'} What each role reads arrives with them.</HonestBlock>
          : !list.length ? <p className={`m-0 ${MUTED}`}>No agent works here yet.</p> : (
            <ul className="m-0 flex list-none flex-col p-0">
              {list.map((a) => (
                <li key={a.uid} className="grid grid-cols-1 items-center gap-2 border-b border-axal-hairline py-2 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto] dark:border-gray-800">
                  <AgentIdentity name={agentName(a)} role={a.role_name} size={24} />
                  <span className="text-[13px] text-axal-ink dark:text-gray-200">{a.reads_line || <Unrecorded />}</span>
                  {a.role_key ? <button type="button" className={BTN_TEXT} onClick={() => onOpenRulebook?.(a)} data-testid={`team-settings-rulebook-${a.uid}`}>Open rule book</button> : null}
                </li>
              ))}
            </ul>
          )}
      </TeamCard>
    </div>
  );
}
