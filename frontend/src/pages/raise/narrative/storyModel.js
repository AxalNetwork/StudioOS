/**
 * D910 (#2694) — the Story tab's words and derivations (NAR2, NAR3, NAR21),
 * kept pure so the tests read them without a browser.
 *
 * WHAT IS READ. Two reads, each on `main`:
 *   - `GET /api/cycles/raise/narrative/:version` (D908): the version's
 *     sections in order, each with its words, audience note and place, and
 *     the figures bound into each section;
 *   - `GET /api/decks/sources` (D896): PITCH's one source registry,
 *     `DECK_SOURCES`, which Insert a figure lists and every bound figure is
 *     checked against.
 * Either part can be unreadable; a part that failed is never drawn as empty.
 *
 * A FIGURE IS BOUND OR A CLAIM, NEVER A BARE NUMBER. A bound figure is drawn
 * from the registry's current item with its Source, date and grade. A number
 * the founder typed is a claim: underlined, with the pill "Founder's figure"
 * until #2430's claim check gives it a state.
 *
 * WHERE A BOUND FIGURE SITS. D908 keeps a section's bindings as its own
 * ordered list, beside the words, not as a token inside them: most sections'
 * words are the deck's own rows, and a token there would print in the deck.
 * D1114 (#2994) puts the figure inside the sentence without a token: Insert
 * writes the figure's own value where the cursor is and binds it, and "Reads
 * as" draws that value as the bound chip in its place (NAR2, NAR20). The deck
 * prints the same value. A bound figure whose value is not in the words yet is
 * listed once under them, until it is placed.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { AREA_LABEL, AREA_ORDER, NOT_ON_STUDIOOS, chipOf, fillLink, gapLine, valueText } from '../pitch/sourcesModel.js';
import { dayLabel } from '../pitch/pitchStudioModel.js';

/**
 * The story's sections, as the Worker keeps them (`services/narrative/store.ts`
 * NARRATIVE_SECTIONS): where each one's words live and how long they may be.
 * A guard test reads the Worker's list and fails if the two drift.
 */
export const SECTIONS = [
  { key: 'problem', label: 'Problem', store: 'deck', max: 600 },
  { key: 'solution', label: 'Solution', store: 'section', max: 4000 },
  { key: 'why_now', label: 'Why now', store: 'meta', max: 2000 },
  { key: 'market', label: 'Market', store: 'deck', max: 600 },
  { key: 'traction', label: 'Traction', store: 'deck', max: 600 },
  { key: 'business_model', label: 'Business model', store: 'section', max: 4000 },
  { key: 'competition', label: 'Competition', store: 'deck', max: 600 },
  { key: 'team', label: 'Team', store: 'section', max: 4000 },
  { key: 'ask', label: 'The ask', store: 'deck', max: 300 },
  { key: 'closing', label: 'Closing line', store: 'deck', max: 600 },
];
const SPEC = new Map(SECTIONS.map((s) => [s.key, s]));

export const NOTE_MAX = 500;
export const MAX_BINDINGS = 20;
export const BINDING_GRADES = ['Measured', 'Reviewed', 'Sourced', 'Stated'];

/* ------------------------------------------------------------------ *
 * NAR21's states, one table each
 * ------------------------------------------------------------------ */

/** The five claim states (NAR21). Only "Founder's figure" reaches a page until #2430 lands. */
export const CLAIM_STATES = {
  Backed: { icon: '✓', tone: 'ok' },
  "Founder's figure": { icon: '◐', tone: 'note' },
  Mismatch: { icon: '≠', tone: 'bad' },
  'Not backed': { icon: '○', tone: 'grey' },
  Stale: { icon: '↻', tone: 'warn' },
};
export const FOUNDERS_FIGURE = "Founder's figure";

/** The section dots (NAR21). Mismatch waits for a per-section check (#2430). */
export const DOT_STATES = ['Empty', 'Written', 'Stale', 'Mismatch'];

/** The bound-figure chip's three states (NAR21), from the registry's item. */
export const CHIP_STATES = ['normal', 'stale', 'missing'];

/* ------------------------------------------------------------------ *
 * The reads
 * ------------------------------------------------------------------ */

/** The version's sections in the Worker's order, or null when the store was unreadable. */
export function storySections(read) {
  if (!read || read.sections?.state !== 'ok' || !Array.isArray(read.sections.items)) return null;
  return read.sections.items
    .filter((s) => SPEC.has(s?.key))
    .map((s) => ({
      key: s.key,
      label: SPEC.get(s.key).label,
      store: SPEC.get(s.key).store,
      max: SPEC.get(s.key).max,
      body: typeof s.body === 'string' && s.body.trim() ? s.body : null,
      note: typeof s.audience_note === 'string' && s.audience_note.trim() ? s.audience_note : null,
    }));
}

