/**
 * D4537 (#4537, step 2) — HQ › AI agents › From Axal › a skill › Definition: edit the working draft.
 *
 * Saves through the existing `PATCH /api/teams/skills/:uid` (Super Admin for an Axal skill), which runs `checkDraft`
 * and answers one code per refusal; the field it names is marked and its sentence shown. Published versions are never
 * edited: saving changes the working draft only, and the page says what that does to the review and evaluation first.
 * Reuses Team › Skills' steps editor and taxonomy picker.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { teamAgentsApi } from '../../../lib/api/teamAgents';
import { OUTPUT_KINDS } from '../../team/skillsModel';
import { StepsEditor, TaxonomyPicker } from '../../team/SkillSheets.jsx';
import { refusalOf } from './refusals';
import { definitionDirty, definitionEditable, definitionForm, definitionPatch, definitionRefusal, saveConsequence } from './definitionModel';

const LABEL = 'flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const FIELD = 'rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] font-normal dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BAD = 'border-red-500 dark:border-red-400';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const BTN = 'rounded-lg bg-axal-ink px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900';
const BTN2 = 'rounded-lg border border-axal-hairline px-3 py-2 text-[13px] font-semibold dark:border-gray-700 dark:text-gray-100';

/** The /studio taxonomy and the catalogue roles, each read on its own; a failed read is said, never an empty list. */
function useOptions() {
  const [tax, setTax] = useState(null);
  const [roles, setRoles] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => api.skills.getTaxonomy())
      .then((r) => { if (alive) setTax({ ok: true, categories: Array.isArray(r?.categories) ? r.categories : [] }); }, () => { if (alive) setTax({ ok: false, categories: [] }); });
    Promise.resolve().then(() => teamAgentsApi.roles())
      .then((r) => { if (alive) setRoles(Array.isArray(r?.roles) ? { ok: true, list: r.roles } : { ok: false, list: [] }); }, () => { if (alive) setRoles({ ok: false, list: [] }); });
    return () => { alive = false; };
  }, []);
  return { tax, roles };
}

