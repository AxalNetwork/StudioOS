/**
 * D1604 (#3716, pd6, pd24) — a live figure on a card: its face, its hover
 * card, Refresh from records, and the Projection label. Pure, no React, no
 * network: everything here reads what the editor already holds, the sources
 * read (`GET /api/decks/sources`) and the chart series read (`GET
 * /api/decks/chart-series`).
 *
 *   faceOf          what the tile's face says beside the figure: source ·
 *                   grade, the way `SourceChip` draws it, with the record and
 *                   the date kept for the hover (owner: a live figure carries
 *                   its source and grade)
 *   figureCard      the hover card: the record, as of, the grade and "Open the
 *                   record ›"; "Not recorded" with "Add in … ›"; the changed
 *                   value with Refresh from records
 *   staleFigures    the figures on a card whose store has moved past the
 *                   snapshot the card holds, compared on the client against
 *                   the reads on screen, so a refresh clears the line at once
 *   refreshCard     every stale figure on a card moved to its store's newest
 *                   snapshot, held until a version is saved like any edit
 *   projectionOf    a chart with a point after today: "Projection", its
 *                   footnote and the Projected grade, drawn in every format
 *
 * NEVER A ZERO. A figure nothing records reads "Not recorded", never 0, and a
 * tile whose store has dropped its value keeps the value the card holds until
 * the founder chooses.
 *
 * D1523 (#3775, pd24, pd25): the badges. A figure is Linked (bound to a
 * record), Stated (typed by the founder), Uncited (a number in free text) or
 * Not recorded. The tile faces draw them in the editor from what the card
 * holds (`badgeOf`, the same rule as the Worker's `services/decks/figures.ts`);
 * Check claims draws the counts and the Stated and Uncited list from
 * `deckV2Adapter.figures` (`checkCounts`, `toReview`). Editor-only: Present,
 * share links and the print page never draw a badge.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { dayLabel } from './pitchStudioModel.js';
import { bindingOf, seriesIndex } from './chartModel.js';
import { recordLine, valueText } from './sourcesModel.js';

export { NOT_RECORDED };

export const CHANGED_LINE = 'A figure on this card has changed in its store.';
export const REFRESH_FROM_RECORDS = 'Refresh from records';
export const REFRESH_HELD = 'Refresh draws the newest snapshot and moves each chip with it. Nothing is saved until you save a version.';
export const OPEN_RECORD = 'Open the record ›';
export const PROJECTION = 'Projection';
export const PROJECTED = 'Projected';
export const PROJECTION_NOTE = 'Forward-looking: a projection from your financial model, not a result.';
/** pd24: a figure typed rather than read from a store is graded Stated; its chip, and its hover line, with who typed it when that is known. */
export const STATED_CHIP = '✎ Stated';
export const TYPED_LINE = (name = null) => `${String(name ?? '').trim() ? `Typed by ${String(name).trim()}` : 'Typed on the card'} · not linked to a record`;
/** D1523 (#3775): the other badges, and the Uncited hover. */
export const LINKED_CHIP = '▤ Linked';
export const UNCITED_CHIP = '! Uncited';
export const UNCITED_LINE = 'This number has no source';
export const LINK_RECORD = 'Link a record ›';
export const REMOVE_FIGURE = 'Remove';
export const GO_TO_CARD = 'Go to card ›';
export const BADGES = Object.freeze({ linked: LINKED_CHIP, stated: STATED_CHIP, uncited: UNCITED_CHIP, not_recorded: NOT_RECORDED });
export const GONE_LINE = 'Its store no longer holds this figure. The card keeps what it shows until you change it.';

const AREAS = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow', team: 'Team', scoring: 'Scoring' };
const GRADED = new Set(['Measured', 'Reviewed', 'Sourced', 'Stated']);
const str = (v) => String(v ?? '').trim();

/** The sources read's items by key. */
export function itemsByKey(items) {
  return new Map((Array.isArray(items) ? items : []).filter((i) => i && i.source_key).map((i) => [i.source_key, i]));
}

