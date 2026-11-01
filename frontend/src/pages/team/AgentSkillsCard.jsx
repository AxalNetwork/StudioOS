import React, { useEffect, useState } from 'react';
import { Sheet } from '../../ui';
import SkillRadar from '../../components/play/SkillRadar.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, HonestBlock, MUTED } from './teamUi.jsx';
import { NOT_RECORDED, SKILLS_UNREAD, assignHint, outputWord, radarVector, tagChip } from './skillsModel.js';

/**
 * D1612 (#3952) — the agent profile's Skills card (SK4) and "Add skills"
 * (SK5), from `agentsAdapter.agentSkills(uid)` and `setAgentSkills`.
 *
 * The card draws the agent's 8-axis `SkillRadar`, the same chart a person's
 * profile draws, computed by the Worker from the agent's skills. An axis no
 * skill tags is "Not recorded": it is left out of the chart, never drawn as
 * a 0, and an agent with no skills draws no chart at all.
 *
 * Each skill shows its pinned version, "Update to vN" when a newer one is
 * published, and Remove. "Add skills" lists only the agent's role's skills;
 * one its sponsor's tools do not cover is greyed out with the reason. Every
 * change is one `PUT …/skills` of the whole list, as the Worker takes it.
 */

const keep = (skills) => skills.map((s) => ({ uid: s.uid, version: s.version }));

