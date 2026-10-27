/**
 * D900 (#2679, part 6 of #2434) — the deck's check against the records.
 *
 * The check itself is D1264's (`raiseClaims.ts`): a deck version's figures,
 * read slide by slide by fixed patterns, never by a model, each written to
 * `raise_claims` (`surface = 'deck'`) as Backed, Founder's figure, Mismatch
 * or Not backed from the founder's pinned evidence. This file adds what the
 * deck needs on top:
 *
 *   Stale         a display state, never stored (D1263): a figure stated by a
 *                 bound field whose store has moved past it (D896's refresh).
 *   the view      each claim with its slide, both figures and both sources,
 *                 the founder's note, and the counts by state.
 *   the swap      "Use the record's figure": the stated number replaced, in
 *                 place, by the record's figure, checked by reading the
 *                 sentence again with the same patterns.
 *
 * Nothing here logs a figure; all SQL is bound.
 */
import type { Env } from '../types';
import { FIGURE_LABEL, FIGURE_UNIT, fmtFigure, parseStatedFigures, type FigureKey } from './raiseCycle';
import { claimRecord, slideText, type ComputedClaim } from './raiseClaims';
import type { RefreshRow } from './decks/sources';

export const DISPLAY_STATES = ['backed', 'founders_figure', 'mismatch', 'not_backed', 'stale'] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
/** A number as written: `$1.2m`, `42`, `3.5%`, `18`. */
const TOKEN = /(\$\s?)?(\d[\d,]*(?:\.\d+)?)(\s*(?:k|m|b|thousand|million|billion)\b)?(\s*%)?/gi;

/** The figure written the way the sentence wrote the one it replaces. */
function written(figure: FigureKey, value: number, token: { dollar: boolean; percent: boolean }): string {
  const unit = FIGURE_UNIT[figure];
  if (unit === 'money') return token.dollar ? fmtFigure(figure, value) : Math.round(value).toLocaleString('en-US');
  if (unit === 'percent') return `${Number(value.toFixed(2))}${token.percent ? '%' : ''}`;
  if (unit === 'months') return String(Number(value.toFixed(1)));
  return Math.round(value).toLocaleString('en-US');
}

/**
 * The text with its stated `figure` replaced by `to`, or null when no number
 * in it is that figure. Every candidate is verified by reading the result
 * with the check's own patterns, so only the number the check read is moved.
 */
export function swapFigure(text: string, figure: FigureKey, stated: number, to: number): string | null {
  const t = String(text ?? '');
  for (const m of t.matchAll(TOKEN)) {
    const n = Number(m[2].replace(/,/g, '')) * (m[3] ? SCALE[m[3].trim().toLowerCase()] ?? 1 : 1);
    if (!Number.isFinite(n) || n !== stated) continue;
    const at = m.index ?? 0;
    const rewritten = written(figure, to, { dollar: Boolean(m[1]), percent: Boolean(m[4]) });
    const next = `${t.slice(0, at)}${rewritten}${m[4] && FIGURE_UNIT[figure] === 'percent' ? '' : m[4] ?? ''}${t.slice(at + m[0].length)}`;
    const after = parseStatedFigures('swap', next).find((s) => s.figure === figure);
    if (after && Math.abs(after.value - to) < 1e-9) return next;
  }
  return null;
}

/**
 * One slide with the figure swapped in the first string that states it, or
 * null. The slide's shape is kept: only that string changes.
 */
export function swapInSlide(slide: unknown, figure: FigureKey, stated: number, to: number): unknown | null {
  let done = false;
  const walk = (v: unknown, depth: number): unknown => {
    if (done || depth > 6) return v;
    if (typeof v === 'string') {
      const next = swapFigure(v, figure, stated, to);
      if (next != null) { done = true; return next; }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]));
    return v;
  };
  const out = walk(slide, 0);
  return done ? out : null;
}

/** The text a binding stands behind: a field's value, a block, or the whole slide. */
function boundText(slide: any, field: string | null): string {
  if (field == null) return slideText(slide).join('\n');
  const block = /^block:(\d+)$/.exec(field);
  if (block) return slideText(Array.isArray(slide?.blocks) ? slide.blocks[Number(block[1])] : null).join('\n');
  if (field.startsWith('block:')) return '';
  const f = (Array.isArray(slide?.fields) ? slide.fields : []).find((x: any) => String(x?.key ?? '') === field);
  return slideText(f?.value).join('\n');
}

/**
 * The claims whose figure a stale binding states (`slide:<n>#<figure>`): the
 * store holds a different value than the card was bound to.
 */
export function staleClaims(slides: unknown, rows: RefreshRow[]): Set<string> {
  const out = new Set<string>();
  const list = Array.isArray(slides) ? slides : [];
  for (const r of rows) {
    if (r.state !== 'stale') continue;
    for (const s of parseStatedFigures('stale', boundText(list[r.slide], r.field))) out.add(`slide:${r.slide + 1}#${s.figure}`);
  }
  return out;
}

