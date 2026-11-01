import React, { useEffect, useState } from 'react';
import { Sheet } from '../../ui';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD, HonestBlock, MUTED } from './teamUi.jsx';
import { LEVELS, OUTPUT_KINDS, draftBody, moveStep } from './skillsModel.js';

/**
 * D1612 (#3952) — New skill and Edit skill (SK7), a Sheet at 640, for those
 * who may write (a company's editors; a Super Admin for "From Axal").
 *
 * Two modes. **Write:** role (required), name, purpose, steps (an ordered
 * list, moved with Up and Down), /studio taxonomy tags with a level each, the
 * read-only tools it may use by name, and what it proposes; Save draft, then
 * Publish (a new version; agents on an older one show "Update available").
 * **Paste a SKILL.md:** the text is sent as it is; the Worker reads it as
 * untrusted data and it lands as a draft for an editor to check and publish.
 *
 * Every refusal is the Worker's own sentence (`throughSkill`).
 */

const blank = (role) => ({ name: '', purpose: '', steps: [''], tools: [], output_kind: 'draft', roles: role ? [role] : [], tags: [] });
const fromSkill = (s) => {
  const d = s.draft || s;
  return {
    name: d.name || '', purpose: d.purpose || '', steps: d.steps?.length ? d.steps : [''], tools: d.tools || [], output_kind: d.output_kind || 'draft',
    roles: (d.roles || []).map((r) => r.key || r), tags: (d.tags || []).map((t) => ({ slug: t.slug, level: t.level })),
  };
};