export function PickSkills({ agent, library, current, onClose, onSave }) {
  const have = new Set(current.map((s) => s.uid));
  const [picked, setPicked] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  const g = library?.available ? library.value : null;
  const list = g ? [...(g.hq || []), ...(g.company?.skills || [])].filter((s) => s.version && s.status !== 'retired' && !have.has(s.uid)) : [];
  const toggle = (uid) => setPicked((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const save = async () => {
    setRefusal('');
    const out = await onSave([...keep(current), ...[...picked].map((uid) => ({ uid }))]);
    if (out && !out.available) setRefusal(out.reason);
  };
  return (
    <Sheet title="Add skills to this agent" sub={agent?.role_name || undefined} width={560} onClose={onClose} testId="pick-skills-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!picked.size} onClick={save} data-testid="pick-skills-save">Add {picked.size || ''}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 px-5 py-5">
        {!library ? <p className={`m-0 ${MUTED}`}>Reading…</p>
          : !library.available ? <HonestBlock>{library.unreadable ? `${SKILLS_UNREAD}.` : library.reason}</HonestBlock>
            : !list.length ? <HonestBlock>{`No other published skill belongs to the ${agent?.role_name || 'agent'} role yet.`}</HonestBlock>
              : list.map((s) => {
                const why = assignHint(s, agent);
                return (
                  <label key={s.uid} className={`flex items-start gap-2 rounded-axal-md border border-axal-hairline p-2.5 dark:border-gray-700 ${why ? 'opacity-60' : ''}`} data-testid={`pick-skill-${s.uid}`}>
                    <input type="checkbox" disabled={!!why} checked={picked.has(s.uid)} onChange={() => toggle(s.uid)} className="mt-1 accent-violet-600" />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[13px] text-axal-ink dark:text-gray-100">{s.name} <span className="font-mono text-[11px] text-axal-muted">v{s.version}</span></b>
                      <span className={MUTED}>{s.purpose}</span>
                      {why ? <span className={`block ${MUTED}`} data-testid={`pick-why-${s.uid}`}>{why}</span> : null}
                    </span>
                  </label>
                );
              })}
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}

/** The card body, from one `GET /api/teams/agents/:uid/skills` answer. */
export function AgentSkillsView({ data, canManage, onUpdate, onRemove, onAdd }) {
  const radar = radarVector(data.radar);
  const skills = Array.isArray(data.skills) ? data.skills : [];
  return (
    <div className="flex flex-col gap-3" data-testid="agent-skills">
      {radar.recorded ? (
        <div data-testid="agent-skills-radar"><SkillRadar skillVector={radar.vector} height={210} animate={false} /></div>
      ) : <p className={`m-0 ${MUTED}`} data-testid="agent-skills-radar-empty">{`Skills profile: ${NOT_RECORDED}. It is computed from the agent's skills.`}</p>}
      {radar.recorded && radar.missing.length ? <p className={`m-0 ${MUTED}`}>{`${NOT_RECORDED}: ${radar.missing.join(', ')}.`}</p> : null}
      {skills.length ? skills.map((s) => (
        <div key={s.uid} className="flex flex-col gap-1 rounded-axal-md border border-axal-hairline p-2.5 dark:border-gray-700" data-testid={`agent-skill-${s.uid}`}>
          <span className="flex items-center gap-2">
            <b className="min-w-0 flex-1 text-[13px] text-axal-ink dark:text-gray-100">{s.name}</b>
            <span className="font-mono text-[11px] text-axal-muted">v{s.version}</span>
            {s.status === 'retired' ? <span className="rounded-axal-pill bg-axal-amber px-2 py-0.5 text-[11px] font-semibold text-axal-amber-deep">Retired</span> : null}
          </span>
          <span className="flex flex-wrap gap-1">{(s.tags || []).map((t) => <span key={t.slug} className="rounded-axal-pill bg-axal-lavender px-2 py-0.5 text-[11px] text-axal-ink dark:bg-violet-900/30 dark:text-gray-100">{tagChip(t)}</span>)}</span>
          <span className={MUTED}>Proposes {outputWord(s.output_kind).toLowerCase()}</span>
          {canManage ? (
            <span className="flex gap-2">
              {s.update_available ? <button type="button" className={BTN_TEXT} onClick={() => onUpdate(s)} data-testid={`agent-skill-update-${s.uid}`}>Update to v{s.latest_version}</button> : null}
              <button type="button" className={BTN_TEXT} onClick={() => onRemove(s)} data-testid={`agent-skill-remove-${s.uid}`}>Remove</button>
            </span>
          ) : null}
        </div>
      )) : <p className={`m-0 ${MUTED}`}>This agent has no skills yet.</p>}
      {canManage ? <button type="button" className={`w-fit ${BTN_SECONDARY}`} onClick={onAdd} data-testid="agent-skills-add">Add skills</button> : null}
    </div>
  );
}

export default function AgentSkillsCard({ agent, companyUid }) {
  const [block, setBlock] = useState(null);
  const [picking, setPicking] = useState(false);
  const [library, setLibrary] = useState(null);
  const [refusal, setRefusal] = useState('');
  const load = () => agents.agentSkills(agent.uid).then(setBlock);
  useEffect(() => { let alive = true; agents.agentSkills(agent.uid).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [agent.uid]);
  const write = async (list) => {
    setRefusal('');
    const out = await agents.setAgentSkills(agent.uid, list);
    if (out.available) { setBlock(out); setPicking(false); } else setRefusal(out.reason);
    return out;
  };
  const current = block?.available ? block.value.skills || [] : [];
  const openPicker = () => {
    setPicking(true); setLibrary(null);
    agents.skillLibrary({ company: companyUid || undefined, role: agent.role_key, sort: 'popular' }).then(setLibrary);
  };
  return (
    <section className="flex flex-col gap-2 px-5 pb-5" data-testid="agent-skills-card">
      <h3 className={`m-0 ${EYEBROW}`}>Skills</h3>
      {!block ? <p className={`m-0 ${MUTED}`}>Reading…</p>
        : !block.available ? (
          <HonestBlock action={block.unreadable ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={load}>Try again</button> : null}>
            {block.unreadable ? `${SKILLS_UNREAD}.` : block.reason}{block.refused ? '' : ' That is not the same as having none.'}
          </HonestBlock>
        ) : (
          <AgentSkillsView data={block.value} canManage={!!block.value.can_manage}
            onUpdate={(s) => write(current.map((x) => (x.uid === s.uid ? { uid: x.uid, version: s.latest_version } : { uid: x.uid, version: x.version })))}
            onRemove={(s) => write(keep(current.filter((x) => x.uid !== s.uid)))}
            onAdd={openPicker} />
        )}
      {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="agent-skills-refusal">{refusal}</p> : null}
      {picking ? <PickSkills agent={agent} library={library} current={current} onClose={() => setPicking(false)} onSave={write} /> : null}
    </section>
  );
}
