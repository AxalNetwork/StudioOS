import React, { useState } from 'react';
import { Pill, Sheet, Unrecorded } from '../../ui';
import { AgentIdentity, PersonAvatar } from './AgentMark.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { agentName, budgetLine, refusalWords } from './teamModel.js';

/**
 * D1497 (#3727, TM6c, TM6b) — who works on a module page, and "Assign this
 * task to…". Built, NOT MOUNTED: a module header's "Working here" button sits
 * beside Ask, which opens the Ask panel (#3706, #3740), and both reads it
 * needs are not on this base: the agents of a module (#3840's
 * `listAgents(…, { module })`) and what each person and agent is working on
 * (#3742 E1's tasks, #3845). The module headers mount this when those land.
 *
 * "Working on" is the assignment store's answer: `null` is its "nothing
 * assigned here"; a field it never sent is "Not recorded".
 */

function WorkingOn({ value }) {
  if (value === undefined) return <Unrecorded />;
  if (value === null) return <span className={MUTED}>Nothing assigned here</span>;
  return <span className="text-[13px] text-axal-ink dark:text-gray-200">{value.title}{value.due ? <span className={MONO}> · due {value.due}</span> : null}{value.waiting ? <span className={MUTED}> · {value.waiting}</span> : null}</span>;
}

export function WorkingHereSheet({ moduleLabel, people, agentsBlock, onClose, onOpenTeam, onAssign, onProfile }) {
  const list = agentsBlock?.available ? (agentsBlock.value?.agents || []) : null;
  const ppl = Array.isArray(people) ? people : [];
  return (
    <Sheet title="Working here" width={520} onClose={onClose} testId="working-here"
      sub={`${moduleLabel} · ${ppl.length} ${ppl.length === 1 ? 'person' : 'people'}${list ? ` · ${list.length} AI agent${list.length === 1 ? '' : 's'}` : ''}`}
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN_SECONDARY} onClick={onOpenTeam}>Open Team</button><button type="button" className={BTN_PRIMARY} onClick={onAssign} disabled={!onAssign}>Assign a task…</button></div>}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <p className="m-0 font-mono text-[11px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">People · {ppl.length}</p>
        {ppl.map((p) => (
          <article key={p.key} className="flex flex-col gap-1.5 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700">
            <span className="flex items-center gap-2.5"><PersonAvatar initials={p.initials} size={34} /><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{p.name}{p.you ? ' · you' : ''}</b></span>
            <span className={MUTED}>{p.role}{p.title ? ` · ${p.title}` : ''} {p.authority ? <Pill tone="info">{p.authority}</Pill> : null}</span>
            <span className="rounded-md bg-axal-ground px-2 py-1.5 dark:bg-gray-900"><span className={`${MONO} mr-1`}>Working on</span><WorkingOn value={p.working_on} /></span>
          </article>
        ))}
        <p className="m-0 font-mono text-[11px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">AI agents{list ? ` · ${list.length}` : ''}</p>
        {list === null ? <HonestBlock>{agentsBlock?.reason || 'The agents could not be read.'} That is not the same as having none.</HonestBlock> : list.map((a) => (
          <article key={a.uid} className="flex flex-col gap-1.5 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700">
            <span className="flex items-center justify-between gap-2"><AgentIdentity name={agentName(a)} role={a.role_name} size={34} /><button type="button" className={BTN_TEXT} onClick={() => onProfile?.(a)}>Profile</button></span>
            <span className={MUTED}>Platform model · {a.model_label || a.model_id || <Unrecorded />} · sponsored by {a.sponsor?.name || <Unrecorded />}{a.month_spend?.available && budgetLine(a.month_spend.value_microusd, a.monthly_cap_microusd) ? ` · ${budgetLine(a.month_spend.value_microusd, a.monthly_cap_microusd)}` : ''}</span>
            <span className="rounded-md bg-axal-ground px-2 py-1.5 dark:bg-gray-900"><span className={`${MONO} mr-1`}>Working on</span><WorkingOn value={a.working_on} /></span>
          </article>
        ))}
        <p className={`m-0 ${MUTED}`}>Only people on the team, and agents whose rule book includes {moduleLabel}, appear here. Agents propose; people decide.</p>
      </div>
    </Sheet>
  );
}

/** TM6b: pick a person or an agent; an agent outside its modules cannot be picked, and says why. */
export function AssignPopover({ task, people, agentsList, moduleLabel, onPick, onClose }) {
  const [q, setQ] = useState('');
  const match = (s) => String(s || '').toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div role="dialog" aria-label="Assign this task to…" className="w-[360px] rounded-axal-lg border border-axal-hairline bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900" data-testid="assign-popover">
      <p className="m-0 mb-2 text-[14px] font-bold text-axal-ink dark:text-gray-100">Assign this task to…</p>
      {task ? <p className={`m-0 mb-2 ${MUTED}`}>{task}</p> : null}
      <input className={FIELD} placeholder="Search people and agents" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="m-0 mb-1 mt-3 font-mono text-[11px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">People</p>
      <div role="listbox" aria-label="People" className="flex flex-col">
        {(people || []).filter((p) => match(p.name)).map((p) => (
          <button key={p.key} type="button" role="option" aria-selected="false" onClick={() => onPick({ kind: 'person', id: p.userId })} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800">
            <PersonAvatar initials={p.initials} size={26} /><span className="text-[13px] text-axal-ink dark:text-gray-100">{p.name}{p.you ? ' · you' : ''}</span><span className={`ml-auto ${MUTED}`}>{p.role}</span>
          </button>
        ))}
      </div>
      <p className="m-0 mb-1 mt-3 font-mono text-[11px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">AI agents</p>
      <div role="listbox" aria-label="AI agents" className="flex flex-col">
        {(agentsList || []).filter((a) => match(agentName(a))).map((a) => {
          const inModules = Array.isArray(a.works_in) && a.works_in.some((w) => (w.label || w) === moduleLabel);
          return (
            <div key={a.uid} role="option" aria-selected="false" aria-disabled={!inModules || undefined} tabIndex={inModules ? 0 : -1}
              onClick={() => { if (inModules) onPick({ kind: 'agent', uid: a.uid }); }}
              className={`flex flex-col rounded-md px-2 py-1.5 ${inModules ? 'cursor-pointer hover:bg-axal-ground dark:hover:bg-gray-800' : 'opacity-55'}`}>
              <AgentIdentity name={agentName(a)} size={26} />
              <span className={MUTED}>{a.role_name} · {inModules ? `In its modules: ${moduleLabel}` : refusalWords('module_not_allowed')}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end"><button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button></div>
    </div>
  );
}
