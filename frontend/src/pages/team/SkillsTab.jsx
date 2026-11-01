import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { day } from '../account/companies/companiesModel.js';
import { SkillCard, TaxChips, ToolChips, UsedBy } from './SkillParts.jsx';
import { AssignSkillSheet, NewSkillSheet } from './SkillSheets.jsx';
import {
  CATEGORIES, SORTS, assignGroups, authorLine, companySkillsTitle, directory, groups, outputWords, scopeLine, skillFileName,
} from './skillsModel.js';

/**
 * D1612 (#3945, #3952) — Team › Skills, boards SK0 (roles), SK1 (a role's
 * directory), SK2 (the skill page) and SK9 (its states), with SK3 (Assign)
 * and SK7 (New skill) opening from here.
 *
 * The roles are #3840's catalogue (`agents.roles`, wired, handed in as
 * `rolesBlock`). Everything else is A1's library (`agents.skillLibrary`,
 * `agents.skill`) and A2's agents (`agents.skillAgents`), unavailable until
 * #3951 and #3956 land: the tab then draws the role tiles with "Not recorded"
 * counts and says why, and never invents a skill or a count.
 *
 * `?tab=skills&role=<key>` opens a role's directory, `&role=all` every role's,
 * and `&skill=<uid>` a skill's page, so each view has an address.
 *
 * A SKILL.md is untrusted text: it is drawn in a <pre> as text, never as
 * HTML. "Copy SKILL.md" and "Download" use the markdown the read returned, so
 * no route is invented for them.
 */

const SECTION = 'rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';

function scopeArgs(scope) {
  const kind = scope.kind === 'company' ? 'company' : 'project';
  return [kind, kind === 'company' ? scope.company.uid : scope.project.id];
}

/** SK9: a block that could not be read, with Try again. */
export function SkillsUnreadable({ onRetry, what = 'Skills' }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-axal-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-900" data-testid="skills-unreadable">
      <span className="text-[13px] font-semibold text-axal-destructive dark:text-red-300">{what} could not be read.</span>
      {onRetry ? <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid="skills-loading" aria-busy="true">
      {['70%', '92%', '60%'].map((w) => <span key={w} aria-hidden="true" className="block h-2.5 rounded bg-axal-ground dark:bg-gray-800" style={{ width: w }} />)}
      <span className={MUTED}>Reading…</span>
    </div>
  );
}

/** A count that is a number only when the read made one. */
const count = (n) => (Number.isFinite(n) ? String(n) : null);

/** SK0: the three figures. */
export function SkillFigures({ figures }) {
  const f = figures || {};
  const total = f.skills && Number.isFinite(f.skills.axal) && Number.isFinite(f.skills.company) ? f.skills.axal + f.skills.company : null;
  const tiles = [
    ['Skills available', count(total), total != null ? `From Axal ${f.skills.axal} · yours ${f.skills.company}` : null],
    ['Agents with skills', f.agents_with_skills && Number.isFinite(f.agents_with_skills.with) && Number.isFinite(f.agents_with_skills.total) ? `${f.agents_with_skills.with} of ${f.agents_with_skills.total}` : null, null],
    ['Updates available', count(f.updates_available), Number.isFinite(f.updates_available) ? 'Agents pinned to an older version' : null],
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="skills-figures">
      {tiles.map(([label, value, sub]) => (
        <section key={label} className="flex flex-col gap-1 rounded-axal-lg border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-700 dark:bg-gray-900">
          <span className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{label}</span>
          <span className="text-[22px] font-extrabold text-axal-ink dark:text-gray-100">{value ?? <Unrecorded />}</span>
          {sub ? <span className={MUTED}>{sub}</span> : null}
        </section>
      ))}
    </div>
  );
}

