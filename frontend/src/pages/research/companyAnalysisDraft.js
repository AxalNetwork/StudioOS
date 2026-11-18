/**
 * D7176 (#7176, canvas D7042 boards RS-14 A2 to C1) — the dossier's draft,
 * kept apart from the saved record so that no action erases what the person
 * typed.
 *
 * Before this, every action's answer went through `take()`, which rebuilt the
 * draft from the record: a refresh, a rerun or an Add replaced an unsaved
 * title with the saved one. Now an answer is MERGED: a field the person
 * changed since the last record keeps their text, and a field they left alone
 * takes the server's. Pure functions, so the rules run in Node.
 */

/** The fields the dossier edits, in the order the canvas lists them. */
export const DRAFT_FIELDS = ['title', 'conclusion', 'notes', 'market_summary', 'gaps', 'wedge', 'next_actions'];

/** How each field is named in "Unsaved changes · title, conclusion". */
export const FIELD_WORD = {
  title: 'title', conclusion: 'conclusion', notes: 'notes', market_summary: 'market summary',
  gaps: 'gaps', wedge: 'wedge', next_actions: 'research questions',
};

/** The generated sections, by output field, with the heading the dossier gives each. */
export const GENERATED_SECTIONS = [
  ['market_summary', 'Market summary'],
  ['gaps', 'Gaps & opportunities'],
  ['wedge', 'Suggested wedge'],
  // D7175: the run's next steps are questions, not findings.
  ['next_actions', 'Suggested research questions'],
];

/** Every field a rerun may rewrite, with its heading in the review. */
export const PROPOSAL_FIELDS = [
  ...GENERATED_SECTIONS,
  ['feature_comparison', 'Feature comparison'],
  ['pricing_signals', 'Pricing signals'],
  ['positioning', 'Positioning'],
  ['traction_signals', 'Traction signals'],
  ['activity_signals', 'Hiring & content activity'],
  ['direct_competitors', 'Direct competitors named in the text'],
  ['adjacent_competitors', 'Adjacent competitors named in the text'],
];

/** A competitor's origin, as the canvas words it. */
export const ORIGIN_WORD = { discovered: 'Discovered', known: 'Named in inputs', manual: 'Added by you' };

const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const joined = (v) => (Array.isArray(v) ? v.map((x) => String(x)).join('\n') : String(v || ''));

/** The draft a record reads as: every field a string. */
export function draftFrom(record) {
  const out = record?.output || {};
  return {
    title: String(record?.title || ''),
    conclusion: String(out.conclusion || ''),
    notes: String(out.notes || ''),
    market_summary: String(out.market_summary || ''),
    gaps: joined(out.gaps),
    wedge: String(out.wedge || ''),
    next_actions: joined(out.next_actions),
  };
}

/** The fields whose draft text differs from the record's. */
export function dirtyFields(draft, record) {
  if (!draft || !record) return [];
  const saved = draftFrom(record);
  return DRAFT_FIELDS.filter((f) => draft[f] !== saved[f]);
}

/**
 * The draft after an action answered with `after`. A field the person changed
 * since `before` keeps their text; every other field takes `after`'s.
 */
export function mergeDraft(draft, before, after) {
  const next = draftFrom(after);
  if (!draft || !before) return next;
  const was = draftFrom(before);
  for (const f of DRAFT_FIELDS) if (draft[f] !== was[f]) next[f] = draft[f];
  return next;
}

/** The output a save sends: the record's output with the draft's fields laid over it. */
export function outputFrom(draft, record) {
  return {
    ...(record?.output || {}),
    market_summary: draft.market_summary.trim(),
    gaps: lines(draft.gaps),
    wedge: draft.wedge.trim(),
    next_actions: lines(draft.next_actions),
    notes: draft.notes.trim(),
    conclusion: draft.conclusion.trim(),
  };
}

/** "Copy my changes": the unsaved fields as plain text, one block each. */
export function changesText(draft, record) {
  const labels = { title: 'Title', conclusion: 'Conclusion', notes: 'Notes', market_summary: 'Market summary', gaps: 'Gaps & opportunities', wedge: 'Suggested wedge', next_actions: 'Suggested research questions' };
  return dirtyFields(draft, record).map((f) => `${labels[f]}:\n${draft[f]}`).join('\n\n');
}

/** The counts the content legend gives each kind. */
export function contentCounts(record) {
  const out = record?.output || {};
  const filled = (v) => (Array.isArray(v) ? v.length > 0 : !!String(v || '').trim());
  const sources = record?.sources || [];
  return {
    generated: GENERATED_SECTIONS.filter(([f]) => filled(out[f])).length,
    manualCandidates: (record?.candidates || []).filter((c) => c.origin === 'manual').length,
    manualSources: sources.filter((s) => s.origin === 'manual').length,
    fetched: sources.filter((s) => s.origin !== 'manual').length,
  };
}

/**
 * What the review starts with ticked (owner answer A on D7042): every
 * addition, and every rewrite of text the person has not edited. Removals and
 * rewrites of edited text start unticked.
 */
export function defaultSelection(proposal) {
  const out = proposal?.output || {};
  return {
    add: new Set((proposal?.candidates?.add || []).map((c) => c.id)),
    remove: new Set(),
    output: new Set(PROPOSAL_FIELDS.map(([f]) => f).filter((f) => out[f]?.changed && !out[f]?.edited_at)),
  };
}

/** Every change the review offers, and how many are ticked. */
export function reviewCounts(proposal, selection) {
  const out = proposal?.output || {};
  const total = (proposal?.candidates?.add || []).length + (proposal?.candidates?.remove || []).length
    + PROPOSAL_FIELDS.filter(([f]) => out[f]?.changed).length;
  const selected = selection ? selection.add.size + selection.remove.size + selection.output.size : 0;
  return { total, selected };
}

/** How many competitors the analysis would hold after the ticked changes. */
export function competitorsAfter(record, selection) {
  return (record?.candidates || []).length + (selection?.add.size || 0) - (selection?.remove.size || 0);
}

/** A proposed or current value as text for the review. */
export function proposalText(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '';
    if (value.every((v) => typeof v === 'string')) return value.map((v) => `• ${v}`).join('\n');
    return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`;
  }
  if (value && typeof value === 'object') {
    const rows = Array.isArray(value.rows) ? value.rows.length : 0;
    return `${rows} ${rows === 1 ? 'row' : 'rows'}`;
  }
  return String(value || '');
}

/** The content type each export format must answer with. */
export const EXPORT_TYPES = { md: 'text/markdown', json: 'application/json' };

/**
 * Why an export response cannot be saved as the file, or null when it can:
 * a status that is not 2xx, or a body of another type than the format's.
 */
export function exportProblem(status, contentType, format) {
  if (!(status >= 200 && status < 300)) return { kind: 'status', status };
  const want = EXPORT_TYPES[format] || EXPORT_TYPES.json;
  const got = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (got !== want) return { kind: 'type', status, type: got || 'no content type' };
  return null;
}

/** The file name an export downloads as. */
export function exportFilename(id, version, format) {
  return `competitor-analysis-${String(id).slice(0, 8)}-v${version}.${format === 'md' ? 'md' : 'json'}`;
}
