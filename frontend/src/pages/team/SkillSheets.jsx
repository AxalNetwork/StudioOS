import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, TriangleAlert, X } from 'lucide-react';
import { Sheet } from '../../ui';
import { api } from '../../lib/api';
import { AgentTile } from './AgentMark.jsx';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { AgentRadar, SkillRow, TaxChips } from './SkillParts.jsx';
import {
  LEVELS, OUTPUT_KINDS, assignGroups, blockedWords, directory, parseSkillMd, previewRadar, problemWords, radarVector, scopeLine,
} from './skillsModel.js';

/**
 * D1612 (#3952) — the skill sheets: SK3 Assign to agents, SK5 Add skills to
 * this agent, SK6 the Add-an-agent Skills step, and SK7 New skill (Write, or
 * Paste a SKILL.md).
 *
 * Every read and write goes through `agentsAdapter` (A1 #3951, A2 #3956), and
 * every refusal comes back in words. An agent or a skill that can't be picked
 * says why ("Needs the HubSpot read tool, which its sponsor hasn’t
 * approved."). Nothing a skill does is saved without a named person: these
 * sheets only choose which recipes an agent may follow.
 */

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

/** The read states every sheet shares: Reading…, switched off, could not be read. */
function ReadState({ block, what }) {
  if (!block) return <p className={`m-0 ${MUTED}`}>Reading…</p>;
  if (block.unreadable) return <p role="alert" className="m-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300">{what} could not be read.</p>;
  return <HonestBlock>{block.reason}</HonestBlock>;
}

// ---------------------------------------------------------------- SK3

/** "Added to 3 agents", and how many it could not add. */
export function assignedWords(out) {
  const added = Number(out?.added) || 0;
  const refused = Array.isArray(out?.refused) ? out.refused.length : 0;
  const head = `Added to ${added} ${added === 1 ? 'agent' : 'agents'}`;
  return refused ? `${head}. ${refused} could not be added.` : head;
}