/** SK0: a role tile. Counts come from the library read; without one they are "Not recorded". */
export function RoleTile({ role, counts, onOpen, onAddAgent }) {
  const skills = counts ? count(counts.skill_count) : null;
  const ags = counts ? count(counts.agent_count) : null;
  return (
    <article className="flex min-w-0 flex-col gap-2.5 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`skills-role-${role.key}`}>
      <button type="button" onClick={() => onOpen(role.key)} disabled={!onOpen} className="flex flex-col gap-2.5 text-left disabled:cursor-default" data-testid={`skills-role-open-${role.key}`}>
        <span className="flex items-center gap-2.5"><AgentTile size={34} /><b className="min-w-0 flex-1 text-[14.5px] leading-tight text-axal-ink dark:text-gray-100">{role.name}</b>{onOpen ? <span aria-hidden="true" className="text-axal-muted dark:text-gray-400">›</span> : null}</span>
        {role.mission ? <span className={MUTED}>{role.mission}</span> : null}
      </button>
      <span className="mt-auto flex flex-wrap items-center gap-1.5">
        <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200">{skills != null ? `${skills} skills` : <>Skills <Unrecorded /></>}</span>
        {ags != null && Number(ags) > 0 ? <span className="rounded-axal-pill border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11.5px] font-semibold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">{ags} agents</span>
          : ags === '0' ? <span className={MUTED}>No agents yet{onAddAgent ? <> · <button type="button" className={BTN_TEXT} onClick={onAddAgent} data-testid={`skills-role-add-${role.key}`}>Add one</button></> : null}</span> : null}
      </span>
    </article>
  );
}