export function DefinitionEditor({ skill, onSaved }) {
  const { tax, roles } = useOptions();
  const labels = useMemo(() => new Map((tax?.categories ?? []).flatMap((c) => (c.skills ?? []).map((s) => [s.slug, s.label]))), [tax]);
  const [form, setForm] = useState(() => definitionForm(skill));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  // A fresh read of the skill (after a save, or a reload) resets the form to what the server holds.
  useEffect(() => { setForm(definitionForm(skill, (s) => labels.get(s))); setRefused(null); }, [skill]); // eslint-disable-line react-hooks/exhaustive-deps
  // The taxonomy's labels arriving later only name the tags already there; they never reset an edit in progress.
  useEffect(() => {
    if (!labels.size) return;
    setForm((f) => ({ ...f, tags: f.tags.map((t) => ({ ...t, skill_label: labels.get(t.skill_slug) || t.skill_label })) }));
  }, [labels]);
  if (!definitionEditable(skill?.status)) {
    return <Card className="space-y-1 px-4 py-4" data-testid="hq-skill-definition-readonly"><h3 className="text-[14px] font-bold">Definition</h3><p className={MUTED}>A retired skill is read only.</p></Card>;
  }
  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid="hq-skill-definition">
        <p className={MUTED}>{saved ? <span role="status" data-testid="def-saved">Saved to the draft. </span> : null}The definition above is the working draft.</p>
        <button type="button" className={BTN2} onClick={() => { setForm(definitionForm(skill, (s) => labels.get(s))); setRefused(null); setOpen(true); }} data-testid="def-open">Edit definition</button>
      </Card>
    );
  }
  const set = (key) => (value) => { setForm((f) => ({ ...f, [key]: value })); setSaved(false); };
  const dirty = definitionDirty(form, skill);
  const bad = (field) => (refused?.field === field ? BAD : '');
  const save = async () => {
    setBusy(true); setRefused(null); setSaved(false);
    try {
      await teamAgentsApi.updateSkill(skill.uid, definitionPatch(form));
      setSaved(true);
      setOpen(false);
      onSaved?.();
    } catch (e) {
      const r = refusalOf(e);
      setRefused(definitionRefusal(r.code, r.data, r.message));
    } finally { setBusy(false); }
  };
  const toggleRole = (key) => set('roles')(form.roles.includes(key) ? form.roles.filter((r) => r !== key) : [...form.roles, key]);
  return (
    <Card className="space-y-3 px-4 py-4" data-testid="hq-skill-definition">
      <div>
        <h3 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Definition</h3>
        <p className={MUTED}>Short name <code className="font-mono" data-testid="hq-skill-slug">{skill.slug ?? 'Not recorded'}</code>. It is the skill’s identity and is never edited.</p>
      </div>
      <label className={LABEL}>Name
        <input className={`${FIELD} ${bad('name')}`} value={form.name} onChange={(e) => set('name')(e.target.value)} aria-invalid={refused?.field === 'name'} data-testid="def-name" />
      </label>
      <label className={LABEL}>Purpose
        <textarea className={`${FIELD} ${bad('purpose')}`} rows={2} value={form.purpose} onChange={(e) => set('purpose')(e.target.value)} aria-invalid={refused?.field === 'purpose'} data-testid="def-purpose" />
      </label>
      <fieldset className={`space-y-1 rounded-lg border border-transparent ${bad('steps')}`}>
        <legend className={LABEL}>Steps</legend>
        <StepsEditor steps={form.steps} setSteps={set('steps')} />
      </fieldset>
      <label className={LABEL}>Read-only tools, one per line
        <textarea className={`${FIELD} font-mono ${bad('tools')}`} rows={3} value={form.tools} onChange={(e) => set('tools')(e.target.value)} aria-invalid={refused?.field === 'tools'} data-testid="def-tools" />
      </label>
      <label className={LABEL}>What it proposes
        <select className={`${FIELD} ${bad('output_kind')}`} value={form.output_kind} onChange={(e) => set('output_kind')(e.target.value)} aria-invalid={refused?.field === 'output_kind'} data-testid="def-output">
          <option value="">Choose</option>
          {OUTPUT_KINDS.map(([k, words]) => <option key={k} value={k}>{words}</option>)}
        </select>
      </label>
      <fieldset className={`space-y-1 rounded-lg border border-transparent ${bad('tags')}`}>
        <legend className={LABEL}>Taxonomy tags</legend>
        <TaxonomyPicker tax={tax} tags={form.tags} setTags={set('tags')} />
      </fieldset>
      <fieldset className={`space-y-1 rounded-lg border border-transparent ${bad('roles')}`} data-testid="def-roles">
        <legend className={LABEL}>Agent roles</legend>
        {!roles ? <p className={MUTED}>Reading the roles…</p>
          : !roles.ok ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">The roles could not be read.</p>
            : <div className="flex flex-wrap gap-3">{roles.list.map((r) => (
              <label key={r.key} className="flex items-center gap-1.5 text-[12.5px] dark:text-gray-200">
                <input type="checkbox" checked={form.roles.includes(r.key)} onChange={() => toggleRole(r.key)} data-testid={`def-role-${r.key}`} />{r.name || r.key}
              </label>
            ))}</div>}
      </fieldset>
      <p className={MUTED} data-testid="def-consequence">{saveConsequence(skill.status)}</p>
      {refused ? (
        <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="def-refused">
          <strong>Not saved.</strong> {refused.text}{refused.code ? <> <code className="font-mono text-[11px]">{refused.code}</code></> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} onClick={save} disabled={!dirty || busy} data-testid="def-save">{busy ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className={BTN2} onClick={() => { setRefused(null); setOpen(false); }} disabled={busy} data-testid="def-cancel">Cancel</button>
      </div>
    </Card>
  );
}