/** Each section's bindings in their order, or null when the store was unreadable. */
export function bindingsBySection(read) {
  if (!read || read.bindings?.state !== 'ok' || !Array.isArray(read.bindings.items)) return null;
  const out = new Map();
  for (const b of [...read.bindings.items].sort((x, y) => (Number(x.position) || 0) - (Number(y.position) || 0))) {
    if (!SPEC.has(b?.section)) continue;
    const list = out.get(b.section) || [];
    list.push({ source_key: b.source_key, record_ref: b.record_ref ?? null, as_of: b.as_of ?? null, grade: b.grade, snapshot_hash: b.snapshot_hash ?? null });
    out.set(b.section, list);
  }
  return out;
}

/** Version 0 is the live deck: it reads, and nothing here writes it (D908). */
export const isLiveDeck = (read) => Number(read?.version) === 0 || read?.meta?.live === true;

/** The audience a version is for, in words ("seed fund"), or null. */
export function audienceOf(read) {
  const t = read?.meta?.state === 'ok' ? read.meta.investor_type : null;
  return t ? String(t).replace(/_/g, ' ') : null;
}

/* ------------------------------------------------------------------ *
 * Bound figures
 * ------------------------------------------------------------------ */

/**
 * Where a bound figure stands against the registry now:
 *   - `fresh`: the item holds the value the figure was bound to;
 *   - `stale`: the record changed since (another snapshot);
 *   - `missing`: the registry holds no value for it any more;
 *   - `unknown`: the registry, or that item, could not be read.
 */
export function figureStatus(binding, sources) {
  if (!sources || sources.status !== 'ok') return 'unknown';
  const item = (sources.items || []).find((it) => it.source_key === binding?.source_key);
  if (!item || item.state === 'not_recorded') return 'missing';
  if (item.state !== 'recorded') return 'unknown';
  if (!binding.snapshot_hash || !item.snapshot_hash) return 'unknown';
  return item.snapshot_hash === binding.snapshot_hash ? 'fresh' : 'stale';
}

/**
 * What a bound figure's chip draws (NAR21): the record's current value with
 * its Source, date and grade; Stale says since when; Missing says where to
 * add it. A figure is never drawn without its record.
 */
export function boundChip(binding, sources) {
  const status = figureStatus(binding, sources);
  const item = sources?.status === 'ok' ? (sources.items || []).find((it) => it.source_key === binding?.source_key) : null;
  // A key is not a name: without its record a figure is "A bound figure".
  const label = item?.label || 'A bound figure';
  if (status === 'missing') {
    return { state: 'missing', label, value: null, chip: null, note: NOT_ON_STUDIOOS, fill: item ? fillLink(item) : null };
  }
  if (status === 'unknown') {
    return { state: 'missing', label, value: null, chip: null, note: item ? gapLine(item) || 'Could not be read' : 'The sources could not be read', fill: null };
  }
  return {
    state: status === 'stale' ? 'stale' : 'normal',
    label,
    value: valueText(item),
    chip: chipOf(item),
    note: status === 'stale' ? `Changed since ${binding.as_of ? dayLabel(binding.as_of) : 'it was inserted'}` : null,
    fill: null,
  };
}

/** A binding, as D908 stores it, from a registry item the founder inserts. */
export function bindingFromItem(item) {
  if (!item || item.state !== 'recorded' || !BINDING_GRADES.includes(item.grade)) return null;
  const asOf = item.as_of ? String(item.as_of).slice(0, 10) : null;
  return {
    source_key: item.source_key,
    record_ref: item.record_ref ?? null,
    as_of: asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null,
    grade: item.grade,
    snapshot_hash: item.snapshot_hash && /^[0-9a-f]{24}$/.test(item.snapshot_hash) ? item.snapshot_hash : null,
  };
}

/** Why an item cannot be inserted into a section, or null when it can. */
export function cannotInsert(item, bindings = []) {
  if (!item || item.state !== 'recorded') return gapLine(item) || NOT_ON_STUDIOOS;
  if (bindings.some((b) => b.source_key === item.source_key)) return 'Already in this section';
  if (bindings.length >= MAX_BINDINGS) return `A section holds at most ${MAX_BINDINGS} figures`;
  if (!bindingFromItem(item)) return 'This figure has no grade to bind';
  return null;
}

/* ------------------------------------------------------------------ *
 * Typed numbers are claims
 * ------------------------------------------------------------------ */

/** A typed figure: money, a percentage, a count or a decimal, with its unit. */
// Not inside a word: "B2B" and "Q3" are names, not figures.
const NUMBER = /(?<![A-Za-z0-9])(?:[$€£]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|bn\b|k\b|K\b|m\b|M\b|x\b))?(?![A-Za-z0-9])/g;

/**
 * The words as segments: plain text, and every typed number as a claim. A
 * claim reads "Founder's figure" until #2430's claim check states it.
 */
