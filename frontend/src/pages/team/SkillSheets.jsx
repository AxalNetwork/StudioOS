import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Search, TriangleAlert, X } from 'lucide-react';
import { Sheet, Unrecorded } from '../../ui';
import { api } from '../../lib/api';
import { AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { AgentRadar, CostExplainer, EligibilityChip, JobLines, RunCostLine, SkillRow, TaxChips } from './SkillParts.jsx';
import {
  AREAS, COUNTS_LOADING, ELIGIBILITY, LEVELS, OUTPUT_KINDS, RELEASE_NOTE_MAX, assignGroups, assignRows, costChangeWords, countsLine, eligibilityOf, eligibilityWhy,
  emptyEligible, listboxMove, offlineWords, parseSkillMd, pickerFailureWords, pickerLiveLine, pickerRows, previewRadar, problemWords, raceRefusal, radarVector,
  releaseNoteBody, scopeLine, spaceOnRow,
} from './skillsModel.js';
import useOnline from '../learning/useOnline.js';

/**
 * D1612 (#3952), v2 boards by #4224 (D4116) — the skill sheets: SK3 Assign
 * to agents (every agent the read answers, natural fit first, each with its
 * run-cost change and SK5's cost explainer), Add skills to this agent, the
 * Add-an-agent Skills step, and SK4 New skill (Write, or Paste a SKILL.md).
 *
 * Every read and write goes through `agentsAdapter` (A1 #3951, A2 #3956), and
 * every refusal comes back in words. An agent or a skill that can't be picked
 * says why ("Needs the HubSpot read tool, which its sponsor hasn’t
 * approved."). Nothing a skill does is saved without a named person: these
 * sheets only choose which recipes an agent may follow.
 */

/**
 * D4121 (#4121): an estimate that follows a changing pick, read again only
 * when `key` changes; `null` while it is read, the block's value (or
 * `{ available: false }`) after.
 */
function useCost(key, read) {
  const [cost, setCost] = useState(null);
  useEffect(() => {
    let alive = true;
    setCost(null);
    Promise.resolve().then(read).then((b) => { if (alive) setCost(b?.available ? b.value : { available: false }); }, () => { if (alive) setCost({ available: false }); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cost;
}

function Box({ on, disabled }) {
  return (
    <span aria-hidden="true" className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-500' : 'border-axal-hairline bg-white dark:border-gray-600 dark:bg-gray-900'} ${disabled ? 'opacity-45' : ''}`}>
      {on ? <Check size={11} /> : null}
    </span>
  );
}

function Refusal({ text }) {
  return text ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="skill-sheet-refusal">{text}</p> : null;
}

// ---------------------------------------------------------------- SK3

/** "Added to 3 agents", and how many it could not add. */
export function assignedWords(out) {
  const added = Number(out?.added) || 0;
  const refused = Array.isArray(out?.refused) ? out.refused.length : 0;
  const head = `Added to ${added} ${added === 1 ? 'agent' : 'agents'}`;
  return refused ? `${head}. ${refused} could not be added.` : head;
}

/**
 * SK3: the agents as rows, grouped by company. `rows` is `assignRows`'s:
 * natural fit first, nobody left out. An agent outside its natural fit can be
 * ticked like any other; only an agent that already has the skill, or that a
 * real gate refuses (a tool its sponsor has not approved, a retired skill),
 * cannot.
 */
export function AssignList({ rows, picked, onTick }) {
  return assignGroups(rows).map((g) => (
    <div key={g.company} className="flex flex-col">
      <span className={EYEBROW}>{g.company}</span>
      {g.agents.map((a) => {
        // D8768: the Worker's one rule. Only `eligible` is ticked; every other state says why, with its recovery.
        const e = eligibilityOf(a);
        const why = a.assigned ? 'Already has this skill.' : eligibilityWhy(e, { who: 'its sponsor' });
        const off = e.state !== 'eligible';
        const on = a.assigned || picked.has(a.uid);
        const change = costChangeWords(a);
        return (
          <label key={a.uid} className={`flex items-start gap-2.5 border-t border-axal-hairline py-2.5 dark:border-gray-800 ${a.scope?.kind === 'project' ? 'pl-6' : ''} ${off ? 'opacity-75' : 'cursor-pointer'}`} data-testid={`assign-agent-${a.uid}`} data-fit={a.fit ? '1' : '0'}>
            <input type="checkbox" className="sr-only" checked={on} disabled={off} onChange={() => onTick(a.uid)} data-testid={`assign-tick-${a.uid}`} />
            <Box on={on} disabled={off} />
            <AgentTile size={26} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{a.name}</b>
                <EligibilityChip e={e} />
                {a.fit ? <span className="inline-flex min-h-[20px] items-center rounded-axal-pill border border-axal-lavender-edge bg-axal-lavender px-2 text-[11px] font-semibold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300" data-testid="assign-fit">Natural fit</span> : null}
              </span>
              <span className={MUTED}>{scopeLine(a.scope)}{Number.isFinite(a.skill_count) ? ` · ${a.skill_count} skills` : ''}</span>
              <span className={MUTED} data-testid="assign-cost">Run cost change · {change ? <b className="text-axal-ink dark:text-gray-100">{change}</b> : <Unrecorded />}</span>
              {why ? <span className="text-[12px] text-amber-800 dark:text-amber-200" data-testid="assign-why">{why}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  ));
}

export function AssignSkillSheet({ skill, personaOf, onClose, onDone }) {
  const [block, setBlock] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  const [readAt, setReadAt] = useState(null);
  const [reads, setReads] = useState(0);
  const online = useOnline();
  useEffect(() => {
    let alive = true;
    setBlock(null);
    agents.assignable(skill.uid).then((b) => { if (alive) { setBlock(b); if (b?.available) setReadAt(new Date()); } });
    return () => { alive = false; };
  }, [skill.uid, reads]);
  const rows = block?.available ? assignRows(block.value?.agents, skill, personaOf) : [];
  const free = rows.filter((a) => eligibilityOf(a).state === 'eligible');
  const counts = block?.available ? countsLine(block.value?.counts) : null;
  const tick = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const save = async () => {
    setRefusal('');
    const out = await agents.assignSkill(skill.uid, [...picked]);
    if (!out.available) { setRefusal(out.reason); return; }
    onDone?.(assignedWords(out.value));
  };
  return (
    <Sheet title="Assign to agents" sub={`${skill.name}${Number.isFinite(skill.version) ? ` · v${skill.version}` : ''} · every agent on the Teams you edit`} width={560} onClose={onClose} testId="assign-skill-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!picked.size || !online} onClick={save} data-testid="assign-skill-save">{picked.size ? `Add to ${picked.size} ${picked.size === 1 ? 'agent' : 'agents'}` : 'Add'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-5">
        {!online ? <OfflineNote picks={picked.size} at={readAt} testId="assign-skill-offline" /> : null}
        {!block?.available ? <PickerReadState block={block} what="The agents" picks={picked.size} onRetry={() => setReads((n) => n + 1)} testPrefix="assign-skill" /> : !rows.length ? <HonestBlock>No agent on a Team you edit yet.</HonestBlock> : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] font-semibold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
              {picked.size} of {free.length} agents selected
              {free.length ? <button type="button" className={`ml-auto ${BTN_TEXT}`} onClick={() => setPicked(new Set(free.map((a) => a.uid)))} data-testid="assign-skill-all">Select all you can edit</button> : null}
            </div>
            {counts ? <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="assign-counts">{counts}</span> : null}
            <span className={MUTED}>Agents whose persona fits this skill’s area come first. Any agent can take it unless a policy blocks it.</span>
            <AssignList rows={rows} picked={picked} onTick={tick} />
          </>
        )}
        <CostExplainer />
        <Refusal text={refusal} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- D8768: the one picker

/** TMS06: a skill's job, needs, output and cost inside a picker, with Back (or Esc) that keeps the picks and returns focus. */
function PickerDetail({ s, onBack }) {
  const back = useRef(null);
  useEffect(() => { back.current?.focus?.(); }, []);
  const e = eligibilityOf(s);
  // TMS15: Esc goes back to the list, not out of the drawer (the Sheet skips an Escape already handled).
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation?.(); onBack(); } };
  return (
    <section className="flex flex-col gap-2 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" aria-label={`${s.name}: details`} onKeyDown={onKey} data-testid="skill-picker-detail">
      <button ref={back} type="button" className={`w-fit max-sm:min-h-[44px] ${BTN_TEXT}`} onClick={onBack} data-testid="skill-picker-back">‹ Back to the list</button>
      <span className="flex flex-wrap items-center gap-2"><b className="text-[14px] text-axal-ink dark:text-gray-100">{s.name}</b><EligibilityChip e={e} /></span>
      <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-200">{s.description || <Unrecorded />}</p>
      <JobLines s={s} />
      {Array.isArray(s.steps) && s.steps.length ? (
        <ol className="m-0 flex flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-200">{s.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
      ) : null}
      {eligibilityWhy(e) ? <span className="text-[12px] text-amber-800 dark:text-amber-200">{eligibilityWhy(e)}</span> : null}
    </section>
  );
}

/**
 * D8768: the one skill picker, shared by an existing agent's Add skills drawer (TMS04–TMS06) and the Add-an-agent
 * wizard (TMS07, TMS08). It draws what the Worker's one rule answered (`eligibility` on each row, `counts`, `areas`):
 * natural fit first and labelled, every published skill listed, only `eligible` tickable, every other state with its
 * reason and recovery. Search and the area filter narrow what is shown and never drop a pick, and a skill's details
 * open in place and come back with the picks and focus kept.
 *
 * Part 3 (TMS15's keyboard): the rows are a multi-select listbox with one tab stop. `/` focuses search; ↑ ↓ Home End
 * move; Space ticks an eligible row and says why any other stays unticked; Enter opens details and Esc there comes
 * back to the same row; Esc in search clears the words before it closes the drawer. A polite live line says what the
 * list now holds ("3 can attach, 3 blocked in Finance") after each search or area change. On a phone the search,
 * area chips and rows are 44 px targets.
 */
export function SkillPicker({ value, exclude, picked, onTick, testPrefix, toolsLine = false }) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState(null);
  const [detail, setDetail] = useState(null);
  const [active, setActive] = useState(0);
  const [said, setSaid] = useState('');
  const search = useRef(null);
  const options = useRef(new Map());
  const all = (Array.isArray(value?.skills) ? value.skills : []).filter((s) => !exclude?.has(s.uid));
  const inArea = area ? all.filter((s) => (s.taxonomy || []).some((t) => t.category_slug === area)) : all;
  const rows = pickerRows(inArea, q);
  const listedAreas = (value?.areas || []).filter((a) => a.listed > 0);
  const at = rows.length ? Math.min(active, rows.length - 1) : 0;
  const focusRow = (i) => {
    setActive(i);
    const s = rows[i];
    if (s) { try { options.current.get(s.uid)?.focus?.(); } catch { /* focus is a convenience */ } }
  };
  const onKey = (e) => {
    if (e.key === '/' && e.target?.tagName !== 'INPUT' && e.target?.tagName !== 'TEXTAREA') { e.preventDefault(); search.current?.focus?.(); }
  };
  const onSearchKey = (e) => {
    if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation?.(); setQ(''); setSaid(''); setActive(0); }
    else if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); focusRow(0); }
  };
  const onListKey = (e) => {
    const to = listboxMove(at, e.key, rows.length);
    if (to != null) { e.preventDefault(); focusRow(to); return; }
    const s = rows[at];
    if (!s) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      const r = spaceOnRow(s, picked);
      if (r.tick) onTick(s.uid);
      setSaid(r.say);
    } else if (e.key === 'Enter') { e.preventDefault(); setDetail(s.uid); }
  };
  const open = detail ? all.find((s) => s.uid === detail) : null;
  const back = () => {
    const uid = detail;
    setDetail(null);
    setTimeout(() => { try { options.current.get(uid)?.focus?.(); } catch { /* focus is a convenience */ } }, 0);
  };
  if (open) return <PickerDetail s={open} onBack={back} />;
  const eligible = rows.filter((s) => eligibilityOf(s).state === 'eligible');
  const empty = !eligible.length ? emptyEligible({ counts: value?.counts, areas: value?.areas, area, q }) : null;
  const counts = countsLine(value?.counts);
  const live = said || pickerLiveLine(rows, { area, q });
  const narrowTo = (next) => { setSaid(''); setActive(0); if ('q' in next) setQ(next.q); if ('area' in next) setArea(next.area); };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="flex flex-col gap-2" onKeyDown={onKey} data-testid={`${testPrefix}-picker`}>
      {counts ? <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid={`${testPrefix}-counts`}>{counts}</span> : null}
      <label className="relative flex items-center">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-axal-muted dark:text-gray-400" />
        <span className="sr-only">Search by job, what it needs or what you get</span>
        <input ref={search} type="search" value={q} onChange={(e) => narrowTo({ q: e.target.value })} onKeyDown={onSearchKey} placeholder="Search skills ( / )" aria-keyshortcuts="/"
          aria-controls={`${testPrefix}-listbox`} className={`${FIELD} h-9 w-full pl-8 text-[12.5px] max-sm:h-11`} data-testid={`${testPrefix}-search`} />
      </label>
      {listedAreas.length ? (
        <div role="group" aria-label="Area" className="flex flex-wrap gap-1.5">
          {[{ area: null, name: 'All' }, ...listedAreas.map((a) => ({ area: a.area, name: AREAS.find((x) => x.axis === a.area)?.name || a.area, a }))].map((x) => (
            <button key={x.name} type="button" aria-pressed={area === x.area} onClick={() => narrowTo({ area: x.area })}
              className={`inline-flex min-h-[28px] items-center rounded-axal-pill border px-2.5 text-[12px] max-sm:min-h-[44px] max-sm:px-3.5 ${area === x.area ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}
              data-testid={`${testPrefix}-area-${x.area || 'all'}`}>{x.name}{x.a ? ` · ${x.a.eligible}/${x.a.listed}` : ''}</button>
          ))}
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only" data-testid={`${testPrefix}-live`}>{live}</p>
      {empty ? (
        <div role="status" className="flex flex-col gap-1.5 rounded-axal-md border border-dashed border-axal-hairline px-3 py-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:text-gray-200" data-testid={`${testPrefix}-empty`}>
          <span>{empty.text}</span>
          {empty.way ? <button type="button" className={`w-fit max-sm:min-h-[44px] ${BTN_TEXT}`} onClick={() => narrowTo({ q: '', area: empty.way.area })} data-testid={`${testPrefix}-way`}>{empty.way.text} Show them</button> : null}
          {picked.size ? <span className={MUTED}>{`Your ${picked.size} ${picked.size === 1 ? 'pick is' : 'picks are'} kept.`}</span> : null}
        </div>
      ) : null}
      {rows.length ? (
        <div role="listbox" id={`${testPrefix}-listbox`} aria-label="Skills" aria-multiselectable="true" onKeyDown={onListKey} className="flex flex-col" data-testid={`${testPrefix}-listbox`}>
          {rows.map((s, i) => {
            const e = eligibilityOf(s);
            const why = eligibilityWhy(e);
            const off = e.state !== 'eligible';
            const on = picked.has(s.uid);
            return (
              <div key={s.uid} role="option" aria-selected={on} aria-disabled={off} tabIndex={i === at ? 0 : -1}
                ref={(n) => { if (n) options.current.set(s.uid, n); else options.current.delete(s.uid); }}
                onFocus={() => setActive(i)} aria-label={`${s.name}, ${ELIGIBILITY[e.state]?.word || ''}${e.fit ? ', natural fit' : ''}`}
                className={`rounded-axal-md outline-none focus-visible:ring-2 focus-visible:ring-axal-violet max-sm:min-h-[44px] dark:focus-visible:ring-violet-400 ${off ? 'opacity-80' : ''}`}
                data-testid={`${testPrefix}-option-${s.uid}`}>
                <label className={off ? '' : 'cursor-pointer'}>
                  <input type="checkbox" className="sr-only" tabIndex={-1} aria-hidden="true" checked={on} disabled={off} onChange={() => onTick(s.uid)} data-testid={`${testPrefix}-${s.uid}`} />
                  <SkillRow s={s} version={s.version} why={why} state={e} check={<Box on={on} disabled={off} />}
                    toolState={(t) => (e.state === 'blocked' && e.code === 'tool_not_approved' && e.tool?.key === t.key ? 'no' : 'ok')}>
                    <button type="button" tabIndex={-1} className={`max-sm:min-h-[44px] ${BTN_TEXT}`} onClick={(ev) => { ev.preventDefault(); setActive(i); setDetail(s.uid); }} data-testid={`${testPrefix}-details-${s.uid}`}>Details</button>
                  </SkillRow>
                </label>
                {toolsLine && Array.isArray(s.tools_to_grant) && s.tools_to_grant.length && on ? (
                  <span className={`block pb-2 pl-7 ${MUTED}`} data-testid={`${testPrefix}-tools-${s.uid}`}>{`Step 3 will ask you to approve ${s.tools_to_grant.join(', ')}.`}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * TMS09 for the pickers: a list that could not be read says so, never "No skills", keeps the picks and offers Try
 * again; loading shows the counts as "—"; switched off is said as it was. `picks` is how many are held.
 */
function PickerReadState({ block, what, picks = 0, onRetry, testPrefix }) {
  if (!block) {
    return (
      <div aria-busy="true" className="flex flex-col gap-1.5" data-testid={`${testPrefix}-loading`}>
        <span className={`font-mono text-[11.5px] ${MUTED}`}>{COUNTS_LOADING}</span>
        <p className={`m-0 ${MUTED}`}>Reading {what.toLowerCase()}…</p>
      </div>
    );
  }
  if (!block.unreadable) return <HonestBlock>{block.reason}</HonestBlock>;
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-axal-md border border-red-300 bg-red-50 px-3 py-2.5 text-[12.5px] text-axal-ink dark:border-red-800 dark:bg-red-900/20 dark:text-gray-100" data-testid={`${testPrefix}-failed`}>
      <b className="text-axal-destructive dark:text-red-300">{what} couldn’t be read.</b>
      <span>{pickerFailureWords(picks)}</span>
      {onRetry ? <button type="button" className={`w-fit max-sm:min-h-[44px] ${BTN_SECONDARY}`} onClick={onRetry} data-testid={`${testPrefix}-retry`}>Try again</button> : null}
    </div>
  );
}

/** TMS09 Offline: the list stays, the picks stay, and adding waits. */
function OfflineNote({ picks, at, testId }) {
  return (
    <p role="status" className="m-0 flex items-start gap-2 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100" data-testid={testId}>
      <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span><b>You’re offline.</b> {offlineWords(picks, at)}</span>
    </p>
  );
}

// ---------------------------------------------------------------- SK5

/** SK5 (D8768 TMS04–TMS06): every published skill the agent could take, natural fit first, the radar previewing the picks. */
export function AddSkillsSheet({ agent, current, radar, onClose, onSaved }) {
  const [block, setBlock] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  const [readAt, setReadAt] = useState(null);
  const [reads, setReads] = useState(0);
  const online = useOnline();
  // TMS09: a re-read (Try again, or after a refusal at save) keeps the picks; only the list is read again.
  useEffect(() => {
    let alive = true;
    setBlock(null);
    agents.availableSkills(agent.uid).then((b) => { if (alive) { setBlock(b); if (b?.available) setReadAt(new Date()); } });
    return () => { alive = false; };
  }, [agent.uid, reads]);
  const have = useMemo(() => new Set((current || []).map((s) => s.uid)), [current]);
  // The picks are read from the whole answer, never the filtered rows: a search or an area never drops one.
  const all = block?.available && Array.isArray(block.value?.skills) ? block.value.skills.filter((s) => !have.has(s.uid)) : [];
  // Only what the latest read says can be attached is sent: a pick that a re-read found blocked waits, unsent.
  const chosen = all.filter((s) => picked.has(s.uid) && eligibilityOf(s).state === 'eligible');
  const tick = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const save = async () => {
    setRefusal('');
    const next = [...(current || []).map((s) => ({ uid: s.uid, version: s.pinned_version })), ...chosen.map((s) => ({ uid: s.uid, version: s.version }))];
    const out = await agents.setAgentSkills(agent.uid, next);
    if (!out.available) {
      // TMS09 "Refused at save · race": a gate changed after the read. Untick that skill, keep the rest, read again.
      const race = raceRefusal(out, chosen);
      if (race) {
        setPicked((s) => { const n = new Set(s); n.delete(race.uid); return n; });
        setRefusal(race.text);
        setReads((n) => n + 1);
        return;
      }
      setRefusal(out.reason);
      return;
    }
    onSaved?.(out.value);
  };
  const preview = previewRadar(radar, chosen);
  // D4121: the cost per run with the picks, read again as they change.
  const pickKey = chosen.map((s) => s.uid).join(',');
  const cost = useCost(`${agent.uid}|${pickKey}`, () => agents.costEstimate(agent.uid, { add: chosen.map((s) => s.uid) }));
  return (
    <Sheet title="Add skills to this agent" sub="Every published skill it could take, natural fit first" width={560} onClose={onClose} testId="add-skills-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!chosen.length || !online} onClick={save} data-testid="add-skills-save">{chosen.length ? `Add ${chosen.length} ${chosen.length === 1 ? 'skill' : 'skills'}` : 'Add'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-5">
        <AgentRadar vector={chosen.length ? preview : radarVector(radar)} radar={radar} height={180} label={chosen.length ? 'With your picks.' : 'Now.'} />
        <RunCostLine est={cost} />
        {!online ? <OfflineNote picks={picked.size} at={readAt} testId="add-skills-offline" /> : null}
        {!block?.available ? <PickerReadState block={block} what="The skills it could take" picks={picked.size} onRetry={() => setReads((n) => n + 1)} testPrefix="add-skills" />
          : <SkillPicker value={block.value} exclude={have} picked={picked} onTick={tick} testPrefix="add-skill" />}
        <Refusal text={refusal} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- SK6

/**
 * The Add-an-agent Skills step (D8768 TMS07, TMS08): the Worker's one rule for an agent not yet added, its role and
 * persona from the steps before. Up to three eligible skills of its natural fit are picked for you; a skill a policy
 * blocks says why; a picked skill names the tools step 3 will ask for. Nothing eligible says so, with counts and the
 * way on. Next waits for a chosen skill unless skills are not open at all.
 *
 * D8769 part 3 (TMM04B, the owner's Q2 = A): the sheet's Next stays off until a skill is chosen (`skillsGate`), so
 * the step hands its read up (`onBlock`); a read that failed says so with Try again, which reads it again.
 */
export function SkillsStep({ scope, role, model, persona, picked, setPicked, onList, onBlock }) {
  const [block, setBlock] = useState(null);
  const [reads, setReads] = useState(0);
  // D4121 AG3: what the agent would cost per run with these skills, before it is added (its cap comes at Review).
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const scopeId = kind === 'company' ? scope.company?.uid : scope.project?.id;
  const pickList = [...(picked || [])];
  const cost = useCost(`${kind}|${scopeId}|${model}|${role}|${persona}|${pickList.join(',')}`,
    () => (model ? agents.draftCostEstimate(kind, scopeId, { model, role, persona, skills: pickList }) : { available: false }));
  useEffect(() => {
    let alive = true;
    setBlock(null);
    onBlock?.(null);
    agents.eligibleSkills(kind, scopeId, { role, persona }).then((b) => {
      if (!alive) return;
      setBlock(b);
      onBlock?.(b);
      if (!b.available) return;
      const list = Array.isArray(b.value?.skills) ? b.value.skills : [];
      onList?.(list);
      if (picked == null) setPicked(new Set(list.filter((s) => { const e = eligibilityOf(s); return e.state === 'eligible' && e.fit; }).slice(0, 3).map((s) => s.uid)));
    });
    return () => { alive = false; };
  }, [role, persona, reads]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!block?.available) {
    // TMS09: loading shows "—" counts; a failed read says so with Try again and keeps the picks; switched off is said.
    return (
      <div className="flex flex-col gap-2" data-testid="add-agent-skills">
        {block?.unreadable ? (
          <HonestBlock role="alert" testId="add-agent-skills-unreadable"
            action={<button type="button" className={`w-fit max-sm:min-h-[44px] ${BTN_SECONDARY}`} onClick={() => setReads((n) => n + 1)} data-testid="add-agent-skills-retry">Try again</button>}>
            The skills this agent could take could not be read. That is not the same as having none.
            <span>{pickerFailureWords(picked?.size || 0)}</span>
          </HonestBlock>
        ) : block
          ? <HonestBlock>Skills aren’t open yet. You can add skills from the agent’s profile later.</HonestBlock>
          : <PickerReadState block={block} what="The skills this agent could take" picks={picked?.size || 0} onRetry={() => setReads((n) => n + 1)} testPrefix="add-agent-skills" />}
      </div>
    );
  }
  const set = picked || new Set();
  const tick = (uid) => { const n = new Set(set); if (n.has(uid)) n.delete(uid); else n.add(uid); setPicked(n); };
  return (
    <div className="flex flex-col gap-2" data-testid="add-agent-skills">
      <p className={`m-0 ${MUTED}`}>Skills that fit this agent come first, and up to three are picked for you. Any published skill can be added unless a policy blocks it.</p>
      {block.value?.tools_unreadable ? <HonestBlock>Your connected tools could not be read, so a skill that needs one is not offered yet.</HonestBlock> : null}
      <SkillPicker value={block.value} picked={set} onTick={tick} testPrefix="add-agent-skill" toolsLine />
      <RunCostLine est={cost} />
    </div>
  );
}

// ---------------------------------------------------------------- SK4 (D1612's SK7)

function useTaxonomy() {
  const [tax, setTax] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => api.skills.getTaxonomy()).then((r) => { if (alive) setTax({ ok: true, categories: Array.isArray(r?.categories) ? r.categories : [] }); }, () => { if (alive) setTax({ ok: false, categories: [] }); });
    return () => { alive = false; };
  }, []);
  return tax;
}

/** SK4 Write: the taxonomy picker over the /studio skills, a level for each. */
export function TaxonomyPicker({ tax, tags, setTags }) {
  const [skillSlug, setSkillSlug] = useState('');
  const [level, setLevel] = useState(3);
  if (!tax) return <p className={`m-0 ${MUTED}`}>Reading the /studio skills…</p>;
  if (!tax.ok) return <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">The /studio skills could not be read.</p>;
  const all = tax.categories.flatMap((c) => (c.skills || []).map((s) => ({ skill_slug: s.slug, skill_label: s.label, category_slug: c.slug, category_label: c.label })));
  const add = () => {
    const s = all.find((x) => x.skill_slug === skillSlug);
    if (!s || tags.some((t) => t.skill_slug === s.skill_slug)) return;
    setTags([...tags, { ...s, level }]);
    setSkillSlug('');
  };
  return (
    <div className="flex flex-col gap-2" data-testid="skill-taxonomy-picker">
      <TaxChips tags={tags} />
      {tags.length ? (
        <span className="flex flex-wrap gap-1.5">
          {tags.map((t) => <button key={t.skill_slug} type="button" className={BTN_TEXT} onClick={() => setTags(tags.filter((x) => x.skill_slug !== t.skill_slug))} aria-label={`Remove ${t.skill_label}`}><X size={12} aria-hidden="true" />{t.skill_label}</button>)}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1"><span className="sr-only">Skill</span>
          <select className={FIELD} value={skillSlug} onChange={(e) => setSkillSlug(e.target.value)} data-testid="skill-tax-skill">
            <option value="">Pick a /studio skill</option>
            {tax.categories.map((c) => <optgroup key={c.slug} label={c.label}>{(c.skills || []).map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}</optgroup>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="sr-only">Level</span>
          <select className={`${FIELD} w-auto`} value={level} onChange={(e) => setLevel(Number(e.target.value))} data-testid="skill-tax-level">
            {LEVELS.slice(1).map((l, i) => <option key={l} value={i + 1}>{l}</option>)}
          </select>
        </label>
        <button type="button" className={`${BTN_SECONDARY} h-10`} onClick={add} disabled={!skillSlug} data-testid="skill-tax-add">Add</button>
      </span>
    </div>
  );
}

/** SK4 Write: the ordered steps, moved with buttons (keyboard first). */
export function StepsEditor({ steps, setSteps }) {
  const move = (i, d) => { const n = [...steps]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setSteps(n); };
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="skill-steps-editor">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className={`${MONO} w-4 text-right`}>{i + 1}</span>
          <label className="min-w-0 flex-1"><span className="sr-only">Step {i + 1}</span>
            <input className={FIELD} value={s} onChange={(e) => setSteps(steps.map((x, k) => (k === i ? e.target.value : x)))} data-testid={`skill-step-${i}`} />
          </label>
          <button type="button" className={BTN_TEXT} onClick={() => move(i, -1)} disabled={!i} aria-label={`Move step ${i + 1} up`}><ArrowUp size={13} aria-hidden="true" /></button>
          <button type="button" className={BTN_TEXT} onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`}><ArrowDown size={13} aria-hidden="true" /></button>
          <button type="button" className={BTN_TEXT} onClick={() => setSteps(steps.filter((_, k) => k !== i))} disabled={steps.length === 1} aria-label={`Remove step ${i + 1}`}><X size={13} aria-hidden="true" /></button>
        </li>
      ))}
      <li><button type="button" className={BTN_TEXT} onClick={() => setSteps([...steps, ''])} data-testid="skill-step-add">+ Add a step</button></li>
    </ol>
  );
}

/** SK4 Paste: the parsed frontmatter row by row, and what will be refused. */
export function PastePreview({ parsed }) {
  return (
    <div className="flex flex-col gap-2" data-testid="skill-paste-preview">
      <span className={EYEBROW}>Parsed frontmatter</span>
      <div className="overflow-hidden rounded-axal-md border border-axal-hairline dark:border-gray-700">
        {parsed.rows.map((r, i) => (
          <div key={r.key} className={`grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 ${i ? 'border-t border-axal-hairline dark:border-gray-800' : ''}`} data-testid={`paste-row-${r.key}`} data-ok={r.ok ? '1' : '0'}>
            <span className={MONO}>{r.key}</span>
            <span className="min-w-0 truncate text-[13px] text-axal-ink dark:text-gray-200">{r.value || 'Not recorded'}</span>
            {r.ok ? <Check size={14} aria-label="Fine" className="text-axal-positive dark:text-emerald-300" /> : <TriangleAlert size={14} aria-label="Needs a fix" className="text-amber-700 dark:text-amber-300" />}
          </div>
        ))}
      </div>
      <span className={MUTED}>{parsed.steps.length ? `${parsed.steps.length} ${parsed.steps.length === 1 ? 'step' : 'steps'}` : 'No steps found'}</span>
      {parsed.problems.map((p) => (
        <p key={p} role="status" className="m-0 flex items-start gap-2 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100" data-testid={`paste-problem-${p}`}>
          <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{problemWords(p, parsed)}
        </p>
      ))}
    </div>
  );
}

export function NewSkillSheet({ scope, onClose, onSaved }) {
  const [mode, setMode] = useState('write');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState(['']);
  const [tags, setTags] = useState([]);
  const [outputKind, setOutputKind] = useState('draft');
  const [outputLabel, setOutputLabel] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(null);
  const tax = useTaxonomy();
  useEffect(() => { let alive = true; agents.toolChoices().then((b) => { if (alive) setTools(b); }); return () => { alive = false; }; }, []);
  const parsed = useMemo(() => parseSkillMd(markdown), [markdown]);
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const id = kind === 'company' ? scope.company.uid : scope.project.id;
  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
  const writeReady = !!name.trim() && cleanSteps.length > 0 && tags.length > 0;
  const body = () => ({
    name: name.trim(), description: description.trim() || null, steps: cleanSteps,
    taxonomy: tags.map((t) => ({ skill_slug: t.skill_slug, level: t.level })), tools: [], output_kind: outputKind, output_label: outputLabel.trim() || null,
  });
  const save = async (publish) => {
    // D4533 B1: an over-long note is told before anything is saved, so no draft is left behind by a refused publish.
    const note = publish ? releaseNoteBody(releaseNote) : { ok: true, note: null };
    if (!note.ok) { setRefusal(note.problem); return; }
    setRefusal(''); setBusy(true);
    try {
      if (mode === 'paste') {
        const out = await agents.importSkill(kind, id, markdown);
        if (!out.available) { setRefusal(out.reason); return; }
        onSaved?.(out.value?.skill);
        return;
      }
      const out = await agents.createSkill(kind, id, body());
      if (!out.available) { setRefusal(out.reason); return; }
      if (publish && out.value?.skill?.uid) {
        const pub = await agents.publishSkill(out.value.skill.uid, { releaseNote: note.note });
        if (!pub.available) { setRefusal(`Saved as a draft. It could not be published: ${pub.reason}`); return; }
        onSaved?.(pub.value?.skill || out.value.skill);
        return;
      }
      onSaved?.(out.value?.skill);
    } finally { setBusy(false); }
  };
  const servers = tools?.available && Array.isArray(tools.value?.servers) ? tools.value.servers : null;
  return (
    <Sheet title="New skill" sub={mode === 'write' ? 'Write · lands as a draft' : 'Paste a SKILL.md · lands as a draft'} width={560} onClose={onClose} testId="new-skill-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          {mode === 'write' ? (
            <>
              <button type="button" className={BTN_SECONDARY} disabled={!writeReady || busy} onClick={() => save(false)} data-testid="new-skill-draft">Save draft</button>
              <button type="button" className={BTN_PRIMARY} disabled={!writeReady || busy} onClick={() => save(true)} data-testid="new-skill-publish">Publish</button>
            </>
          ) : <button type="button" className={BTN_PRIMARY} disabled={!markdown.trim() || busy} onClick={() => save(false)} data-testid="new-skill-import">Save as draft</button>}
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        <div role="radiogroup" aria-label="How" className="flex gap-1.5">
          {[['write', 'Write'], ['paste', 'Paste a SKILL.md']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
              className={`inline-flex min-h-[30px] items-center rounded-axal-pill border px-3 text-[12.5px] ${mode === k ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}
              data-testid={`new-skill-mode-${k}`}>{l}</button>
          ))}
        </div>
        {mode === 'write' ? (
          <>
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Name</span>
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="new-skill-name" />
            </label>
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Description</span>
              <input className={FIELD} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} data-testid="new-skill-description" />
            </label>
            <div className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Steps</span><StepsEditor steps={steps} setSteps={setSteps} /></div>
            <div className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Taxonomy · required, sets its area</span><TaxonomyPicker tax={tax} tags={tags} setTags={setTags} /></div>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Tools · read only, from your connected tools</span>
              <span className={MUTED} data-testid="new-skill-tools">{servers ? 'Tools are picked per agent by its sponsor; a skill names the read tools it needs.' : 'Read-only tools are not open for agents yet. This skill uses none.'}</span>
            </div>
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Output kind</span>
              <select className={FIELD} value={outputKind} onChange={(e) => setOutputKind(e.target.value)} data-testid="new-skill-output">
                {OUTPUT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className={MUTED}>What it proposes, in words (optional)</span>
              <input className={FIELD} value={outputLabel} onChange={(e) => setOutputLabel(e.target.value)} maxLength={120} placeholder="An update draft in Grow › Updates" />
            </label>
            <label className="flex flex-col gap-1"><span className={MUTED}>Release note · optional, kept with the version if you publish</span>
              <textarea className={`${FIELD} h-20 py-2`} value={releaseNote} onChange={(e) => setReleaseNote(e.target.value)} maxLength={RELEASE_NOTE_MAX} data-testid="new-skill-release-note" />
            </label>
            <span className={MUTED}>Publishing makes a new version. Agents pinned to an older version show “Update available”.</span>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">SKILL.md</span>
              <textarea className={`${FIELD} h-44 py-2 font-mono text-[12px]`} value={markdown} onChange={(e) => setMarkdown(e.target.value)} spellCheck={false} data-testid="new-skill-markdown" />
            </label>
            {markdown.trim() ? <PastePreview parsed={parsed} /> : <p className={`m-0 ${MUTED}`}>Paste a SKILL.md: frontmatter between two <span className="font-mono">---</span> lines, then numbered steps. It lands as a draft; nothing runs until an editor publishes it.</p>}
          </>
        )}
        <Refusal text={refusal} />
      </div>
    </Sheet>
  );
}