/**
 * A bound figure's face, as an item `SourceChip` draws: the source the store
 * names (or the binding's area while the store is not read), the record line,
 * and the binding's own date and grade, because the card shows the snapshot
 * it holds. Null for a figure no record backs.
 */
export function faceOf(binding, item = null) {
  const key = str(binding?.source_key);
  if (!key) return null;
  const grade = GRADED.has(binding.grade) ? binding.grade : null;
  if (!grade) return null;
  const area = AREAS[key.split('.')[0]] || 'StudioOS';
  const known = item && item.source_key === key;
  return {
    state: 'recorded',
    source_key: key,
    source: (known && item.source) || area,
    module: (known && item.module) || area,
    record_ref: binding.record_ref ?? (known ? item.record_ref : null) ?? null,
    as_of: binding.as_of ?? null,
    grade,
  };
}

/** A block's bound figures: a metric tile's one, or each of a chart's series. */
function bindingsIn(block) {
  if (!block || typeof block !== 'object') return [];
  if (block.kind === 'metric' && block.binding?.source_key) return [{ at: null, binding: block.binding, label: str(block.label) || 'Figure' }];
  if (block.kind === 'chart' && Array.isArray(block.series)) {
    return block.series.map((s, i) => (s?.binding?.source_key ? { at: i, binding: s.binding, label: str(s.label) || s.binding.source_key } : null)).filter(Boolean);
  }
  return [];
}

/**
 * The store's answer for one binding: `fresh`, `stale` (another snapshot),
 * `gone` (it held a snapshot and holds nothing now) or `unknown` (not read,
 * or not readable). A binding that never held a snapshot (the one-click
 * build binds a missing slot as `{ grade: 'Not recorded', snapshot_hash:
 * null }`) against a store that still records nothing is `fresh`: the
 * figure never changed.
 */
function compare(binding, cur) {
  if (!cur) return 'unknown';
  if (cur.state === 'recorded') return (cur.snapshot_hash ?? null) === (binding.snapshot_hash ?? null) ? 'fresh' : 'stale';
  if (cur.state === 'not_recorded') return binding.snapshot_hash ? 'gone' : 'fresh';
  return 'unknown';
}

const currentOf = (binding, byKey, series) => byKey.get(binding.source_key) || series.get(binding.source_key) || null;

/**
 * The figures on one card whose store has another snapshot (or none), each
 * `{ blockId, at, label, state, was, now }`. `was` is what the tile shows;
 * `now` what Refresh would put there, in the same words: the unit-formatted
 * text the worker's build writes (`valueText`), so "$12,400", never 1240000
 * cents (a series' newest value is the chart's to draw, so it is null there).
 */
export function staleFigures(card, items, charts = null) {
  const byKey = itemsByKey(items);
  const series = seriesIndex(charts);
  const out = [];
  for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
    for (const f of bindingsIn(b)) {
      const cur = currentOf(f.binding, byKey, series);
      const state = compare(f.binding, cur);
      if (state !== 'stale' && state !== 'gone') continue;
      const was = b.kind === 'metric' ? (str(b.value) || NOT_RECORDED) : null;
      const now = b.kind === 'metric' && state === 'stale' ? (valueText(cur) ?? NOT_RECORDED) : null;
      out.push({ blockId: b.id, at: f.at, label: f.label, state, was, now });
    }
  }
  return out;
}

/**
 * A metric tile moved to its store's snapshot, as the Add menu binds one,
 * its value in the unit-formatted words the worker's build writes
 * (`valueText`). Unchanged when the store holds no value.
 */
export function refreshMetric(block, item) {
  if (!block || block.kind !== 'metric' || !item || item.state !== 'recorded') return block;
  return {
    ...block,
    value: valueText(item),
    binding: { source_key: item.source_key, record_ref: item.record_ref ?? null, as_of: item.as_of ?? null, grade: item.grade ?? null, snapshot_hash: item.snapshot_hash ?? null },
  };
}

/**
 * Refresh from records on one card: every stale metric tile and chart series
 * takes its store's newest snapshot. A figure whose store is gone is left as
 * it is (never zeroed). Returns `{ card, moved }`.
 */
