import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { day } from '../account/companies/companiesModel.js';
import SkillEnergy from '../../ui/SkillEnergy.jsx';
import { AreaDot, CostLine, SkillCard, SkillImage, TaxChips, ToolChips, UsedBy } from './SkillParts.jsx';
import { AssignSkillSheet, NewSkillSheet } from './SkillSheets.jsx';
import {
  AREAS, SORTS, areaCounts, areaFromParam, assignGroups, authorLine, companySkillsTitle, directory, groups, outputWords, scopeLine, skillAreas, skillFileName,
} from './skillsModel.js';

/**
 * D1612 (#3945, #3952), rebuilt to the v2 boards by #4224 (D4116) — Team ›
 * Skills: SK0 the 8 areas of the /studio radar, SK1 an area's directory (or
 * All), SK2 the skill page, and SK6's states (an empty area, loading, could
 * not be read, read-only, a retired Axal skill still pinned, phone and dark),
 * with SK3 (Assign to agents) and SK4 (New skill) opening from here.
 *
 * v2 has no roles. A skill sits in the areas of its taxonomy tags (the area
 * key and hue are `lib/skillAreas.js`'s, the table SkillEnergy and the radar
 * read); any skill can go to any agent, and natural fit only sorts Assign.
 * Every card draws its SkillEnergy image (D4120) and its run cost (R5,
 * #4121), which reads "Not recorded" while no route serves it.
 *
 * The library is A1's `GET /api/teams/skills?company=` and a skill's page
 * `GET /api/teams/skills/:uid`, through `agents.skillLibrary` and
 * `agents.skill`; who uses it is A2's `agents.skillAgents`.
 *
 * `?tab=skills&area=<key>` opens an area, `&area=all` every area, and
 * `&skill=<uid>` a skill's page. An old `&role=` link opens All.
 *
 * A SKILL.md is untrusted text: it is drawn in a <pre> as text, never as
 * HTML. "Copy SKILL.md" and "Download" use the markdown the read returned, so
 * no route is invented for them.
 */

const SECTION = 'rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';

/** SK6c: a block that could not be read, with Try again. Never "No skills". */
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

/** SK0: an area tile. The count comes from the library read; without one it is "Not recorded", never 0. */
export function AreaTile({ area, count: n, onOpen }) {
  const skills = count(n);
  return (
    <article className="flex min-w-0 flex-col rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900" data-testid={`skills-area-${area.key}`}>
      <button type="button" onClick={onOpen ? () => onOpen(area.key) : undefined} disabled={!onOpen} className="flex items-center gap-3 p-3.5 text-left disabled:cursor-default" data-testid={`skills-area-open-${area.key}`}>
        <SkillEnergy slug={`area-${area.key}`} area={area.key} level={4} size={48} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <b className="flex items-center gap-1.5 text-[14.5px] leading-tight text-axal-ink dark:text-gray-100"><AreaDot area={area.key} />{area.name}</b>
          <span className={MUTED}>{skills != null ? `${skills} ${skills === '1' ? 'skill' : 'skills'}` : <>Skills <Unrecorded /></>}</span>
        </span>
        {onOpen ? <span aria-hidden="true" className="text-axal-muted dark:text-gray-400">›</span> : null}
      </button>
    </article>
  );
}