export function AssignSkillSheet({ skill, onClose, onDone }) {
  const [block, setBlock] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  useEffect(() => { let alive = true; agents.assignable(skill.uid).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [skill.uid]);
  const list = block?.available && Array.isArray(block.value?.agents) ? block.value.agents : [];
  const free = list.filter((a) => !a.blocked && !a.assigned);
  const tick = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const save = async () => {
    setRefusal('');
    const out = await agents.assignSkill(skill.uid, [...picked]);
    if (!out.available) { setRefusal(out.reason); return; }
    onDone?.(assignedWords(out.value));
  };
  return (
    <Sheet title="Assign to agents" sub={`${skill.name}${Number.isFinite(skill.version) ? ` · v${skill.version}` : ''} · agents of its role you can edit`} width={560} onClose={onClose} testId="assign-skill-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!picked.size} onClick={save} data-testid="assign-skill-save">{picked.size ? `Add to ${picked.size} ${picked.size === 1 ? 'agent' : 'agents'}` : 'Add'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-5">
        {!block?.available ? <ReadState block={block} what="The agents" /> : !list.length ? <HonestBlock>No agent of this skill’s role that you can edit.</HonestBlock> : (
          <>
            <div className="flex items-center gap-2 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] font-semibold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
              {picked.size} of {free.length} agents selected
              {free.length ? <button type="button" className={`ml-auto ${BTN_TEXT}`} onClick={() => setPicked(new Set(free.map((a) => a.uid)))} data-testid="assign-skill-all">Select all you can edit</button> : null}
            </div>
            {assignGroups(list).map((g) => (
              <div key={g.company} className="flex flex-col">
                <span className={EYEBROW}>{g.company}</span>
                {g.agents.map((a) => {
                  const why = a.assigned ? 'Already has this skill.' : blockedWords(a.blocked);
                  const off = !!(a.assigned || a.blocked);
                  const on = a.assigned || picked.has(a.uid);
                  return (
                    <label key={a.uid} className={`flex items-start gap-2.5 border-t border-axal-hairline py-2.5 dark:border-gray-800 ${a.scope?.kind === 'project' ? 'pl-6' : ''} ${off ? 'opacity-75' : 'cursor-pointer'}`} data-testid={`assign-agent-${a.uid}`}>
                      <input type="checkbox" className="sr-only" checked={on} disabled={off} onChange={() => tick(a.uid)} />
                      <Box on={on} disabled={off} />
                      <AgentTile size={26} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{a.name}</b>
                        <span className={MUTED}>{scopeLine(a.scope)}{Number.isFinite(a.skill_count) ? ` · ${a.skill_count} skills` : ''}</span>
                        {why ? <span className="text-[12px] text-amber-800 dark:text-amber-200" data-testid="assign-why">{why}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </>
        )}
        <Refusal text={refusal} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- SK5

/** SK5: only its role's skills, tools checked against its approved tools, the radar previewing the picks. */
export function AddSkillsSheet({ agent, current, radar, onClose, onSaved }) {
  const [block, setBlock] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [refusal, setRefusal] = useState('');
  useEffect(() => { let alive = true; agents.availableSkills(agent.uid).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [agent.uid]);
  const have = new Set((current || []).map((s) => s.uid));
  const list = block?.available ? directory(block.value?.skills, { sort: 'popular' }).filter((s) => !have.has(s.uid)) : [];
  const chosen = list.filter((s) => picked.has(s.uid));
  const tick = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const save = async () => {
    setRefusal('');
    const next = [...(current || []).map((s) => ({ uid: s.uid, version: s.pinned_version })), ...chosen.map((s) => ({ uid: s.uid, version: s.version }))];
    const out = await agents.setAgentSkills(agent.uid, next);
    if (!out.available) { setRefusal(out.reason); return; }
    onSaved?.(out.value);
  };
  const preview = previewRadar(radar, chosen);
  return (
    <Sheet title="Add skills to this agent" sub={`${agent.role_name || 'Its role'}’s skills, most used first`} width={560} onClose={onClose} testId="add-skills-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!chosen.length} onClick={save} data-testid="add-skills-save">{chosen.length ? `Add ${chosen.length} ${chosen.length === 1 ? 'skill' : 'skills'}` : 'Add'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-5">
        <AgentRadar vector={chosen.length ? preview : radarVector(radar)} radar={radar} height={180} label={chosen.length ? 'With your picks.' : 'Now.'} />
        {!block?.available ? <ReadState block={block} what="Its role’s skills" /> : !list.length ? <HonestBlock>No other skill of this role yet.</HonestBlock>
          : list.map((s) => {
            const why = blockedWords(s.blocked);
            const on = picked.has(s.uid);
            return (
              <label key={s.uid} className={why ? 'opacity-80' : 'cursor-pointer'}>
                <input type="checkbox" className="sr-only" checked={on} disabled={!!why} onChange={() => tick(s.uid)} data-testid={`add-skill-${s.uid}`} />
                <SkillRow s={s} version={s.version} why={why} check={<Box on={on} disabled={!!why} />}
                  toolState={(t) => (s.blocked?.code === 'tool_not_approved' && (s.blocked.tool?.key === t.key) ? 'no' : 'ok')} />
              </label>
            );
          })}
        <Refusal text={refusal} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- SK6

/** SK6: the Add-an-agent Skills step. Its role's published skills, the three most used picked for you. */
export function SkillsStep({ scope, role, picked, setPicked, onList }) {
  const [block, setBlock] = useState(null);
  useEffect(() => {
    let alive = true;
    const kind = scope.kind === 'company' ? 'company' : 'project';
    agents.skillLibrary(kind, kind === 'company' ? scope.company.uid : scope.project.id, { role }).then((b) => {
      if (!alive) return;
      setBlock(b);
      if (!b.available) return;
      const list = directory(b.value?.skills, { role, sort: 'popular' }).filter((s) => s.status === 'published');
      onList?.(list);
      if (picked == null) setPicked(new Set(list.slice(0, 3).map((s) => s.uid)));
    });
    return () => { alive = false; };
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!block?.available) {
    return (
      <div className="flex flex-col gap-2" data-testid="add-agent-skills">
        {block ? <HonestBlock>{block.unreadable ? 'This role’s skills could not be read.' : 'Skills aren’t open yet.'} You can add skills from the agent’s profile later.</HonestBlock> : <p className={`m-0 ${MUTED}`}>Reading…</p>}
      </div>
    );
  }
  const list = directory(block.value?.skills, { role, sort: 'popular' }).filter((s) => s.status === 'published');
  const set = picked || new Set();
  const tick = (uid) => { const n = new Set(set); if (n.has(uid)) n.delete(uid); else n.add(uid); setPicked(n); };
  return (
    <div className="flex flex-col gap-2" data-testid="add-agent-skills">
      <p className={`m-0 ${MUTED}`}>This role’s skills, picked for you. Change any of them.</p>
      {!list.length ? <HonestBlock>No skills for this role yet. You can add skills from the agent’s profile later.</HonestBlock>
        : list.map((s) => (
          <label key={s.uid} className="cursor-pointer">
            <input type="checkbox" className="sr-only" checked={set.has(s.uid)} onChange={() => tick(s.uid)} data-testid={`add-agent-skill-${s.uid}`} />
            <SkillRow s={s} version={s.version} check={<Box on={set.has(s.uid)} />} />
          </label>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------- SK7

function useTaxonomy() {
  const [tax, setTax] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => api.skills.getTaxonomy()).then((r) => { if (alive) setTax({ ok: true, categories: Array.isArray(r?.categories) ? r.categories : [] }); }, () => { if (alive) setTax({ ok: false, categories: [] }); });
    return () => { alive = false; };
  }, []);
  return tax;
}

/** SK7 Write: the taxonomy picker over the /studio skills, a level for each. */
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

/** SK7 Write: the ordered steps, moved with buttons (keyboard first). */
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

/** SK7 Paste: the parsed frontmatter row by row, and what will be refused. */
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

export function NewSkillSheet({ scope, roles, role: initialRole, onClose, onSaved }) {
  const [mode, setMode] = useState('write');
  const [role, setRole] = useState(initialRole || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState(['']);
  const [tags, setTags] = useState([]);
  const [outputKind, setOutputKind] = useState('draft');
  const [outputLabel, setOutputLabel] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(null);
  const tax = useTaxonomy();
  useEffect(() => { let alive = true; agents.toolChoices().then((b) => { if (alive) setTools(b); }); return () => { alive = false; }; }, []);
  const parsed = useMemo(() => parseSkillMd(markdown), [markdown]);
  const kind = scope.kind === 'company' ? 'company' : 'project';
  const id = kind === 'company' ? scope.company.uid : scope.project.id;
  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
  const writeReady = !!role && !!name.trim() && cleanSteps.length > 0;
  const body = () => ({
    role_keys: [role], name: name.trim(), description: description.trim() || null, steps: cleanSteps,
    taxonomy: tags.map((t) => ({ skill_slug: t.skill_slug, level: t.level })), tools: [], output_kind: outputKind, output_label: outputLabel.trim() || null,
  });
  const save = async (publish) => {
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
        const pub = await agents.publishSkill(out.value.skill.uid, {});
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
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Role · required</span>
              <select className={FIELD} value={role} onChange={(e) => setRole(e.target.value)} data-testid="new-skill-role">
                <option value="">Pick a role</option>
                {(roles || []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Name</span>
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="new-skill-name" />
            </label>
            <label className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Description</span>
              <input className={FIELD} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} data-testid="new-skill-description" />
            </label>
            <div className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Steps</span><StepsEditor steps={steps} setSteps={setSteps} /></div>
            <div className="flex flex-col gap-1"><span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Taxonomy</span><TaxonomyPicker tax={tax} tags={tags} setTags={setTags} /></div>
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