export function refreshCard(card, items, charts = null) {
  const byKey = itemsByKey(items);
  const series = seriesIndex(charts);
  let moved = 0;
  const blocks = (Array.isArray(card?.blocks) ? card.blocks : []).map((b) => {
    if (b?.kind === 'metric' && b.binding?.source_key) {
      const cur = byKey.get(b.binding.source_key);
      if (compare(b.binding, cur) !== 'stale') return b;
      moved += 1;
      return refreshMetric(b, cur);
    }
    if (b?.kind === 'chart' && Array.isArray(b.series)) {
      let touched = false;
      const next = b.series.map((s) => {
        const cur = s?.binding?.source_key ? series.get(s.binding.source_key) : null;
        if (!cur || compare(s.binding, cur) !== 'stale') return s;
        touched = true; moved += 1;
        return { ...s, binding: bindingOf(cur) };
      });
      return touched ? { ...b, series: next } : b;
    }
    return b;
  });
  return { card: moved ? { ...card, blocks } : card, moved };
}

/** "2026-10" from a point's x ("2026-10", "2026-10-07"), or null. */
const monthOf = (x) => (typeof x === 'string' && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null);

/**
 * A chart that draws a month after today's is a projection (pd6): the label
 * "Projection", its footnote and the Projected grade, in every format the
 * card is drawn in. A series of records never reaches past today, so this
 * is a typed or modelled series. Null otherwise.
 */
export function projectionOf(block, today = new Date().toISOString().slice(0, 10)) {
  if (!block || block.kind !== 'chart' || !Array.isArray(block.series)) return null;
  const now = monthOf(today);
  if (!now) return null;
  let from = null;
  for (const s of block.series) {
    for (const p of Array.isArray(s?.points) ? s.points : []) {
      const m = monthOf(p?.x);
      if (m && m > now && (!from || m < from)) from = m;
    }
  }
  return from ? { label: PROJECTION, note: PROJECTION_NOTE, grade: PROJECTED, from } : null;
}

/**
 * The hover card for a figure area (pd24): what the face cannot hold. Null
 * for a block that carries no figure.
 *
 *   lines    "From Grow › Revenue · as of 1 Oct 2026 · Measured"
 *   link     "Open the record ›" to the module, when the store names it
 *   missing  "Not recorded", with "Add in … ›"; null for a tile whose
 *            face holds a typed value no record backs, which reads
 *            TYPED_LINE (pd24: "Typed by [name] · not linked to a record") instead, graded
 *            Stated (D1523's `badgeOf`)
 *   changed  the line, and `was → now` for a tile
 *   projection
 */
export function figureCard(block, items, charts = null, today) {
  const byKey = itemsByKey(items);
  const series = seriesIndex(charts);
  const projection = projectionOf(block, today);
  const figures = bindingsIn(block);
  if (block?.kind === 'metric' && !figures.length) {
    const typed = Boolean(str(block.value));
    return { title: str(block.label) || 'Figure', lines: typed ? [TYPED_LINE(block.typed_by?.name)] : [], missing: typed ? null : { text: NOT_RECORDED, link: null }, changed: [], projection: null };
  }
  if (!figures.length && !projection) return null;
  const lines = [];
  let link = null;
  let missing = null;
  for (const f of figures) {
    const cur = currentOf(f.binding, byKey, series);
    const face = faceOf(f.binding, cur);
    if (!face) {
      const add = cur?.module && cur?.href ? { text: `Add in ${cur.module} ›`, href: cur.href } : null;
      missing = { text: NOT_RECORDED, link: add };
      continue;
    }
    const day = face.as_of ? dayLabel(face.as_of) : 'date not recorded';
    lines.push(`${f.at == null ? '' : `${f.label}: `}${recordLine(face)} · as of ${day} · ${face.grade}`);
    if (!link && cur?.href) link = { text: OPEN_RECORD, href: cur.href };
  }
  const changed = staleFigures({ blocks: [block] }, items, charts);
  return { title: block.kind === 'metric' ? (str(block.label) || 'Figure') : 'Chart', lines, link, missing, changed, projection };
}

