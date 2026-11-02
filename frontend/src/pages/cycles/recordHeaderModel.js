/**
 * D1454 (#3710, IV-D1, IV-M2): what a record's header row holds, and the
 * interview record's sections on a phone. Pure: no React, no read.
 *
 * ONE ACTION ROW (IV-D1). The read's declared actions are split into
 *   · `primary`, the first action whose tone is `primary` (Open recording on
 *     an interview, Edit on most records), drawn as the purple button;
 *   · `secondary`, every other action that is not a danger, in the read's order;
 *   · `menu`, the danger actions (Delete), behind ⋯.
 * Ask and Email are not the read's: the header puts Ask after the primary and
 * Email after Ask, so the order is primary, Ask, Email, secondary, ⋯.
 * An action the read did not declare is never invented here.
 */
export function headerRow(actions = []) {
  const list = (Array.isArray(actions) ? actions : []).filter((a) => a && typeof a.key === 'string' && a.label);
  const primary = list.find((a) => a.tone === 'primary') || null;
  const menu = list.filter((a) => a.tone === 'danger');
  const secondary = list.filter((a) => a !== primary && a.tone !== 'danger');
  return { primary, secondary, menu };
}

/**
 * IV-M2: the interview record's four sections on a phone, in this order. The
 * chosen one is kept in `?tab=` beside `?session=`, so a reload returns to it;
 * anything else in `?tab=` reads as Summary.
 */
export const PHONE_TABS = Object.freeze([
  { key: 'summary', label: 'Summary' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'findings', label: 'Findings' },
  { key: 'notes', label: 'Notes' },
]);
const TAB_KEYS = new Set(PHONE_TABS.map((t) => t.key));
export const tabOf = (raw) => (TAB_KEYS.has(raw) ? raw : 'summary');

/**
 * Which phone section a part of the record belongs to. The read's sections
 * are told apart by `recordParts(read).kind` (`transcript`, `placements`,
 * `cost`, `session`, `fed`). Summary holds the session's summary, the cost,
 * the session and the activity; Notes holds the interview's tools, What it
 * fed and the read's other sections (From this conversation).
 */
export function sectionTab(kind, title = '') {
  if (kind === 'transcript') return 'transcript';
  if (kind === 'placements') return 'findings';
  if (kind === 'cost' || kind === 'session' || kind === 'activity' || kind === 'summary') return 'summary';
  if (kind === 'tools') return 'notes';
  return /^session$/i.test(String(title).trim()) ? 'summary' : 'notes';
}

/**
 * IV-M3, tap a line to play from there: the audio part that holds `ms` and the
 * offset inside it. Parts carry `start_ms` per chunk (`GET /sessions/:id/audio`);
 * the part is the one with the greatest `start_ms` at or before `ms`. A part
 * with no `start_ms`, or a passage with none, gives null: the line then does
 * not play, rather than playing from a guessed place.
 */
export function seekTarget(parts, ms) {
  // null and '' are "no start", never 0 (Number(null) is 0).
  if (ms === null || ms === undefined || ms === '') return null;
  const at = Number(ms);
  if (!Number.isFinite(at) || at < 0 || !Array.isArray(parts) || !parts.length) return null;
  if (parts.some((p) => !Number.isFinite(Number(p?.start_ms)) || p?.start_ms === null)) return null;
  let index = -1;
  parts.forEach((p, i) => { if (Number(p.start_ms) <= at && (index < 0 || Number(p.start_ms) >= Number(parts[index].start_ms))) index = i; });
  if (index < 0) return null;
  return { index, offsetMs: at - Number(parts[index].start_ms) };
}

/** IV-M3: the player's three speeds. Anything else plays at 1×. */
export const RATES = Object.freeze([1, 1.5, 2]);
export const rateOf = (raw) => (RATES.includes(Number(raw)) ? Number(raw) : 1);
