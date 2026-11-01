import React, { useCallback, useEffect, useState } from 'react';
import { AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MUTED, TeamCard } from './teamUi.jsx';
import { CATEGORIES, SKILLS_UNREAD, SORTS, libraryGroups, outputWord, tagChip, usedByWords } from './skillsModel.js';
import SkillDetailSheet from './SkillDetailSheet.jsx';
import SkillEditorSheet from './SkillEditorSheet.jsx';

/**
 * D1612 (#3952, part C of #3945) — Team › Skills: the agent roles (SK0), then
 * a role's skill directory (SK1), from `agentsAdapter.skillLibrary` (#3951's
 * `GET /api/teams/skills`). Drawn in Team's current visual language until the
 * SK0–SK9 boards land (#3945).
 *
 * Two groups: "From Axal" and the company's own skills. Each card shows the
 * name, its purpose, the author, its taxonomy chips with levels, its tools,
 * what it proposes and "Used by N agents". Filters: the 8 /studio categories
 * and a search; sort Popular · New · A–Z. "New skill" is only for those who
 * may write (the Worker says so in `can_write` and `can_write_hq`).
 *
 * States: loading; "Skills could not be read · Try again"; switched off;
 * an empty group says so in words, never as a 0.
 */

export function SkillCard({ s, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen?.(s)} className="flex w-full flex-col gap-2 rounded-axal-md border border-axal-hairline bg-white p-3 text-left hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:hover:border-violet-500" data-testid={`skill-card-${s.uid}`}>
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px] text-axal-ink dark:text-gray-100">{s.name}</b>
          <span className={MUTED}>{s.purpose}</span>
        </span>
        {s.version ? <span className="rounded-axal-pill bg-axal-ground px-2 py-0.5 font-mono text-[11px] text-axal-muted dark:bg-gray-800 dark:text-gray-400">v{s.version}</span>
          : <span className="rounded-axal-pill border border-dashed border-axal-hairline px-2 py-0.5 text-[11px] text-axal-muted dark:border-gray-600 dark:text-gray-400">Draft</span>}
        {s.status === 'retired' ? <span className="rounded-axal-pill bg-axal-amber px-2 py-0.5 text-[11px] font-semibold text-axal-amber-deep">Retired</span> : null}
      </span>
      <span className="flex flex-wrap gap-1">
        {(s.tags || []).map((t) => <span key={t.slug} className="rounded-axal-pill bg-axal-lavender px-2 py-0.5 text-[11px] text-axal-ink dark:bg-violet-900/30 dark:text-gray-100">{tagChip(t)}</span>)}
        {(s.tools || []).map((t) => <span key={t} className="rounded-axal-pill bg-axal-ground px-2 py-0.5 font-mono text-[10.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-200">{t}</span>)}
      </span>
      <span className={`flex flex-wrap gap-x-3 ${MUTED}`}>
        <span>By {s.author}</span>
        <span>Proposes {outputWord(s.output_kind).toLowerCase()}</span>
        <span data-testid={`skill-used-${s.uid}`}>{usedByWords(s.used_by)}</span>
      </span>
    </button>
  );
}

function Group({ title, skills, empty, onOpen, testId }) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <h3 className={`m-0 ${EYEBROW}`}>{title}</h3>
      {skills.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{skills.map((s) => <SkillCard key={s.uid} s={s} onOpen={onOpen} />)}</div>
        : <p className={`m-0 ${MUTED}`}>{empty}</p>}
    </div>
  );
}

/** SK0: the roles, each with its skill and agent counts; "All roles" stays available. */
export function RolesGrid({ roles, onPick }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3" data-testid="skills-roles">
      <button type="button" onClick={() => onPick('')} className="flex items-center gap-2 rounded-axal-md border border-axal-hairline p-3 text-left hover:border-axal-violet dark:border-gray-700" data-testid="skills-role-all">
        <b className="text-[13.5px] text-axal-ink dark:text-gray-100">All roles</b>
      </button>
      {(roles || []).map((r) => (
        <button key={r.key} type="button" onClick={() => onPick(r.key)} className="flex flex-col gap-1 rounded-axal-md border border-axal-hairline p-3 text-left hover:border-axal-violet dark:border-gray-700" data-testid={`skills-role-${r.key}`}>
          <span className="flex items-center gap-2"><AgentTile size={24} /><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{r.label}</b></span>
          <span className={MUTED}>{`${r.skills} ${r.skills === 1 ? 'skill' : 'skills'}`}{r.agents != null ? ` · ${r.agents} ${r.agents === 1 ? 'agent' : 'agents'}` : ''}</span>
        </button>
      ))}
    </div>
  );
}