/** True when the block is a figure the hover card speaks for. */
export const isFigure = (block) => Boolean(block && (block.kind === 'metric' || (block.kind === 'chart' && Array.isArray(block.series) && block.series.length)));

/**
 * D1523: every number a text names, in order, as the Worker's `numbersIn`
 * reads it: digits in any script, a currency sign, separators and a % or
 * k/m/b suffix kept on; up to 20.
 */
export function numbersIn(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(/[$€£¥₹]?\s?\p{Nd}[\p{Nd},.]*(?:\s?%|\s?[kKmMbB](?![\p{L}]))?/gu)) {
    const t = m[0].trim().replace(/[.,]+$/, '');
    if (t) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

const recordedBinding = (b) => Boolean(b && typeof b.source_key === 'string' && b.source_key && typeof b.grade === 'string' && b.grade !== 'Not recorded');

/**
 * The badge a block's face carries in the editor: `linked`, `stated`,
 * `uncited`, `not_recorded`, or null for a block that names no figure. A
 * chart or a table is graded by its weakest figure (Uncited, then Stated,
 * then Not recorded), so the face never claims more than its cells hold.
 */
export function badgeOf(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.kind === 'metric') {
    const value = str(block.value);
    if (block.binding?.source_key) return recordedBinding(block.binding) && value ? 'linked' : 'not_recorded';
    return value ? 'stated' : 'not_recorded';
  }
  if (block.kind === 'text') return numbersIn(block.text).length ? 'uncited' : null;
  const states = [];
  if (block.kind === 'chart') {
    for (const s of Array.isArray(block.series) ? block.series : []) {
      if (s?.binding?.source_key) states.push(recordedBinding(s.binding) ? 'linked' : 'not_recorded');
      else if (Array.isArray(s?.points) && s.points.length) states.push('stated');
    }
  }
  if (block.kind === 'table') {
    for (const row of Array.isArray(block.rows) ? block.rows : []) {
      for (const cell of Array.isArray(row) ? row : []) {
        if (cell?.binding?.source_key) states.push(recordedBinding(cell.binding) ? 'linked' : 'not_recorded');
        else if (numbersIn(cell?.text).length) states.push('stated');
      }
    }
  }
  for (const s of ['uncited', 'stated', 'not_recorded', 'linked']) if (states.includes(s)) return s;
  return null;
}

/** pd25: "▤ Linked 4 · ✎ Stated 2 · ! Uncited 1", with Not recorded added when any is. Null while the read is not in. */
export function checkCounts(counts) {
  if (!counts || typeof counts !== 'object') return null;
  const n = (k) => (Number.isFinite(counts[k]) ? counts[k] : 0);
  const parts = [`${LINKED_CHIP} ${n('linked')}`, `${STATED_CHIP} ${n('stated')}`, `${UNCITED_CHIP} ${n('uncited')}`];
  if (n('not_recorded')) parts.push(`${NOT_RECORDED} ${n('not_recorded')}`);
  return parts.join(' · ');
}

/**
 * pd25: the figures Check claims lists for the founder to look at, Uncited
 * first, then Stated, each `{ key, card, chip, title, line }`: card is
 * 0-based, for "Go to card ›".
 */
export function toReview(figures) {
  const rank = { uncited: 0, stated: 1 };
  return (Array.isArray(figures) ? figures : [])
    .filter((f) => f && (f.state === 'uncited' || f.state === 'stated') && Number.isInteger(f.card))
    .map((f, i) => ({
      key: `${f.card}-${f.block_id ?? 'x'}-${f.at ?? ''}-${i}`,
      card: f.card,
      state: f.state,
      chip: BADGES[f.state],
      title: str(f.label) || (f.state === 'uncited' ? (Array.isArray(f.figures) ? f.figures.join(', ') : 'A number') : (str(f.value) || 'A figure')),
      line: f.state === 'uncited' ? UNCITED_LINE : TYPED_LINE(),
    }))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.card - b.card);
}
