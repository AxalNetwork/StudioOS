/**
 * D1558 (#3805, deck v2 C10) — the editor's deep link to a card and a Grid
 * area: `?card=<uid | place from 1>&area=c<c1>-<c2>r<r1>-<r2>` (or an area id),
 * as the "deck ready to send" rows and the narrative coach's findings write it
 * (`services/narrative/coach.ts` `editorHref`). Pure.
 *
 * A card named by a uid the deck does not hold falls back to its place, then
 * to the first card. An area opens the area whose range is the one named; else
 * the area that holds the range's top-left cell; else nothing is selected.
 */
import { editorCardOf } from './reviewTileModel.js';

const RANGE = /^c([1-9][0-9]?)-([1-9][0-9]?)r([1-9][0-9]?)-([1-9][0-9]?)$/;

/** The card a link opens, 0-based. */
export function cardFromLink(raw, cards) {
  const list = Array.isArray(cards) ? cards : [];
  const key = String(raw ?? '');
  const byUid = key ? list.findIndex((c) => typeof c?.uid === 'string' && c.uid === key) : -1;
  return byUid >= 0 ? byUid : editorCardOf(raw, list.length);
}

/** A link's area as a range, or null when it names none or is malformed. */
export function rangeOf(raw) {
  const m = RANGE.exec(String(raw ?? ''));
  if (!m) return null;
  const [c1, c2, r1, r2] = m.slice(1).map(Number);
  return c2 >= c1 && r2 >= r1 ? { c1, c2, r1, r2 } : null;
}

/** The id of the area a link selects among `areas` (`gridSelection.areasOf`), or null. */
export function areaFromLink(raw, areas) {
  const list = Array.isArray(areas) ? areas : [];
  if (raw == null || raw === '') return null;
  const byId = list.find((a) => a.id === String(raw));
  if (byId) return byId.id;
  const g = rangeOf(raw);
  if (!g) return null;
  const same = list.find((a) => a.grid && a.grid.c1 === g.c1 && a.grid.c2 === g.c2 && a.grid.r1 === g.r1 && a.grid.r2 === g.r2);
  if (same) return same.id;
  const holds = list.find((a) => a.grid && a.grid.c1 <= g.c1 && g.c1 <= a.grid.c2 && a.grid.r1 <= g.r1 && g.r1 <= a.grid.r2);
  return holds ? holds.id : null;
}
