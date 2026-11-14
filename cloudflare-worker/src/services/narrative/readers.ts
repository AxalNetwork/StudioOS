/**
 * D909 (#2693, part 3 of #2454) — which deck reads which narrative version,
 * and whether the venture is a Spin-Out venture.
 *
 * READ BY IS A BINDING, NEVER A GUESS. A card of the venture's current pitch
 * deck reads narrative version N when one of its bindings (D896: on the slide,
 * a field or a block) names that version's record, `narrative_version_meta:vN`,
 * the record_ref D896's narrative slot writes. Nothing else counts: the
 * version marker's `deck_version` is the newest deck at save time (bug 4 of
 * #2454), and saving words is not evidence that a deck reads them. With no
 * such binding a version reads "No deck reads this version.", which is true.
 *
 * SPIN-OUT. The live wording (`spinout_deck_overrides` version 0) is the
 * Spin-Out deck's (`spinoutDeckOverrides.ts`). A venture is a Spin-Out venture
 * when its current deck is the Spin-Out deck (`axal_spinout_demoday`) or it
 * holds that deck's wording; only then does New version offer "The Spin-Out
 * deck wording" (owner question 5 on #2454, read as A).
 *
 * Read only. All SQL is bound.
 */
import type { Env } from '../../types';
import { VERSION_MARKER_KEY } from '../raiseCycle';

export const SPINOUT_METHOD = 'axal_spinout_demoday';
const VERSION_REF = /^narrative_version_meta:v([1-9][0-9]{0,8})$/;

export type DeckReaders = {
  /** The venture's current pitch deck, or null when it has none. */
  deck: { id: number; version: number } | null;
  /** Narrative version → the 1-based cards of the current deck that bind it, ascending. */
  byVersion: Map<number, number[]>;
  spinout: boolean;
};

/**
 * The record_ref of every binding on each slide, in the three places D896's
 * `bindingsOf` (`services/decks/sources.ts`) walks: the slide, its fields and
 * its blocks. Walked here rather than imported, because `decks/sources.ts`
 * reads `raiseCycle.ts`, which reads this file.
 */
function slideRefs(slides: unknown): Array<{ slide: number; ref: string }> {
  const out: Array<{ slide: number; ref: string }> = [];
  const add = (slide: number, b: any) => {
    if (b && typeof b === 'object' && typeof b.source_key === 'string' && b.source_key) out.push({ slide, ref: String(b.record_ref ?? '') });
  };
  (Array.isArray(slides) ? slides : []).forEach((s: any, i) => {
    add(i, s?.binding);
    for (const f of Array.isArray(s?.fields) ? s.fields : []) add(i, f?.binding);
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) add(i, b?.binding);
  });
  return out;
}

/** The cards of `slides` that bind each narrative version (pure). */
export function readersOf(slides: unknown): Map<number, number[]> {
  const out = new Map<number, Set<number>>();
  for (const { slide, ref } of slideRefs(slides)) {
    const m = VERSION_REF.exec(ref);
    if (!m) continue;
    const v = Number(m[1]);
    if (!out.has(v)) out.set(v, new Set());
    out.get(v)!.add(slide + 1);
  }
  return new Map([...out].map(([v, cards]) => [v, [...cards].sort((a, b) => a - b)]));
}

const methodOf = (slides: unknown): string | null => {
  for (const s of Array.isArray(slides) ? slides : []) if (s && typeof s.method_id === 'string' && s.method_id) return s.method_id;
  return null;
};

export async function deckReaders(env: Env, projectId: number): Promise<DeckReaders> {
  const row = await env.DB.prepare(
    'SELECT id, version, slides FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY version DESC, id DESC LIMIT 1',
  ).bind(projectId).first<{ id: number; version: number; slides: string | null }>();
  let slides: unknown = [];
  try { slides = JSON.parse(row?.slides || '[]'); } catch { slides = []; }
  const live = await env.DB.prepare(
    'SELECT 1 AS n FROM spinout_deck_overrides WHERE project_id = ? AND version = 0 AND field_key != ? LIMIT 1',
  ).bind(projectId, VERSION_MARKER_KEY).first<{ n: number }>();
  return {
    deck: row ? { id: Number(row.id), version: Number(row.version) } : null,
    byVersion: row ? readersOf(slides) : new Map(),
    spinout: methodOf(slides) === SPINOUT_METHOD || !!live,
  };
}

/** "Pitch deck v6 · cards 1, 2, 5", or "No deck reads this version." */
export function readBySentence(r: DeckReaders, version: number): string {
  const cards = r.deck ? r.byVersion.get(version) : undefined;
  if (!r.deck || !cards?.length) return 'No deck reads this version.';
  return `Pitch deck v${r.deck.version} · ${cards.length === 1 ? 'card' : 'cards'} ${cards.join(', ')}`;
}
