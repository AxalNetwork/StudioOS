/**
 * D4254 P2b (#4269) — Present's teleprompter (ps5) and the phone remote
 * (ps5b), pure. `PitchPresent.jsx` draws them.
 *
 * The script is the card's own speaker notes (`slide.notes`, through
 * `cardsOf`), the words P2a's Script tab writes. Nothing here writes to the
 * Worker: the size and the speed are the viewer's own, kept in this browser
 * (`localStorage`, every read and write wrapped, so a private window or a
 * blocked store just uses the defaults), and Mirror is for this screen only.
 */
import { NO_NOTES, presentHref } from './presentExportModel.js';

export const TELEPROMPTER = 'Teleprompter';
export const TELEPROMPTER_TITLE = 'Present · Teleprompter';
export const PHONE_REMOTE = 'Phone remote';
export const ON_SCREEN = 'On screen';
export const THIS_CARD = 'This card';
export const END = 'End';
export const SIZE = 'Size';
export const SPEED = 'Speed';
export const MIRROR = 'Mirror';
export const BACK = '‹ Back';
export const NEXT_CARD = 'Next card ›';
export const LAST_CARD = 'This is the last card.';

/** The script's type size, in px: A− and A+ step it inside these bounds. */
export const SIZE_MIN = 20;
export const SIZE_MAX = 72;
export const SIZE_STEP = 4;
export const SIZE_DEFAULT = 36;

/** The scroll speeds, in px a second; Off holds the script still. */
export const SPEEDS = Object.freeze([
  { id: 'off', label: 'Off', pxPerSec: 0 },
  { id: 'slow', label: 'Slow', pxPerSec: 14 },
  { id: 'steady', label: 'Steady', pxPerSec: 26 },
  { id: 'fast', label: 'Fast', pxPerSec: 42 },
]);
export const SPEED_DEFAULT = 'off';

export const PREFS_STORE_NAME = 'pitch.teleprompter.v1';

/** A size kept inside the bounds and on the step; anything unreadable is the default. */
export function clampSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return SIZE_DEFAULT;
  const stepped = Math.round(n / SIZE_STEP) * SIZE_STEP;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, stepped));
}

/** A− (dir −1) or A+ (dir +1). */
export const nextSize = (size, dir) => clampSize(clampSize(size) + (dir < 0 ? -SIZE_STEP : SIZE_STEP));

export const speedOf = (id) => SPEEDS.find((s) => s.id === id) || SPEEDS.find((s) => s.id === SPEED_DEFAULT);

/** The speed after this one, round the list (the one Speed button cycles). */
export function nextSpeed(id) {
  const i = SPEEDS.findIndex((s) => s.id === speedOf(id).id);
  return SPEEDS[(i + 1) % SPEEDS.length].id;
}

/** The viewer's kept size and speed; a missing, broken or blocked store is the defaults. */
export function readPrefs(storage) {
  try {
    const raw = storage?.getItem?.(PREFS_STORE_NAME);
    const v = raw ? JSON.parse(raw) : null;
    return { size: clampSize(v?.size ?? SIZE_DEFAULT), speed: speedOf(v?.speed).id };
  } catch {
    return { size: SIZE_DEFAULT, speed: SPEED_DEFAULT };
  }
}

/** Keeps the size and speed for this viewer; a store that refuses is ignored. */
export function writePrefs(storage, prefs) {
  try { storage?.setItem?.(PREFS_STORE_NAME, JSON.stringify({ size: clampSize(prefs?.size), speed: speedOf(prefs?.speed).id })); } catch { /* the page still works */ }
}

/** The card's script as paragraphs, or the one "no notes" line. */
export function scriptOf(card) {
  const notes = typeof card?.notes === 'string' ? card.notes.trim() : '';
  if (!notes) return { empty: true, paragraphs: [NO_NOTES] };
  return { empty: false, paragraphs: notes.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean) };
}

/** A card's number as the boards print it: "8", never Present's padded "08". */
const numberOf = (card) => { const k = Number(card?.n); return Number.isFinite(k) && k > 0 ? String(k) : String(card?.n ?? ''); };

/**
 * "Next · 8" and "Business model", with the next card's first script line
 * (its title when it has no script); null on the last card.
 */
export function nextLine(next) {
  if (!next) return null;
  const s = scriptOf(next);
  return { label: `Next · ${numberOf(next)}`, title: next.title || '', first: s.empty ? null : s.paragraphs[0] };
}

/** "7 · Traction": the card the phone remote is on. */
export const cardLabel = (card) => (card ? `${numberOf(card)} · ${card.title || ''}`.trim() : '');

/** The script's mirror, for a reflecting teleprompter glass: the words flip left to right. */
export const mirrorStyle = (on) => (on ? { transform: 'scaleX(-1)' } : undefined);

/** Present opens on the teleprompter when the address says so (P2a's Open teleprompter). */
export const startView = (params) => (params?.get?.('view') === 'teleprompter' ? 'teleprompter' : 'presenter');

/** The phone is a remote when the address says `remote=1`. */
export const isRemote = (params) => params?.get?.('remote') === '1';

/** P2a's Open teleprompter: Present on this version, opening on the teleprompter. */
export function teleprompterHref(projectId, deckId) {
  const href = presentHref(projectId, deckId);
  return `${href}${href.includes('?') ? '&' : '?'}view=teleprompter`;
}
