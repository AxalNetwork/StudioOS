/**
 * D6008 (#6008) — the interview guide's rules, as data (D5995, V27–V29).
 * Pure: the guide component and the recording's guide drawer read these, and
 * `frontend/test/interview_guide_6008.test.mjs` holds them.
 *
 *   - `groupsOf` orders the questions under each open hypothesis (code and
 *     claim), then each theme no interview has judged, then Default and Other.
 *     While no hypothesis is open and the guide has no question, the Worker's
 *     default discovery questions are drawn, labelled as defaults.
 *   - `authorLine` marks Eadwyn's questions until they are edited.
 *   - `holdLine` says what a draft holds before it runs.
 *   - The edits (`move`, `remove`, `edit`, `add`) change the local list only;
 *     the guide is saved whole, with the version read, by Save.
 */

export const DEFAULTS_LABEL = 'Discovery questions · no open hypothesis yet';
export const AI_OFF_TITLE = 'AI assistance is off for this venture.';
export const AI_OFF_LINE = 'Eadwyn can’t draft questions. The guide stays writable by hand.';
export const UNAVAILABLE_LINE = 'The guide couldn’t be read. Recording still works.';
export const DRAFT_FAILED_TITLE = 'Eadwyn couldn’t draft questions.';
export const DRAFT_FAILED_LINE = 'The held credit is released. Your questions are unchanged.';
export const KEPT_LINE = 'kept for the venture · a copy is taken onto the interview when used';
export const COPY_NOTE = 'Questions you mark asked are noted on the interview’s copy of the guide. The venture’s guide doesn’t change.';

/** "$0.04" from micro-dollars; never a figure it did not read. */
export function holdLine(microusd) {
  const n = typeof microusd === 'number' ? microusd : NaN;
  if (!Number.isFinite(n) || n < 0) return 'The hold could not be worked out.';
  const usd = n / 1e6;
  const shown = usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
  return `Holds about ${shown} of AI credit before it runs · unused credit is released`;
}

export function authorLine(q) {
  if (q?.by === 'eadwyn') return 'Eadwyn’s · until you edit it';
  if (q?.by === 'default') return 'Default question';
  return null;
}

const keyOf = (g) => (g?.kind === 'hypothesis' || g?.kind === 'theme') && g.ref ? g.ref : g?.kind === 'default' ? 'default' : 'other';

/**
 * The groups the guide draws, in order. `proposals` are Eadwyn's draft
 * questions not yet accepted, drawn in their group with Discard, Edit, Accept.
 */
export function groupsOf(read, questions = [], proposals = []) {
  const m = read?.material || { hypotheses: [], themes: [] };
  const groups = [
    ...(m.hypotheses || []).map((h) => ({ key: h.ref, kind: 'hypothesis', tag: h.code || 'H', label: h.claim || 'Not recorded', questions: [], proposals: [] })),
    ...(m.themes || []).map((t) => ({ key: t.ref, kind: 'theme', tag: 'Theme', label: `Not judged yet · ${t.title}`, questions: [], proposals: [] })),
  ];
  const at = new Map(groups.map((g) => [g.key, g]));
  const extra = (key, tag, label, kind) => {
    if (!at.has(key)) { const g = { key, kind, tag, label, questions: [], proposals: [] }; groups.push(g); at.set(key, g); }
    return at.get(key);
  };
  for (const q of questions) {
    const k = keyOf(q.group);
    const g = at.get(k) || (k === 'default' ? extra('default', 'Default', DEFAULTS_LABEL, 'default') : extra('other', 'Other', 'Not under an open hypothesis or theme', 'other'));
    g.questions.push(q);
  }
  for (const p of proposals) { const g = at.get(p.group); if (g) g.proposals.push(p); }
  const defaults = Array.isArray(read?.defaults) ? read.defaults : [];
  if (!questions.length && defaults.length) {
    const g = extra('default', 'Default', DEFAULTS_LABEL, 'default');
    defaults.forEach((text, i) => g.questions.push({ id: `default${i + 1}`, text, group: { kind: 'default', ref: null }, by: 'default', unsaved: true }));
  }
  return groups;
}

/** Up (-1) or down (+1) within the whole list; the order saved is the order drawn. */
export function move(list, id, dir) {
  const i = list.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export const remove = (list, id) => list.filter((q) => q.id !== id);
/** Editing a question's text makes it the founder's (the Worker decides the same on save). */
export const edit = (list, id, text) => list.map((q) => (q.id === id ? { ...q, text, by: q.text === text ? q.by : 'me' } : q));
let seq = 0;
export function add(list, group, text = '') {
  seq += 1;
  return [...list, { id: `new${Date.now().toString(36)}${seq}`, text, group: group || { kind: 'other', ref: null }, by: 'me' }];
}
/** The default questions, kept as the founder's own when they choose to keep them. */
export const keepDefaults = (defaults) => (defaults || []).map((text, i) => ({ id: `keep${i + 1}${Date.now().toString(36)}`, text, group: { kind: 'default', ref: null }, by: 'me' }));

/** What Save sends: no client-only fields. */
export const forSave = (list) => list.filter((q) => !q.unsaved).map(({ id, text, group }) => ({ id, text, group }));

/** "2 of 7 asked" from a copy. */
export function askedLine(copy) {
  const n = copy?.questions?.length || 0;
  const asked = (copy?.asked || []).filter((id) => copy.questions.some((q) => q.id === id)).length;
  return n ? `${asked} of ${n} asked` : 'No question on this interview’s guide.';
}

/** A refusal's sentence, or the given fallback; never a raw exception. */
export function sentenceOf(e, fallback) {
  const m = e && typeof e.message === 'string' ? e.message.trim() : '';
  return m && e.status ? m : fallback;
}

export const isAiOff = (read) => read?.ai?.assist === 'off';
export const canDraft = (read) => !!read?.can_write && !isAiOff(read) && ((read?.material?.hypotheses || []).length + (read?.material?.themes || []).length) > 0;
