/**
 * D1577 (#3824, deck v2 E4; PD-7 pd32, PD-1 pd1) — what the editor draws of
 * the other members on the deck. Pure, so every line is tested without a
 * socket.
 *
 *   - the toolbar: each editor's avatar (initials in their colour) and
 *     "[N] editing" (`editingLine`); you are not counted;
 *   - the stage: an area another editor is in is outlined in their colour with
 *     "[Name] is editing this area", and its tooltip says "Wait or ask [Name]"
 *     (`heldAreas`); their cursor on this card is a dot in their colour;
 *   - the deck card on Studio home: the editors' avatars (`avatarsOf`).
 *
 * `editors` is the Worker's list (`GET /api/decks/:id/presence`, or the room's
 * `presence` frame): `[{ user_id, name, colour, card, area, cursor }]`. Null
 * means presence is not on (the owner has not approved its cost yet), and
 * nothing is drawn: never "0 editing".
 */

export const AVATARS_MAX = 4;

/** Up to two initials; a member with no recorded name is "?", never an address. */
export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`).toUpperCase();
}

/** The others on the deck, one per member (a member's own tabs are one editor). */
export function othersOf(editors, youId) {
  if (!Array.isArray(editors)) return null;
  const seen = new Set();
  const out = [];
  for (const e of editors) {
    const id = Number(e?.user_id);
    if (!Number.isFinite(id) || id === Number(youId) || seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** "[N] editing", counting everyone on the deck with you; null when presence is off or you are alone. */
export function editingLine(editors, youId) {
  const others = othersOf(editors, youId);
  if (!others || !others.length) return null;
  return `${others.length + 1} editing`;
}

/** The avatars to draw (at most AVATARS_MAX) and how many more there are. */
export function avatarsOf(editors, youId) {
  const others = othersOf(editors, youId);
  if (!others || !others.length) return null;
  return {
    shown: others.slice(0, AVATARS_MAX).map((e) => ({ id: Number(e.user_id), initials: initialsOf(e.name), colour: e.colour, name: e.name || 'A member' })),
    more: Math.max(0, others.length - AVATARS_MAX),
  };
}

export const editingArea = (name) => `${name || 'Another member'} is editing this area`;
export const waitOrAsk = (name) => `Wait or ask ${name || 'them'}`;

/** The areas of one card another editor is in: `Map<areaId, { name, colour, label, tooltip }>`. */
export function heldAreas(editors, youId, cardUid) {
  const held = new Map();
  if (!cardUid) return held;
  for (const e of othersOf(editors, youId) ?? []) {
    if (e.card !== cardUid || !e.area || held.has(e.area)) continue;
    held.set(e.area, { name: e.name || 'A member', colour: e.colour, label: editingArea(e.name), tooltip: waitOrAsk(e.name) });
  }
  return held;
}

/** The other editors' cursors on one card, as percentages of the stage. */
export function cursorsOn(editors, youId, cardUid) {
  if (!cardUid) return [];
  return (othersOf(editors, youId) ?? [])
    .filter((e) => e.card === cardUid && e.cursor && Number.isFinite(e.cursor.x) && Number.isFinite(e.cursor.y))
    .map((e) => ({ id: Number(e.user_id), colour: e.colour, name: e.name || 'A member', left: `${Math.round(e.cursor.x * 1000) / 10}%`, top: `${Math.round(e.cursor.y * 1000) / 10}%` }));
}