export default function SkillsTab({ scope, teamAgents }) {
  const company = scope.kind === 'company' ? scope.company : null;
  const [role, setRole] = useState(null);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');
  const [block, setBlock] = useState(null);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    setBlock(null);
    agents.skillLibrary({ company: company?.uid, role: role || undefined, category: category || undefined, q: q.trim() || undefined, sort }).then(setBlock);
  }, [company?.uid, role, category, q, sort]);
  useEffect(() => { load(); }, [load]);

  if (!block) return <TeamCard title="Skills" testId="skills-tab"><p className={`m-0 ${MUTED}`}>Reading…</p></TeamCard>;
  if (!block.available) {
    return (
      <TeamCard title="Skills" testId="skills-tab">
        <HonestBlock testId="skills-unavailable" action={block.unreadable ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={load} data-testid="skills-retry">Try again</button> : null}>
          {block.unreadable ? `${SKILLS_UNREAD}.` : block.reason}{block.refused ? '' : ' That is not the same as having none.'}
        </HonestBlock>
      </TeamCard>
    );
  }
  const g = libraryGroups(block.value);
  const roleLabel = role ? (block.value.roles || []).find((r) => r.key === role)?.label : null;
  const canNew = g.canWriteHq || g.company?.canWrite;
  return (
    <TeamCard title={role === null ? 'Skills' : (roleLabel ? `Skills · ${roleLabel}` : 'Skills · All roles')} testId="skills-tab"
      aside={canNew ? <button type="button" className={BTN_PRIMARY} onClick={() => setEditing({ role })} data-testid="skills-new">New skill</button> : null}>
      {role === null ? (
        <>
          <p className={`m-0 mb-3 ${MUTED}`}>Each skill belongs to agent roles. An agent is only given skills of its own role.</p>
          <RolesGrid roles={block.value.roles} onPick={setRole} />
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => setRole(null)} data-testid="skills-back">‹ All roles</button>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Category" className="flex flex-wrap gap-1">
              {CATEGORIES.map(([k, label]) => (
                <button key={k || 'all'} type="button" aria-pressed={category === k} onClick={() => setCategory(k)}
                  className={`rounded-axal-pill px-2.5 py-1 text-[12px] ${category === k ? 'bg-axal-violet text-white dark:bg-violet-500' : 'bg-axal-ground text-axal-ink dark:bg-gray-800 dark:text-gray-200'}`} data-testid={`skills-category-${k || 'all'}`}>{label}</button>
              ))}
            </div>
            <input type="search" className={`${FIELD} w-56`} placeholder="Search skills" aria-label="Search skills" value={q} onChange={(e) => setQ(e.target.value)} data-testid="skills-search" />
            <label className="flex items-center gap-1.5"><span className={MUTED}>Sort</span>
              <select className={`${FIELD} w-32`} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="skills-sort">
                {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          </div>
          <Group title="From Axal" skills={g.hq} empty="No Axal skill matches." onOpen={setOpen} testId="skills-group-hq" />
          {g.company ? <Group title={`${g.company.name}'s skills`} skills={g.company.skills} empty={`${g.company.name} has no skill that matches.`} onOpen={setOpen} testId="skills-group-company" /> : null}
        </div>
      )}
      {open ? (
        <SkillDetailSheet uid={open.uid} teamAgents={teamAgents} companyName={company?.name}
          onClose={() => setOpen(null)} onEdit={(s) => { setOpen(null); setEditing({ skill: s }); }} onChanged={load} />
      ) : null}
      {editing ? (
        <SkillEditorSheet company={company} canWriteHq={g.canWriteHq} canWriteCompany={!!g.company?.canWrite}
          roles={block.value.roles} skill={editing.skill || null} presetRole={editing.role || null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      ) : null}
    </TeamCard>
  );
}
