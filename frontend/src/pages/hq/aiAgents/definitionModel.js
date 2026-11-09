/**
 * D4537 (#4537, step 2) — the From Axal definition editor, as pure rules.
 *
 * The Worker decides: `PATCH /api/teams/skills/:uid` runs `checkDraft` and answers one code per refusal. This file
 * turns a skill into the form, the form into that route's body, and a refusal code into the field it is about and the
 * page's sentence. It checks nothing the server does not, so a save the server would refuse is never shown as saved.
 */

/** The ladder's words, lower case as the Worker stores them (`SENIORITY_LEVELS`). */
export const LEVEL_KEYS = ['aware', 'working', 'proficient', 'advanced', 'expert'];
export const levelKey = (n) => LEVEL_KEYS[n - 1] ?? null;
export const levelRank = (key) => LEVEL_KEYS.indexOf(String(key ?? '').toLowerCase()) + 1;

/** `checkDraft`'s codes (`services/agents/skills.ts`), each with its field and the page's sentence. */
export const DEFINITION_REFUSALS = {
  name_missing: { field: 'name', text: 'Give the skill a name.' },
  purpose_missing: { field: 'purpose', text: 'Say what the skill does and when to use it.' },
  steps_invalid: { field: 'steps', text: 'Give at least one step, and no empty or overlong step.' },
  tools_invalid: { field: 'tools', text: 'List tools by name, such as hubspot.read_contacts.' },
  tool_not_read_only: { field: 'tools', text: (d) => `${d?.tool || 'A tool'} can change records. A skill may only request read-only tools.` },
  output_invalid: { field: 'output_kind', text: 'Choose what the skill proposes.' },
  tags_invalid: { field: 'tags', text: 'Tag the skill with at least one /studio skill, each at a level.' },
  tag_unknown: { field: 'tags', text: 'One of the tags is no longer a /studio skill.' },
  roles_missing: { field: 'roles', text: 'Choose at least one agent role.' },
  role_unknown: { field: 'roles', text: 'One of the roles is not an agent role.' },
  slug_invalid: { field: 'slug', text: 'The short name is not valid.' },
  not_editor: { field: null, text: 'Only this skill’s editors can change it.' },
  body_invalid: { field: null, text: 'That change could not be read.' },
};

/** The field a refusal is about, and its sentence (the Worker's own sentence for a code not listed). */
export function definitionRefusal(code, data = null, serverMessage = null) {
  const r = code ? DEFINITION_REFUSALS[code] : null;
  const text = r ? (typeof r.text === 'function' ? r.text(data) : r.text) : (serverMessage || 'That change was not saved.');
  return { code: code || null, field: r?.field ?? null, text };
}

/** The form for a skill from `GET /api/admin/ai-agents/skills/:uid`. Tags carry a numeric level for the picker. */
export function definitionForm(skill, labelOf = () => null) {
  return {
    name: skill?.name ?? '',
    purpose: skill?.purpose ?? '',
    steps: Array.isArray(skill?.steps) && skill.steps.length ? skill.steps.map(String) : [''],
    tools: Array.isArray(skill?.tools) ? skill.tools.join('\n') : '',
    output_kind: skill?.output_kind ?? '',
    tags: (skill?.tags ?? []).map((t) => ({ skill_slug: t.slug, skill_label: labelOf(t.slug) || t.slug, level: levelRank(t.level) || 3 })),
    roles: Array.isArray(skill?.roles) ? [...skill.roles] : [],
  };
}

/** The PATCH body: every editable field, trimmed as the Worker trims, tags back in its words. */
export function definitionPatch(form) {
  return {
    name: form.name.trim(),
    purpose: form.purpose.trim(),
    steps: form.steps.map((s) => s.trim()),
    tools: form.tools.split(/[\n,]/).map((t) => t.trim()).filter(Boolean),
    output_kind: form.output_kind,
    tags: form.tags.map((t) => ({ slug: t.skill_slug, level: levelKey(t.level) })),
    roles: [...form.roles],
  };
}

/** Whether the form differs from the skill it was read from. */
export function definitionDirty(form, skill) {
  return JSON.stringify(definitionPatch(form)) !== JSON.stringify(definitionPatch(definitionForm(skill)));
}

/** A retired skill is read only; a draft, one in review or a published one has a working draft to edit. */
export const definitionEditable = (status) => status === 'draft' || status === 'in_review' || status === 'published';

/** What saving does to the release state, said before the save (D4533: the evidence follows the definition). */
export function saveConsequence(status) {
  if (status === 'in_review') return 'Saving changes the draft under review: the open review and its evaluation no longer cover it.';
  if (status === 'published') return 'Saving changes the working draft. The published version stays as it is until a new one is published.';
  return 'Saving changes the draft. Any evaluation of the previous text no longer counts.';
}