/** SK1: the area row, search and sort. Picking an area changes the address (`&area=`). */
export function Filters({ area, onArea, q, setQ, sort, setSort }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-axal-lg border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid="skills-filters">
      <div role="group" aria-label="Area" className="flex flex-wrap gap-1.5">
        {[{ key: null, name: 'All' }, ...AREAS].map((a) => {
          const on = (area?.key || null) === a.key;
          return (
            <button key={a.name} type="button" aria-pressed={on} onClick={() => onArea(a.key)}
              className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-axal-pill border px-2.5 text-[12px] ${on ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}
              data-testid={`skills-cat-${a.key || 'all'}`}>{a.key ? <AreaDot area={a.key} /> : null}{a.name}</button>
          );
        })}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <label className="relative flex min-w-0 flex-1 items-center sm:flex-none">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-axal-muted dark:text-gray-400" />
          <span className="sr-only">Search skills</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills" className={`${FIELD} h-8 w-full pl-8 text-[12.5px] sm:w-[200px]`} data-testid="skills-search" />
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

/** SK1: one area's directory, or every area's (`area` null). */
export function Directory({ area, value, companyName, canNew, canAssign, onArea, onBack, onOpen, onAssign, onNew }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');
  const list = directory(value.skills, { area: area?.key || null, q, sort });
  const { axal, company } = groups(list);
  return (
    <div className="flex flex-col gap-3.5" data-testid="skills-directory">
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" className={BTN_TEXT} onClick={onBack} data-testid="skills-back">‹ Areas</button>
        <span className={MUTED}>·</span>
        <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{area ? <AreaDot area={area.key} /> : null}{area ? area.name : 'All areas'}</h2>
        <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200" data-testid="skills-dir-count">{list.length} {list.length === 1 ? 'skill' : 'skills'}</span>
        {canNew ? <button type="button" className={`${BTN_PRIMARY} ml-auto h-9`} onClick={onNew} data-testid="skills-new">New skill</button> : null}
      </div>
      <Filters area={area} onArea={onArea} q={q} setQ={setQ} sort={sort} setSort={setSort} />
      {!list.length ? (
        <HonestBlock testId="skills-empty">
          {q.trim() ? 'No skill matches this search.' : area ? `No skills in ${area.name} yet. Axal adds skills to every area${canNew ? '; editors can write one' : ''}.` : `No skills yet.${canNew ? ' Editors can write one.' : ''}`}
        </HonestBlock>
      ) : null}
      <Group title="From Axal" list={axal} onOpen={onOpen} onAssign={onAssign} canAssign={canAssign} testId="skills-group-axal" />
      <Group title={companySkillsTitle(companyName)} list={company} onOpen={onOpen} onAssign={onAssign} canAssign={canAssign} testId="skills-group-company" />
      {!canNew && !canAssign ? <ReadOnlyLine /> : null}
    </div>
  );
}

/** SK6d: a member who edits no Team here reads every skill, and adds or assigns none. */
function ReadOnlyLine() {
  return <p className={`m-0 ${MUTED}`} data-testid="skills-read-only">You can read every skill. Only this Team’s editors add skills or assign them to agents.</p>;
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
export function SkillPage({ block, agentsBlock, backTo, onBack, onAssign, onRetry, canAssign }) {
  const [copied, setCopied] = useState('');
  if (!block) return <Loading />;
  if (!block.available) return block.unreadable ? <SkillsUnreadable what="This skill" onRetry={onRetry} /> : <HonestBlock>{block.reason}</HonestBlock>;
  const s = block.value?.skill || {};
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const versions = Array.isArray(s.versions) ? s.versions : [];
  const can = !!canAssign && s.status === 'published';
  const areas = skillAreas(s).map((a) => a.name).join(', ');
  const copy = async () => setCopied((await copyText(s.markdown || '')) ? 'Copied.' : 'It could not be copied. Select the text and copy it.');
  return (
    <div className="flex flex-col gap-3.5" data-testid="skill-page">
      <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={onBack} data-testid="skill-back">‹ {backTo || 'Areas'}</button>
      <div className={`${SECTION} flex flex-wrap items-center gap-3`}>
        <SkillImage s={s} size={96} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[16px] text-axal-ink dark:text-gray-100">{s.name}</b>
          <span className={MUTED}>{[s.scope === 'hq' ? 'From Axal' : authorLine(s).replace(/^By /, ''), Number.isFinite(s.version) && s.version > 0 ? `v${s.version}` : 'Draft', areas].filter(Boolean).join(' · ')} · <UsedBy n={s.used_by} /></span>
          <CostLine s={s} />
          {s.status === 'retired' ? <span className="text-[12px] text-amber-800 dark:text-amber-200" data-testid="skill-retired-line">{s.scope === 'hq' ? 'Axal retired this skill.' : 'Retired.'} Agents still pinned to it keep working at their version.</span> : null}
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
            <span className={EYEBROW}>Areas</span>{(s.taxonomy || []).length ? <TaxChips tags={s.taxonomy} /> : <Unrecorded />}
            <span className={EYEBROW}>Tools</span>{(s.tools || []).length ? <ToolChips tools={s.tools} /> : <span className={MUTED}>No tools</span>}
            <span className={MUTED}>Any agent can take it. An agent whose persona fits its area is listed first.</span>
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

export default function SkillsTab({ scope, agentsBlock }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  // v2: `&area=<key>` opens an area; `&area=all`, an unknown area, or an old `&role=` link opens All.
  const inDirectory = params.has('area') || params.has('role');
  const area = areaFromParam(params.get('area'));
  const skillUid = params.get('skill');
  const companyUid = scope.company?.uid || null;
  const companyName = scope.company?.name || null;
  const [lib, setLib] = useState(null);
  const [page, setPage] = useState(null);
  const [using, setUsing] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => { setLib(null); agents.skillLibrary(companyUid).then(setLib); }, [companyUid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!skillUid) { setPage(null); setUsing(null); return undefined; }
    let alive = true;
    setPage(null); setUsing(null);
    agents.skill(skillUid).then((b) => { if (alive) setPage(b); });
    agents.skillAgents(skillUid).then((b) => { if (alive) setUsing(b); });
    return () => { alive = false; };
  }, [skillUid]);

  const go = (next) => {
    const p = new URLSearchParams(search);
    p.set('tab', 'skills');
    p.delete('role');
    for (const [k, v] of Object.entries(next)) { if (v == null) p.delete(k); else p.set(k, v); }
    navigate(`${pathname}?${p.toString()}`);
  };
  const value = lib?.available ? lib.value || {} : null;
  const planOk = agentsBlock?.value?.plan_ok !== false;
  const canNew = !!value?.can_edit && planOk;
  const canAssign = !!value && (!!value.can_edit || !!agentsBlock?.value?.can_manage) && planOk;
  const counts = useMemo(() => (value ? areaCounts(value.skills) : null), [value]);
  const teamAgents = agentsBlock?.available && Array.isArray(agentsBlock.value?.agents) ? agentsBlock.value.agents : [];
  const personaOf = (uid) => teamAgents.find((a) => a.uid === uid)?.persona || null;

  let body;
  if (skillUid) {
    body = <SkillPage block={page} agentsBlock={using} canAssign={canAssign} backTo={inDirectory ? (area ? area.name : 'All areas') : 'Areas'}
      onBack={() => go({ skill: null })} onAssign={(s) => setSheet({ kind: 'assign', skill: s })}
      onRetry={() => { setPage(null); agents.skill(skillUid).then(setPage); }} />;
  } else if (!lib) {
    body = <Loading />;
  } else if (lib.unreadable) {
    body = <SkillsUnreadable onRetry={load} />;
  } else if (inDirectory && value) {
    body = <Directory area={area} value={value} companyName={companyName} canNew={canNew} canAssign={canAssign}
      onArea={(k) => go({ area: k || 'all' })} onBack={() => go({ area: null })} onOpen={(s) => go({ skill: s.uid })}
      onAssign={(s) => setSheet({ kind: 'assign', skill: s })} onNew={() => setSheet({ kind: 'new' })} />;
  } else {
    body = (
      <div className="flex flex-col gap-3.5" data-testid="skills-areas">
        {value ? <SkillFigures figures={value.figures} /> : <HonestBlock testId="skills-off">{lib.reason} Skills open here once they are switched on; the areas below are where they sit.</HonestBlock>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Areas</h2>
          {value ? <button type="button" className={BTN_TEXT} onClick={() => go({ area: 'all' })} data-testid="skills-all-areas">All areas</button> : null}
          <span className={`ml-auto ${MUTED}`}>{value ? 'Pick an area to see its skills. Any skill can go to any agent.' : ''}</span>
          {canNew ? <button type="button" className={`${BTN_PRIMARY} h-9`} onClick={() => setSheet({ kind: 'new' })} data-testid="skills-new">New skill</button> : null}
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {AREAS.map((a) => <AreaTile key={a.key} area={a} count={counts ? counts[a.key] : null} onOpen={value ? (k) => go({ area: k }) : null} />)}
        </div>
        {value && !canNew && !canAssign ? <ReadOnlyLine /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5" data-testid="team-skills">
      {notice ? <p role="status" className="m-0 w-fit rounded-axal-md bg-axal-ink px-3 py-2 text-[13px] text-white dark:bg-gray-100 dark:text-gray-900" data-testid="skills-notice">{notice}</p> : null}
      {body}
      {sheet?.kind === 'assign' ? <AssignSkillSheet skill={sheet.skill} personaOf={personaOf} onClose={() => setSheet(null)} onDone={(words) => { setSheet(null); setNotice(words); load(); }} /> : null}
      {sheet?.kind === 'new' ? <NewSkillSheet scope={scope} onClose={() => setSheet(null)} onSaved={(s) => { setSheet(null); load(); if (s?.uid) go({ skill: s.uid }); }} /> : null}
    </div>
  );
}
