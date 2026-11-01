import React, { useCallback, useEffect, useState } from 'react';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, HonestBlock, MUTED } from './teamUi.jsx';
import { AgentRadar, SkillRow } from './SkillParts.jsx';
import { AddSkillsSheet } from './SkillSheets.jsx';
import { radarVector, scopeChip, updateLabel } from './skillsModel.js';

/**
 * D1612 (#3952, SK4, SK9b) — the agent profile's Skills and Values, from A2's
 * `GET /api/teams/agents/:uid/skills` (#3956, through `agents.agentSkills`).
 *
 * The radar is the Worker's, computed from the agent's skills on the 8 /studio
 * axes; with no skills it reads "Not recorded", never zeros. Each skill shows
 * its pinned version, "Update to vN" when a newer one is published, and Remove;
 * a retired Axal skill keeps working at its pin and says so. Values are the
 * dimensions the company set, labelled "Set by [Company]", never a score.
 * Changes write the whole list through `agents.setAgentSkills`.
 */

export function ValuesCard({ values }) {
  const dims = Array.isArray(values?.dims) ? values.dims : [];
  if (!values || !dims.length) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="agent-values">
        <span className={EYEBROW}>Values</span>
        <p className={`m-0 ${MUTED}`}>No values are set for this agent’s role. A company sets them in the role’s rule book.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="agent-values">
      <span className={EYEBROW}>Values · set by {values.set_by || 'the company'}</span>
      {dims.map((d) => {
        const v = Number.isInteger(d.value) && d.value >= 1 && d.value <= 5 ? d.value : null;
        return (
          <div key={d.key} className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-2.5">
            <span className="flex flex-col"><b className="text-[13px] text-axal-ink dark:text-gray-100">{d.label}</b><span className="text-[11px] text-axal-muted dark:text-gray-400">Set by {values.set_by || 'the company'}</span></span>
            <span role="img" aria-label={v ? `${d.label}: ${v} of 5` : `${d.label}: not recorded`} className="flex gap-[3px]">
              {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-2 flex-1 rounded-[3px] ${v && i <= v ? 'bg-axal-violet dark:bg-violet-400' : 'bg-axal-hairline dark:bg-gray-700'}`} />)}
            </span>
            <span className="font-mono text-[11.5px] text-axal-ink dark:text-gray-200">{v ? `${v} / 5` : 'Not recorded'}</span>
            {d.note ? <span className="col-span-3 -mt-1 text-[12px] text-axal-muted dark:text-gray-400">{d.note}</span> : null}
          </div>
        );
      })}
      <span className={MUTED}>The same scale as values on people profiles in /studio.</span>
    </div>
  );
}

/** The Skills card's body, from one A2 answer. Pure on its props, so the test renders every state. */
export function AgentSkillsView({ value, agent, canManage, onAdd, onUpdate, onRemove, busy }) {
  const skills = Array.isArray(value?.skills) ? value.skills : [];
  const vector = radarVector(value?.radar);
  const chip = scopeChip(agent?.scope);
  return (
    <div className="flex flex-col gap-3" data-testid="agent-skills">
      {chip || agent?.role_name ? (
        <span className="flex flex-wrap gap-1.5">
          {chip ? <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200" data-testid="agent-scope-chip">{chip}</span> : null}
          {agent?.role_name ? <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200">{agent.role_name}</span> : null}
        </span>
      ) : null}
      <AgentRadar vector={vector} radar={value?.radar} />
      <div className="flex items-center">
        <span className={`flex-1 ${EYEBROW}`}>Skills{skills.length ? ` · ${skills.length}` : ''}</span>
        {canManage ? <button type="button" className={`${BTN_PRIMARY} h-8 px-3 text-[12.5px]`} onClick={onAdd} data-testid="agent-skills-add">Add skills</button> : null}
      </div>
      {!skills.length ? <p className={`m-0 ${MUTED}`}>No skills yet. Add skills of its role to give it recipes.</p>
        : skills.map((s) => {
          const retired = s.status === 'retired';
          const upd = !retired ? updateLabel(s) : null;
          return (
            <SkillRow key={s.uid} s={s} version={s.pinned_version} retired={retired}
              why={retired ? `Axal retired this skill. It keeps working at v${s.pinned_version}; pick a replacement.` : null}
              toolState={(t) => (t.approved === false ? 'no' : null)}>
              {canManage ? (
                <span className="flex shrink-0 items-center gap-1">
                  {upd ? <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} disabled={busy} onClick={() => onUpdate(s)} data-testid={`agent-skill-update-${s.uid}`}>{upd}</button> : null}
                  <button type="button" className={BTN_TEXT} disabled={busy} onClick={() => onRemove(s)} data-testid={`agent-skill-remove-${s.uid}`}>Remove</button>
                </span>
              ) : null}
            </SkillRow>
          );
        })}
      <div className="h-px bg-axal-hairline dark:bg-gray-800" />
      <ValuesCard values={value?.values} />
    </div>
  );
}

export default function AgentSkillsCard({ agent, canManage }) {
  const [block, setBlock] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const load = useCallback(() => { setBlock(null); agents.agentSkills(agent.uid).then(setBlock); }, [agent.uid]);
  useEffect(() => { load(); }, [load]);
  const value = block?.available ? block.value || {} : null;
  const manage = !!(canManage && value?.can_manage !== false);
  const write = async (next) => {
    setRefusal(''); setBusy(true);
    try {
      const out = await agents.setAgentSkills(agent.uid, next);
      if (!out.available) { setRefusal(out.reason); return; }
      setBlock(out);
    } finally { setBusy(false); }
  };
  const list = (value?.skills || []).map((s) => ({ uid: s.uid, version: s.pinned_version }));
  return (
    <section className="flex flex-col gap-2 rounded-axal-lg border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-700 dark:bg-gray-900" data-testid="agent-skills-card">
      <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">Skills and values</h3>
      {!block ? <p className={`m-0 ${MUTED}`}>Reading…</p>
        : !block.available ? (block.unreadable
          ? <div role="alert" className="flex items-center gap-2 text-[13px] font-semibold text-axal-destructive dark:text-red-300">Skills could not be read.<button type="button" className={BTN_TEXT} onClick={load}>Try again</button></div>
          : <HonestBlock testId="agent-skills-off">{block.reason} Its skills appear here once they are switched on.</HonestBlock>)
          : (
            <AgentSkillsView value={value} agent={agent} canManage={manage} busy={busy} onAdd={() => setAdding(true)}
              onUpdate={(s) => write(list.map((x) => (x.uid === s.uid ? { uid: s.uid, version: s.current_version } : x)))}
              onRemove={(s) => write(list.filter((x) => x.uid !== s.uid))} />
          )}
      {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
      {adding && value ? <AddSkillsSheet agent={agent} current={value.skills} radar={value.radar} onClose={() => setAdding(false)} onSaved={(v) => { setAdding(false); setBlock({ available: true, value: v }); }} /> : null}
    </section>
  );
}