export function claimSegments(text) {
  const s = String(text ?? '');
  const out = [];
  let at = 0;
  for (const m of s.matchAll(NUMBER)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index), claim: false });
    out.push({ text: m[0], claim: true, state: FOUNDERS_FIGURE });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at), claim: false });
  return out;
}

export const claimsIn = (text) => claimSegments(text).filter((x) => x.claim).length;

/* ------------------------------------------------------------------ *
 * Section dots and the rail
 * ------------------------------------------------------------------ */

/** A section's dot: Empty with no words and no figure; Stale when a figure it binds has moved; else Written. */
export function sectionDot(section, bindings = [], sources = null) {
  if (!section?.body && !bindings.length) return 'Empty';
  if (bindings.some((b) => ['stale', 'missing'].includes(figureStatus(b, sources)))) return 'Stale';
  return 'Written';
}

/** Move one section up (-1) or down (+1) in the order; the ends stay put. */
export function moveSection(order, key, delta) {
  const i = order.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

const sameBindings = (a = [], b = []) => a.length === b.length
  && a.every((x, i) => x.source_key === b[i].source_key && x.snapshot_hash === b[i].snapshot_hash);

/** The draft a page starts from: the saved words, notes, figures and order. */
export function draftOf(sections, bindings) {
  return {
    order: (sections || []).map((s) => s.key),
    byKey: Object.fromEntries((sections || []).map((s) => [s.key, {
      body: s.body ?? '', note: s.note ?? '', bindings: [...(bindings?.get(s.key) || [])],
    }])),
  };
}

/**
 * What Save version sends, one `PUT …/sections/:section` per changed section,
 * and what each one changes in words. A section whose place moved sends its
 * new place; nothing unchanged is sent.
 */
export function savePlan(saved, draft) {
  const base = draftOf(saved.sections, saved.bindings);
  const writes = [];
  draft.order.forEach((key, i) => {
    const spec = SPEC.get(key);
    const was = base.byKey[key] || { body: '', note: '', bindings: [] };
    const now = draft.byKey[key] || was;
    const body = {};
    const changes = [];
    if (now.body.trim() !== was.body.trim()) {
      body.body = now.body.trim() ? now.body.trim() : null;
      // D1114: words Eadwyn proposed and the founder accepted, untouched since, are saved as Eadwyn's.
      if (body.body && now.source === 'eadwyn') { body.source = { kind: 'eadwyn' }; changes.push('Eadwyn’s words'); } else changes.push(body.body ? 'new words' : 'words cleared');
    }
    if (now.note.trim() !== was.note.trim()) { body.audience_note = now.note.trim() ? now.note.trim() : null; changes.push('audience note'); }
    if (base.order.indexOf(key) !== i) { body.position = i; changes.push('new place'); }
    if (saved.bindings && !sameBindings(now.bindings, was.bindings)) {
      body.bindings = now.bindings;
      changes.push(`${now.bindings.length} bound ${now.bindings.length === 1 ? 'figure' : 'figures'}`);
    }
    if (changes.length) writes.push({ section: key, label: spec.label, store: spec.store, body, changes });
  });
  return writes;
}

/** The Save version dialog's words: what it changes, in this version only. */
export function saveDialog(writes, version) {
  const deck = writes.filter((w) => w.store === 'deck' && 'body' in w.body).map((w) => w.label);
  return {
    title: `Save version ${version}?`,
    lines: writes.map((w) => `${w.label}: ${w.changes.join(', ')}.`),
    deck: deck.length
      ? `${listOf(deck)} ${deck.length === 1 ? 'is' : 'are'} the deck’s words for v${version}: saving ${deck.length === 1 ? 'it' : 'them'} changes this version’s deck wording and runs its check again.`
      : null,
    keep: 'Other versions and the live deck do not change.',
    confirm: 'Save version',
  };
}

const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** What a failed save says. The text stays in the editor (NAR17d). */
export const SAVE_FAILED = 'Save failed. Your text is kept here; nothing after the failed section was saved.';

/* ------------------------------------------------------------------ *
 * Insert a figure (NAR3)
 * ------------------------------------------------------------------ */

/**
 * The registry's items grouped by area for the popover: every slot, so a
 * missing one shows where to add it. Withheld items are not this reader's,
 * and Scoring is a band the deck includes on purpose, never a story figure.
 */
export function insertGroups(items, search = '', only = null) {
  const needle = String(search || '').trim().toLowerCase();
  // D1114: Home's "Insert in Story" opens this on its one figure (`only`).
  const keep = (it) => it.state !== 'withheld' && !it.optional && it.area !== 'scoring'
    && (!only || it.source_key === only)
    && (!needle || `${it.label} ${it.module}`.toLowerCase().includes(needle));
  return AREA_ORDER
    .map((area) => ({ id: area, label: AREA_LABEL[area], items: (items || []).filter((it) => it.area === area && keep(it)) }))
    .filter((g) => g.items.length);
}

export const INSERT_FOOT = 'Inserted figures show the record’s value with its source. When the record changes the figure goes Stale; you choose when to save again.';

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const STORY_UNREADABLE = 'The story’s sections could not be read. This is not a claim that they are empty.';
export const BINDINGS_UNREADABLE = 'The bound figures could not be read, so none is drawn and none can be inserted.';
export const LIVE_DECK = 'Version 0 is the live deck’s wording. Change it in the deck, or in a saved version.';
export const NOTHING_TO_SAVE = 'Nothing changed since the last save.';
export const SECTION_COUNT = (i, n) => `STORY · SECTION ${i + 1} OF ${n}`;

export { NOT_RECORDED };

/* ------------------------------------------------------------------ *
 * D1114 (#2994): bound figures inside the sentence
 * ------------------------------------------------------------------ */

const norm = (t) => String(t ?? '').replace(/\s+/g, '').toLowerCase();

/**
 * The words as segments: plain text, a typed number as a claim, and a typed
 * number that is a bound figure's own value as that figure, in its place.
 * `figures` is `[{ binding, view }]` (`boundChip`); each binds one place.
 */
export function inlineSegments(text, figures = []) {
  const free = figures.filter((f) => f.view?.value);
  const used = new Set();
  return claimSegments(text).map((seg) => {
    if (!seg.claim) return seg;
    const f = free.find((x) => !used.has(x.binding.source_key) && norm(x.view.value) === norm(seg.text));
    if (!f) return seg;
    used.add(f.binding.source_key);
    return { text: seg.text, figure: f };
  });
}

/** The bound figures whose value is not in the words yet: listed under them until placed. */
export function unplacedFigures(text, figures = []) {
  const placed = new Set(inlineSegments(text, figures).filter((x) => x.figure).map((x) => x.figure.binding.source_key));
  return figures.filter((f) => !placed.has(f.binding.source_key));
}

/** The words with a figure's value put where the cursor is, a space either side as the sentence needs. */
export function insertAt(text, caret, value) {
  const s = String(text ?? '');
  const at = Number.isInteger(caret) && caret >= 0 && caret <= s.length ? caret : s.length;
  const before = s.slice(0, at);
  const after = s.slice(at);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '';
  return { text: `${before}${pre}${value}${post}${after}`, caret: at + pre.length + String(value).length };
}

/* ------------------------------------------------------------------ *
 * D1114 (#2994): "Ask Eadwyn ▾" (NAR2), AI off (NAR17b), out of tokens (NAR17c)
 * ------------------------------------------------------------------ */

/** The menu, in the canvas's words; each is one run of `draft:narrative-section`. */
export const ASK_MODES = [
  { mode: 'draft', label: 'Draft this section' },
  { mode: 'shorten', label: 'Shorten' },
  { mode: 'plain', label: 'Plain words' },
];
export const SECTION_OPTION = 'draft:narrative-section';
export const AI_OFF_LINE = 'AI assistance is off on this page. You can still write and check.';
export const AI_OFF_SUB = 'Turn it back on from the Eadwyn rail.';
export const AI_DRAW = 'Runs use your plan’s AI allowance first, then your AI tokens.';
export const ASK_FOOT = 'Eadwyn proposes; nothing changes until you accept and save. Eadwyn writes no numbers.';
export const PROPOSAL_NOTE = 'Proposed by Eadwyn. Accept puts these words in the section; Save version saves them.';
export const DRAFT_REMOVED = 'A line with a number was removed. Insert figures yourself from your records.';

const TOKEN_CODES = new Set(['budget_user_day', 'budget_user_month', 'budget_org_month', 'spend_limit', 'insufficient_tokens']);

/**
 * What a refused run says (NAR17b, NAR17c). `tokens`: the allowance and the
 * tokens cannot cover it, nothing was charged, with Top up. `off`: the page's
 * switch is off. Otherwise the Worker's own sentence. Never a code.
 */
export function runRefusal(e) {
  const code = e?.code || e?.data?.code || e?.data?.error || null;
  const said = String(e?.data?.message || e?.data?.detail || e?.message || '').trim();
  const sentence = said && !/^[a-z_]+$/.test(said) ? said : '';
  if (Number(e?.status) === 402 || TOKEN_CODES.has(code)) {
    return { kind: 'tokens', text: sentence || 'Not enough AI tokens for this run.', sub: `${AI_DRAW} Nothing was charged.` };
  }
  if (code === 'assist_off') return { kind: 'off', text: AI_OFF_LINE, sub: AI_OFF_SUB };
  return { kind: 'other', text: sentence || 'Eadwyn could not write this just now. Nothing was charged. Try again.', sub: null };
}