export type StoredClaim = {
  uid: string; field_key: string; claim_kind: string; stated_value: string | null; state: string; checked_at: string | null;
  note: string | null; note_value: string | null; noted_at: string | null;
};

/** A stored note applies only to the figure it was written against. */
export const noteApplies = (c: Pick<StoredClaim, 'note' | 'note_value' | 'stated_value'>) => c.note != null && c.note_value === c.stated_value;

/** The claims stored for one deck version, with the founder's notes. */
export async function storedDeckClaims(env: Env, projectId: number, version: string): Promise<StoredClaim[]> {
  const r = await env.DB.prepare(
    `SELECT uid, field_key, claim_kind, stated_value, state, checked_at, note, note_value, noted_at
       FROM raise_claims WHERE project_id = ? AND surface = 'deck' AND surface_version = ? ORDER BY id`,
  ).bind(projectId, version).all<StoredClaim>();
  return r.results || [];
}

const slideOf = (fieldKey: string) => { const m = /^slide:(\d+)#/.exec(fieldKey); return m ? Number(m[1]) : null; };

/**
 * PD13's rows. The founder reads both figures, both sources and the note; any
 * other reader reads the state alone (D1264: `record` and `stated_value` are
 * founder-only). `computed` carries the records from the check just run.
 */
export function deckCheckView(stored: StoredClaim[], opts: { founder: boolean; stale: Set<string>; computed?: ComputedClaim[] }) {
  const records = new Map((opts.computed ?? []).map((c) => [c.field_key, claimRecord(c)]));
  const claims = stored.map((c) => {
    const figure = (c.claim_kind in FIGURE_LABEL ? c.claim_kind : null) as FigureKey | null;
    const stale = opts.stale.has(c.field_key);
    const display: DisplayState = stale ? 'stale' : (DISPLAY_STATES as readonly string[]).includes(c.state) ? c.state as DisplayState : 'not_backed';
    const base = { uid: c.uid, slide: slideOf(c.field_key), figure: c.claim_kind, label: figure ? FIGURE_LABEL[figure] : c.claim_kind, state: c.state, display_state: display, stale, checked_at: c.checked_at };
    if (!opts.founder) return base;
    const stated = c.stated_value == null || !figure ? null : fmtFigure(figure, Number(c.stated_value));
    return {
      ...base,
      stated_value: c.stated_value, stated_shown: stated,
      record: records.get(c.field_key) ?? null,
      note: noteApplies(c) ? { text: c.note, at: c.noted_at } : null,
      note_outdated: c.note != null && !noteApplies(c),
    };
  });
  const counts = Object.fromEntries(DISPLAY_STATES.map((s) => [s, claims.filter((c) => c.display_state === s).length])) as Record<DisplayState, number>;
  return { claims: claims.sort((a, b) => (a.slide ?? 0) - (b.slide ?? 0)), counts, figures: claims.length };
}

/** When each deck version of a venture was last checked, and its counts, for PD2 and the versions table. */
export async function deckCheckSummaries(env: Env, projectId: number) {
  const checks = await env.DB.prepare(
    'SELECT deck_id, surface_version, figures, checked_at FROM deck_checks WHERE project_id = ?',
  ).bind(projectId).all<{ deck_id: number; surface_version: string; figures: number; checked_at: string }>();
  const states = await env.DB.prepare(
    `SELECT surface_version, state, COUNT(*) AS n, MAX(checked_at) AS at FROM raise_claims
      WHERE project_id = ? AND surface = 'deck' GROUP BY surface_version, state`,
  ).bind(projectId).all<{ surface_version: string; state: string; n: number; at: string | null }>();
  const decks = await env.DB.prepare('SELECT id, version FROM pitch_decks WHERE project_id = ?').bind(projectId).all<{ id: number; version: number }>();
  return (decks.results || []).map((d) => {
    const version = `v${Number(d.version) || 1}`;
    const mine = (states.results || []).filter((s) => s.surface_version === version);
    const check = (checks.results || []).find((k) => Number(k.deck_id) === Number(d.id)) ?? null;
    const at = [check?.checked_at, ...mine.map((s) => s.at)].filter((x): x is string => !!x).sort().at(-1) ?? null;
    if (!check && !mine.length) return { deck_id: Number(d.id), version, checked: false, checked_at: null, counts: null };
    const counts = Object.fromEntries(['backed', 'founders_figure', 'mismatch', 'not_backed'].map((s) => [s, Number(mine.find((m) => m.state === s)?.n ?? 0)]));
    return { deck_id: Number(d.id), version, checked: true, checked_at: at, counts };
  });
}