export default function SkillEditorSheet({ company, canWriteHq, canWriteCompany, roles, skill, presetRole, onClose, onSaved }) {
  const [mode, setMode] = useState('write');
  const [form, setForm] = useState(() => (skill ? fromSkill(skill) : blank(presetRole)));
  const [scope, setScope] = useState(skill ? skill.scope : (canWriteCompany ? 'company' : 'hq'));
  const [pasted, setPasted] = useState('');
  const [taxonomy, setTaxonomy] = useState(null);
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; agents.skillTaxonomy().then((b) => { if (alive) setTaxonomy(b); }); return () => { alive = false; }; }, []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const categories = taxonomy?.available && Array.isArray(taxonomy.value?.categories) ? taxonomy.value.categories : [];
  const tagLevel = (slug) => form.tags.find((t) => t.slug === slug)?.level || '';
  const setTag = (slug, level) => set('tags', level ? [...form.tags.filter((t) => t.slug !== slug), { slug, level }] : form.tags.filter((t) => t.slug !== slug));
  const toggleRole = (key) => set('roles', form.roles.includes(key) ? form.roles.filter((r) => r !== key) : [...form.roles, key]);
  const ready = mode === 'paste' ? pasted.trim().length > 0 : form.roles.length > 0 && form.name.trim() && form.purpose.trim();

  const save = async (publish) => {
    setRefusal(''); setBusy(true);
    let out;
    if (skill) out = await agents.updateSkill(skill.uid, draftBody(form));
    else {
      const where = scope === 'company' ? { scope: 'company', company: company?.uid } : { scope: 'hq' };
      out = await agents.createSkill(mode === 'paste' ? { ...where, skill_md: pasted } : { ...where, ...draftBody(form) });
    }
    if (out.available && publish) out = await agents.publishSkill(out.value.skill.uid);
    setBusy(false);
    if (!out.available) { setRefusal(out.reason); return; }
    onSaved?.(out.value.skill);
  };

  return (
    <Sheet title={skill ? `Edit ${skill.name}` : 'New skill'} width={640} onClose={onClose} testId="skill-editor-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_SECONDARY} disabled={!ready || busy} onClick={() => save(false)} data-testid="skill-save-draft">Save draft</button>
          {mode === 'write' ? <button type="button" className={BTN_PRIMARY} disabled={!ready || busy} onClick={() => save(true)} data-testid="skill-save-publish">Publish</button> : null}
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-5">
        {!skill ? (
          <div role="tablist" aria-label="How to make it" className="flex gap-2">
            {[['write', 'Write'], ['paste', 'Paste a SKILL.md']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={`rounded-axal-pill px-3 py-1 text-[12.5px] font-semibold ${mode === k ? 'bg-axal-violet text-white dark:bg-violet-500' : 'bg-axal-ground text-axal-ink dark:bg-gray-800 dark:text-gray-200'}`} data-testid={`skill-mode-${k}`}>{label}</button>
            ))}
          </div>
        ) : null}
        {!skill && canWriteHq && canWriteCompany ? (
          <label className="flex flex-col gap-1"><span className={MUTED}>For</span>
            <select className={FIELD} value={scope} onChange={(e) => setScope(e.target.value)} data-testid="skill-scope">
              <option value="company">{company?.name ? `${company.name}'s agents` : 'This company'}</option>
              <option value="hq">Every company (From Axal)</option>
            </select>
          </label>
        ) : null}
        {mode === 'paste' ? (
          <>
            <textarea className={`${FIELD} h-64 font-mono text-[12px]`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'---\nname: "…"\ndescription: "…"\nroles: [cfo]\ntools: []\noutput: draft\ntaxonomy:\n  - { slug: "investor_reporting", level: proficient }\n---\n1. …'} aria-label="SKILL.md" data-testid="skill-paste" />
            <p className={`m-0 ${MUTED}`}>A pasted skill is read as data. It lands as a draft: check it, then publish. Nothing runs until then.</p>
          </>
        ) : (
          <>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Roles</legend>
              <span className="flex flex-wrap gap-1">
                {(roles || []).map((r) => (
                  <button key={r.key} type="button" aria-pressed={form.roles.includes(r.key)} onClick={() => toggleRole(r.key)}
                    className={`rounded-axal-pill px-2.5 py-1 text-[12px] ${form.roles.includes(r.key) ? 'bg-axal-violet text-white dark:bg-violet-500' : 'bg-axal-ground text-axal-ink dark:bg-gray-800 dark:text-gray-200'}`} data-testid={`skill-role-${r.key}`}>{r.label}</button>
                ))}
              </span>
              <span className={MUTED}>An agent is only given skills of its own role.</span>
            </fieldset>
            <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Name</span>
              <input className={FIELD} value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} data-testid="skill-name" /></label>
            <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">What it does, and when to use it</span>
              <textarea className={`${FIELD} h-20`} value={form.purpose} maxLength={300} onChange={(e) => set('purpose', e.target.value)} data-testid="skill-purpose" /></label>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="skill-steps">
              <legend className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Steps</legend>
              {form.steps.map((x, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className="w-5 font-mono text-[12px] text-axal-muted">{i + 1}.</span>
                  <input className={FIELD} value={x} maxLength={400} aria-label={`Step ${i + 1}`} onChange={(e) => set('steps', form.steps.map((y, j) => (j === i ? e.target.value : y)))} />
                  <button type="button" className={BTN_TEXT} aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => set('steps', moveStep(form.steps, i, -1))}>↑</button>
                  <button type="button" className={BTN_TEXT} aria-label={`Move step ${i + 1} down`} disabled={i === form.steps.length - 1} onClick={() => set('steps', moveStep(form.steps, i, 1))}>↓</button>
                  <button type="button" className={BTN_TEXT} aria-label={`Remove step ${i + 1}`} disabled={form.steps.length === 1} onClick={() => set('steps', form.steps.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
              {form.steps.length < 20 ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => set('steps', [...form.steps, ''])} data-testid="skill-add-step">Add a step</button> : null}
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="skill-tags">
              <legend className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Skills it covers</legend>
              {!taxonomy ? <span className={MUTED}>Reading…</span>
                : !taxonomy.available ? <HonestBlock>The skills taxonomy could not be read. That is not the same as none.</HonestBlock>
                  : categories.map((cat) => (
                    <details key={cat.slug} className="rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700">
                      <summary className="cursor-pointer text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{cat.label}</summary>
                      {(cat.skills || []).map((sk) => (
                        <label key={sk.slug} className="mt-1 flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-200">
                          <span className="min-w-0 flex-1">{sk.label}</span>
                          <select className={`${FIELD} h-8 w-36`} value={tagLevel(sk.slug)} onChange={(e) => setTag(sk.slug, e.target.value)} aria-label={`${sk.label} level`} data-testid={`skill-tag-${sk.slug}`}>
                            <option value="">Not covered</option>
                            {LEVELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                          </select>
                        </label>
                      ))}
                    </details>
                  ))}
            </fieldset>
            <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Read-only tools it may use</span>
              <input className={FIELD} value={form.tools.join(', ')} onChange={(e) => set('tools', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} placeholder="hubspot.read_contacts" data-testid="skill-tools" />
              <span className={MUTED}>By name, separated by commas. An agent gets this skill only if its sponsor approved every one. Write tools are never allowed.</span>
            </label>
            <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">What it proposes</span>
              <select className={FIELD} value={form.output_kind} onChange={(e) => set('output_kind', e.target.value)} data-testid="skill-output">
                {OUTPUT_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <span className={MUTED}>Always a proposal that a named person accepts.</span>
            </label>
          </>
        )}
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="skill-refusal">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}