/** SK1: the category row, search and sort. */
export function Filters({ category, setCategory, q, setQ, sort, setSort }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-axal-lg border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid="skills-filters">
      <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
        {[{ slug: null, label: 'All' }, ...CATEGORIES].map((c) => {
          const on = category === c.slug;
          return (
            <button key={c.label} type="button" aria-pressed={on} onClick={() => setCategory(c.slug)}
              className={`inline-flex min-h-[28px] items-center rounded-axal-pill border px-2.5 text-[12px] ${on ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}
              data-testid={`skills-cat-${c.slug || 'all'}`}>{c.label}</button>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <label className="relative flex items-center">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-axal-muted dark:text-gray-400" />
          <span className="sr-only">Search skills</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills" className={`${FIELD} h-8 w-[200px] pl-8 text-[12.5px]`} data-testid="skills-search" />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-200">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${FIELD} h-8 w-auto py-0 text-[12.5px]`} data-testid="skills-sort">
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function Group({ title, list, onOpen, onAssign, canAssign, testId }) {
  if (!list.length) return null;
  return (
    <section className="flex flex-col gap-2.5" data-testid={testId}>
      <h2 className="m-0 flex items-baseline gap-2 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{title}<span className={MONO}>{list.length}</span></h2>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {list.map((s) => <SkillCard key={s.uid} s={s} onOpen={onOpen} onAssign={onAssign} canAssign={canAssign} />)}
      </div>
    </section>
  );
}

/** SK1: one role's directory, or every role's. */
export function Directory({ role, value, companyName, canEdit, onBack, onOpen, onAssign, onNew }) {
  const [category, setCategory] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');
  const list = directory(value.skills, { role: role?.key || null, category, q, sort });
  const { axal, company } = groups(list);
  const counts = role ? (value.roles || []).find((r) => r.key === role.key) : null;
  const filtered = !!(category || q.trim());
  return (
    <div className="flex flex-col gap-3.5" data-testid="skills-directory">
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" className={BTN_TEXT} onClick={onBack} data-testid="skills-back">‹ Roles</button>
        <span className={MUTED}>·</span>
        <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{role ? role.name : 'All roles'}</h2>
        {counts && Number.isFinite(counts.skill_count) ? <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200">{counts.skill_count} skills</span> : null}
        {counts && Number.isFinite(counts.agent_count) ? <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200">{counts.agent_count} agents</span> : null}
        {canEdit ? <button type="button" className={`${BTN_PRIMARY} ml-auto h-9`} onClick={onNew} data-testid="skills-new">New skill</button> : null}
      </div>
      <Filters category={category} setCategory={setCategory} q={q} setQ={setQ} sort={sort} setSort={setSort} />
      {!list.length ? (
        <HonestBlock testId="skills-empty">
          {filtered ? 'No skill matches this filter.' : `No skills for ${role ? role.name : 'any role'} yet. Axal adds skills as roles grow${canEdit ? '; editors can write one' : ''}.`}
        </HonestBlock>
      ) : null}
      <Group title="From Axal" list={axal} onOpen={onOpen} onAssign={onAssign} canAssign={canEdit} testId="skills-group-axal" />
      <Group title={companySkillsTitle(companyName)} list={company} onOpen={onOpen} onAssign={onAssign} canAssign={canEdit} testId="skills-group-company" />
      {!canEdit ? <p className={`m-0 ${MUTED}`} data-testid="skills-read-only">You can read every skill. Only company editors add skills or assign them.</p> : null}
    </div>
  );
}

function copyText(text) {
  try { return navigator?.clipboard?.writeText ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false); } catch { return Promise.resolve(false); }
}

function download(s) {
  try {
    const blob = new Blob([s.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = skillFileName(s);
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch { /* the browser refused the download; the Copy button still works */ }
}

/** SK2: the agents using a skill, grouped by company and project. */
export function UsingAgents({ block }) {
  if (!block) return <p className={`m-0 ${MUTED}`}>Reading…</p>;
  if (!block.available) return <p className={`m-0 ${MUTED}`} data-testid="skill-agents-off">{block.unreadable ? 'The agents using it could not be read.' : 'Who uses it is not open yet.'}</p>;
  const list = Array.isArray(block.value?.agents) ? block.value.agents : [];
  if (!list.length) return <p className={`m-0 ${MUTED}`}>No agent you can see uses it yet.</p>;
  return (
    <div className="flex flex-col" data-testid="skill-agents">
      {assignGroups(list).map((g) => (
        <div key={g.company} className="flex flex-col">
          <span className={`${EYEBROW} pt-2`}>{g.company}</span>
          {g.agents.map((a) => (
            <div key={a.uid} className="flex items-center gap-2 border-t border-axal-hairline py-1.5 dark:border-gray-800">
              <AgentTile size={24} />
              <span className="flex min-w-0 flex-1 flex-col"><span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{a.name}</span><span className={MUTED}>{scopeLine(a.scope)}</span></span>
              {Number.isFinite(a.pinned_version) ? <span className={MONO}>v{a.pinned_version}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** SK2: one skill's page. */
export function SkillPage({ block, agentsBlock, roleName, roleNames, onBack, onAssign, onRetry, canEdit }) {
  const [copied, setCopied] = useState('');
  if (!block) return <Loading />;
  if (!block.available) return block.unreadable ? <SkillsUnreadable what="This skill" onRetry={onRetry} /> : <HonestBlock>{block.reason}</HonestBlock>;
  const s = block.value?.skill || {};
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const versions = Array.isArray(s.versions) ? s.versions : [];
  const can = canEdit && block.value?.can_edit !== false && s.status === 'published';
  const copy = async () => setCopied((await copyText(s.markdown || '')) ? 'Copied.' : 'It could not be copied. Select the text and copy it.');
  return (
    <div className="flex flex-col gap-3.5" data-testid="skill-page">
      <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={onBack}>‹ {roleName || 'Roles'}</button>
      <div className={`${SECTION} flex flex-wrap items-center gap-3`}>
        <AgentTile size={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[16px] text-axal-ink dark:text-gray-100">{s.name}</b>
          <span className={MUTED}>{[s.scope === 'hq' ? 'From Axal' : authorLine(s).replace(/^By /, ''), Number.isFinite(s.version) && s.version > 0 ? `v${s.version}` : 'Draft', roleNames(s.roles)].filter(Boolean).join(' · ')} · <UsedBy n={s.used_by} /></span>
        </span>
        {s.markdown ? <button type="button" className={BTN_SECONDARY} onClick={copy} data-testid="skill-copy">Copy SKILL.md</button> : null}
        {can ? <button type="button" className={BTN_PRIMARY} onClick={() => onAssign(s)} data-testid="skill-page-assign">Assign to agents…</button> : null}
      </div>
      {copied ? <p role="status" className={`m-0 ${MUTED}`}>{copied}</p> : null}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className={`${SECTION} flex flex-col gap-2.5`}>
          {s.markdown ? <pre className="m-0 whitespace-pre-wrap rounded-axal-md border border-axal-hairline bg-axal-ground/60 px-3.5 py-3 font-mono text-[12px] leading-[1.6] text-axal-ink dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200" data-testid="skill-md">{s.markdown}</pre> : null}
          <h3 className="m-0 mt-1 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Purpose</h3>
          <p className="m-0 text-[13.5px] leading-[1.6] text-axal-ink dark:text-gray-200">{s.description || <Unrecorded />}</p>
          <h3 className="m-0 mt-1 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Steps</h3>
          {steps.length ? (
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="skill-steps">
              {steps.map((st, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-axal-md border border-axal-hairline bg-axal-ground/50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/50">
                  <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-axal-lavender font-mono text-[11px] font-semibold text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300">{i + 1}</span>
                  <span className="text-[13.5px] leading-[1.5] text-axal-ink dark:text-gray-200">{st}</span>
                </li>
              ))}
            </ol>
          ) : <p className={`m-0 ${MUTED}`}>No steps recorded.</p>}
        </section>
        <div className="flex flex-col gap-3.5">
          <section className={`${SECTION} flex flex-col gap-2`}>
            <span className={EYEBROW}>What it proposes</span>
            <p className="m-0 text-[13.5px] leading-[1.55] text-axal-ink dark:text-gray-200">{outputWords(s) || <Unrecorded />}. A named person accepts it; the skill never sends or saves anything itself.</p>
            {s.markdown ? <button type="button" className={`w-fit ${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} onClick={() => download(s)} data-testid="skill-download">Download SKILL.md</button> : null}
          </section>
          <section className={`${SECTION} flex flex-col gap-2`}>
            <span className={EYEBROW}>Taxonomy</span><TaxChips tags={s.taxonomy} />
            <span className={EYEBROW}>Tools</span>{(s.tools || []).length ? <ToolChips tools={s.tools} /> : <span className={MUTED}>No tools</span>}
            <span className={EYEBROW}>Roles</span><span className="text-[13px] text-axal-ink dark:text-gray-200">{roleNames(s.roles) || <Unrecorded />}</span>
          </section>
          <section className={`${SECTION} flex flex-col`}>
            <span className={EYEBROW}>Version history</span>
            {versions.length ? versions.map((v) => (
              <div key={v.version} className="flex gap-2.5 border-t border-axal-hairline py-1.5 text-[12.5px] first-of-type:border-t-0 dark:border-gray-800">
                <span className="w-7 font-mono font-semibold text-axal-ink dark:text-gray-100">v{v.version}</span>
                <span className="min-w-0 flex-1 text-axal-ink dark:text-gray-300">{v.note || '—'}</span>
                <span className={MONO}>{day(v.published_at) || ''}</span>
              </div>
            )) : <p className={`m-0 mt-1 ${MUTED}`}>Not published yet.</p>}
          </section>
          <section className={`${SECTION} flex flex-col`}>
            <span className={EYEBROW}>Agents using it</span>
            <UsingAgents block={agentsBlock} />
          </section>
        </div>
      </div>
    </div>
  );
}

export default function SkillsTab({ scope, rolesBlock, agentsBlock, onAddAgent }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const roleKey = params.get('role');
  const skillUid = params.get('skill');
  const [kind, id] = scopeArgs(scope);
  const companyName = scope.company?.name || null;
  const [lib, setLib] = useState(null);
  const [page, setPage] = useState(null);
  const [using, setUsing] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => { setLib(null); agents.skillLibrary(kind, id, {}).then(setLib); }, [kind, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!skillUid) { setPage(null); setUsing(null); return undefined; }
    let alive = true;
    setPage(null); setUsing(null);
    agents.skill(skillUid).then((b) => { if (alive) setPage(b); });
    agents.skillAgents(skillUid).then((b) => { if (alive) setUsing(b); });
    return () => { alive = false; };
  }, [skillUid]);

  const roles = rolesBlock?.available && Array.isArray(rolesBlock.value?.roles) ? rolesBlock.value.roles : [];
  const roleNames = useMemo(() => (keys) => (Array.isArray(keys) ? keys.map((k) => roles.find((r) => r.key === k)?.name || k).join(', ') : ''), [roles]);
  const go = (next) => {
    const p = new URLSearchParams(search);
    p.set('tab', 'skills');
    for (const [k, v] of Object.entries(next)) { if (v == null) p.delete(k); else p.set(k, v); }
    navigate(`${pathname}?${p.toString()}`);
  };
  const value = lib?.available ? lib.value || {} : null;
  const canEdit = !!value?.can_edit && agentsBlock?.value?.plan_ok !== false;
  const role = roleKey && roleKey !== 'all' ? roles.find((r) => r.key === roleKey) || { key: roleKey, name: roleKey } : null;

  let body;
  if (skillUid) {
    body = <SkillPage block={page} agentsBlock={using} canEdit={canEdit} roleName={role?.name} roleNames={roleNames}
      onBack={() => go({ skill: null })} onAssign={(s) => setSheet({ kind: 'assign', skill: s })}
      onRetry={() => { setPage(null); agents.skill(skillUid).then(setPage); }} />;
  } else if (!lib) {
    body = <Loading />;
  } else if (lib.unreadable) {
    body = <SkillsUnreadable onRetry={load} />;
  } else if (roleKey && value) {
    body = <Directory role={role} value={value} companyName={companyName} canEdit={canEdit}
      onBack={() => go({ role: null })} onOpen={(s) => go({ skill: s.uid })}
      onAssign={(s) => setSheet({ kind: 'assign', skill: s })} onNew={() => setSheet({ kind: 'new', role: role?.key || null })} />;
  } else {
    body = (
      <div className="flex flex-col gap-3.5" data-testid="skills-roles">
        {value ? <SkillFigures figures={value.figures} /> : <HonestBlock testId="skills-off">{lib.reason} Skills open here once they are switched on; the roles below are the agent roles they belong to.</HonestBlock>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Roles</h2>
          {value ? <button type="button" className={BTN_TEXT} onClick={() => go({ role: 'all' })} data-testid="skills-all-roles">All roles</button> : null}
          <span className={`ml-auto ${MUTED}`}>{value ? 'Pick a role to see its skills' : ''}</span>
          {canEdit ? <button type="button" className={`${BTN_PRIMARY} h-9`} onClick={() => setSheet({ kind: 'new', role: null })} data-testid="skills-new">New skill</button> : null}
        </div>
        {!rolesBlock ? <Loading />
          : !rolesBlock.available ? <HonestBlock>{rolesBlock.unreadable ? 'The agent roles could not be read.' : rolesBlock.reason}</HonestBlock>
            : (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                {roles.map((r) => <RoleTile key={r.key} role={r} counts={value ? (value.roles || []).find((x) => x.key === r.key) || null : null}
                  onOpen={value ? (k) => go({ role: k }) : null} onAddAgent={canEdit ? onAddAgent : null} />)}
              </div>
            )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5" data-testid="team-skills">
      {notice ? <p role="status" className="m-0 w-fit rounded-axal-md bg-axal-ink px-3 py-2 text-[13px] text-white dark:bg-gray-100 dark:text-gray-900" data-testid="skills-notice">{notice}</p> : null}
      {body}
      {sheet?.kind === 'assign' ? <AssignSkillSheet skill={sheet.skill} onClose={() => setSheet(null)} onDone={(words) => { setSheet(null); setNotice(words); load(); }} /> : null}
      {sheet?.kind === 'new' ? <NewSkillSheet scope={scope} roles={roles} role={sheet.role} onClose={() => setSheet(null)} onSaved={(s) => { setSheet(null); load(); if (s?.uid) go({ skill: s.uid }); }} /> : null}
    </div>
  );
}
