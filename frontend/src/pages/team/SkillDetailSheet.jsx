import React, { useEffect, useState } from 'react';
import { Sheet } from '../../ui';
import { AgentPill, AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { agentName } from './teamModel.js';
import { assignHint, groupAgents, outputWord, skillFileName, tagChip, usedByWords } from './skillsModel.js';

/**
 * D1612 (#3952) — a skill's page (SK2) and "Assign to agents…" (SK3), from
 * `agentsAdapter.skill(uid)` and `assignSkill`.
 *
 * The page shows the purpose and steps, the taxonomy tags with levels, the
 * tools, what it proposes, its roles, the version history and the agents
 * using it, grouped by company and by project. Actions: "Assign to agents…",
 * "Copy SKILL.md", "Download"; a writer also gets Edit, Publish and Retire.
 *
 * Assigning lists the team's agents grouped by the company and its projects.
 * An agent the Worker would refuse is greyed out with the reason in words
 * (`assignHint`: its role, its sponsor's approved tools); Save is all or
 * nothing, and says "Added to N agents".
 */

export function AssignSheet({ skill, teamAgents, companyName, onClose, onDone }) {
  const list = Array.isArray(teamAgents) ? teamAgents.filter((a) => a.status !== 'removed') : [];
  const groups = groupAgents(list, companyName);
  const [picked, setPicked] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  const [saving, setSaving] = useState(false);
  const toggle = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const save = async () => {
    setRefusal(''); setSaving(true);
    const out = await agents.assignSkill(skill.uid, [...picked]);
    setSaving(false);
    if (!out.available) { setRefusal(out.reason); return; }
    onDone?.(`Added to ${out.value.added} ${out.value.added === 1 ? 'agent' : 'agents'}.`);
  };
  const row = (a) => {
    const why = assignHint(skill, a);
    return (
      <label key={a.uid} className={`flex min-h-[40px] items-center gap-2 text-[13px] ${why ? 'opacity-60' : ''}`} data-testid={`assign-agent-${a.uid}`}>
        <input type="checkbox" disabled={!!why} checked={picked.has(a.uid)} onChange={() => toggle(a.uid)} className="accent-violet-600" />
        <AgentTile size={22} />
        <span className="min-w-0 flex-1">
          <span className="block text-axal-ink dark:text-gray-100">{agentName(a)} · {a.role_name || a.role_key}</span>
          {why ? <span className={MUTED} data-testid={`assign-why-${a.uid}`}>{why}</span> : null}
        </span>
      </label>
    );
  };
  return (
    <Sheet title="Assign to agents" sub={skill.name} width={560} onClose={onClose} testId="assign-skill-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!picked.size || saving} onClick={save} data-testid="assign-save">Save</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-5">
        {!list.length ? <HonestBlock>No agent on this team you can edit. Add an agent first.</HonestBlock> : null}
        {groups.agents.length ? (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0"><legend className={EYEBROW}>{groups.company || 'This team'}</legend>{groups.agents.map(row)}</fieldset>
        ) : null}
        {groups.projects.map((p) => (
          <fieldset key={p.id} className="m-0 flex flex-col gap-1 border-0 p-0"><legend className={EYEBROW}>{groups.company ? `${groups.company} › ${p.name}` : p.name}</legend>{p.agents.map(row)}</fieldset>
        ))}
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="assign-refusal">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}

function download(name, text) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** The skill page body, from one `GET /api/teams/skills/:uid` answer. */
export function SkillPage({ data }) {
  const s = data.skill || {};
  return (
    <div className="flex flex-col gap-4 px-5 py-5" data-testid="skill-page">
      <p className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100">{s.purpose}</p>
      <div className="flex flex-col gap-1">
        <h3 className={`m-0 ${EYEBROW}`}>Steps</h3>
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-axal-ink dark:text-gray-100">{(s.steps || []).map((x, i) => <li key={i}>{x}</li>)}</ol>
      </div>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className={MUTED}>Skills</dt><dd className="m-0 flex flex-wrap gap-1">{(s.tags || []).map((t) => <span key={t.slug} className="rounded-axal-pill bg-axal-lavender px-2 py-0.5 text-[11px] text-axal-ink dark:bg-violet-900/30 dark:text-gray-100">{tagChip(t)}</span>)}</dd>
        <dt className={MUTED}>Tools</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{(s.tools || []).length ? s.tools.map((t) => <span key={t} className={`mr-2 ${MONO}`}>{t}</span>) : 'None: it reads only what the agent can already see'}</dd>
        <dt className={MUTED}>Proposes</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{outputWord(s.output_kind)}, which a named person accepts</dd>
        <dt className={MUTED}>Roles</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{(s.roles || []).map((r) => r.label).join(', ')}</dd>
        <dt className={MUTED}>Author</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{s.author}</dd>
        <dt className={MUTED}>In use</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{usedByWords(s.used_by)}</dd>
      </dl>
      <div className="flex flex-col gap-1" data-testid="skill-versions">
        <h3 className={`m-0 ${EYEBROW}`}>Versions</h3>
        {(data.versions || []).length ? data.versions.map((v) => <span key={v.version} className={MUTED}>v{v.version} · {String(v.published_at || '').slice(0, 10)}{v.by ? ` · ${v.by.name}` : ''}</span>)
          : <span className={MUTED}>Not published yet.</span>}
      </div>
      <div className="flex flex-col gap-1.5" data-testid="skill-agents">
        <h3 className={`m-0 ${EYEBROW}`}>Agents using it</h3>
        {(data.agents || []).length ? data.agents.map((g, i) => (
          <div key={g.company?.uid || i} className="flex flex-col gap-1">
            {g.agents.length ? <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{g.company?.name || 'No company'}</span> : null}
            {g.agents.map((a) => <span key={a.uid} className="flex items-center gap-1.5 text-[13px] text-axal-ink dark:text-gray-100"><AgentTile size={20} />{a.name || a.role_key}<AgentPill /><span className={MUTED}>v{a.version}{a.update_available ? ' · Update available' : ''}</span></span>)}
            {g.projects.map((p) => (
              <div key={p.id} className="flex flex-col gap-1 pl-3">
                <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{g.company ? `${g.company.name} › ${p.name}` : p.name}</span>
                {p.agents.map((a) => <span key={a.uid} className="flex items-center gap-1.5 text-[13px] text-axal-ink dark:text-gray-100"><AgentTile size={20} />{a.name || a.role_key}<AgentPill /><span className={MUTED}>v{a.version}{a.update_available ? ' · Update available' : ''}</span></span>)}
              </div>
            ))}
          </div>
        )) : <span className={MUTED}>No agent you can see uses it yet.</span>}
      </div>
    </div>
  );
}

export default function SkillDetailSheet({ uid, teamAgents, companyName, onClose, onEdit, onChanged }) {
  const [block, setBlock] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [note, setNote] = useState('');
  const load = () => agents.skill(uid).then(setBlock);
  useEffect(() => { let alive = true; agents.skill(uid).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [uid]);
  const s = block?.available ? block.value.skill : null;
  const act = async (fn) => {
    setNote('');
    const out = await fn();
    if (!out.available) { setNote(out.reason); return; }
    await load(); onChanged?.();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.skill_md); setNote('Copied.'); } catch { setNote('It could not be copied. Use Download instead.'); }
  };
  return (
    <>
      <Sheet width={640} onClose={onClose} testId="skill-detail-sheet" title={s ? s.name : 'Skill'}
        sub={s ? <>{s.author} · {s.version ? `v${s.version}` : 'Draft'}{s.status === 'retired' ? ' · Retired' : ''}</> : undefined}
        footer={s ? (
          <div className="flex flex-wrap justify-end gap-2">
            {s.skill_md ? <button type="button" className={BTN_SECONDARY} onClick={copy} data-testid="skill-copy">Copy SKILL.md</button> : null}
            {s.skill_md ? <button type="button" className={BTN_SECONDARY} onClick={() => download(skillFileName(s), s.skill_md)} data-testid="skill-download">Download</button> : null}
            {s.can_write ? <button type="button" className={BTN_SECONDARY} onClick={() => onEdit?.(s)} data-testid="skill-edit">Edit</button> : null}
            {s.can_write && s.status !== 'retired' ? <button type="button" className={BTN_SECONDARY} onClick={() => act(() => agents.publishSkill(s.uid))} data-testid="skill-publish">Publish</button> : null}
            {s.can_write && s.status !== 'retired' && s.version ? <button type="button" className={BTN_TEXT} onClick={() => act(() => agents.updateSkill(s.uid, { status: 'retired' }))} data-testid="skill-retire">Retire</button> : null}
            {s.version && s.status !== 'retired' ? <button type="button" className={BTN_PRIMARY} onClick={() => setAssigning(true)} data-testid="skill-assign">Assign to agents…</button> : null}
          </div>
        ) : null}>
        {!block ? <p className={`m-0 px-5 py-5 ${MUTED}`}>Reading…</p>
          : !block.available ? <div className="px-5 py-5"><HonestBlock>{block.unreadable ? 'This skill could not be read.' : block.reason}</HonestBlock></div>
            : <SkillPage data={block.value} />}
        {note ? <p role="status" className="m-0 px-5 pb-4 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="skill-note">{note}</p> : null}
      </Sheet>
      {assigning && s ? <AssignSheet skill={s} teamAgents={teamAgents} companyName={companyName} onClose={() => setAssigning(false)}
        onDone={async (words) => { setAssigning(false); setNote(words); await load(); onChanged?.(); }} /> : null}
    </>
  );
}
